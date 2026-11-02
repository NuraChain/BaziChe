import { randomBytes } from 'node:crypto';

import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError } from '@azerothjs/http';
import type { DataSource, EntityManager } from 'typeorm';

import { ConversationMember } from '../../entities/conversation-member.entity.ts';
import { Friendship } from '../../entities/friendship.entity.ts';
import { GroupBan } from '../../entities/group-ban.entity.ts';
import { GroupEvent } from '../../entities/group-event.entity.ts';
import { GroupInvite } from '../../entities/group-invite.entity.ts';
import { GroupMember } from '../../entities/group-member.entity.ts';
import { GroupMute } from '../../entities/group-mute.entity.ts';
import { GroupRequest } from '../../entities/group-request.entity.ts';
import { Group, type GroupPrivacy } from '../../entities/group.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { instantOf, keysetAfter } from '../../lib/keyset.ts';
import { firstRow, rowsOf } from '../../lib/rows.ts';
import { folded, likeLiteral, SEARCH_FROM, searchNeedle } from '../social/names.ts';
import type { SocialService } from '../social/service.ts';
import { GROUP_REFUSALS, type GroupRefusal } from './refusals.ts';
import {
    FIRST_MEMBERS_MOST, GROUP_LOG_PAGE, GROUP_RIGHTS, LINK_TOKEN, MEMBERS_PAGE, SWITCH_COLUMNS, SWITCH_DEFAULTS, SWITCHES, mayIn, outranks,
    type GroupAct, type GroupEventKind, type GroupRight, type GroupRole, type GroupSwitches
} from './roles.ts';
import { candidatesFor, checkSlug, slugFromName } from './slug.ts';

export interface GroupRow
{
    id: string;
    slug: string;
    name: string;
    blurb: string;
    crest: string;
    hue: number;
    game: string | null;
    privacy: GroupPrivacy;
    photo: string | null;
    approval: boolean;
    members_send: boolean;
    members_media: boolean;
    members_add: boolean;
    members_pin: boolean;
    members_info: boolean;
    members_call: boolean;
    members_join_call: boolean;
    members_speak: boolean;
    created_at: Date;

    /** The owner's handle. Never null in practice - the single-owner index sees to that. */
    owner: string | null;

    /** This viewer's role, or null when they are only looking. */
    role: GroupRole | null;

    /** The rights this viewer holds, when they are an admin. */
    rights: GroupRight[] | null;

    /** Whether this viewer waits for an answer to a request to join, and how many wait for whoever may answer. */
    requested: boolean;
    request_count: number;

    /** Whether a mute is in force on this viewer, and until when when it ends by itself. */
    muted: boolean;
    muted_until: Date | null;

    /** Up to six handles, the staff first, minus anyone this viewer cannot see. */
    faces: string[];

    /** Everyone, including the ones this viewer has blocked. The blurb says "12 members". */
    member_count: number;

    conversation_id: string | null;
}

export interface MemberRow
{
    user_id: string;
    role: GroupRole;
    rights: GroupRight[] | null;
    joined_at: Date;
    role_since: Date | null;
    muted: boolean;
    muted_until: Date | null;
    rank: number;
    at_key: string;
}

export interface EventRow
{
    id: string;
    kind: GroupEventKind;
    actor_handle: string | null;
    actor_role: GroupRole | null;
    person_handle: string | null;
    details: Record<string, string>;
    created_at: Date;
    at_key: string;
}

export interface LinkRow
{
    id: string;
    token: string;
    by: string | null;
    created_at: Date;
    expires_at: Date | null;
    max_uses: number | null;
    uses: number;
    approval: boolean;
    revoked_at: Date | null;
    live: boolean;
}

/** What a link lets its holder do: they are in, may join, may ask, have asked, or are kept out. */
export type LinkState = 'member' | 'join' | 'request' | 'requested' | 'banned';

/** What a change to a person's place answers: whether anything changed, and from what. */
export interface Changed
{
    changed: boolean;
}

/** How many times a slug claim will try before giving up. */
const CLAIM_ATTEMPTS = 6;

/** What a group name may be, before it is folded into a slug. */
const NAME_MAX = 60;
const BLURB_MAX = 240;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIQUE_VIOLATION = '23505';

/** The most links a group's list shows, and the most requests its queue does. */
const LINKS_MOST = 100;
const REQUESTS_MOST = 200;

/** The switch columns in their order, and the values a new group starts with in the same order. */
const SWITCH_LIST = SWITCHES.map((name) => SWITCH_COLUMNS[name]).join(', ');

export const refused = (word: GroupRefusal, message: string, details?: Record<string, unknown>) =>
    new HttpError(GROUP_REFUSALS[word], message, { code: word, ...(details === undefined ? {} : { details }) });

const rankOf = (alias: string) => `case ${ alias }.role when 'owner' then 3 when 'admin' then 2 when 'moderator' then 1 else 0 end`;

const apart = (viewer: string, other: string) => `not exists (select 1 from blocks b
                         where (b.user_id = ${ viewer } and b.blocked_id = ${ other })
                            or (b.user_id = ${ other } and b.blocked_id = ${ viewer }))`;

const LIVE_MUTE = `(m.until is null or m.until > now())`;

/** A link that still brings people in: not revoked, not past its end, not used up. */
const LIVE_LINK = `(i.revoked_at is null and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses))`;

/**
 * The columns every group read returns, parameterised by the viewer.
 *
 * `$1` is always the viewer. `u.handle::text` is not decoration: handle is `citext`, and
 * `array_agg` over it hands node-pg an OID it has no parser for, so the faces arrive as the
 * literal string `{alex,sara.k}` instead of an array. It has happened once already in chat.
 */
const GROUP_COLUMNS = `
    g.id, g.slug::text as slug, g.name, g.blurb, g.crest, g.hue, g.game, g.privacy, g.photo, g.approval,
    ${ SWITCH_LIST }, g.created_at,

    (select u.handle::text
       from group_members gm join users u on u.id = gm.user_id
      where gm.group_id = g.id and gm.role = 'owner')                       as owner,

    (select gm.role from group_members gm
      where gm.group_id = g.id and gm.user_id = $1)                         as role,

    (select gm.rights from group_members gm
      where gm.group_id = g.id and gm.user_id = $1)                         as rights,

    exists (select 1 from group_mutes m
             where m.group_id = g.id and m.user_id = $1 and ${ LIVE_MUTE }) as muted,

    (select m.until from group_mutes m
      where m.group_id = g.id and m.user_id = $1 and ${ LIVE_MUTE })        as muted_until,

    (select count(*)::int from group_members gm where gm.group_id = g.id)   as member_count,

    exists (select 1 from group_requests r
             where r.group_id = g.id and r.user_id = $1)                   as requested,

    (select count(*)::int from group_requests r where r.group_id = g.id)  as request_count,

    (select coalesce(array_agg(f.handle order by f.rank desc, f.since nulls last, f.joined, f.handle), '{}')
       from (select u.handle::text as handle, ${ rankOf('gm') } as rank, gm.role_since as since, gm.joined_at as joined
               from group_members gm join users u on u.id = gm.user_id
              where gm.group_id = g.id and u.is_suspended = false and ${ apart('$1', 'u.id') }
              order by rank desc, gm.role_since nulls last, gm.joined_at, u.handle
              limit 6) f)                                                   as faces,

    (select c.id from conversations c
      where c.group_id = g.id and c.kind = 'group')                         as conversation_id
`;

/**
 * Whether this viewer may be told the group exists at all.
 *
 * The same rule the chat domain follows for a conversation: a private group answers somebody who is
 * not in it exactly as a group that was never made. Not a 403 - a 403 would confirm it is there, and
 * the point of private is that a stranger cannot tell the difference between a closed door and a
 * typo. `$1` is the viewer, as everywhere else in this file.
 *
 * One string, so the rule cannot be applied to one read and forgotten on the next.
 */
const VISIBLE_TO = `
    (g.privacy = 'public'
        or exists (select 1 from group_members gm
                    where gm.group_id = g.id and gm.user_id = $1))
`;

/** A members page's cursor: the rank, the microseconds of joining, and the account. */
const MEMBER_CURSOR = /^([0-3])\|(\d{1,17})\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export const switchesOf = (row: GroupRow): GroupSwitches => ({
    send: row.members_send,
    media: row.members_media,
    add: row.members_add,
    pin: row.members_pin,
    info: row.members_info,
    call: row.members_call,
    joinCall: row.members_join_call,
    speak: row.members_speak
});

interface Standing
{
    role: GroupRole;
    rights: GroupRight[] | null;
    muted: boolean;
}

export function createGroupService(db: DataSource, social: SocialService)
{
    /**
     * This viewer's role, which IS the authorisation for every write.
     *
     * Reads are open - groups are discoverable, that is what `discover` is for - but nothing is
     * written by somebody who is not in the room.
     */
    const roleOf = async (me: string, groupId: string): Promise<GroupRole | null> =>
    {
        if (!UUID.test(groupId))
        {
            return null;
        }
        const row = await db.getRepository(GroupMember).findOne({
            select: { role: true },
            where: { groupId, userId: me }
        });
        return row?.role ?? null;
    };

    const one = async (me: string, groupId: string): Promise<GroupRow | null> =>
    {
        if (!UUID.test(groupId))
        {
            return null;
        }
        const rows = await db.query(
            `select ${ GROUP_COLUMNS } from groups g where g.id = $2 and ${ VISIBLE_TO }`,
            [me, groupId]
        );
        return firstRow<GroupRow>(rows);
    };

    /** Somebody's place in a group, read inside the transaction that holds the group's lock. */
    const standingIn = async (tx: EntityManager, userId: string, groupId: string): Promise<Standing | null> =>
    {
        const rows = await tx.query(
            `select gm.role, gm.rights,
                    exists (select 1 from group_mutes m
                             where m.group_id = gm.group_id and m.user_id = gm.user_id and ${ LIVE_MUTE }) as muted
               from group_members gm
              where gm.group_id = $1 and gm.user_id = $2`,
            [groupId, userId]
        );
        return firstRow<Standing>(rows);
    };

    /**
     * Takes the group's row for the length of a change, and reads what its members may do from it.
     *
     * Every change to who holds what goes through here, so two of them to one group run one after the
     * other and each reads the actor's place again after the one before has landed: a role taken away
     * in the moment between two presses is a role the second press no longer has.
     */
    const lockGroup = async (tx: EntityManager, groupId: string) =>
    {
        const group = UUID.test(groupId)
            ? await tx.getRepository(Group).findOne({ where: { id: groupId }, lock: { mode: 'pessimistic_write' } })
            : null;

        if (group === null)
        {
            throw new NotFoundError('No group there.');
        }

        const switches: GroupSwitches = {
            send: group.membersSend,
            media: group.membersMedia,
            add: group.membersAdd,
            pin: group.membersPin,
            info: group.membersInfo,
            call: group.membersCall,
            joinCall: group.membersJoinCall,
            speak: group.membersSpeak
        };

        return { group, switches };
    };

    /** The actor's place, refused as a group that is not there for somebody not in it. */
    const actorIn = async (tx: EntityManager, me: string, groupId: string) =>
    {
        const standing = await standingIn(tx, me, groupId);
        if (standing === null)
        {
            throw new NotFoundError('No group there.');
        }
        return standing;
    };

    const must = (standing: Standing, switches: GroupSwitches, act: GroupAct) =>
    {
        if (!mayIn(standing, switches, act))
        {
            throw refused('group-right', 'You cannot do that in this group.');
        }
    };

    /** The person an act is about: somebody else, and ranked below the actor when they are in the group. */
    const mustReach = (me: string, actor: Standing, otherId: string, other: Standing | null) =>
    {
        if (otherId === me)
        {
            throw refused('group-self', 'That is not something to do to yourself here.');
        }
        if (!outranks(actor.role, other?.role ?? null))
        {
            throw refused('group-rank', 'They hold a place at or above yours here.');
        }
    };

    const handlesIn = async (tx: EntityManager, ids: readonly string[]) =>
    {
        const wanted = [...new Set(ids)];
        const rows = wanted.length === 0
            ? []
            : await tx.getRepository(User).createQueryBuilder('u')
                .select('u.id', 'id')
                .addSelect('u.handle::text', 'handle')
                .where('u.id in (:...wanted)', { wanted })
                .getRawMany<{ id: string; handle: string }>();

        return new Map(rows.map((row) => [row.id, row.handle]));
    };

    /** One row of the group's log, in the caller's transaction. */
    const record = async (
        tx: EntityManager,
        groupId: string,
        actor: { id: string; role: GroupRole | null } | null,
        kind: GroupEventKind,
        person: string | null,
        details: Record<string, string> = {}
    ) =>
    {
        const handles = await handlesIn(tx, [actor?.id, person].filter((id): id is string => id !== undefined && id !== null));

        // The moment it is written, not the transaction's start: the rows one change writes would all
        // share that, and the log, newest first, would read them in the order of their random ids.
        await tx.getRepository(GroupEvent).insert({
            groupId,
            actorId: actor?.id ?? null,
            actorHandle: actor === null ? null : handles.get(actor.id) ?? null,
            actorRole: actor?.role ?? null,
            kind,
            personId: person,
            personHandle: person === null ? null : handles.get(person) ?? null,
            details,
            createdAt: () => 'clock_timestamp()'
        });
    };

    /**
     * Adds somebody to the group AND to its conversation, in the caller's transaction.
     *
     * The two have to move together. A member who is not in the thread cannot read what the group
     * is saying, and a thread member who is not in the group keeps reading it after they leave.
     */
    const seatIn = async (tx: EntityManager, groupId: string, userId: string) =>
    {
        // RETURNING, not an affected count: TypeORM hands back a bare [] for an INSERT
        // without it, so "did this write?" reads as zero however many rows it wrote.
        const joined = await tx.query(
            `insert into group_members (group_id, user_id, role)
             values ($1, $2, 'member')
             on conflict (group_id, user_id) do nothing
             returning user_id`,
            [groupId, userId]
        );

        if (firstRow<{ user_id: string }>(joined) === null)
        {
            return false;
        }

        await tx.query(
            `insert into conversation_members (conversation_id, user_id)
             select c.id, $2::uuid from conversations c
              where c.group_id = $1 and c.kind = 'group'
             on conflict do nothing`,
            [groupId, userId]
        );
        await tx.getRepository(GroupRequest).delete({ groupId, userId });
        return true;
    };

    const unseatIn = async (tx: EntityManager, groupId: string, userId: string) =>
    {
        await tx.getRepository(GroupMember).delete({ groupId, userId });
        await tx.query(
            `delete from conversation_members
              where user_id = $2
                and conversation_id in (select id from conversations where group_id = $1 and kind = 'group')`,
            [groupId, userId]
        );
    };

    const banned = async (tx: EntityManager, groupId: string, userId: string) =>
        tx.getRepository(GroupBan).existsBy({ groupId, userId });

    return {
        /** Every group this account is in, the busiest-looking first. */
        async mine(me: string): Promise<GroupRow[]>
        {
            const rows = await db.query(
                `select ${ GROUP_COLUMNS }
                 from groups g
                 join group_members gm on gm.group_id = g.id and gm.user_id = $1
                 order by g.name`,
                [me]
            );
            return rowsOf<GroupRow>(rows);
        },

        /**
         * Groups this account is NOT in.
         *
         * Being a stranger is not grounds for invisibility in this product - that is the same
         * rule the people directory follows - so a group is discoverable to anyone signed in.
         * What a non-member cannot do is read the thread or write anything. A group that keeps
         * them out is not offered to them.
         */
        async discover(me: string, limit: number): Promise<GroupRow[]>
        {
            const rows = await db.query(
                `select ${ GROUP_COLUMNS }
                 from groups g
                 where g.privacy = 'public'
                   and not exists (select 1 from group_members gm
                                    where gm.group_id = g.id and gm.user_id = $1)
                   and not exists (select 1 from group_bans gb
                                    where gb.group_id = g.id and gb.user_id = $1)
                 order by g.created_at desc
                 limit $2`,
                [me, limit]
            );
            return rowsOf<GroupRow>(rows);
        },

        async bySlug(me: string, slug: string): Promise<GroupRow | null>
        {
            const rows = await db.query(
                `select ${ GROUP_COLUMNS } from groups g where g.slug = $2 and ${ VISIBLE_TO }`,
                [me, slug]
            );
            return firstRow<GroupRow>(rows);
        },

        byId: one,

        roleOf,

        /** Everyone in the group, as uuids. What the realtime layer needs to ring the doorbell. */
        async memberIds(groupId: string): Promise<string[]>
        {
            const rows = await db.getRepository(GroupMember).find({ select: { userId: true }, where: { groupId } });
            return rows.map((row) => row.userId);
        },

        /**
         * Makes a group, claims its slug, seats the owner and the first members, and opens its
         * conversation.
         *
         * The slug is claimed by INSERT: walk `candidatesFor` and let the unique index arbitrate,
         * moving on only for a genuine 23505. "Check then insert" is the same race with extra
         * steps, and two people making "Friday Night Crew" in the same second is exactly the case
         * this has to survive.
         *
         * A name that folds to nothing - all emoji, all punctuation - falls back to a word the
         * product owns rather than to something invented from the characters. The first members are
         * asked of the messaging policy one by one, as an add is, and anybody it refuses is left out.
         */
        async create(me: string, input: {
            name: string;
            blurb: string;
            crest: string;
            hue: number;
            game: string | null;
            privacy: GroupPrivacy;
            photo?: string | null;
            switches?: Partial<GroupSwitches>;
            approval?: boolean;
            members?: readonly string[];
        })
        {
            const name = input.name.trim().slice(0, NAME_MAX);
            if (name.length < 2)
            {
                throw new ValidationError({ name: 'Give the group a name.' }, 'That name is too short.');
            }

            const photo = input.photo ?? null;
            const switches = { ...SWITCH_DEFAULTS, ...input.switches };
            const first = [...new Set(input.members ?? [])].filter((id) => id !== me && UUID.test(id)).slice(0, FIRST_MEMBERS_MOST);
            const admitted: string[] = [];

            for (const id of first)
            {
                if (await social.mayMessage(me, id) === null)
                {
                    admitted.push(id);
                }
            }

            const wanted = slugFromName(name) || 'group';

            for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1)
            {
                const slug = candidatesFor(wanted, attempt, Math.random);
                if (checkSlug(slug) !== null)
                {
                    continue;
                }

                try
                {
                    const made = await db.transaction(async (tx) =>
                    {
                        const inserted = await tx.query(
                            `insert into groups (slug, name, blurb, crest, hue, game, privacy, created_by, photo, approval, ${ SWITCH_LIST })
                             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${ SWITCHES.map((_, index) => `$${ index + 11 }`).join(', ') })
                             returning id`,
                            [
                                slug, name, input.blurb.trim().slice(0, BLURB_MAX), input.crest, input.hue, input.game, input.privacy, me,
                                photo, input.approval ?? false, ...SWITCHES.map((key) => switches[key])
                            ]
                        );
                        const id = rowsOf<{ id: string }>(inserted)[0].id;

                        await tx.getRepository(GroupMember).insert({ groupId: id, userId: me, role: 'owner', roleSince: () => 'now()' });

                        const conversation = await tx.query(
                            `insert into conversations (kind, group_id, game) values ('group', $1, $2) returning id`,
                            [id, input.game]
                        );

                        await tx.getRepository(ConversationMember).insert({
                            conversationId: rowsOf<{ id: string }>(conversation)[0].id,
                            userId: me
                        });
                        await record(tx, id, { id: me, role: 'owner' }, 'created', null, { name });

                        const seated: string[] = [];
                        for (const other of admitted)
                        {
                            if (await seatIn(tx, id, other))
                            {
                                seated.push(other);
                                await record(tx, id, { id: me, role: 'owner' }, 'joined', other, { by: 'add' });
                            }
                        }

                        return { id, seated };
                    });

                    const row = await one(me, made.id);
                    if (row === null)
                    {
                        throw new NotFoundError('No group there.');
                    }
                    return { row, seated: made.seated };
                }
                catch (error)
                {
                    if ((error as { code?: string }).code !== UNIQUE_VIOLATION)
                    {
                        throw error;
                    }
                }
            }

            throw new ConflictError('That name is taken. Try another.');
        },

        /**
         * Joins an open group.
         *
         * Returns false when this account was already in it, so the caller can stay quiet rather
         * than announcing an arrival that did not happen. Somebody the group keeps out is told so.
         */
        async join(me: string, groupId: string): Promise<'joined' | 'already' | 'requested'>
        {
            if ((await one(me, groupId)) === null)
            {
                throw new NotFoundError('No group there.');
            }

            return db.transaction(async (tx) =>
            {
                const { group } = await lockGroup(tx, groupId);

                if (await banned(tx, groupId, me))
                {
                    throw refused('group-banned', 'You cannot join this group.');
                }

                if (await standingIn(tx, me, groupId) !== null)
                {
                    return 'already';
                }

                // A public group that asks first takes a request, which waits for whoever may answer.
                if (group.approval)
                {
                    await tx.query('insert into group_requests (group_id, user_id) values ($1, $2) on conflict do nothing', [groupId, me]);
                    return 'requested';
                }

                await seatIn(tx, groupId, me);
                await record(tx, groupId, { id: me, role: 'member' }, 'joined', null, { by: 'join' });
                return 'joined';
            });
        },

        /**
         * Adds somebody else.
         *
         * Gated by `mayMessage`, because adding a person to a group is writing into their chat
         * list - the same act the messaging policy already governs. A blocked pair, an account
         * that takes no stranger messages, and a minor being added by a stranger are all refused
         * by the one rule rather than by a second opinion written here. And by the group: who may
         * add is its switch or an admin's right, and somebody it keeps out stays out.
         */
        async add(me: string, groupId: string, otherId: string)
        {
            const policy = await social.mayMessage(me, otherId);

            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'add');

                if (policy !== null)
                {
                    throw new ForbiddenError(policy === 'blocked'
                        ? 'You cannot reach that account.'
                        : 'They are not taking invitations from people they have not added.');
                }

                if (await banned(tx, groupId, otherId))
                {
                    throw refused('group-banned', 'They are kept out of this group.');
                }

                const arrived = await seatIn(tx, groupId, otherId);
                if (arrived)
                {
                    await record(tx, groupId, { id: me, role: actor.role }, 'joined', otherId, { by: 'add' });
                }
                return arrived;
            });
        },

        /**
         * Leaves, and hands the group on rather than stranding it.
         *
         * An owner who is the last member takes the group with them - an empty group is a row
         * nobody can ever see again. An owner who leaves a populated group hands it to an heir: the
         * admin who has been one longest, else the moderator, else the longest-standing member,
         * which keeps `group_members_single_owner` satisfied and is announced with a line so it is
         * visible rather than silent.
         */
        async leave(me: string, groupId: string): Promise<{ left: boolean; deleted: boolean; newOwner: string | null; heirId: string | null }>
        {
            return db.transaction(async (tx) =>
            {
                await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);

                if (actor.role !== 'owner')
                {
                    await unseatIn(tx, groupId, me);
                    await record(tx, groupId, { id: me, role: actor.role }, 'left', null);
                    return { left: true, deleted: false, newOwner: null, heirId: null };
                }

                const heirs = await tx.query(
                    `select gm.user_id, u.handle::text as handle
                     from group_members gm join users u on u.id = gm.user_id
                     where gm.group_id = $1 and gm.user_id <> $2
                     order by ${ rankOf('gm') } desc, gm.role_since nulls last, gm.joined_at, u.handle
                     limit 1`,
                    [groupId, me]
                );

                const heir = firstRow<{ user_id: string; handle: string }>(heirs);
                if (heir === null)
                {
                    await tx.getRepository(Group).delete({ id: groupId });
                    return { left: true, deleted: true, newOwner: null, heirId: null };
                }

                // Leave before the heir is promoted, or the partial unique index refuses the second
                // write - which is exactly what it is for.
                await unseatIn(tx, groupId, me);
                await tx.getRepository(GroupMember).update({ groupId, userId: heir.user_id }, { role: 'owner', rights: null, roleSince: () => 'now()' });
                await record(tx, groupId, { id: me, role: 'owner' }, 'left', null);
                await record(tx, groupId, null, 'owner', heir.user_id, { by: 'left' });

                return { left: true, deleted: false, newOwner: heir.handle, heirId: heir.user_id };
            });
        },

        /** Takes somebody out, who may come back. Removing yourself is `leave`, which has different rules. */
        async remove(me: string, groupId: string, otherId: string): Promise<boolean>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'remove');

                if (otherId === me)
                {
                    throw new ValidationError({}, 'Use leave for that.');
                }

                const other = UUID.test(otherId) ? await standingIn(tx, otherId, groupId) : null;
                if (other === null)
                {
                    return false;
                }

                mustReach(me, actor, otherId, other);

                await unseatIn(tx, groupId, otherId);
                await record(tx, groupId, { id: me, role: actor.role }, 'removed', otherId);
                return true;
            });
        },

        /**
         * Keeps somebody out: takes them out if they are in, drops their request, and refuses every
         * way back in while the row stands. Somebody outside the group can be kept out too.
         */
        async ban(me: string, groupId: string, otherId: string): Promise<{ changed: boolean; wasMember: boolean }>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'ban');

                if (!UUID.test(otherId))
                {
                    throw refused('group-member', 'There is nobody like that to keep out.');
                }

                const other = await standingIn(tx, otherId, groupId);
                mustReach(me, actor, otherId, other);

                if (await banned(tx, groupId, otherId))
                {
                    return { changed: false, wasMember: false };
                }

                if (other !== null)
                {
                    await unseatIn(tx, groupId, otherId);
                }
                await tx.getRepository(GroupRequest).delete({ groupId, userId: otherId });
                await tx.getRepository(GroupBan).insert({ groupId, userId: otherId, bannedBy: me });
                await record(tx, groupId, { id: me, role: actor.role }, 'banned', otherId);

                return { changed: true, wasMember: other !== null };
            });
        },

        async unban(me: string, groupId: string, otherId: string): Promise<Changed>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'ban');

                const gone = await tx.getRepository(GroupBan).delete({ groupId, userId: otherId });
                if ((gone.affected ?? 0) === 0)
                {
                    return { changed: false };
                }

                await record(tx, groupId, { id: me, role: actor.role }, 'unbanned', otherId);
                return { changed: true };
            });
        },

        /**
         * Keeps a member quiet for some hours, or until it is lifted. A row of its own and not a
         * column of the membership, so leaving and coming back does not shed it.
         */
        async mute(me: string, groupId: string, otherId: string, hours: number | null): Promise<Changed>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'mute');

                const other = UUID.test(otherId) ? await standingIn(tx, otherId, groupId) : null;
                if (other === null)
                {
                    throw refused('group-member', 'They are not in this group.');
                }
                mustReach(me, actor, otherId, other);

                await tx.query(
                    `insert into group_mutes (group_id, user_id, muted_by, until, created_at)
                     values ($1, $2, $3, case when $4::int is null then null else now() + make_interval(hours => $4::int) end, now())
                     on conflict (group_id, user_id)
                     do update set muted_by = excluded.muted_by, until = excluded.until, created_at = excluded.created_at`,
                    [groupId, otherId, me, hours]
                );
                await record(tx, groupId, { id: me, role: actor.role }, 'muted', otherId, hours === null ? {} : { hours: String(hours) });
                return { changed: true };
            });
        },

        async unmute(me: string, groupId: string, otherId: string): Promise<Changed>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'mute');

                const other = UUID.test(otherId) ? await standingIn(tx, otherId, groupId) : null;
                mustReach(me, actor, otherId, other);

                const gone = await tx.getRepository(GroupMute).delete({ groupId, userId: otherId });
                if ((gone.affected ?? 0) === 0)
                {
                    return { changed: false };
                }

                await record(tx, groupId, { id: me, role: actor.role }, 'unmuted', otherId);
                return { changed: true };
            });
        },

        /**
         * Gives a member a role below the owner's, or changes an admin's rights.
         *
         * Only the owner makes, unmakes or changes an admin, so nobody grants a right they do not
         * hold; an admin with `members` makes and unmakes moderators. The rights are a set from the
         * closed list, kept in its order. A role and rights somebody already holds change nothing.
         */
        async setRole(me: string, groupId: string, otherId: string, role: 'admin' | 'moderator' | 'member', rights: readonly string[] = []): Promise<Changed>
        {
            const wanted = role === 'admin' ? GROUP_RIGHTS.filter((right) => rights.includes(right)) : null;

            if (role === 'admin' && rights.some((right) => !(GROUP_RIGHTS as readonly string[]).includes(right)))
            {
                throw refused('group-rights', 'Those are not rights an admin can hold.');
            }

            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);

                const other = UUID.test(otherId) ? await standingIn(tx, otherId, groupId) : null;
                if (other === null)
                {
                    throw refused('group-member', 'They are not in this group.');
                }

                const governs = (place: GroupRole) => (place === 'admin' ? 'admins' : 'moderators');
                must(actor, switches, governs(role === 'member' ? (other.role === 'owner' ? 'admin' : other.role) : role));
                if (other.role !== 'member')
                {
                    must(actor, switches, governs(other.role === 'owner' ? 'admin' : other.role));
                }
                mustReach(me, actor, otherId, other);

                const before = other.rights === null ? null : GROUP_RIGHTS.filter((right) => other.rights?.includes(right));
                const sameRights = JSON.stringify(before) === JSON.stringify(wanted);

                if (other.role === role && sameRights)
                {
                    return { changed: false };
                }

                await tx.getRepository(GroupMember).update(
                    { groupId, userId: otherId },
                    {
                        role,
                        rights: wanted,
                        ...(other.role === role ? {} : { roleSince: role === 'member' ? null : () => 'now()' })
                    }
                );

                if (other.role !== role)
                {
                    await record(tx, groupId, { id: me, role: actor.role }, 'role', otherId, { from: other.role, to: role, ...(wanted === null ? {} : { rights: wanted.join(',') }) });
                }
                else
                {
                    await record(tx, groupId, { id: me, role: actor.role }, 'rights', otherId, { from: (before ?? []).join(','), to: (wanted ?? []).join(',') });
                }
                return { changed: true };
            });
        },

        /**
         * Hands the group to another member.
         *
         * Under the group's lock, so two handovers at once run one after the other and the second
         * finds its caller no longer the owner. The demotion comes FIRST, because
         * `group_members_single_owner` makes the two-owner moment unrepresentable: the owner becomes
         * an admin holding every right, and the other the owner.
         */
        async transfer(me: string, groupId: string, otherId: string): Promise<Changed & { handle: string | null }>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);

                if (actor.role !== 'owner')
                {
                    must(actor, switches, 'transfer');
                }

                if (otherId === me)
                {
                    return { changed: false, handle: null };
                }

                const other = UUID.test(otherId) ? await standingIn(tx, otherId, groupId) : null;
                if (other === null)
                {
                    throw refused('group-member', 'They are not in this group.');
                }

                const account = await tx.getRepository(User).findOne({ select: { isSuspended: true, handle: true }, where: { id: otherId } });
                if (account === null || account.isSuspended)
                {
                    throw refused('group-suspended', 'That account cannot take the group just now.');
                }

                await tx.getRepository(GroupMember).update({ groupId, userId: me }, { role: 'admin', rights: [...GROUP_RIGHTS], roleSince: () => 'now()' });
                await tx.getRepository(GroupMember).update({ groupId, userId: otherId }, { role: 'owner', rights: null, roleSince: () => 'now()' });
                await record(tx, groupId, { id: me, role: 'owner' }, 'owner', otherId, { from: other.role });

                return { changed: true, handle: account.handle };
            });
        },

        /**
         * Edits what the group looks like. The SLUG does not move.
         *
         * A url that changes when somebody edits a name is a url that breaks every link anyone
         * ever shared. The slug is claimed once, at creation, and the name is free after that.
         * How it looks is the `info` act's; whether it is public is the owner's alone.
         */
        async update(me: string, groupId: string, patch: { name?: string; blurb?: string; crest?: string; game?: string | null; privacy?: GroupPrivacy; photo?: string | null })
        {
            const name = patch.name === undefined ? undefined : patch.name.trim().slice(0, NAME_MAX);
            if (name !== undefined && name.length < 2)
            {
                throw new ValidationError({ name: 'Give the group a name.' }, 'That name is too short.');
            }

            await db.transaction(async (tx) =>
            {
                const { group, switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);

                const blurb = patch.blurb === undefined ? undefined : patch.blurb.trim().slice(0, BLURB_MAX);
                const looks = {
                    ...(name === undefined || name === group.name ? {} : { name }),
                    ...(blurb === undefined || blurb === group.blurb ? {} : { blurb }),
                    ...(patch.crest === undefined || patch.crest === group.crest ? {} : { crest: patch.crest }),
                    ...(patch.game === undefined || patch.game === group.game ? {} : { game: patch.game }),
                    ...(patch.photo === undefined || patch.photo === group.photo ? {} : { photo: patch.photo })
                };
                const privacy = patch.privacy === undefined || patch.privacy === group.privacy ? undefined : patch.privacy;

                if (Object.keys(looks).length > 0)
                {
                    must(actor, switches, 'info');
                }
                if (privacy !== undefined)
                {
                    must(actor, switches, 'permissions');
                }
                if (Object.keys(looks).length === 0 && privacy === undefined)
                {
                    return;
                }

                await tx.getRepository(Group).update({ id: groupId }, { ...looks, ...(privacy === undefined ? {} : { privacy }) });

                if (Object.keys(looks).length > 0)
                {
                    await record(tx, groupId, { id: me, role: actor.role }, 'info', null, {
                        fields: Object.keys(looks).join(','),
                        ...(looks.name === undefined ? {} : { from: group.name, to: looks.name })
                    });
                }
                if (privacy !== undefined)
                {
                    await record(tx, groupId, { id: me, role: actor.role }, 'permissions', null, { privacy });
                }
            });

            const updated = await one(me, groupId);
            if (updated === null)
            {
                throw new NotFoundError('No group there.');
            }
            return updated;
        },

        /** What the members may do, and whether joining is a request: the owner's alone. */
        async setSwitches(me: string, groupId: string, wanted: GroupSwitches, approval: boolean): Promise<Changed>
        {
            return db.transaction(async (tx) =>
            {
                const { group, switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'permissions');

                const moved = SWITCHES.filter((key) => wanted[key] !== switches[key]);
                const approvalMoved = approval !== group.approval;

                if (moved.length === 0 && !approvalMoved)
                {
                    return { changed: false };
                }

                await tx.query(
                    `update groups set approval = $2, ${ SWITCHES.map((key, index) => `${ SWITCH_COLUMNS[key] } = $${ index + 3 }`).join(', ') } where id = $1`,
                    [groupId, approval, ...SWITCHES.map((key) => wanted[key])]
                );
                await record(tx, groupId, { id: me, role: actor.role }, 'permissions', null, {
                    ...(moved.length === 0 ? {} : { on: moved.filter((key) => wanted[key]).join(','), off: moved.filter((key) => !wanted[key]).join(',') }),
                    ...(approvalMoved ? { approval: approval ? 'on' : 'off' } : {})
                });
                return { changed: true };
            });
        },

        /** The group's say in a pin, inside the chat's transaction: its row, the right, and how it is logged. */
        async pinGate(tx: EntityManager, me: string, groupId: string)
        {
            const { switches } = await lockGroup(tx, groupId);
            const actor = await actorIn(tx, me, groupId);
            must(actor, switches, 'pin');

            return (pinned: boolean, messageId: string) =>
                record(tx, groupId, { id: me, role: actor.role }, pinned ? 'pinned' : 'unpinned', null, { message: messageId });
        },

        /**
         * The group's say in taking somebody else's line out of its thread, inside the chat's own
         * transaction: the right to, and an author ranked below the actor, which somebody who left is.
         * The log says whose line it was; the author is told nothing.
         */
        async deleteGate(tx: EntityManager, me: string, groupId: string, authorId: string, messageId: string)
        {
            const { switches } = await lockGroup(tx, groupId);
            const actor = await actorIn(tx, me, groupId);
            must(actor, switches, 'delete');
            mustReach(me, actor, authorId, await standingIn(tx, authorId, groupId));
            await record(tx, groupId, { id: me, role: actor.role }, 'deleted', authorId, { message: messageId });
        },

        /** A link that brings people in, made by whoever may make them: an end, a limit of uses, and whether it asks first. */
        async makeLink(me: string, groupId: string, input: { hours: number | null; uses: number | null; approval: boolean }): Promise<string>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'links');

                const inserted = await tx.query(
                    `insert into group_invites (group_id, token, created_by, expires_at, max_uses, approval)
                     values ($1, $2, $3, case when $4::int is null then null else now() + make_interval(hours => $4::int) end, $5, $6)
                     returning id`,
                    [groupId, randomBytes(16).toString('base64url'), me, input.hours, input.uses, input.approval]
                );
                const id = rowsOf<{ id: string }>(inserted)[0].id;

                await record(tx, groupId, { id: me, role: actor.role }, 'invite', null, {
                    to: 'made',
                    link: id,
                    approval: input.approval ? 'on' : 'off',
                    ...(input.hours === null ? {} : { hours: String(input.hours) }),
                    ...(input.uses === null ? {} : { uses: String(input.uses) })
                });
                return id;
            });
        },

        /** The group's links, newest first, for whoever may make them; null for anybody else. */
        async links(me: string, groupId: string): Promise<LinkRow[] | null>
        {
            const found = await one(me, groupId);
            if (found === null || found.role === null || !mayIn({ role: found.role, rights: found.rights }, switchesOf(found), 'links'))
            {
                return null;
            }

            return rowsOf<LinkRow>(await db.query(
                `select i.id, i.token, u.handle::text as by, i.created_at, i.expires_at, i.max_uses, i.uses, i.approval, i.revoked_at,
                        ${ LIVE_LINK } as live
                   from group_invites i left join users u on u.id = i.created_by
                  where i.group_id = $1
                  order by i.created_at desc, i.id desc
                  limit $2`,
                [groupId, LINKS_MOST]
            ));
        },

        /** Stops a link bringing anybody in. One already stopped, or past its end, changes nothing. */
        async revokeLink(me: string, groupId: string, linkId: string): Promise<Changed>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'links');

                if (!UUID.test(linkId) || !await tx.getRepository(GroupInvite).existsBy({ id: linkId, groupId }))
                {
                    throw new NotFoundError('No such link.');
                }

                const revoked = rowsOf<{ id: string }>(await tx.query(
                    `update group_invites set revoked_at = greatest(now(), created_at)
                      where id = $1 and revoked_at is null
                      returning id`,
                    [linkId]
                ));
                if (revoked.length === 0)
                {
                    return { changed: false };
                }

                await record(tx, groupId, { id: me, role: actor.role }, 'invite', null, { to: 'revoked', link: linkId });
                return { changed: true };
            });
        },

        /**
         * What a link opens onto, for anybody signed in who holds it: the group as its members see
         * its face, and what the reader can do. A link that is no link, ended, used up or revoked is
         * null, one answer for all of them. A private group is seen through its link and only through it.
         */
        async byLink(me: string, token: string): Promise<{ row: GroupRow; can: LinkState } | null>
        {
            if (!LINK_TOKEN.test(token))
            {
                return null;
            }

            const link = firstRow<{ group_id: string; approval: boolean }>(await db.query(
                `select i.group_id, i.approval from group_invites i where i.token = $1 and ${ LIVE_LINK }`,
                [token]
            ));
            if (link === null)
            {
                return null;
            }

            const row = firstRow<GroupRow>(await db.query(`select ${ GROUP_COLUMNS } from groups g where g.id = $2`, [me, link.group_id]));
            if (row === null)
            {
                return null;
            }

            const kept = await db.getRepository(GroupBan).existsBy({ groupId: link.group_id, userId: me });
            const asked = await db.getRepository(GroupRequest).existsBy({ groupId: link.group_id, userId: me });

            const can: LinkState = row.role !== null ? 'member' : kept ? 'banned' : asked ? 'requested' : link.approval ? 'request' : 'join';
            return { row, can };
        },

        /**
         * Comes in by a link: seated when the link lets anybody in, a request when it asks first. A use
         * is counted in the statement that admits the person, so a limit cannot be raced past.
         */
        async joinByLink(me: string, token: string): Promise<{ row: GroupRow; came: 'member' | 'joined' | 'requested' }>
        {
            const link = LINK_TOKEN.test(token)
                ? firstRow<{ id: string; group_id: string; approval: boolean }>(await db.query(
                    `select i.id, i.group_id, i.approval from group_invites i where i.token = $1 and ${ LIVE_LINK }`,
                    [token]
                ))
                : null;

            if (link === null)
            {
                throw refused('group-link', 'That invite link no longer works.');
            }

            return db.transaction(async (tx) =>
            {
                await lockGroup(tx, link.group_id);

                // The face is read here, in the change's own transaction, because the link is what lets
                // its holder see the group: a private group's asker could not read it by its id.
                const face = async () => firstRow<GroupRow>(await tx.query(`select ${ GROUP_COLUMNS } from groups g where g.id = $2`, [me, link.group_id]))!;

                if (await standingIn(tx, me, link.group_id) !== null)
                {
                    return { row: await face(), came: 'member' as const };
                }
                if (await banned(tx, link.group_id, me))
                {
                    throw refused('group-banned', 'You cannot join this group.');
                }

                if (link.approval)
                {
                    await tx.query(
                        `insert into group_requests (group_id, user_id, invite_id) values ($1, $2, $3) on conflict do nothing`,
                        [link.group_id, me, link.id]
                    );
                    return { row: await face(), came: 'requested' as const };
                }

                const used = rowsOf<{ id: string }>(await tx.query(
                    `update group_invites i set uses = uses + 1 where i.id = $1 and ${ LIVE_LINK } returning i.id`,
                    [link.id]
                ));
                if (used.length === 0)
                {
                    throw refused('group-link', 'That invite link no longer works.');
                }

                await seatIn(tx, link.group_id, me);
                await record(tx, link.group_id, { id: me, role: 'member' }, 'joined', null, { by: 'link', link: link.id });
                return { row: await face(), came: 'joined' as const };
            });
        },

        /** Who waits to be let in, the longest waiting first, for whoever may answer. */
        /**
         * The reader's friends who could be added: not in the group, not kept out of it and not
         * suspended, for whoever may add somebody, and nothing for anybody else. The page offers these
         * and no others, so it needs no list of who is in a group of any size.
         */
        async addable(me: string, groupId: string): Promise<string[] | null>
        {
            const found = await one(me, groupId);
            if (found === null || found.role === null || !mayIn({ role: found.role, rights: found.rights, muted: found.muted }, switchesOf(found), 'add'))
            {
                return null;
            }

            const rows = await db.getRepository(Friendship).createQueryBuilder('f')
                .innerJoin(User, 'u', 'u.id = f.friendId')
                .select('f.friendId', 'id')
                .where('f.userId = :me', { me })
                .andWhere('u.isSuspended = false')
                .andWhere((outer) => `not exists ${ outer.subQuery().select('1').from(GroupMember, 'gm').where('gm.groupId = :groupId').andWhere('gm.userId = f.friendId').getQuery() }`)
                .andWhere((outer) => `not exists ${ outer.subQuery().select('1').from(GroupBan, 'b').where('b.groupId = :groupId').andWhere('b.userId = f.friendId').getQuery() }`)
                .setParameter('groupId', groupId)
                .orderBy('u.handle')
                .getRawMany<{ id: string }>();

            return rows.map((row) => row.id);
        },

        async requests(me: string, groupId: string): Promise<{ user_id: string; created_at: Date; by_link: boolean }[] | null>
        {
            const found = await one(me, groupId);
            if (found === null || found.role === null || !mayIn({ role: found.role, rights: found.rights }, switchesOf(found), 'approve'))
            {
                return null;
            }

            return rowsOf<{ user_id: string; created_at: Date; by_link: boolean }>(await db.query(
                `select r.user_id, r.created_at, r.invite_id is not null as by_link
                   from group_requests r join users u on u.id = r.user_id
                  where r.group_id = $1 and u.is_suspended = false
                  order by r.created_at, r.user_id
                  limit $2`,
                [groupId, REQUESTS_MOST]
            ));
        },

        /**
         * Lets somebody in or turns them away. Let in, they are seated and a use of the link they came
         * by is counted while it still has one; either way the request goes, and an answer to a request
         * that is not there changes nothing.
         */
        async answer(me: string, groupId: string, otherId: string, approve: boolean): Promise<Changed & { seated: boolean; left: number }>
        {
            return db.transaction(async (tx) =>
            {
                const { switches } = await lockGroup(tx, groupId);
                const actor = await actorIn(tx, me, groupId);
                must(actor, switches, 'approve');

                const request = UUID.test(otherId)
                    ? await tx.getRepository(GroupRequest).findOne({ where: { groupId, userId: otherId }, lock: { mode: 'pessimistic_write' } })
                    : null;

                if (request === null)
                {
                    return { changed: false, seated: false, left: await tx.getRepository(GroupRequest).countBy({ groupId }) };
                }

                await tx.getRepository(GroupRequest).delete({ groupId, userId: otherId });

                if (approve)
                {
                    await seatIn(tx, groupId, otherId);
                    if (request.inviteId !== null)
                    {
                        await tx.query(`update group_invites i set uses = uses + 1 where i.id = $1 and ${ LIVE_LINK }`, [request.inviteId]);
                    }
                    await record(tx, groupId, { id: me, role: actor.role }, 'request', otherId, { to: 'approved' });
                }
                else
                {
                    await record(tx, groupId, { id: me, role: actor.role }, 'request', otherId, { to: 'declined' });
                }

                return { changed: true, seated: approve, left: await tx.getRepository(GroupRequest).countBy({ groupId }) };
            });
        },

        /** Takes back one's own request. */
        async withdraw(me: string, groupId: string): Promise<Changed & { left: number }>
        {
            if (!UUID.test(groupId))
            {
                return { changed: false, left: 0 };
            }
            const gone = await db.getRepository(GroupRequest).delete({ groupId, userId: me });
            return { changed: (gone.affected ?? 0) > 0, left: await db.getRepository(GroupRequest).countBy({ groupId }) };
        },

        /** Everybody who may answer a request: the owner and the admins holding `approve`. */
        async approvers(groupId: string): Promise<string[]>
        {
            const rows = await db.getRepository(GroupMember).createQueryBuilder('gm')
                .select('gm.user_id', 'user_id')
                .where('gm.group_id = :groupId', { groupId })
                .andWhere(`(gm.role = 'owner' or (gm.role = 'admin' and 'approve' = any(gm.rights)))`)
                .getRawMany<{ user_id: string }>();
            return rows.map((row) => row.user_id);
        },

        /**
         * The members a page at a time: the owner, the admins and the moderators, then everybody by
         * when they joined. A name or a handle narrows it, folded as the social search folds them.
         * Nobody this viewer is apart from is listed, and a suspended account is not either.
         */
        async members(me: string, groupId: string, asked: string | undefined, cursor: string | undefined): Promise<{ rows: MemberRow[]; cursor?: string; count: number }>
        {
            const found = await one(me, groupId);
            if (found === null)
            {
                throw new NotFoundError('No group there.');
            }

            const after = cursor === undefined ? null : MEMBER_CURSOR.exec(cursor);
            const needle = asked === undefined ? '' : searchNeedle(asked);
            const narrowing = needle.length >= SEARCH_FROM;

            const rows = rowsOf<MemberRow>(await db.query(
                `select gm.user_id, gm.role, gm.rights, gm.joined_at, gm.role_since,
                        exists (select 1 from group_mutes m where m.group_id = gm.group_id and m.user_id = gm.user_id and ${ LIVE_MUTE }) as muted,
                        (select m.until from group_mutes m where m.group_id = gm.group_id and m.user_id = gm.user_id and ${ LIVE_MUTE }) as muted_until,
                        ${ rankOf('gm') } as rank,
                        (extract(epoch from gm.joined_at) * 1000000)::bigint::text as at_key
                   from group_members gm join users u on u.id = gm.user_id
                  where gm.group_id = $1
                    and u.is_suspended = false
                    and ${ apart('$2', 'u.id') }
                    and ($3::text is null or ${ folded('u.handle::text') } like $3 or ${ folded('u.display_name') } like $3)
                    and ($4::int is null
                         or ${ rankOf('gm') } < $4::int
                         or (${ rankOf('gm') } = $4::int and (gm.joined_at, gm.user_id) > (${ instantOf('$5') }, $6::uuid)))
                  order by rank desc, gm.joined_at, gm.user_id
                  limit $7`,
                [
                    groupId, me, narrowing ? `%${ likeLiteral(needle) }%` : null,
                    after === null ? null : Number(after[1]), after === null ? '0' : after[2], after === null ? '00000000-0000-0000-0000-000000000000' : after[3],
                    MEMBERS_PAGE + 1
                ]
            ));

            const page = rows.slice(0, MEMBERS_PAGE);
            const last = page.at(-1);

            return {
                rows: page,
                ...(rows.length > MEMBERS_PAGE && last !== undefined ? { cursor: `${ last.rank }|${ last.at_key }|${ last.user_id }` } : {}),
                count: found.member_count
            };
        },

        /** The group's log, newest first, for its owner, admins and moderators. */
        async log(me: string, groupId: string, cursor: string | undefined): Promise<{ rows: EventRow[]; cursor?: string } | null>
        {
            const found = await one(me, groupId);
            if (found === null || found.role === null || !mayIn({ role: found.role, rights: found.rights }, switchesOf(found), 'log'))
            {
                return null;
            }

            const after = keysetAfter(cursor);
            const rows = rowsOf<EventRow>(await db.query(
                `select e.id, e.kind, e.actor_handle, e.actor_role, e.person_handle, e.details, e.created_at,
                        (extract(epoch from e.created_at) * 1000000)::bigint::text as at_key
                   from group_events e
                  where e.group_id = $1
                    and ($2::text is null or (e.created_at, e.id) < (${ instantOf('$2') }, $3::uuid))
                  order by e.created_at desc, e.id desc
                  limit $4`,
                [groupId, after?.micros ?? null, after?.id ?? '00000000-0000-0000-0000-000000000000', GROUP_LOG_PAGE + 1]
            ));

            const page = rows.slice(0, GROUP_LOG_PAGE);
            const last = page.at(-1);

            return { rows: page, ...(rows.length > GROUP_LOG_PAGE && last !== undefined ? { cursor: `${ last.at_key }|${ last.id }` } : {}) };
        },

        /** Who is kept out, newest first, for whoever may lift a ban. */
        async banned(me: string, groupId: string): Promise<{ user_id: string; created_at: Date }[] | null>
        {
            const found = await one(me, groupId);
            if (found === null || found.role === null || !mayIn({ role: found.role, rights: found.rights }, switchesOf(found), 'ban'))
            {
                return null;
            }

            return db.getRepository(GroupBan).find({ select: { userId: true, createdAt: true }, where: { groupId }, order: { createdAt: 'DESC' } })
                .then((rows) => rows.map((row) => ({ user_id: row.userId, created_at: row.createdAt })));
        }
    };
}

export type GroupService = ReturnType<typeof createGroupService>;

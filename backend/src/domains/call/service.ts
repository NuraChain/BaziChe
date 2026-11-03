import { randomUUID } from 'node:crypto';

import { HttpError } from '@azerothjs/http';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';

import { Call } from '../../entities/call.entity.ts';
import { CallParticipant } from '../../entities/call-participant.entity.ts';
import { Conversation } from '../../entities/conversation.entity.ts';
import { ConversationMember } from '../../entities/conversation-member.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { FACES, mayIn, outranks, type GroupRight, type GroupRole, type GroupStanding, type GroupSwitches } from '../group/roles.ts';
import type { SocialService } from '../social/service.ts';
import { CALL_REFUSALS, type CallRefusal } from './refusals.ts';
import { callMoved } from './rooms.ts';
import { ALONE_SECONDS, EMPTY_SECONDS, GROUP_CALL_MOST, RING_SECONDS, type CallEnding, type CallKind, type CallState } from './rules.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a call that ended is still read with the open ones, so a page that showed it can say how it ended. */
export const ENDED_SECONDS = 30;

/** The calls a person is shown at once: the open one, and those that ended a moment ago. */
const SHOWN_MOST = 8;

/** The calls one sweep ends of each kind; the rest wait for the next. */
const SWEPT_MOST = 100;

const SAYS: Record<CallRefusal, string> = {
    'call-missing': 'No call there.',
    'call-room': 'Nobody can be called here.',
    'call-friends': 'You can call only your friends.',
    'in-call': 'You are already in a call.',
    'call-over': 'That call is no longer ringing.',
    'call-right': 'You cannot do that in this voice chat.',
    'call-full': 'This voice chat is full.',
    'call-removed': 'You were taken out of this voice chat.',
    'call-ended': 'That voice chat has ended.',
    'call-nobody': 'Nobody by that name is in this voice chat.',
    'call-rank': 'They hold a place at or above yours in this group.'
};

export const callRefusal = (word: CallRefusal) => new HttpError(CALL_REFUSALS[word], SAYS[word], { code: word });

/** Somebody out of a live call's room for longer than a direct call waits, written against the table it is asked of. */
const aloneIn = (calls: string) =>
    `exists (select 1 from call_participants p
              where p.call_id = ${ calls }.id and p.removed_at is null
                and p.left_at <= now() - make_interval(secs => ${ ALONE_SECONDS }))`;

/** When the last person went out of a call's room, or when it began for one nobody came into, written against the table it is asked of. */
const emptiedAt = (calls: string) =>
    `coalesce((select max(p.left_at) from call_participants p where p.call_id = ${ calls }.id), ${ calls }.answered_at)`;

/** Nobody in a group's voice chat's room, and nobody since longer than it waits (MS-D32), written against the table it is asked of. */
const emptyIn = (calls: string) =>
    `not exists (select 1 from call_participants p where p.call_id = ${ calls }.id and p.left_at is null)
     and ${ emptiedAt(calls) } <= now() - make_interval(secs => ${ EMPTY_SECONDS })`;

/** What a group's voice chat asks of its group, inside the call's own transaction. */
export interface CallGate
{
    standing: GroupStanding;
    switches: GroupSwitches;

    /** Somebody else's place in the group, or nothing for somebody not in it. */
    of(otherId: string): Promise<GroupStanding | null>;

    /** A change to the voice chat, written to the group's log as the reader's. */
    log(otherId: string | null, details: Record<string, string>): Promise<void>;
}

/** The group service's part in a voice chat: its gate, lent to the call's transaction as the chat's pins borrow theirs. */
export interface CallGroups
{
    callGate(tx: EntityManager, me: string, groupId: string): Promise<CallGate | null>;
}

interface Raw
{
    id: string;
    conversation_id: string;
    kind: CallKind;
    started_by: string | null;
    state: CallState;
    ending: CallEnding | null;
    created_at: Date;
    answered_at: Date | null;
    ended_at: Date | null;
    remaining_ms: number;
    switches: GroupSwitches | null;
}

export interface CallPerson
{
    id: string;
    handle: string;

    /** Not carried until somebody lets them speak (MS-D33). */
    held: boolean;
    hand: boolean;

    /** In the call's room now. */
    here: boolean;

    /** Left a group's voice chat on purpose, or was taken out of it. */
    gone: boolean;

    /** Their place in the group whose voice chat it is, and the rights an admin holds; none in a direct call. */
    role: GroupRole | null;
    rights: GroupRight[] | null;
}

export interface CallRow
{
    id: string;
    room: string;
    kind: CallKind;
    startedBy: string | null;
    state: CallState;
    ending: CallEnding | null;
    at: Date;
    answeredAt: Date | null;
    endedAt: Date | null;

    /** What is left of its ring by Postgres's clock, nought once it stopped ringing. */
    remainingMs: number;
    people: CallPerson[];

    /** What the members of the group whose voice chat it is may do; none for a direct call. */
    switches: GroupSwitches | null;
}

/** A change asked of a call: which call, whether it was this request that changed it, and whether it began a group's voice chat. */
export interface CallChange
{
    id: string;
    changed: boolean;
    started?: boolean;
}

/** A group's voice chat as its room's members see it: how many are in it and the first of their handles. */
export interface RoomCall
{
    id: string;
    here: number;
    faces: string[];
}

/**
 * Calls in a conversation (MS-D28 to MS-D33): between the two people of a direct one, or a group's
 * voice chat.
 *
 * Every change is a conditional update from the state it expects, and a state only moves forward
 * (ringing, live, ended), so a change asked twice, or two asked at once, change it once. A ring
 * takes both people's locks in id order: whether somebody is free is a question about calls in
 * other rooms, which no row or index of this one can answer. A group's voice chat is live from its
 * start, and every act in it is asked of the group under the group's lock (`CallGroups`).
 */
export function createCallService(db: DataSource, social: SocialService, groups: CallGroups)
{
    const loaded = async (manager: EntityManager, ids: readonly string[]) =>
    {
        if (ids.length === 0)
        {
            return [];
        }

        const calls = await manager.getRepository(Call).createQueryBuilder('c')
            .select('c.id', 'id')
            .addSelect('c.conversation_id', 'conversation_id')
            .addSelect('c.kind', 'kind')
            .addSelect('c.started_by', 'started_by')
            .addSelect('c.state', 'state')
            .addSelect('c.ending', 'ending')
            .addSelect('c.created_at', 'created_at')
            .addSelect('c.answered_at', 'answered_at')
            .addSelect('c.ended_at', 'ended_at')
            .addSelect(`case when c.state = 'ringing'
                             then greatest(0, ceil(extract(epoch from c.created_at + make_interval(secs => :ring) - now()) * 1000))
                             else 0 end::int`, 'remaining_ms')
            .addSelect(`(select json_build_object(
                                'send', g.members_send, 'media', g.members_media, 'add', g.members_add, 'pin', g.members_pin,
                                'info', g.members_info, 'call', g.members_call, 'joinCall', g.members_join_call,
                                'speak', g.members_speak)
                           from conversations v join groups g on g.id = v.group_id
                          where v.id = c.conversation_id and c.kind = 'group')`, 'switches')
            .where('c.id in (:...ids)', { ids, ring: RING_SECONDS })
            .getRawMany<Raw>();

        const people = await manager.getRepository(CallParticipant).createQueryBuilder('p')
            .innerJoin(User, 'u', 'u.id = p.user_id')
            .select('p.call_id', 'call_id')
            .addSelect('p.user_id', 'user_id')
            .addSelect('u.handle', 'handle')
            .addSelect('p.held', 'held')
            .addSelect('p.hand_at is not null', 'hand')
            .addSelect('p.left_at is null', 'here')
            .addSelect('p.gone_at is not null', 'gone')
            .addSelect(`(select gm.role from calls c join conversations v on v.id = c.conversation_id
                           join group_members gm on gm.group_id = v.group_id and gm.user_id = p.user_id
                          where c.id = p.call_id)`, 'role')
            .addSelect(`(select gm.rights from calls c join conversations v on v.id = c.conversation_id
                           join group_members gm on gm.group_id = v.group_id and gm.user_id = p.user_id
                          where c.id = p.call_id)`, 'rights')
            .where('p.call_id in (:...ids)', { ids })
            .orderBy('p.joined_at')
            .addOrderBy('p.user_id')
            .getRawMany<{
                call_id: string;
                user_id: string;
                handle: string;
                held: boolean;
                hand: boolean;
                here: boolean;
                gone: boolean;
                role: GroupRole | null;
                rights: GroupRight[] | null;
            }>();

        const byId = new Map(calls.map((row) => [row.id, row]));

        return ids.flatMap((id): CallRow[] =>
        {
            const row = byId.get(id);

            if (row === undefined)
            {
                return [];
            }

            return [{
                id: row.id,
                room: row.conversation_id,
                kind: row.kind,
                startedBy: row.started_by,
                state: row.state,
                ending: row.ending,
                at: row.created_at,
                answeredAt: row.answered_at,
                endedAt: row.ended_at,
                remainingMs: row.remaining_ms,
                people: people.filter((one) => one.call_id === id).map((one) => ({
                    id: one.user_id,
                    handle: one.handle,
                    held: one.held,
                    hand: one.hand,
                    here: one.here,
                    gone: one.gone,
                    role: one.role,
                    rights: one.rights
                })),
                switches: row.switches
            }];
        });
    };

    /** Where the reader stands in a call, or nothing for one they are not in and an id that is no uuid. */
    const standing = async (me: string, callId: string) =>
    {
        if (!UUID.test(callId))
        {
            return null;
        }

        const found = await db.getRepository(Call).createQueryBuilder('c')
            .innerJoin(CallParticipant, 'p', 'p.call_id = c.id and p.user_id = :me', { me })
            .select('c.state', 'state')
            .addSelect('c.kind', 'kind')
            .addSelect('c.started_by', 'started_by')
            .where('c.id = :callId', { callId })
            .getRawOne<{ state: CallState; kind: CallKind; started_by: string | null }>();

        return found ?? null;
    };

    /**
     * Each person's calls, one change at a time. `pg_advisory_xact_lock` is raw because no
     * repository can say it, and the locks are taken in id order so that two rings between the same
     * two people never wait on each other.
     */
    const lockPeople = async (tx: EntityManager, people: readonly string[]) =>
    {
        for (const userId of [...new Set(people)].sort())
        {
            await tx.query(`select pg_advisory_xact_lock(hashtext('call:person'), hashtext($1))`, [userId]);
        }
    };

    /**
     * Somebody in a call already: one between two people while it is open, or in the room of any
     * other but `except`.
     */
    const busy = async (tx: EntityManager, userId: string, except: string | null = null) =>
        (await tx.getRepository(CallParticipant).createQueryBuilder('p')
            .innerJoin(Call, 'c', `c.id = p.call_id and c.state <> 'ended'`)
            .where('p.user_id = :userId and p.removed_at is null', { userId })
            .andWhere(`(c.kind = 'direct' or p.left_at is null)`)
            .andWhere('p.call_id is distinct from :except', { except })
            .getCount()) > 0;

    /** The group a room is the conversation of, or nothing for a room that is no group's. */
    const groupOf = async (manager: EntityManager, room: string) =>
        (await manager.getRepository(Conversation).createQueryBuilder('c')
            .select('c.group_id', 'group_id')
            .where(`c.id = :room and c.kind = 'group' and c.group_id is not null`, { room })
            .getRawOne<{ group_id: string }>())?.group_id ?? null;

    /** The group's voice chat open in a room, or nothing. */
    const openIn = async (manager: EntityManager, room: string) =>
        (await manager.getRepository(Call).createQueryBuilder('c')
            .select('c.id', 'id')
            .where(`c.conversation_id = :room and c.kind = 'group' and c.state = 'live'`, { room })
            .getRawOne<{ id: string }>())?.id ?? null;

    /**
     * Somebody into a group's voice chat (MS-D51): a row of their own the first time, out of its room
     * until their socket comes in, held where they may not speak; coming back after they left takes
     * the row they had, so a hold or a hand stands, and holds them where they may no longer speak.
     * Somebody taken out stays out, and nobody comes in past the most it holds.
     */
    const joinIn = async (tx: EntityManager, callId: string, me: string, gate: CallGate): Promise<CallChange> =>
    {
        if (!mayIn(gate.standing, gate.switches, 'joinCall'))
        {
            throw callRefusal('call-right');
        }

        const mine = await tx.getRepository(CallParticipant).findOne({ where: { callId, userId: me } });

        if (mine?.removedAt != null)
        {
            throw callRefusal('call-removed');
        }

        if (mine !== null && mine.goneAt === null)
        {
            return { id: callId, changed: false };
        }

        if (await busy(tx, me, callId))
        {
            throw callRefusal('in-call');
        }

        const inRoom = await tx.getRepository(CallParticipant).createQueryBuilder('p')
            .where('p.call_id = :callId and p.left_at is null', { callId })
            .getCount();

        if (inRoom >= GROUP_CALL_MOST)
        {
            throw callRefusal('call-full');
        }

        if (mine === null)
        {
            await tx.getRepository(CallParticipant).createQueryBuilder()
                .insert()
                .values({ callId, userId: me, joinedAt: () => 'now()', leftAt: () => 'now()', held: !mayIn(gate.standing, gate.switches, 'speak') })
                .execute();
        }
        else
        {
            await tx.getRepository(CallParticipant).createQueryBuilder()
                .update()
                .set({ goneAt: null, joinedAt: () => 'now()', leftAt: () => 'now()', held: mayIn(gate.standing, gate.switches, 'speak') ? () => 'held' : true })
                .where('call_id = :callId and user_id = :me', { callId, me })
                .execute();
        }

        return { id: callId, changed: true };
    };

    /** A group's voice chat begun where none runs, or joined where one does (MS-D50). */
    const startIn = async (me: string, room: string, groupId: string): Promise<CallChange> =>
        await db.transaction(async (tx): Promise<CallChange> =>
        {
            const gate = await groups.callGate(tx, me, groupId);

            if (gate === null)
            {
                throw callRefusal('call-room');
            }

            await lockPeople(tx, [me]);

            const open = await openIn(tx, room);

            if (open !== null)
            {
                return await joinIn(tx, open, me, gate);
            }

            if (!mayIn(gate.standing, gate.switches, 'call'))
            {
                throw callRefusal('call-right');
            }

            if (await busy(tx, me))
            {
                throw callRefusal('in-call');
            }

            const id = randomUUID();

            await tx.getRepository(Call).createQueryBuilder()
                .insert()
                .values({ id, conversationId: room, kind: 'group', startedBy: me, state: 'live', answeredAt: () => 'now()' })
                .execute();

            await tx.getRepository(CallParticipant).createQueryBuilder()
                .insert()
                .values({ callId: id, userId: me, joinedAt: () => 'now()', leftAt: () => 'now()', held: !mayIn(gate.standing, gate.switches, 'speak') })
                .execute();

            return { id, changed: true, started: true };
        });

    /** Somebody's row in a call, by their handle whatever its case, or nothing. */
    const rowIn = (tx: EntityManager, callId: string, handle: string) =>
        tx.getRepository(CallParticipant).createQueryBuilder('p')
            .innerJoin(User, 'u', 'u.id = p.user_id')
            .where('p.call_id = :callId and u.handle = :handle', { callId, handle })
            .getOne();

    /** Refuses an act of the staff on somebody not ranked below the reader in the group, themselves included. */
    const below = async (gate: CallGate, otherId: string) =>
    {
        if (!outranks(gate.standing.role, (await gate.of(otherId))?.role ?? null))
        {
            throw callRefusal('call-rank');
        }
    };

    /** The group a voice chat's room belongs to, or nothing for a call that is no group's. */
    const voiceChat = async (callId: string) =>
    {
        if (!UUID.test(callId))
        {
            return null;
        }

        const found = await db.getRepository(Call).createQueryBuilder('c')
            .innerJoin(Conversation, 'r', 'r.id = c.conversation_id')
            .select('r.group_id', 'group_id')
            .where(`c.id = :callId and c.kind = 'group' and r.group_id is not null`, { callId })
            .getRawOne<{ group_id: string }>();

        return found ?? null;
    };

    /**
     * A call answered: live, and everybody out of its room as of now, so a side that never comes is
     * waited for as one that left (MS-D32). An answer is never earlier than the ring, which a change
     * that began before the ring and waited for its lock would otherwise write.
     */
    const answerIn = async (tx: EntityManager, callId: string, me: string) =>
    {
        const answered = await tx.getRepository(Call).createQueryBuilder()
            .update()
            .set({ state: 'live', answeredAt: () => 'greatest(now(), created_at)' })
            .where(`id = :callId and state = 'ringing' and started_by is distinct from :me`, { callId, me })
            .execute();

        if ((answered.affected ?? 0) === 0)
        {
            return false;
        }

        await tx.getRepository(CallParticipant).createQueryBuilder()
            .update()
            .set({ leftAt: () => 'greatest(now(), joined_at)' })
            .where('call_id = :callId and removed_at is null', { callId })
            .execute();

        return true;
    };

    /**
     * A call ended from the state it was in, and everybody let out of its room. `onlyIf` is what must
     * still hold as it ends, and `at` when it ended, never earlier than it began.
     */
    const endIn = async (tx: EntityManager, callId: string, from: CallState, ending: CallEnding, onlyIf = 'true', at = 'now()') =>
    {
        const ended = await tx.getRepository(Call).createQueryBuilder()
            .update()
            .set({ state: 'ended', ending, endedAt: () => `greatest(${ at }, coalesce(answered_at, created_at))` })
            .where(`id = :callId and state = :from and ${ onlyIf }`, { callId, from })
            .execute();

        if ((ended.affected ?? 0) === 0)
        {
            return false;
        }

        await tx.getRepository(CallParticipant).createQueryBuilder()
            .update()
            .set({ leftAt: () => 'greatest(now(), joined_at)' })
            .where('call_id = :callId and left_at is null', { callId })
            .execute();

        return true;
    };

    /**
     * An act of a group's staff on its voice chat, under the group's lock as every act on the group
     * is: refused to whoever is not in the group as a call that is not there, to whoever lacks the
     * calls right, and once it has ended. `act` answers whether it changed anything.
     */
    const staffAct = async (me: string, callId: string, act: (tx: EntityManager, gate: CallGate) => Promise<boolean>): Promise<CallChange> =>
    {
        const chat = await voiceChat(callId);

        if (chat === null)
        {
            throw callRefusal('call-missing');
        }

        return await db.transaction(async (tx) =>
        {
            const gate = await groups.callGate(tx, me, chat.group_id);

            if (gate === null)
            {
                throw callRefusal('call-missing');
            }

            if (!mayIn(gate.standing, gate.switches, 'calls'))
            {
                throw callRefusal('call-right');
            }

            if (!await tx.getRepository(Call).existsBy({ id: callId, state: 'live' }))
            {
                throw callRefusal('call-ended');
            }

            return { id: callId, changed: await act(tx, gate) };
        });
    };

    /** Whether two people may be in a call together: friends, no block either way, neither suspended (MS-D29). */
    const mayCall = async (me: string, other: string) =>
    {
        const [{ relation }, mine, theirs] = await Promise.all([social.relationOf(me, other), social.person(me), social.person(other)]);

        return relation === 'friend' && mine !== null && theirs !== null;
    };

    return {
        loaded: (ids: readonly string[]) => loaded(db.manager, ids),

        /** The reader's calls that are open, and those that ended a moment ago, newest first; never a voice chat they left. */
        async mine(me: string)
        {
            const ids = await db.getRepository(Call).createQueryBuilder('c')
                .innerJoin(CallParticipant, 'p', 'p.call_id = c.id and p.user_id = :me and p.gone_at is null', { me })
                .select('c.id', 'id')
                .where(`(c.state <> 'ended' or c.ended_at > now() - make_interval(secs => :ended))`, { ended: ENDED_SECONDS })
                .orderBy('c.created_at', 'DESC')
                .addOrderBy('c.id', 'DESC')
                .limit(SHOWN_MOST)
                .getRawMany<{ id: string }>();

            return loaded(db.manager, ids.map((row) => row.id));
        },

        /** One call of the reader's, however long ago, or nothing. */
        async one(me: string, callId: string)
        {
            return await standing(me, callId) === null ? null : (await loaded(db.manager, [callId]))[0] ?? null;
        },

        /**
         * The voice chat open in a group's room, as a member of it sees it: how many are in its room
         * and the first of them, or nothing while none runs. Answers no room at all (`null`) to
         * somebody not in it, the answer a room that is not there gets.
         */
        async ofRoom(me: string, room: string): Promise<{ call: RoomCall | null } | null>
        {
            if (!UUID.test(room))
            {
                return null;
            }

            const member = await db.getRepository(ConversationMember).existsBy({ conversationId: room, userId: me });

            if (!member)
            {
                return null;
            }

            const open = await openIn(db.manager, room);

            if (open === null)
            {
                return { call: null };
            }

            // Everybody is counted, and a face is drawn of nobody suspended or blocked either way, as a group's own faces are.
            const here = await db.getRepository(CallParticipant).createQueryBuilder('p')
                .innerJoin(User, 'u', 'u.id = p.user_id')
                .select('u.handle', 'handle')
                .addSelect(`u.is_suspended = false and not exists (select 1 from blocks b
                                                                    where (b.user_id = :me and b.blocked_id = u.id)
                                                                       or (b.user_id = u.id and b.blocked_id = :me))`, 'shown')
                .where('p.call_id = :open and p.left_at is null', { open, me })
                .orderBy('p.joined_at')
                .addOrderBy('p.user_id')
                .getRawMany<{ handle: string; shown: boolean }>();

            return { call: { id: open, here: here.length, faces: here.filter((one) => one.shown).slice(0, FACES).map((one) => one.handle) } };
        },

        /**
         * Rings the other person of a direct conversation, or begins a group's voice chat in its room.
         * A ring asked twice is the one call; asked by somebody whose call is ringing for them it
         * answers that call, since both want to talk; a callee who is in a call or being rung is busy,
         * and the call ends at once as `busy`.
         */
        async ring(me: string, room: string): Promise<CallChange>
        {
            if (!UUID.test(room))
            {
                throw callRefusal('call-room');
            }

            const groupId = await groupOf(db.manager, room);

            if (groupId !== null)
            {
                return await startIn(me, room, groupId);
            }

            const pair = await db.getRepository(ConversationMember).createQueryBuilder('m')
                .innerJoin(Conversation, 'c', `c.id = m.conversation_id and c.kind = 'direct'`)
                .innerJoin(ConversationMember, 'o', 'o.conversation_id = m.conversation_id and o.user_id <> m.user_id')
                .select('o.user_id', 'other')
                .where('m.conversation_id = :room and m.user_id = :me', { room, me })
                .getRawOne<{ other: string }>();

            if (pair === undefined || (await social.relationOf(me, pair.other)).relation === 'blocked')
            {
                throw callRefusal('call-room');
            }

            if (!await mayCall(me, pair.other))
            {
                throw callRefusal('call-friends');
            }

            return await db.transaction(async (tx): Promise<CallChange> =>
            {
                await lockPeople(tx, [me, pair.other]);

                const open = await tx.getRepository(Call).createQueryBuilder('c')
                    .select('c.id', 'id')
                    .addSelect('c.state', 'state')
                    .addSelect('c.started_by', 'started_by')
                    .where(`c.conversation_id = :room and c.state <> 'ended'`, { room })
                    .getRawOne<{ id: string; state: CallState; started_by: string | null }>();

                if (open !== undefined)
                {
                    if (open.state === 'ringing' && open.started_by !== me)
                    {
                        return { id: open.id, changed: await answerIn(tx, open.id, me) };
                    }

                    return { id: open.id, changed: false };
                }

                if (await busy(tx, me))
                {
                    throw callRefusal('in-call');
                }

                const free = !await busy(tx, pair.other);
                const id = randomUUID();

                await tx.getRepository(Call).createQueryBuilder()
                    .insert()
                    .values({
                        id,
                        conversationId: room,
                        kind: 'direct',
                        startedBy: me,
                        state: free ? 'ringing' : 'ended',
                        ending: free ? null : 'busy',
                        endedAt: free ? null : () => 'now()'
                    })
                    .execute();

                await tx.getRepository(CallParticipant).createQueryBuilder()
                    .insert()
                    .values([me, pair.other].map((userId) => ({ callId: id, userId, joinedAt: () => 'now()', leftAt: () => 'now()', held: false })))
                    .execute();

                return { id, changed: true };
            });
        },

        /** Into a group's voice chat that runs, for a member of its group whom it lets in (MS-D51). */
        async join(me: string, callId: string): Promise<CallChange>
        {
            const chat = await voiceChat(callId);

            if (chat === null)
            {
                throw callRefusal('call-missing');
            }

            return await db.transaction(async (tx) =>
            {
                const gate = await groups.callGate(tx, me, chat.group_id);

                if (gate === null)
                {
                    throw callRefusal('call-missing');
                }

                await lockPeople(tx, [me]);

                const live = await tx.getRepository(Call).existsBy({ id: callId, state: 'live' });

                if (!live)
                {
                    throw callRefusal('call-ended');
                }

                return await joinIn(tx, callId, me, gate);
            });
        },

        async accept(me: string, callId: string): Promise<CallChange>
        {
            const call = await standing(me, callId);

            if (call === null || call.kind === 'group' || call.started_by === me)
            {
                throw callRefusal('call-missing');
            }

            if (await db.transaction((tx) => answerIn(tx, callId, me)))
            {
                return { id: callId, changed: true };
            }

            if ((await standing(me, callId))?.state === 'live')
            {
                return { id: callId, changed: false };
            }

            throw callRefusal('call-over');
        },

        async decline(me: string, callId: string): Promise<CallChange>
        {
            const call = await standing(me, callId);

            if (call === null || call.kind === 'group' || call.started_by === me)
            {
                throw callRefusal('call-missing');
            }

            if (await db.transaction((tx) => endIn(tx, callId, 'ringing', 'declined')))
            {
                return { id: callId, changed: true };
            }

            if ((await standing(me, callId))?.state === 'ended')
            {
                return { id: callId, changed: false };
            }

            throw callRefusal('call-over');
        },

        /**
         * Ends the reader's part: a ring they started is cancelled, one they were rung by declined, a
         * live call ended as answered. Asked as it rings first, since a ring can become live in the
         * moment between and never the other way round. In a group's voice chat it is leaving it, on
         * purpose (`gone_at`), which the chat goes on without.
         */
        async hangUp(me: string, callId: string): Promise<CallChange>
        {
            const call = await standing(me, callId);

            if (call === null)
            {
                throw callRefusal('call-missing');
            }

            if (call.kind === 'group')
            {
                const left = await db.getRepository(CallParticipant).createQueryBuilder()
                    .update()
                    .set({ goneAt: () => 'now()', leftAt: () => 'coalesce(left_at, now())' })
                    .where('call_id = :callId and user_id = :me and gone_at is null', { callId, me })
                    .execute();

                return { id: callId, changed: (left.affected ?? 0) > 0 };
            }

            const changed = await db.transaction(async (tx) =>
                await endIn(tx, callId, 'ringing', call.started_by === me ? 'cancelled' : 'declined')
                || await endIn(tx, callId, 'live', 'answered'));

            return { id: callId, changed };
        },

        /** A group's voice chat ended for everyone, by somebody whose group lets them (MS-D52), and written to its log. */
        async end(me: string, callId: string): Promise<CallChange>
        {
            const chat = await voiceChat(callId);

            if (chat === null)
            {
                throw callRefusal('call-missing');
            }

            return await db.transaction(async (tx): Promise<CallChange> =>
            {
                const gate = await groups.callGate(tx, me, chat.group_id);

                if (gate === null)
                {
                    throw callRefusal('call-missing');
                }

                if (!mayIn(gate.standing, gate.switches, 'calls'))
                {
                    throw callRefusal('call-right');
                }

                const ended = await endIn(tx, callId, 'live', 'answered');

                if (ended)
                {
                    await gate.log(null, { act: 'end' });
                }

                return { id: callId, changed: ended };
            });
        },

        /** The reader's hand up, or down, in a group's voice chat they are in (MS-D33). */
        async hand(me: string, callId: string, up: boolean): Promise<CallChange>
        {
            const mine = await voiceChat(callId) === null ? null : await db.getRepository(CallParticipant).findOne({ where: { callId, userId: me } });

            if (mine === null || mine.goneAt !== null)
            {
                throw callRefusal('call-missing');
            }

            const raised = await db.getRepository(CallParticipant).createQueryBuilder()
                .update()
                .set({ handAt: up ? () => 'now()' : null })
                .where(`call_id = :callId and user_id = :me and gone_at is null and hand_at is ${ up ? 'null' : 'not null' }`, { callId, me })
                .andWhere(`exists (select 1 from calls c where c.id = call_id and c.state = 'live')`)
                .execute();

            if ((raised.affected ?? 0) > 0)
            {
                return { id: callId, changed: true };
            }

            if (!await db.getRepository(Call).existsBy({ id: callId, state: 'live' }))
            {
                throw callRefusal('call-ended');
            }

            return { id: callId, changed: false };
        },

        /**
         * Somebody in a group's voice chat held, so this server carries nothing they say, or let speak,
         * which puts their hand down: by the owner or an admin with the calls right, on somebody ranked
         * below them (MS-D33). Written to the group's log.
         */
        async hold(me: string, callId: string, handle: string, held: boolean)
        {
            return await staffAct(me, callId, async (tx, gate) =>
            {
                const other = await rowIn(tx, callId, handle);

                if (other === null || other.goneAt !== null)
                {
                    throw callRefusal('call-nobody');
                }

                await below(gate, other.userId);

                const moved = await tx.getRepository(CallParticipant).createQueryBuilder()
                    .update()
                    .set(held ? { held: true } : { held: false, handAt: null })
                    .where('call_id = :callId and user_id = :other and held = :was', { callId, other: other.userId, was: !held })
                    .execute();

                if ((moved.affected ?? 0) === 0)
                {
                    return false;
                }

                await gate.log(other.userId, { act: held ? 'hold' : 'speak' });
                return true;
            });
        },

        /** Everybody in a group's voice chat ranked below the reader held at once, written to its log once. */
        async holdAll(me: string, callId: string)
        {
            return await staffAct(me, callId, async (tx, gate) =>
            {
                const rows = await tx.getRepository(CallParticipant).find({ where: { callId, held: false, goneAt: IsNull() } });
                const lower: string[] = [];

                for (const row of rows)
                {
                    if (outranks(gate.standing.role, (await gate.of(row.userId))?.role ?? null))
                    {
                        lower.push(row.userId);
                    }
                }

                if (lower.length === 0)
                {
                    return false;
                }

                await tx.getRepository(CallParticipant).update({ callId, userId: In(lower), held: false }, { held: true });
                await gate.log(null, { act: 'hold-all' });
                return true;
            });
        },

        /**
         * Somebody taken out of a group's voice chat, who cannot come back into it (MS-D33): out of its
         * room and gone from it, by whoever may hold them. Written to the group's log.
         */
        async remove(me: string, callId: string, handle: string)
        {
            return await staffAct(me, callId, async (tx, gate) =>
            {
                const other = await rowIn(tx, callId, handle);

                if (other === null)
                {
                    throw callRefusal('call-nobody');
                }

                await below(gate, other.userId);

                const taken = await tx.getRepository(CallParticipant).createQueryBuilder()
                    .update()
                    .set({ removedAt: () => 'now()', goneAt: () => 'coalesce(gone_at, now())', leftAt: () => 'coalesce(left_at, now())' })
                    .where('call_id = :callId and user_id = :other and removed_at is null', { callId, other: other.userId })
                    .execute();

                if ((taken.affected ?? 0) === 0)
                {
                    return false;
                }

                await gate.log(other.userId, { act: 'remove' });
                return true;
            });
        },

        /**
         * Somebody kept quiet in a group is held in its voice chat, as they would be coming into it,
         * until somebody lets them speak. Answers the voice chat when it held them.
         */
        async quieted(room: string, userId: string)
        {
            const open = UUID.test(room) ? await openIn(db.manager, room) : null;

            if (open === null)
            {
                return null;
            }

            const held = await db.getRepository(CallParticipant).createQueryBuilder()
                .update()
                .set({ held: true })
                .where('call_id = :open and user_id = :userId and held = false and gone_at is null', { open, userId })
                .execute();

            return (held.affected ?? 0) > 0 ? open : null;
        },

        /** Ends, as `failed`, every open call of the person's with somebody they may no longer call. */
        async revalidate(userId: string)
        {
            const open = await db.getRepository(Call).createQueryBuilder('c')
                .innerJoin(CallParticipant, 'p', 'p.call_id = c.id and p.user_id = :userId', { userId })
                .innerJoin(CallParticipant, 'o', 'o.call_id = c.id and o.user_id <> p.user_id')
                .select('c.id', 'id')
                .addSelect('o.user_id', 'other')
                .where(`c.state <> 'ended' and c.kind = 'direct'`)
                .getRawMany<{ id: string; other: string }>();

            const ended: string[] = [];

            for (const call of open)
            {
                if (await mayCall(userId, call.other))
                {
                    continue;
                }

                const failed = await db.transaction(async (tx) =>
                    await endIn(tx, call.id, 'ringing', 'failed') || await endIn(tx, call.id, 'live', 'failed'));

                if (failed)
                {
                    ended.push(call.id);
                }
            }

            return loaded(db.manager, ended);
        },

        /**
         * What only time ends: a ring nobody answered (`missed`), a live call one side left for
         * longer than it waits, and a group's voice chat nobody has been in for longer than it waits
         * (both `answered`). The last two are asked again as they end, so somebody who came back in
         * the meantime keeps the call.
         */
        async sweep()
        {
            const rang = await db.getRepository(Call).createQueryBuilder('c')
                .select('c.id', 'id')
                .where(`c.state = 'ringing' and c.created_at <= now() - make_interval(secs => :ring)`, { ring: RING_SECONDS })
                .orderBy('c.created_at')
                .limit(SWEPT_MOST)
                .getRawMany<{ id: string }>();

            const left = await db.getRepository(Call).createQueryBuilder('c')
                .select('c.id', 'id')
                .where(`c.state = 'live' and c.kind = 'direct' and ${ aloneIn('c') }`)
                .orderBy('c.answered_at')
                .limit(SWEPT_MOST)
                .getRawMany<{ id: string }>();

            const emptied = await db.getRepository(Call).createQueryBuilder('c')
                .select('c.id', 'id')
                .where(`c.state = 'live' and c.kind = 'group' and ${ emptyIn('c') }`)
                .orderBy('c.answered_at')
                .limit(SWEPT_MOST)
                .getRawMany<{ id: string }>();

            const missed: string[] = [];
            const ended: string[] = [];

            for (const { id } of rang)
            {
                if (await db.transaction((tx) => endIn(tx, id, 'ringing', 'missed')))
                {
                    missed.push(id);
                }
            }

            for (const { id } of left)
            {
                if (await db.transaction((tx) => endIn(tx, id, 'live', 'answered', aloneIn('calls'))))
                {
                    ended.push(id);
                }
            }

            // A voice chat nobody is in ended when its last person went, not when the sweep came by.
            for (const { id } of emptied)
            {
                if (await db.transaction((tx) => endIn(tx, id, 'live', 'answered', emptyIn('calls'), emptiedAt('calls'))))
                {
                    ended.push(id);
                }
            }

            return { missed: await loaded(db.manager, missed), ended: await loaded(db.manager, ended) };
        },

        /**
         * Somebody came into a call's room or went out of it, as the hub saw it. Answers the
         * conversation of a group's voice chat somebody moved in, whose members are told who is in
         * it now, and nothing for anything else.
         */
        async moved(userId: string, room: string, here: boolean)
        {
            const id = await callMoved(db, userId, room, here);

            if (id === null)
            {
                return null;
            }

            const found = await db.getRepository(Call).findOne({ select: { conversationId: true, kind: true }, where: { id } });

            return found?.kind === 'group' ? found.conversationId : null;
        },

        /**
         * Whoever is no longer in a group is no longer in its voice chat: gone from it, and out of its
         * room. Answers the voice chat when anybody of them was in it.
         */
        async outOf(room: string, userIds: readonly string[])
        {
            const open = UUID.test(room) && userIds.length > 0 ? await openIn(db.manager, room) : null;

            if (open === null)
            {
                return null;
            }

            const left = await db.getRepository(CallParticipant).createQueryBuilder()
                .update()
                .set({ goneAt: () => 'now()', leftAt: () => 'coalesce(left_at, now())' })
                .where('call_id = :open and user_id in (:...userIds) and gone_at is null', { open, userIds })
                .execute();

            return (left.affected ?? 0) > 0 ? open : null;
        },

        /**
         * Everybody out of every call's room: who is in one is the hub's memory, and a server that
         * has just started holds nobody, so a call one side never comes back to after a restart ends
         * as one they left would.
         */
        async emptyRooms()
        {
            const emptied = await db.getRepository(CallParticipant).createQueryBuilder()
                .update()
                .set({ leftAt: () => 'greatest(now(), joined_at)' })
                .where('left_at is null')
                .execute();

            return emptied.affected ?? 0;
        }
    };
}

export type CallService = ReturnType<typeof createCallService>;

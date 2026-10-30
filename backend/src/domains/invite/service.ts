import { randomInt } from 'node:crypto';

import { HttpError } from '@azerothjs/http';
import { IsNull, type DataSource, type EntityManager } from 'typeorm';

import { EstablishedPlayer, InviteCampaign, InviteCode, InviteVisit, Match, MatchPlayer, Referral, User } from '../../entities/index.ts';
import { cursorOf, keyOf, keysetAfter, olderThan } from '../../lib/keyset.ts';
import { PROFILE_LOOKS, chosenIn, worn } from '../shop/looks.ts';
import { CODE_ALPHABET, CODE_LENGTH, ESTABLISHED_DAYS, ESTABLISHED_GAMES, MANY_A_DAY, QUICK_MINUTES, codeFrom, type InviteFlag } from './policy.ts';
import { INVITE_REFUSALS, type InviteRefusal } from './refusals.ts';

export type InviteService = ReturnType<typeof createInviteService>;

export const inviteRefusal = (word: InviteRefusal, message: string, details?: Record<string, string>) =>
    new HttpError(INVITE_REFUSALS[word], message, { code: word, ...(details === undefined ? {} : { details }) });

/** A retired code, one nobody holds, one that is no code and a suspended account's are one answer: a link that no longer works. */
export const noInvite = () => inviteRefusal('invite-missing', 'That invite link no longer works.');

/** How many people invited one page lists. */
const PEOPLE_PAGE = 20;

/** How many fresh codes are tried before giving up: two people drawing one is about one in 8.5 × 10^11 already. */
const CODE_ATTEMPTS = 8;

const freshCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** A campaign gives while it is active and inside its window, by Postgres's clock. */
const RUNNING = `campaign.state = 'active' and (campaign.starts_at is null or campaign.starts_at <= now()) and (campaign.ends_at is null or campaign.ends_at > now())`;

type Runner = DataSource | EntityManager;

/**
 * Whether the player in `seat` can vouch for a game: not suspended, and established or on the staff
 * (the owner by the wallets the server names, and every member of the staff, who are where it all
 * starts and need no row). Wants `:owners`.
 */
const vouches = (seat: string) => `(exists (select 1 from users vu where vu.id = ${ seat }.user_id and vu.is_suspended = false)
    and (exists (select 1 from established_players e where e.user_id = ${ seat }.user_id)
        or exists (select 1 from staff_members s where s.user_id = ${ seat }.user_id)
        or exists (select 1 from wallets o where o.user_id = ${ seat }.user_id and o.address = any(:owners))))`;

/** Another seat of the game being counted, held by somebody the same inviter brought in. */
const SIBLING = `exists (select 1 from referrals sibling where sibling.invitee_id = other.user_id and sibling.inviter_id = referrals.inviter_id)`;

const liveCode = (runner: Runner, userId: string) =>
    runner.getRepository(InviteCode).findOne({ select: { code: true, createdAt: true }, where: { userId, retiredAt: IsNull() } });

/**
 * A person's live code, made when they have none.
 *
 * Every attempt inserts and lets the two unique indexes decide, ignoring a clash: a code somebody
 * already holds is drawn again, and a live code made meanwhile by another ask of theirs is theirs.
 * An insert that ignores rather than fails is what lets this run inside a transaction too.
 */
const makeCode = async (runner: Runner, userId: string) =>
{
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1)
    {
        const live = await liveCode(runner, userId);

        if (live !== null)
        {
            return live;
        }

        await runner.getRepository(InviteCode).createQueryBuilder()
            .insert()
            .values({ code: freshCode(), userId })
            .orIgnore()
            .execute();
    }

    throw new Error('No invite code could be made.');
};

/** When a person may next make a new code: a day after they last did, while that is still ahead. */
const nextCode = async (runner: Runner, userId: string) =>
{
    const row = await runner.getRepository(InviteCode).createQueryBuilder('invite')
        .select(`max(invite.retired_at) + interval '1 day'`, 'next')
        .where('invite.user_id = :userId', { userId })
        .andWhere(`invite.retired_at > now() - interval '1 day'`)
        .getRawOne<{ next: Date | null }>();

    return row?.next ?? null;
};

const viewOf = (code: { code: string; createdAt: Date }, next: Date | null) => ({
    code: code.code,
    since: code.createdAt.toISOString(),
    ...(next === null ? {} : { next: next.toISOString() })
});

export function createInviteService(db: DataSource, owners: () => readonly string[])
{
    /** Who holds a code that still brings people in: live, and its owner not suspended. */
    const ownerOf = async (text: string | undefined) =>
    {
        const code = codeFrom(text);

        if (code === null)
        {
            return null;
        }

        const row = await db.getRepository(InviteCode).createQueryBuilder('invite')
            .innerJoin(User, 'owner', 'owner.id = invite.user_id')
            .select('invite.user_id', 'userId')
            .where('invite.code = :code', { code })
            .andWhere('invite.retired_at is null')
            .andWhere('owner.is_suspended = false')
            .getRawOne<{ userId: string }>();

        return row === undefined ? null : { code, userId: row.userId };
    };

    /**
     * What came of a person's links: the devices that opened any of them, a device a day, and the
     * friends who joined and who played, leaving out a suspended one as every list does.
     */
    const cameOf = async (userId: string) =>
    {
        const opened = await db.getRepository(InviteVisit).createQueryBuilder('visit')
            .innerJoin(InviteCode, 'invite', 'invite.code = visit.code')
            .select('count(*)::int', 'visits')
            .where('invite.user_id = :userId', { userId })
            .getRawOne<{ visits: number }>();
        const friends = await db.getRepository(Referral).createQueryBuilder('referral')
            .innerJoin(User, 'friend', 'friend.id = referral.invitee_id')
            .select('count(*)::int', 'joined')
            .addSelect('(count(*) filter (where referral.counted_at is not null))::int', 'played')
            .where('referral.inviter_id = :userId', { userId })
            .andWhere('friend.is_suspended = false')
            .getRawOne<{ joined: number; played: number }>();

        return { visits: opened?.visits ?? 0, joined: friends?.joined ?? 0, played: friends?.played ?? 0 };
    };

    /** The reader's live code, made the first time it is asked for, and what came of their links. */
    const summary = async (userId: string) =>
        ({ ...viewOf(await makeCode(db, userId), await nextCode(db, userId)), ...await cameOf(userId) });

    return {
        ownerOf,
        summary,

        /**
         * The people the reader invited, newest first, twenty a page: each as a list draws a person,
         * when they joined and whether they have played, and nothing else of them.
         */
        async people(userId: string, cursor: string | null)
        {
            const after = keysetAfter(cursor);
            const query = db.getRepository(Referral).createQueryBuilder('referral')
                .innerJoin(User, 'friend', 'friend.id = referral.invitee_id')
                .select('referral.invitee_id', 'id')
                .addSelect(keyOf('referral.created_at'), 'at_key')
                .addSelect('referral.created_at', 'joined_at')
                .addSelect('referral.counted_at is not null', 'played')
                .addSelect('friend.handle', 'handle')
                .addSelect('friend.display_name', 'display_name')
                .addSelect('friend.avatar', 'avatar')
                .addSelect('friend.hue', 'hue')
                .addSelect(chosenIn('friend', PROFILE_LOOKS.deco), 'deco')
                .where('referral.inviter_id = :userId', { userId })
                .andWhere('friend.is_suspended = false')
                .orderBy('referral.created_at', 'DESC')
                .addOrderBy('referral.invitee_id', 'DESC')
                .limit(PEOPLE_PAGE + 1);

            if (after !== null)
            {
                query.andWhere(olderThan('referral.created_at', 'referral.invitee_id'), after);
            }

            const rows = await query.getRawMany<{ id: string; at_key: string; joined_at: Date; played: boolean; handle: string; display_name: string; avatar: string | null; hue: number; deco: string | null }>();

            return {
                people: rows.slice(0, PEOPLE_PAGE).map((row) => ({
                    person: { handle: row.handle, displayName: row.display_name, ...(row.avatar === null ? {} : { avatar: row.avatar }), hue: row.hue, ...worn('deco', row.deco) },
                    joinedAt: row.joined_at.toISOString(),
                    played: row.played
                })),
                ...cursorOf(rows, PEOPLE_PAGE)
            };
        },

        /**
         * A new code in place of the reader's live one, at most once a day: links already shared stop
         * bringing anybody in. Two asks at once are one after the other, under the person's own row.
         */
        async renew(userId: string)
        {
            await db.transaction(async (tx) =>
            {
                await tx.getRepository(User).findOne({ select: { id: true }, where: { id: userId }, lock: { mode: 'pessimistic_write' } });

                const next = await nextCode(tx, userId);

                if (next !== null)
                {
                    throw inviteRefusal('invite-code-soon', 'A new code can be made once a day.', { at: next.toISOString() });
                }

                await tx.getRepository(InviteCode).createQueryBuilder()
                    .update()
                    .set({ retiredAt: () => 'greatest(now(), created_at)' })
                    .where('user_id = :userId', { userId })
                    .andWhere('retired_at is null')
                    .execute();

                await makeCode(tx, userId);
            });

            return await summary(userId);
        },

        /**
         * A device that opened a link, once a day. The code's own owner opening it is no visit, and a
         * link that no longer works is answered as one.
         */
        async visit(text: string, visitor: string, viewerId: string | null)
        {
            const owner = await ownerOf(text);

            if (owner === null)
            {
                throw noInvite();
            }

            if (owner.userId === viewerId)
            {
                return;
            }

            await db.getRepository(InviteVisit).createQueryBuilder()
                .insert()
                .values({ code: owner.code, visitor, day: () => `(now() at time zone 'utc')::date` })
                .orIgnore()
                .execute();
        },

        /**
         * Credits a new account to whoever's link it came through, once and for good, with the
         * campaign running as the account is made.
         *
         * A code that brings nobody in is let go of without a word: an invite is a courtesy, and a
         * sign-in never fails for one. The new account cannot be the code's owner, because a code is
         * made only for somebody who asked for it and nobody has been signed in as this account yet.
         */
        async refer(inviteeId: string, invite: string | undefined)
        {
            const owner = await ownerOf(invite);

            if (owner === null)
            {
                return;
            }

            const running = await db.getRepository(InviteCampaign).createQueryBuilder('campaign')
                .select('campaign.id', 'id')
                .where(RUNNING)
                .getRawOne<{ id: string }>();

            await db.getRepository(Referral).createQueryBuilder()
                .insert()
                .values({ inviteeId, inviterId: owner.userId, code: owner.code, campaignId: running?.id ?? null })
                .orIgnore()
                .execute();
        },

        /**
         * Who a finished game made established: every player in it, not suspended, whose account is
         * a week old and who has played out five games with somebody established or on the staff.
         */
        async establish(matchId: string)
        {
            const ready = await db.getRepository(MatchPlayer).createQueryBuilder('seat')
                .innerJoin(User, 'player', 'player.id = seat.user_id')
                .select('seat.user_id', 'userId')
                .where('seat.match_id = :matchId', { matchId })
                .andWhere('player.is_suspended = false')
                .andWhere('player.created_at <= now() - make_interval(days => :days)', { days: ESTABLISHED_DAYS })
                .andWhere('not exists (select 1 from established_players e where e.user_id = seat.user_id)')
                .andWhere(`(select count(distinct mine.match_id) from match_players mine
                            join matches played on played.id = mine.match_id
                            where mine.user_id = seat.user_id and played.finished_at is not null
                              and mine.result in ('won', 'lost', 'drawn')
                              and exists (select 1 from match_players other
                                          where other.match_id = mine.match_id and other.user_id <> mine.user_id
                                            and other.result in ('won', 'lost', 'drawn') and ${ vouches('other') })) >= :games`, { games: ESTABLISHED_GAMES, owners: owners() })
                .getRawMany<{ userId: string }>();

            if (ready.length > 0)
            {
                await db.getRepository(EstablishedPlayer).createQueryBuilder().insert().values(ready.map(({ userId }) => ({ userId }))).orIgnore().execute();
            }

            return ready.map(({ userId }) => userId);
        },

        /**
         * The invites a finished game made count: every friend who played it out (won, lost or drawn),
         * the first time, in a game their inviter did not sit in, through another player who played
         * it out, can vouch for it and was not brought in by the same inviter. Otherwise anybody
         * could count a second wallet of their own by playing it once, or a farm of fresh wallets by
         * playing them against each other. What makes a counted invite wait for a person is written
         * with it.
         */
        async countedBy(matchId: string)
        {
            const match = await db.getRepository(Match).findOne({ select: { id: true, game: true, finishedAt: true }, where: { id: matchId } });

            if (match === null || match.finishedAt === null)
            {
                return { game: match?.game ?? '', counted: [] };
            }

            const rows = await db.getRepository(Referral).createQueryBuilder()
                .update()
                .set({
                    countedAt: () => 'now()',
                    flags: () => `nullif(array_remove(array[
                        case when referrals.created_at > now() - make_interval(mins => :quick) then 'quick' end,
                        case when exists (select 1 from match_players other where other.match_id = :matchId and other.user_id <> referrals.invitee_id and ${ SIBLING }) then 'ring' end,
                        case when (select count(*) from referrals today where today.inviter_id = referrals.inviter_id and today.counted_at > now() - interval '1 day') >= :many then 'many' end
                    ]::varchar[], null), '{}'::varchar[])`
                })
                .where('counted_at is null')
                .andWhere('inviter_id is not null')
                .andWhere(`invitee_id in (select seat.user_id from match_players seat where seat.match_id = :matchId and seat.result in ('won', 'lost', 'drawn'))`, { matchId })
                .andWhere('not exists (select 1 from match_players seat where seat.match_id = :matchId and seat.user_id = referrals.inviter_id)', { matchId })
                .andWhere(`exists (select 1 from match_players other
                                   where other.match_id = :matchId and other.user_id <> referrals.invitee_id
                                     and other.result in ('won', 'lost', 'drawn') and ${ vouches('other') } and not ${ SIBLING })`, { matchId })
                .setParameters({ owners: owners(), quick: QUICK_MINUTES, many: MANY_A_DAY })
                .returning(['inviterId', 'inviteeId', 'flags', 'campaignId'])
                .execute();

            return {
                game: match.game,
                counted: (rows.raw as { inviter_id: string; invitee_id: string; flags: InviteFlag[] | null; campaign_id: string | null }[])
                    .map((row) => ({ inviterId: row.inviter_id, inviteeId: row.invitee_id, flags: row.flags, campaignId: row.campaign_id }))
            };
        }
    };
}

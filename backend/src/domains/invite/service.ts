import { randomInt } from 'node:crypto';

import { HttpError } from '@azerothjs/http';
import { IsNull, type DataSource, type EntityManager } from 'typeorm';

import { InviteCampaign, InviteCode, InviteVisit, Match, Referral, User } from '../../entities/index.ts';
import { CODE_ALPHABET, CODE_LENGTH, codeFrom } from './policy.ts';
import { INVITE_REFUSALS, type InviteRefusal } from './refusals.ts';

export type InviteService = ReturnType<typeof createInviteService>;

export const inviteRefusal = (word: InviteRefusal, message: string, details?: Record<string, string>) =>
    new HttpError(INVITE_REFUSALS[word], message, { code: word, ...(details === undefined ? {} : { details }) });

/** A retired code, one nobody holds, one that is no code and a suspended account's are one answer: a link that no longer works. */
export const noInvite = () => inviteRefusal('invite-missing', 'That invite link no longer works.');

/** How many fresh codes are tried before giving up: two people drawing one is about one in 8.5 × 10^11 already. */
const CODE_ATTEMPTS = 8;

const freshCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** A campaign gives while it is active and inside its window, by Postgres's clock. */
const RUNNING = `campaign.state = 'active' and (campaign.starts_at is null or campaign.starts_at <= now()) and (campaign.ends_at is null or campaign.ends_at > now())`;

type Runner = DataSource | EntityManager;

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

export function createInviteService(db: DataSource)
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

    return {
        ownerOf,

        /** The reader's live code, made the first time it is asked for. */
        async code(userId: string)
        {
            return viewOf(await makeCode(db, userId), await nextCode(db, userId));
        },

        /**
         * A new code in place of the reader's live one, at most once a day: links already shared stop
         * bringing anybody in. Two asks at once are one after the other, under the person's own row.
         */
        async renew(userId: string)
        {
            return await db.transaction(async (tx) =>
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

                return viewOf(await makeCode(tx, userId), await nextCode(tx, userId));
            });
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
         * The invites a finished game made count: every friend who played it out (a void seat not),
         * in a game their inviter did not sit in, the first time. Otherwise anybody could count a
         * second wallet of their own by playing it once.
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
                .set({ countedAt: () => 'now()' })
                .where('counted_at is null')
                .andWhere('inviter_id is not null')
                .andWhere(`invitee_id in (select seat.user_id from match_players seat where seat.match_id = :matchId and seat.result is not null and seat.result <> 'void')`, { matchId })
                .andWhere('not exists (select 1 from match_players seat where seat.match_id = :matchId and seat.user_id = referrals.inviter_id)', { matchId })
                .returning(['inviterId', 'inviteeId'])
                .execute();

            return {
                game: match.game,
                counted: (rows.raw as { inviter_id: string; invitee_id: string }[]).map((row) => ({ inviterId: row.inviter_id, inviteeId: row.invitee_id }))
            };
        }
    };
}

import { randomUUID } from 'node:crypto';

import { HttpError } from '@azerothjs/http';
import type { DataSource, EntityManager } from 'typeorm';

import { Call } from '../../entities/call.entity.ts';
import { CallParticipant } from '../../entities/call-participant.entity.ts';
import { Conversation } from '../../entities/conversation.entity.ts';
import { ConversationMember } from '../../entities/conversation-member.entity.ts';
import { User } from '../../entities/user.entity.ts';
import type { SocialService } from '../social/service.ts';
import { CALL_REFUSALS, type CallRefusal } from './refusals.ts';
import { ALONE_SECONDS, RING_SECONDS, type CallEnding, type CallKind, type CallState } from './rules.ts';

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
    'call-over': 'That call is no longer ringing.'
};

export const callRefusal = (word: CallRefusal) => new HttpError(CALL_REFUSALS[word], SAYS[word], { code: word });

/** Somebody out of a live call's room for longer than a direct call waits, written against the table it is asked of. */
const aloneIn = (calls: string) =>
    `exists (select 1 from call_participants p
              where p.call_id = ${ calls }.id and p.removed_at is null
                and p.left_at <= now() - make_interval(secs => ${ ALONE_SECONDS }))`;

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
    people: { id: string; handle: string }[];
}

/** A change asked of a call: which call, and whether it was this request that changed it. */
export interface CallChange
{
    id: string;
    changed: boolean;
}

/**
 * Calls between the two people of a direct conversation (MS-D28 to MS-D32).
 *
 * Every change is a conditional update from the state it expects, and a state only moves forward
 * (ringing, live, ended), so a change asked twice, or two asked at once, change it once. A ring
 * takes both people's locks in id order: whether somebody is free is a question about calls in
 * other rooms, which no row or index of this one can answer.
 */
export function createCallService(db: DataSource, social: SocialService)
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
            .where('c.id in (:...ids)', { ids, ring: RING_SECONDS })
            .getRawMany<Raw>();

        const people = await manager.getRepository(CallParticipant).createQueryBuilder('p')
            .innerJoin(User, 'u', 'u.id = p.user_id')
            .select('p.call_id', 'call_id')
            .addSelect('p.user_id', 'user_id')
            .addSelect('u.handle', 'handle')
            .where('p.call_id in (:...ids)', { ids })
            .orderBy('p.joined_at')
            .addOrderBy('p.user_id')
            .getRawMany<{ call_id: string; user_id: string; handle: string }>();

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
                people: people.filter((one) => one.call_id === id).map((one) => ({ id: one.user_id, handle: one.handle }))
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
            .addSelect('c.started_by', 'started_by')
            .where('c.id = :callId', { callId })
            .getRawOne<{ state: CallState; started_by: string | null }>();

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

    /** Somebody in a call already: one between two people while it is open, or in the room of any other. */
    const busy = async (tx: EntityManager, userId: string) =>
        (await tx.getRepository(CallParticipant).createQueryBuilder('p')
            .innerJoin(Call, 'c', `c.id = p.call_id and c.state <> 'ended'`)
            .where('p.user_id = :userId and p.removed_at is null', { userId })
            .andWhere(`(c.kind = 'direct' or p.left_at is null)`)
            .getCount()) > 0;

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

    /** A call ended from the state it was in, and everybody let out of its room. `onlyIf` is what must still hold as it ends. */
    const endIn = async (tx: EntityManager, callId: string, from: CallState, ending: CallEnding, onlyIf = 'true') =>
    {
        const ended = await tx.getRepository(Call).createQueryBuilder()
            .update()
            .set({ state: 'ended', ending, endedAt: () => 'greatest(now(), coalesce(answered_at, created_at))' })
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

    /** Whether two people may be in a call together: friends, no block either way, neither suspended (MS-D29). */
    const mayCall = async (me: string, other: string) =>
    {
        const [{ relation }, mine, theirs] = await Promise.all([social.relationOf(me, other), social.person(me), social.person(other)]);

        return relation === 'friend' && mine !== null && theirs !== null;
    };

    return {
        loaded: (ids: readonly string[]) => loaded(db.manager, ids),

        /** The reader's calls that are open, and those that ended a moment ago, newest first. */
        async mine(me: string)
        {
            const ids = await db.getRepository(Call).createQueryBuilder('c')
                .innerJoin(CallParticipant, 'p', 'p.call_id = c.id and p.user_id = :me', { me })
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
         * Rings the other person of a direct conversation. Asked twice it is the one call; asked by
         * somebody whose call is ringing for them it answers that call, since both want to talk; a
         * callee who is in a call or being rung is busy, and the call ends at once as `busy`.
         */
        async ring(me: string, room: string): Promise<CallChange>
        {
            if (!UUID.test(room))
            {
                throw callRefusal('call-room');
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

        async accept(me: string, callId: string): Promise<CallChange>
        {
            const call = await standing(me, callId);

            if (call === null || call.started_by === me)
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

            if (call === null || call.started_by === me)
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
         * moment between and never the other way round.
         */
        async hangUp(me: string, callId: string): Promise<CallChange>
        {
            const call = await standing(me, callId);

            if (call === null)
            {
                throw callRefusal('call-missing');
            }

            const changed = await db.transaction(async (tx) =>
                await endIn(tx, callId, 'ringing', call.started_by === me ? 'cancelled' : 'declined')
                || await endIn(tx, callId, 'live', 'answered'));

            return { id: callId, changed };
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
         * What only time ends: a ring nobody answered (`missed`), and a live call one side left for
         * longer than it waits (`answered`). The second is asked again as it ends, so somebody who
         * came back in the meantime keeps the call.
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

            return { missed: await loaded(db.manager, missed), ended: await loaded(db.manager, ended) };
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

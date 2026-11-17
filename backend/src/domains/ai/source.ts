import type { DataSource } from 'typeorm';

import { rowsOf } from '../../lib/rows.ts';
import type { MatchLog } from '../../schemas.ts';
import { turnMs } from '../match/turns.ts';
import { variantOf } from '../match/sides.ts';
import { hasSystemSeat } from '../system/sql.ts';
import { isSkill } from '../system/rules.ts';
import { AI_ENGINES, OPENNESS, inputOf, type Hidden, type SeatLog } from './agent.ts';
import type { SeatRow, Source, Turn } from './runtime.ts';

/**
 * What the runtime reads of a match, and the only place it reads anything. The state goes to the
 * runtime (to find the seat to move, count its choices and play the fallback); a hidden game's
 * agent is handed only what `match.feed` composes for its seat.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What `match.feed` hands back, as far as this needs it: the match now, and every action after `since`. */
export type Feed = (matchId: string, since: number) => Promise<{
    load: { match: { rev: number; game: string }; state: unknown };
    events: (seat: number | null) => { rev: number; seat: number; log: MatchLog }[];
} | null>;

/**
 * How many matches the seat logs are kept for; past it the one read longest ago is dropped. Sized
 * for the pool cap: below it, decisions taking turns across the matches would evict each one before
 * its next read and every read would be a full one.
 */
export const LOGS_MOST = 256;

interface Kept
{
    game: string;
    rev: number;
    log: SeatLog[];
}

/** Whether `fresh` is exactly the actions after `since` up to `rev`, one per revision, nothing missing. */
export const follows = (since: number, rev: number, fresh: readonly { rev: number }[]) =>
    fresh.length === rev - since && fresh.every((entry, at) => entry.rev === since + 1 + at);

/**
 * The seat logs of hidden games, built once and extended.
 *
 * Reading the whole history on every decision costs the square of a long match (a poker freezeout
 * runs to thousands of actions), so the log built so far is kept per match and seat with the
 * revision it reaches, and only what is newer is read. Rows of `match_actions` never change once
 * written and each is composed for the seat on its own, so the kept part plus the new part is the
 * same log a full read composes. Anything unexpected (another game, a revision behind the kept
 * one, a hole in the new part) is answered by a full read, which is always right.
 */
export function createSeatLogs(feed: Feed, most = LOGS_MOST)
{
    const kept = new Map<string, Map<number, Kept>>();

    const keep = (matchId: string, seat: number, value: Kept) =>
    {
        const seats = kept.get(matchId) ?? new Map<number, Kept>();

        kept.delete(matchId);
        seats.set(seat, value);
        kept.set(matchId, seats);

        for (const oldest of kept.keys())
        {
            if (kept.size <= most)
            {
                break;
            }

            kept.delete(oldest);
        }
    };

    const answer = (matchId: string, seat: number, found: NonNullable<Awaited<ReturnType<Feed>>>, log: SeatLog[]) =>
    {
        keep(matchId, seat, { game: found.load.match.game, rev: found.load.match.rev, log });

        return inputOf(found.load.match.game, found.load.state, seat, () => log) as Hidden;
    };

    return {
        /** The seat's `{ view, log }` at exactly `rev`, or null when the match is not there, not hidden or past `rev`. */
        read: async (matchId: string, rev: number, seat: number): Promise<Hidden | null> =>
        {
            const was = kept.get(matchId)?.get(seat);

            // A revision never goes back, so a log already past `rev` says the match has moved on.
            if (was !== undefined && was.rev > rev)
            {
                return null;
            }

            if (was !== undefined)
            {
                const found = await feed(matchId, was.rev);

                if (found === null)
                {
                    kept.delete(matchId);

                    return null;
                }

                if (found.load.match.rev !== rev)
                {
                    return null;
                }

                const fresh = found.events(seat);

                if (found.load.match.game === was.game && OPENNESS[was.game] === 'hidden' && follows(was.rev, rev, fresh))
                {
                    return answer(matchId, seat, found, [...was.log, ...fresh.map((entry) => ({ rev: entry.rev, seat: entry.seat, log: entry.log }))]);
                }
            }

            const found = await feed(matchId, 0);

            if (found === null || OPENNESS[found.load.match.game] !== 'hidden')
            {
                kept.delete(matchId);

                return null;
            }

            if (found.load.match.rev !== rev)
            {
                return null;
            }

            return answer(matchId, seat, found, found.events(seat).map((entry) => ({ rev: entry.rev, seat: entry.seat, log: entry.log })));
        },

        forget: (matchId: string) =>
        {
            kept.delete(matchId);
        },

        /** Drops every match not in `live`. */
        keepOnly: (live: ReadonlySet<string>) =>
        {
            for (const matchId of [...kept.keys()])
            {
                if (!live.has(matchId))
                {
                    kept.delete(matchId);
                }
            }
        },

        /** How many matches are held: for specs. */
        held: () => kept.size
    };
}

interface MatchRow
{
    game: string;
    rev: number;
    state: unknown;
    finished: boolean;
    left_ms: number | null;
    mode: string;
    teams: boolean;
}

interface PlayerRow
{
    seat: number;
    user_id: string;
    result: string | null;
    skill: string | null;
    style: number | null;
}

const MATCH_SQL = `
    select m.game, m.rev, m.state, (m.finished_at is not null) as finished,
           (extract(epoch from (m.deadline_at - now())) * 1000)::float8 as left_ms,
           t.mode, t.teams
      from matches m
      join tables t on t.id = m.table_id
     where m.id = $1
       and ${ hasSystemSeat('m.id') }`;

const PLAYERS_SQL = `
    select mp.seat, mp.user_id, mp.result, sp.skill, sp.style
      from match_players mp
      left join system_players sp on sp.user_id = mp.user_id
     where mp.match_id = $1
     order by mp.seat`;

const DUE_SQL = `
    select m.id as match_id, m.rev
      from matches m
     where m.finished_at is null
       and ${ hasSystemSeat('m.id') }
     order by m.deadline_at
     limit $1`;

/** A match as the runtime reads it, from its row and its seats. */
export function turnOf(matchId: string, row: MatchRow, players: readonly PlayerRow[]): Turn
{
    const engine = AI_ENGINES[row.game];
    const bank = engine?.bank?.(row.state) ?? null;
    const seats: SeatRow[] = players.map((one) => ({
        seat: one.seat,
        userId: one.user_id,
        result: one.result,
        system: one.skill === null ? null : { skill: isSkill(one.skill) ? one.skill : 'intermediate', style: one.style ?? 0 }
    }));

    return {
        matchId,
        game: row.game,
        rev: row.rev,
        format: { seats: players.length, variant: variantOf(row.teams) },
        state: row.state,
        finished: row.finished,
        leftMs: row.left_ms ?? 0,
        limitMs: bank ?? turnMs(row.mode),
        clock: bank !== null,
        seats
    };
}

export function createAiSource(db: DataSource, feed: Feed): Source
{
    const logs = createSeatLogs(feed);

    return {
        turnAt: async (matchId) =>
        {
            if (!UUID.test(matchId))
            {
                return null;
            }

            const row = rowsOf<MatchRow>(await db.query(MATCH_SQL, [matchId]))[0];

            if (row === undefined || row.finished)
            {
                logs.forget(matchId);
            }

            if (row === undefined)
            {
                return null;
            }

            return turnOf(matchId, row, rowsOf<PlayerRow>(await db.query(PLAYERS_SQL, [matchId])));
        },

        hidden: async (matchId, rev, seat) => await logs.read(matchId, rev, seat),

        due: async (limit) =>
        {
            const due = rowsOf<{ match_id: string; rev: number }>(await db.query(DUE_SQL, [limit])).map((row) => ({ matchId: row.match_id, rev: row.rev }));

            // A short list is every live match with a system seat, so whatever else is held has ended.
            if (due.length < limit)
            {
                logs.keepOnly(new Set(due.map((row) => row.matchId)));
            }

            return due;
        }
    };
}

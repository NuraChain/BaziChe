import type { DataSource } from 'typeorm';

import { rowsOf } from '../../lib/rows.ts';
import type { MatchLog } from '../../schemas.ts';
import { turnMs } from '../match/turns.ts';
import { variantOf } from '../match/sides.ts';
import { hasSystemSeat } from '../system/sql.ts';
import { isSkill } from '../system/rules.ts';
import { AI_ENGINES, OPENNESS, inputOf, type Hidden } from './agent.ts';
import type { SeatRow, Source, Turn } from './runtime.ts';

/**
 * What the runtime reads of a match, and the only place it reads anything. The state goes to the
 * runtime (to find the seat to move, count its choices and play the fallback); a hidden game's
 * agent is handed only what `match.feed` composes for its seat.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What `match.feed` hands back, as far as this needs it. */
export type Feed = (matchId: string, rev: number) => Promise<{
    load: { match: { rev: number; game: string }; state: unknown };
    events: (seat: number | null) => { rev: number; seat: number; log: MatchLog }[];
} | null>;

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
    return {
        turnAt: async (matchId) =>
        {
            if (!UUID.test(matchId))
            {
                return null;
            }

            const row = rowsOf<MatchRow>(await db.query(MATCH_SQL, [matchId]))[0];

            if (row === undefined)
            {
                return null;
            }

            return turnOf(matchId, row, rowsOf<PlayerRow>(await db.query(PLAYERS_SQL, [matchId])));
        },

        hidden: async (matchId, rev, seat) =>
        {
            const found = await feed(matchId, 0);

            if (found === null || found.load.match.rev !== rev || OPENNESS[found.load.match.game] !== 'hidden')
            {
                return null;
            }

            return inputOf(found.load.match.game, found.load.state, seat, (reader) => found.events(reader)) as Hidden;
        },

        due: async (limit) =>
            rowsOf<{ match_id: string; rev: number }>(await db.query(DUE_SQL, [limit])).map((row) => ({ matchId: row.match_id, rev: row.rev }))
    };
}

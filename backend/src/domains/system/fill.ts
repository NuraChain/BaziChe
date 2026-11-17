import type { DataSource, EntityManager } from 'typeorm';

import { rowsOf } from '../../lib/rows.ts';
import { lockTable, seatAt, standUp } from '../table/service.ts';
import { takeIdle } from './pool.ts';
import { gameOn, systemConfigOf, type SystemConfig } from './rules.ts';
import { isSystem, notSystem } from './sql.ts';

/**
 * Seat filling, people first: after a person has waited at an open public quick table, the server
 * seats system players in its free chairs one a pass, and starts the game once every chair is taken
 * and ready. The decisions are the pure functions below; the rest reads, locks and writes.
 *
 * What keeps it safe when two passes or two processes run at once:
 * - one system player in two places: `takeIdle` takes its `system_players` row `for update skip
 *   locked` and asks again, in a statement of its own, whether it is seated or playing anywhere;
 * - two players in one chair: `lockTable`, and `seatAt`'s update only matches an empty chair;
 * - two games at one table: `match.start` takes `lockTable` and returns the running game, and the
 *   `matches_one_live` index refuses a second one;
 * - a person losing a chair to the filler mid-search: the filler takes quick play's own per-game
 *   lock before the table's, so the two take turns.
 */

/** A pass seats this many at most, so a slow database does not hold the pass past its budget. */
const FILL_MOST = 50;

/** How many tables with a system player waiting are looked at in one pass. */
const SEATED_MOST = 500;

/** A table every chair of which is taken, that has not started this long after, lets its system players go. */
export const STALL_MS = 60_000;

/** After a game, each system player stands up somewhere in this window, its own moment for its own seat. */
export const AFTER_LEAST_MS = 8_000;
export const AFTER_MOST_MS = 20_000;

export interface Chair
{
    seat: number;
    user: string | null;
    invited: boolean;
    ready: boolean;

    /** Epoch ms, or null for an empty chair. */
    joined: number | null;
    system: boolean;
    retired: boolean;
}

/** One table as the filler judges it, every time in epoch ms by the database's clock. */
export interface Board
{
    id: string;
    game: string;
    seats: number;
    teams: boolean;

    /** The catalogue has the game on; `match.start` refuses one that is not. */
    available: boolean;
    open: boolean;
    public: boolean;
    quick: boolean;
    staked: boolean;
    tournament: boolean;
    live: boolean;

    /** When the last game here started and finished, or null when none has. */
    started: number | null;
    finished: number | null;
    now: number;
    chairs: Chair[];
}

export type StandWhy = 'alone' | 'off' | 'retired' | 'stalled' | 'after';

const isPerson = (chair: Chair) => chair.user !== null && !chair.system;

const isFree = (chair: Chair) => chair.user === null && !chair.invited;

/**
 * Since when the person waiting longest has waited: from when they sat down, or from the end of the
 * last game here when they stayed on after it, since nobody waits through a game they were playing.
 */
export const waitingSince = (board: Board): number | null =>
{
    const since = board.chairs
        .filter((chair) => isPerson(chair) && chair.ready && chair.joined !== null)
        .map((chair) => Math.max(chair.joined!, board.finished ?? 0));

    return since.length === 0 ? null : Math.min(...since);
};

/** Whether a system player may be seated at this table now. `here` holds the people present. */
export const fillable = (config: SystemConfig, board: Board, here: ReadonlySet<string>) =>
{
    const since = waitingSince(board);

    return gameOn(config, board.game)
        && board.available
        && board.quick
        && board.public
        && board.open
        && !board.live
        && !board.staked
        && !board.tournament
        && board.chairs.some((chair) => isPerson(chair) && chair.ready && here.has(chair.user!))
        && board.chairs.some(isFree)
        && since !== null
        && board.now - since >= config.wait * 1000;
};

/**
 * The chair a system player takes: any free one, and at a teams table one on the side with the most
 * people, so the other side keeps its chairs for whoever comes next and people end up on both sides.
 * People are never moved.
 */
export const systemChairFor = (board: Board): number | null =>
{
    const free = board.chairs.filter(isFree).map((chair) => chair.seat);

    if (free.length === 0)
    {
        return null;
    }

    if (!board.teams)
    {
        return Math.min(...free);
    }

    const people = (side: number) => board.chairs.filter((chair) => isPerson(chair) && chair.seat % 2 === side).length;
    const most = Math.max(...free.map((seat) => people(seat % 2)));

    return Math.min(...free.filter((seat) => people(seat % 2) === most));
};

/** Whether, once `seat` is taken, every chair is taken and ready, so the game starts. */
export const startsWith = (board: Board, seat: number) =>
    board.chairs.every((chair) => chair.seat === seat || (chair.user !== null && chair.ready));

/** FNV-1a: the same text always gives the same number, on every process and after a restart. */
const hashOf = (text: string) =>
{
    let hash = 2166136261;

    for (let at = 0; at < text.length; at += 1)
    {
        hash ^= text.charCodeAt(at);
        hash = Math.imul(hash, 16777619) >>> 0;
    }

    return hash;
};

/** How long after a game this seat's system player stands up: seeded by the table, the seat and the finish, so nothing is held in memory. */
export const afterDelay = (tableId: string, seat: number, finished: number) =>
    AFTER_LEAST_MS + hashOf(`${ tableId }:${ seat }:${ Math.floor(finished) }`) % (AFTER_MOST_MS - AFTER_LEAST_MS + 1);

/** The system players to stand up at this table now, and why. Nothing moves while a game runs. */
export const standUps = (config: SystemConfig, board: Board): { user: string; why: StandWhy }[] =>
{
    if (board.live || !board.open)
    {
        return [];
    }

    const system = board.chairs.filter((chair) => chair.user !== null && chair.system);

    if (system.length === 0)
    {
        return [];
    }

    const all = (why: StandWhy) => system.map((chair) => ({ user: chair.user!, why }));

    if (!board.chairs.some(isPerson))
    {
        return all('alone');
    }

    if (!gameOn(config, board.game) || !board.available)
    {
        return all('off');
    }

    const filled = board.chairs.every((chair) => chair.user !== null)
        ? Math.max(...board.chairs.map((chair) => chair.joined ?? 0))
        : null;

    if (filled !== null && (board.started === null || board.started < filled) && board.now - filled >= STALL_MS)
    {
        return all('stalled');
    }

    return system.flatMap((chair): { user: string; why: StandWhy }[] =>
    {
        if (chair.retired)
        {
            return [{ user: chair.user!, why: 'retired' as const }];
        }

        const played = board.finished !== null && chair.joined !== null && chair.joined <= board.finished;

        return played && board.now - board.finished! >= afterDelay(board.id, chair.seat, board.finished!)
            ? [{ user: chair.user!, why: 'after' as const }]
            : [];
    });
};

const ms = (column: string) => `(extract(epoch from ${ column }) * 1000)::float8`;

const BOARDS_SQL = `
    select t.id, t.game, t.seats, t.teams,
           exists (select 1 from games g where g.id = t.game and g.status = 'available') as available,
           t.status = 'open' as open,
           t.privacy = 'public' as public,
           t.tournament_id is not null as tournament,
           exists (select 1 from quick_tables q where q.table_id = t.id) as quick,
           exists (select 1 from table_stakes k where k.table_id = t.id) as staked,
           exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null) as live,
           (select ${ ms('max(m.started_at)') } from matches m where m.table_id = t.id) as started,
           (select ${ ms('max(m.finished_at)') } from matches m where m.table_id = t.id) as finished,
           ${ ms('now()') } as now,
           (select json_agg(json_build_object(
                       'seat', s.seat,
                       'user', s.user_id,
                       'invited', s.invited_id is not null,
                       'ready', s.ready,
                       'joined', ${ ms('s.joined_at') },
                       'system', s.user_id is not null and ${ isSystem('s.user_id') },
                       'retired', exists (select 1 from system_players r where r.user_id = s.user_id and r.retired_at is not null)
                   ) order by s.seat)
              from table_seats s where s.table_id = t.id) as chairs
      from tables t
     where t.id = any($1::uuid[])`;

/**
 * Open public quick tables a system player may sit at: no game running, no stake, no tournament, a
 * chair neither taken nor held for an invite, and a ready person who has waited `$1` seconds, from
 * when they sat down or from the end of the last game here. Longest wait first. The switch and the
 * games that are off are asked by the caller; presence is asked of the hub.
 */
const FILLABLE_SQL = `
    select t.id, t.game
      from tables t
      join quick_tables q on q.table_id = t.id
     cross join lateral (select max(m.finished_at) as last from matches m where m.table_id = t.id) f
     cross join lateral (
               select min(greatest(s.joined_at, f.last)) as since
                 from table_seats s
                where s.table_id = t.id and s.user_id is not null and s.ready and ${ notSystem('s.user_id') }) w
     where t.status = 'open'
       and t.privacy = 'public'
       and t.tournament_id is null
       and not (t.game::text = any($2::text[]))
       and exists (select 1 from games g where g.id = t.game and g.status = 'available')
       and not exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null)
       and not exists (select 1 from table_stakes k where k.table_id = t.id)
       and exists (select 1 from table_seats s where s.table_id = t.id and s.user_id is null and s.invited_id is null)
       and w.since is not null
       and w.since <= now() - make_interval(secs => $1)
     order by w.since, t.id
     limit $3`;

/** Open tables with a system player sitting and no game running: the ones that may have to let it go. */
const SEATED_SQL = `
    select distinct s.table_id as id
      from table_seats s
      join tables t on t.id = s.table_id and t.status = 'open'
     where s.user_id is not null and ${ isSystem('s.user_id') }
       and not exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null)
     limit $1`;

interface BoardRow extends Omit<Board, 'chairs'>
{
    chairs: Chair[] | null;
}

export const boardOf = (row: BoardRow): Board => ({ ...row, chairs: row.chairs ?? [] });

export interface FillSweep
{
    seated: number;
    started: number;
    stood: number;
    closed: number;
    failed: { tableId: string; reason: string }[];
}

export interface FillHooks
{
    /** Starts the game at a table that just filled, as the system player who took the last chair. */
    start(userId: string, tableId: string): Promise<void>;

    /** Tells the people at a table its chairs changed; `gone` are those who just stood up. */
    changed(tableId: string, gone: readonly string[]): Promise<void>;
}

export function createSeatFiller(db: DataSource, random: () => number = Math.random, clock: () => number = Date.now)
{
    const configNow = async () =>
        systemConfigOf(rowsOf<{ value: string }>(await db.query(`select value from settings where key = 'system-players'`))[0]?.value ?? null);

    const boardsOf = async (from: DataSource | EntityManager, ids: readonly string[]) =>
        ids.length === 0 ? [] : rowsOf<BoardRow>(await from.query(BOARDS_SQL, [ids])).map(boardOf);

    const fillOne = async (config: SystemConfig, tableId: string, game: string, here: (userIds: readonly string[]) => ReadonlySet<string>) =>
        await db.transaction(async (tx) =>
        {
            await tx.query(`select pg_advisory_xact_lock(hashtext('quick'), hashtext($1))`, [game]);
            await lockTable(tx, tableId);

            const [board] = await boardsOf(tx, [tableId]);

            if (board === undefined)
            {
                return null;
            }

            const people = board.chairs.flatMap((chair) => isPerson(chair) ? [chair.user!] : []);

            if (!fillable(config, board, here(people)))
            {
                return null;
            }

            const seat = systemChairFor(board);

            if (seat === null)
            {
                return null;
            }

            const userId = await takeIdle(tx, { config, seated: people, random, skill: config.skill });

            if (userId === null || !await seatAt(tx, tableId, seat, userId))
            {
                return null;
            }

            return { userId, full: startsWith(board, seat) };
        });

    const standAt = async (config: SystemConfig, tableId: string) =>
        await db.transaction(async (tx) =>
        {
            await lockTable(tx, tableId);

            const [board] = await boardsOf(tx, [tableId]);
            const gone: string[] = [];
            let closed = false;

            for (const { user } of board === undefined ? [] : standUps(config, board))
            {
                const stood = await standUp(tx, tableId, user);

                closed ||= stood.closed;

                if (stood.left)
                {
                    gone.push(user);
                }
            }

            return { gone, closed };
        });

    return {
        configNow,

        /** One pass: lets go of the system players that must stand up, then seats one more at each table that has waited. */
        async sweep(forMs: number, here: (userIds: readonly string[]) => ReadonlySet<string>, hooks: FillHooks): Promise<FillSweep>
        {
            const until = clock() + forMs;
            const config = await configNow();
            const swept: FillSweep = { seated: 0, started: 0, stood: 0, closed: 0, failed: [] };
            const failed = (tableId: string) => (error: unknown) =>
            {
                swept.failed.push({ tableId, reason: error instanceof Error ? error.message : String(error) });

                return null;
            };

            const seatedAt = rowsOf<{ id: string }>(await db.query(SEATED_SQL, [SEATED_MOST])).map((row) => row.id);

            for (const board of await boardsOf(db, seatedAt))
            {
                if (clock() >= until)
                {
                    return swept;
                }

                if (standUps(config, board).length === 0)
                {
                    continue;
                }

                const stood = await standAt(config, board.id).catch(failed(board.id));

                if (stood === null || stood.gone.length === 0)
                {
                    continue;
                }

                swept.stood += stood.gone.length;
                swept.closed += stood.closed ? 1 : 0;
                await hooks.changed(board.id, stood.gone).catch(failed(board.id));
            }

            if (!config.on)
            {
                return swept;
            }

            const off = Object.entries(config.games).flatMap(([game, on]) => on ? [] : [game]);
            const waiting = rowsOf<{ id: string; game: string }>(await db.query(FILLABLE_SQL, [config.wait, off, FILL_MOST]));

            for (const { id, game } of waiting)
            {
                if (clock() >= until)
                {
                    break;
                }

                const sat = await fillOne(config, id, game, here).catch(failed(id));

                if (sat === null)
                {
                    continue;
                }

                swept.seated += 1;

                if (sat.full)
                {
                    const began = await hooks.start(sat.userId, id).then(() => true, failed(id));

                    swept.started += began === true ? 1 : 0;
                }
                else
                {
                    await hooks.changed(id, []).catch(failed(id));
                }
            }

            return swept;
        }
    };
}

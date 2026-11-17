import type { DataSource, EntityManager } from 'typeorm';

import { Game, Setting } from '../../entities/index.ts';
import { cursorOf, instantOf, keyOf, keysetAfter, type Keyed } from '../../lib/keyset.ts';
import { rowsOf } from '../../lib/rows.ts';
import type { AdminSystem, AdminSystemPlayer, AdminSystemPlayers } from '../../schemas.ts';
import { record, staffRefusal, type Actor } from '../admin/staff.ts';
import { hasSystemSeat, isSystem } from './sql.ts';
import {
    POOL_LEAST,
    POOL_MOST,
    WAIT_LEAST,
    WAIT_MOST,
    isSkill,
    noAiFigures,
    systemConfigOf,
    systemConfigText,
    type AiFigures,
    type Skill,
    type SystemConfig
} from './rules.ts';

const CONFIG_KEY = 'system-players';

export const SYSTEM_PLAYERS_PAGE = 50;

type ConfigPart = 'switch' | 'games' | 'settings';

export interface GameRow
{
    game: string;
    seated: number;
    playing: number;
    live: number;
    today: number;
}

export interface PlayerRow extends Keyed
{
    handle: string;
    display_name: string;
    hue: number;
    skill: Skill;
    style: number;
    played: number;
    retired_at: Date | null;
    created_at: Date;
    table_code: string | null;
    table_game: string | null;
    playing: boolean | null;
}

/** Per game: system players waiting at a table and playing now, live matches with a system seat, and those started today. */
const GAMES_SQL = `
    select g.id as game,
           (select count(*)::int from table_seats s
              join tables t on t.id = s.table_id
             where t.game = g.id and t.status = 'open' and ${ isSystem('s.user_id') }
               and not exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null)) as seated,
           (select count(*)::int from match_players mp
              join matches m on m.id = mp.match_id
             where m.game = g.id and m.finished_at is null and ${ isSystem('mp.user_id') }) as playing,
           (select count(*)::int from matches m
             where m.game = g.id and m.finished_at is null and ${ hasSystemSeat('m.id') }) as live,
           (select count(*)::int from matches m
             where m.game = g.id and m.started_at >= date_trunc('day', now()) and ${ hasSystemSeat('m.id') }) as today
      from games g
     order by g.sort_order, g.id`;

const POOL_SQL = `
    select (count(*) filter (where retired_at is null))::int as size,
           (count(*) filter (where retired_at is not null))::int as retired
      from system_players`;

/** The pool, newest first: who each one is, how it plays, its games, and where it is now. */
const PLAYERS_SQL = `
    select sp.user_id as id, ${ keyOf('sp.created_at') } as at_key,
           u.handle::text as handle, u.display_name, u.hue,
           sp.skill, sp.style, sp.retired_at, sp.created_at,
           (select count(*)::int from match_players mp
              join matches m on m.id = mp.match_id
             where mp.user_id = sp.user_id and m.finished_at is not null and mp.result is distinct from 'void') as played,
           here.code as table_code, here.game as table_game, here.playing
      from system_players sp
      join users u on u.id = sp.user_id
      left join lateral (
               select t.code::text as code, t.game,
                      exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null) as playing
                 from table_seats s
                 join tables t on t.id = s.table_id
                where s.user_id = sp.user_id and t.status = 'open'
                limit 1) here on true
     where ($1::text is null or (sp.created_at, sp.user_id) < (${ instantOf('$1') }, cast($2 as uuid)))
       and ($3::text is null or u.handle = $3)
     order by sp.created_at desc, sp.user_id desc
     limit $4`;

export const playerOf = (row: PlayerRow): AdminSystemPlayer => ({
    handle: row.handle,
    displayName: row.display_name,
    hue: row.hue,
    skill: row.skill,
    style: row.style,
    played: row.played,
    ...(row.table_code === null || row.table_game === null ? {} : { at: { table: row.table_code, game: row.table_game, playing: row.playing === true } }),
    retired: row.retired_at !== null,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at.toISOString() }),
    createdAt: row.created_at.toISOString()
});

/** The page's view of the config and the figures, from the rows read and what the runtime counted. */
export const systemViewOf = (config: SystemConfig, games: readonly GameRow[], pool: { size: number; retired: number }, ai: AiFigures): AdminSystem => ({
    on: config.on,
    wait: config.wait,
    skill: config.skill,
    most: config.most,
    games: games.map((row) => ({ ...row, on: config.games[row.game] !== false })),
    pool,
    ai: { ...ai, errors: ai.errors.map((one) => ({ ...one })) }
});

/** The games part after a change: only the games switched off are kept, since a game absent is on. */
export const gamesAfter = (before: Record<string, boolean>, asked: Record<string, boolean>) =>
{
    const merged = { ...before, ...asked };

    return Object.fromEntries(Object.entries(merged).filter(([, on]) => !on));
};

/** The games a change names that the site does not have; any one refuses the whole change. */
export const unknownGames = (asked: Record<string, boolean>, known: readonly string[]) => Object.keys(asked).filter((game) => !known.includes(game));

export const gamesText = (config: SystemConfig) =>
{
    const off = Object.keys(config.games).filter((game) => config.games[game] === false).sort();

    return off.length === 0 ? 'all on' : `off: ${ off.join(', ') }`;
};

export const settingsText = (config: SystemConfig) => `wait ${ config.wait }s, skill ${ config.skill }, most ${ config.most }`;

/** The settings an admin may write, or null when one is outside its range. */
export const settingsOf = (said: { wait: number; skill: string; most: number }) =>
    Number.isInteger(said.wait) && said.wait >= WAIT_LEAST && said.wait <= WAIT_MOST
    && Number.isInteger(said.most) && said.most >= POOL_LEAST && said.most <= POOL_MOST
    && isSkill(said.skill)
        ? { wait: said.wait, skill: said.skill, most: said.most }
        : null;

/**
 * The staff's side of system players. Reading (`system`): the config, the figures and the pool.
 * Writing: the switch, the games and the settings (the owner's, through `wallet`), and retiring
 * one (`system`). Each change is its staff action in the transaction that makes it, with the
 * setting's row locked, on the model of the rewards config.
 */
export function createSystemAdmin(db: DataSource, aiFigures: () => AiFigures = noAiFigures)
{
    const configNow = async (from: EntityManager) => systemConfigOf((await from.getRepository(Setting).findOneBy({ key: CONFIG_KEY }))?.value ?? null);

    const locked = async (tx: EntityManager) =>
    {
        await tx.getRepository(Setting).createQueryBuilder()
            .insert()
            .values({ key: CONFIG_KEY, value: systemConfigText(systemConfigOf(null)), staffId: null })
            .orIgnore()
            .execute();

        const row = await tx.getRepository(Setting).createQueryBuilder('s')
            .setLock('pessimistic_write')
            .where('s.key = :key', { key: CONFIG_KEY })
            .getOneOrFail();

        return systemConfigOf(row.value);
    };

    const view = async (from: EntityManager): Promise<AdminSystem> =>
    {
        const [config, games, [pool]] = await Promise.all([
            configNow(from),
            from.query(GAMES_SQL).then((rows) => rowsOf<GameRow>(rows)),
            from.query(POOL_SQL).then((rows) => rowsOf<{ size: number; retired: number }>(rows))
        ]);

        return systemViewOf(config, games, pool ?? { size: 0, retired: 0 }, aiFigures());
    };

    const change = async (actor: Actor, part: ConfigPart, reason: string, next: (config: SystemConfig) => SystemConfig, said: (config: SystemConfig) => string) =>
        await db.transaction(async (tx) =>
        {
            const before = await locked(tx);
            const after = systemConfigOf(systemConfigText(next(before)));

            if (systemConfigText(after) !== systemConfigText(before))
            {
                await tx.getRepository(Setting).update({ key: CONFIG_KEY }, { value: systemConfigText(after), staffId: actor.id });
                await record(tx, actor, { kind: 'system-players', reason, details: { part, from: said(before), to: said(after) } });
            }

            return await view(tx);
        });

    const players = async (from: EntityManager, after: { micros: string; id: string } | null, handle: string | null, limit: number) =>
        rowsOf<PlayerRow>(await from.query(PLAYERS_SQL, [after?.micros ?? null, after?.id ?? null, handle, limit]));

    return {
        config: () => configNow(db.manager),

        view: () => view(db.manager),

        /** The pool, newest first, a page at a time. */
        async players(cursor: string | undefined): Promise<AdminSystemPlayers>
        {
            const rows = await players(db.manager, keysetAfter(cursor), null, SYSTEM_PLAYERS_PAGE + 1);

            return { rows: rows.slice(0, SYSTEM_PLAYERS_PAGE).map(playerOf), ...cursorOf(rows, SYSTEM_PLAYERS_PAGE) };
        },

        switchTo: (actor: Actor, on: boolean, reason: string) =>
            change(actor, 'switch', reason, (config) => ({ ...config, on }), (config) => (config.on ? 'on' : 'off')),

        async setGames(actor: Actor, asked: Record<string, boolean>, reason: string)
        {
            const known = (await db.getRepository(Game).find({ select: { id: true } })).map((game) => game.id);
            const unknown = unknownGames(asked, known);

            if (unknown.length > 0)
            {
                throw staffRefusal('staff-system-game', `There is no game ${ unknown[0] }.`);
            }

            return await change(actor, 'games', reason, (config) => ({ ...config, games: gamesAfter(config.games, asked) }), gamesText);
        },

        async setSettings(actor: Actor, said: { wait: number; skill: string; most: number }, reason: string)
        {
            const settings = settingsOf(said);

            if (settings === null)
            {
                throw staffRefusal('staff-system-settings', `Wait is ${ WAIT_LEAST } to ${ WAIT_MOST } seconds and the pool ${ POOL_LEAST } to ${ POOL_MOST }.`);
            }

            return await change(actor, 'settings', reason, (config) => ({ ...config, ...settings }), settingsText);
        },

        /**
         * Retires one: never seated again. A match it is playing is played to the end; standing it
         * up from a table that has not started is the seat filler's.
         */
        async retire(actor: Actor, handle: string, reason: string): Promise<AdminSystemPlayer>
        {
            return await db.transaction(async (tx) =>
            {
                const found = rowsOf<{ id: string; handle: string; retired: boolean }>(await tx.query(
                    `select sp.user_id as id, u.handle::text as handle, sp.retired_at is not null as retired
                       from system_players sp
                       join users u on u.id = sp.user_id
                      where u.handle = $1
                        for update of sp`,
                    [handle]
                ))[0];

                if (found === undefined)
                {
                    throw staffRefusal('staff-nobody', 'No one by that name.');
                }

                if (!found.retired)
                {
                    await tx.query('update system_players set retired_at = now() where user_id = $1', [found.id]);
                    await record(tx, actor, { kind: 'system-players', person: { id: found.id, handle: found.handle }, reason, details: { part: 'retire' } });
                }

                const [row] = await players(tx, null, found.handle, 1);

                return playerOf(row);
            });
        }
    };
}

export type SystemAdmin = ReturnType<typeof createSystemAdmin>;

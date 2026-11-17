import type { EntityManager } from 'typeorm';

import { rowsOf } from '../../lib/rows.ts';
import { systemNameOf, type SystemName } from './names.ts';
import { STYLE_MOST, type Skill, type SystemConfig } from './rules.ts';

/** What a seat filler asks the pool for. */
export interface Wanted
{
    config: SystemConfig;

    /** The people at the table: a system player one of them blocks, or who is blocked by one, is not taken. */
    seated: readonly string[];

    random: () => number;

    /** What a system player made now plays at. */
    skill: Skill;
}

/** How many idle candidates are tried before giving up for this pass; another filler may have just seated one. */
const TAKE_ATTEMPTS = 3;

/** How many names are tried for a new system player before giving up for this pass. */
const MAKE_ATTEMPTS = 4;

/** What to do once the pool has been looked through: take the idle one found, make one, or leave the table waiting. */
export const poolStep = (found: boolean, size: number, most: number): 'take' | 'make' | 'none' =>
    found ? 'take' : size < most ? 'make' : 'none';

/** The `users` values of a new system player: no minor, no strangers' messages, no presence, no picture, no bio. */
export const systemUserOf = (name: SystemName) => ({
    handle: name.handle,
    displayName: name.displayName,
    hue: name.hue,
    isMinor: false,
    allowStrangerMessages: false,
    showOnline: false,
    avatar: null,
    bio: ''
});

export const styleOf = (random: () => number) => Math.min(STYLE_MOST, Math.floor(random() * (STYLE_MOST + 1)));

/**
 * Not retired, not seated anywhere, in no live match, and neither blocking nor blocked by anyone at
 * the table. `skip locked` so two fillers never take the same one; the row stays locked until the
 * caller's transaction ends, which is where it is seated.
 */
const IDLE_SQL = `
    select sp.user_id
      from system_players sp
     where sp.retired_at is null
       and not (sp.user_id = any($2::uuid[]))
       and not exists (select 1 from table_seats s where s.user_id = sp.user_id)
       and not exists (
               select 1 from match_players mp
               join matches m on m.id = mp.match_id
               where mp.user_id = sp.user_id and m.finished_at is null)
       and not exists (
               select 1 from blocks b
               where (b.user_id = sp.user_id and b.blocked_id = any($1::uuid[]))
                  or (b.blocked_id = sp.user_id and b.user_id = any($1::uuid[])))
     order by random()
     limit 1
       for update of sp skip locked`;

/**
 * Asked again in a statement of its own once the row is locked: the first one read the seats as they
 * were when it began, and a filler that committed a seat for this player since is seen only now.
 */
const STILL_IDLE_SQL = `
    select 1 as idle
     where not exists (select 1 from table_seats s where s.user_id = $1::uuid)
       and not exists (
               select 1 from match_players mp
               join matches m on m.id = mp.match_id
               where mp.user_id = $1::uuid and m.finished_at is null)`;

/**
 * A system player to seat, by user id: an idle one when there is one, a new one when the pool is
 * under its cap, and otherwise null, and the table simply waits. Run inside the transaction that
 * seats it.
 */
export async function takeIdle(tx: EntityManager, wanted: Wanted): Promise<string | null>
{
    const passed: string[] = [];

    for (let attempt = 0; attempt < TAKE_ATTEMPTS; attempt += 1)
    {
        const found = rowsOf<{ user_id: string }>(await tx.query(IDLE_SQL, [[...wanted.seated], passed]))[0];

        if (found === undefined)
        {
            break;
        }

        if (rowsOf(await tx.query(STILL_IDLE_SQL, [found.user_id])).length > 0)
        {
            return found.user_id;
        }

        passed.push(found.user_id);
    }

    // One maker at a time, so two fillers both under the cap by one do not both make one.
    await tx.query(`select pg_advisory_xact_lock(hashtext('system-players'), hashtext('make'))`);

    const [{ size }] = rowsOf<{ size: number }>(await tx.query('select count(*)::int as size from system_players where retired_at is null'));

    if (poolStep(false, size, wanted.config.most) !== 'make')
    {
        return null;
    }

    return await make(tx, wanted.random, wanted.skill);
}

/**
 * Makes one system player: its `users` row under a name nobody holds, then its own row. A taken
 * handle is not an error inside a transaction that must go on, so the insert asks the index with
 * `on conflict do nothing` and the next name is tried.
 */
async function make(tx: EntityManager, random: () => number, skill: Skill): Promise<string | null>
{
    for (let attempt = 0; attempt < MAKE_ATTEMPTS; attempt += 1)
    {
        const user = systemUserOf(systemNameOf(random));
        const inserted = rowsOf<{ id: string }>(await tx.query(
            `insert into users (handle, display_name, hue, is_minor, allow_stranger_messages, show_online, avatar, bio)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (handle) do nothing
             returning id`,
            [user.handle, user.displayName, user.hue, user.isMinor, user.allowStrangerMessages, user.showOnline, user.avatar, user.bio]
        ))[0];

        if (inserted !== undefined)
        {
            await tx.query('insert into system_players (user_id, skill, style) values ($1, $2, $3)', [inserted.id, skill, styleOf(random)]);

            return inserted.id;
        }
    }

    return null;
}

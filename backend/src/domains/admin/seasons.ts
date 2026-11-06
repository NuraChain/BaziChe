import type { DataSource, EntityManager } from 'typeorm';

import { Season, User } from '../../entities/index.ts';
import { affectedBy } from '../../lib/rows.ts';
import type { AdminSeasons, SeasonView } from '../../schemas.ts';
import { RATING_HOME, SEASON_DAYS, SEASON_KEEPS } from './roles.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

interface SeasonRow
{
    id: number;
    name: string;
    started_at: Date;
    ends_at: Date;
    ratings_reset: number;
    handle: string | null;
}

export interface SeasonAsk
{
    name: string;
    reason: string;
}

/** The running season's window, for the board: a season counts what finished inside it. */
export interface SeasonWindow
{
    number: number;
    name: string;
    startedAt: Date;
    endsAt: Date;
}

const shown = (row: SeasonRow): SeasonView => ({
    number: row.id,
    name: row.name,
    startedAt: row.started_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    ratingsReset: row.ratings_reset,
    ...(row.handle === null ? {} : { by: row.handle })
});

const seasons = (manager: DataSource | EntityManager) => manager.getRepository(Season).createQueryBuilder('s')
    .leftJoin(User, 'u', 'u.id = s.staff_id')
    .select('s.id', 'id')
    .addSelect('s.name', 'name')
    .addSelect('s.started_at', 'started_at')
    .addSelect('s.ends_at', 'ends_at')
    .addSelect('s.ratings_reset', 'ratings_reset')
    .addSelect('u.handle', 'handle')
    .orderBy('s.id', 'DESC');

/** The season running now, on the database's clock, or null between seasons. */
export async function runningSeason(manager: DataSource | EntityManager): Promise<SeasonWindow | null>
{
    const row = await seasons(manager).where('s.started_at <= now() and s.ends_at > now()').limit(1).getRawOne<SeasonRow>();

    return row === undefined ? null : { number: row.id, name: row.name, startedAt: row.started_at, endsAt: row.ends_at };
}

export function createSeasonService(db: DataSource)
{
    const locked = (tx: EntityManager) => tx.query(`select pg_advisory_xact_lock(hashtext('nura:season'))`);

    const view = async (manager: DataSource | EntityManager): Promise<AdminSeasons> =>
    {
        const [rows, live] = await Promise.all([seasons(manager).getRawMany<SeasonRow>(), runningSeason(manager)]);
        const running = live === null ? undefined : rows.find((row) => row.id === live.number);

        return {
            days: SEASON_DAYS,
            seasons: rows.map(shown),
            ...(running === undefined ? {} : { current: shown(running) })
        };
    };

    return {
        read: () => view(db),

        /**
         * Starts the next season, and pulls every rating halfway back toward where everybody begins.
         *
         * One transaction under one lock: two staff pressing Start at once must not make two seasons,
         * and a reset without its season (or a season without its reset) is a board nobody can explain.
         * The check that none is running is made inside the lock, on the database's clock.
         */
        async start(actor: Actor, ask: SeasonAsk)
        {
            return await db.transaction(async (tx) =>
            {
                await locked(tx);

                if (await runningSeason(tx) !== null)
                {
                    throw staffRefusal('staff-season-running', 'A season is already running.');
                }

                const ratingsReset = affectedBy(await tx.query(
                    `update player_stats
                        set rating = round($1 + (rating - $1) * $2)::int,
                            peak_rating = greatest(peak_rating, round($1 + (rating - $1) * $2)::int)
                      where rating <> $1`,
                    [RATING_HOME, SEASON_KEEPS]
                ));

                const inserted = await tx.createQueryBuilder()
                    .insert()
                    .into(Season)
                    .values({ name: ask.name, endsAt: () => `now() + make_interval(days => ${ SEASON_DAYS })`, ratingsReset, staffId: actor.id })
                    .returning('id')
                    .execute();
                const number = String((inserted.raw as { id: number }[])[0].id);

                await record(tx, actor, {
                    kind: 'season',
                    reason: ask.reason,
                    details: { number, name: ask.name, days: String(SEASON_DAYS), ratings: String(ratingsReset) }
                });

                return view(tx);
            });
        }
    };
}

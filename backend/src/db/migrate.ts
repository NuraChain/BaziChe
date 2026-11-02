import { createHash } from 'node:crypto';

import { DataSource, type DataSourceOptions, type MigrationInterface } from 'typeorm';

import { MIGRATIONS } from './migrations/index.ts';
import { destructive, meaningful, type Statement } from './drift.ts';
import { INDEXES_TYPEORM_CANNOT_EXPRESS, createUnexpressibleIndexes, holdsNothing, rewriteChecks, syncSchema } from './schema.ts';

/** The table the applied migrations are written in, one row each. */
export const MIGRATIONS_TABLE = 'schema_migrations';

/** Where the fingerprint of the rules TypeORM's diff cannot see is kept: one row. */
export const RULES_TABLE = 'schema_rules';

/**
 * Every CHECK the entities declare and every hand-built index, as one hash. TypeORM's diff sees a
 * check added or dropped, never one whose expression changed, so a migration cannot carry that; the
 * boot compares this instead, and rewrites them when it moved.
 */
export function rulesOf(db: Pick<DataSource, 'entityMetadatas'>)
{
    const checks = db.entityMetadatas.flatMap((entity) => entity.checks.map((check) => `${ entity.tablePath }:${ check.name ?? '' }:${ check.expression ?? '' }`));

    return createHash('sha256').update([...checks.sort(), ...INDEXES_TYPEORM_CANNOT_EXPRESS].join('\n')).digest('hex');
}

/** One key for every server on the database: the second to boot waits for the first to finish migrating. */
const LOCK = `hashtext('baziche:migrations')`;

/**
 * What the boot does to the database, one step of it each, so the order and the decisions can be
 * held by a spec without a Postgres, and the real ones are a thin layer over TypeORM.
 */
export interface MigrationTarget
{
    lock(): Promise<void>;
    unlock(): Promise<void>;

    /** No table any entity names: a database nothing was built in yet. */
    empty(): Promise<boolean>;

    /** Whether the migrations table is there: whether this database is versioned yet. */
    versioned(): Promise<boolean>;

    /** Builds the schema from the entities (`syncSchema`). */
    build(): Promise<void>;

    /** Writes every known migration as applied without running any, and the rules as they are: the schema already is what they would make. */
    stamp(): Promise<void>;

    /** Whether the CHECKs or the hand-built indexes changed since they were last written. */
    rulesMoved(): Promise<boolean>;

    /** Runs the migrations not yet applied, oldest first, each in a transaction of its own; answers their names. */
    apply(): Promise<string[]>;

    /** Rewrites every CHECK and the hand-built indexes, which TypeORM's own diff cannot see change, and writes down that it did. */
    settle(): Promise<void>;

    /** The hand-built indexes, `if not exists`: cheap enough for every boot. */
    indexes(): Promise<void>;

    /** What would still change to match the entities, less the noise (`drift.ts`). */
    drift(): Promise<Statement[]>;
}

export type Migrated =
    | { done: 'built' }
    | { done: 'adopted'; synced: boolean }
    | { done: 'migrated'; applied: string[] };

export interface MigrationLog
{
    info(event: string, fields?: Record<string, unknown>): void;
    warn(event: string, fields?: Record<string, unknown>): void;
}

/** A database that holds tables, has never been versioned, and would lose something to match the entities. */
export class BehindAndDestructive extends Error
{
    override readonly name = 'BehindAndDestructive';

    constructor(readonly statements: readonly string[])
    {
        super('This database is behind the entities in a way that would lose data, and it has never been versioned.');
    }
}

/**
 * Brings the database to the entities, one version at a time, on every boot, before anything reads it.
 *
 * - **Empty**: built from the entities, and every migration written down as applied, because what
 *   they would do is already done.
 * - **Never versioned** (built by `syncSchema` before this existed): adopted. If it already matches
 *   the entities, or only lacks what can be added without losing anything, it is synced (its CHECKs
 *   rewritten either way) and every migration written down as applied. If matching them would drop a table or a column it stops,
 *   because that is a person's call and a dump's: `npm run schema:sync` once, then start again.
 * - **Versioned**: every migration not yet applied runs, oldest first, each in a transaction of its
 *   own; the first that fails rolls back and stops the boot. The CHECKs are rewritten after any did,
 *   and whenever their fingerprint moved (`rulesOf`), which no migration can carry.
 *
 * Then whatever still differs from the entities is said, as a warning naming the statements: an
 * entity changed with no migration for it. It does not stop the boot, because TypeORM's diff is not
 * exact (`drift.ts`), and a gate on a guess could keep production down.
 *
 * Every server on the database takes one lock around all of it, so two that start together migrate
 * once.
 */
export async function migrate(target: MigrationTarget, log: MigrationLog)
{
    await target.lock();

    try
    {
        let migrated: Migrated;

        if (await target.empty())
        {
            await target.build();
            await target.stamp();
            migrated = { done: 'built' };
        }
        else if (!await target.versioned())
        {
            const behind = await target.drift();
            const loses = destructive(behind);

            if (loses.length > 0)
            {
                throw new BehindAndDestructive(loses.map((one) => one.query));
            }

            // Built, or its rules rewritten, either way: a database synced before versions existed may
            // hold a CHECK from before its entity changed, which nothing about its tables shows.
            if (behind.length > 0)
            {
                await target.build();
            }
            else
            {
                await target.settle();
            }

            await target.stamp();
            migrated = { done: 'adopted', synced: behind.length > 0 };
        }
        else
        {
            const applied = await target.apply();

            if (applied.length > 0 || await target.rulesMoved())
            {
                await target.settle();
            }

            migrated = { done: 'migrated', applied };
        }

        await target.indexes();

        const left = await target.drift();

        if (left.length > 0)
        {
            log.warn('the entities differ from the database and no migration covers it: npm run migration:new <Name>', {
                statements: left.map((one) => one.query).slice(0, 20)
            });
        }

        return migrated;
    }
    finally
    {
        await target.unlock();
    }
}

/**
 * The real target: a DataSource of its own, two connections, with the time limits a migration needs
 * rather than a request's. The pool's 30-second statement limit would kill an ALTER of a real table
 * halfway; a lock nobody releases fails the boot loudly after a while instead of hanging it.
 */
export function migrationSource(options: DataSourceOptions, migrations: (new () => MigrationInterface)[] = MIGRATIONS)
{
    return new DataSource({
        ...options,
        migrations,
        migrationsTableName: MIGRATIONS_TABLE,
        migrationsTransactionMode: 'each',
        extra: {
            ...('extra' in options ? options.extra as Record<string, unknown> : {}),
            // Two: one holds the lock for the whole of it, and the work needs another beside it. One
            // would wait on itself for ever.
            max: 2,
            statement_timeout: 30 * 60_000,
            lock_timeout: 60_000
        }
    } as DataSourceOptions);
}

export function targetOf(db: DataSource): MigrationTarget
{
    const runner = db.createQueryRunner();
    const rules = rulesOf(db);

    const writeRules = async () =>
    {
        await db.query(`create table if not exists ${ RULES_TABLE } (id smallint primary key check (id = 1), hash text not null, written_at timestamptz not null default now())`);
        await db.query(
            `insert into ${ RULES_TABLE } (id, hash) values (1, $1) on conflict (id) do update set hash = excluded.hash, written_at = now()`,
            [rules]
        );
    };

    return {
        lock: async () =>
        {
            await runner.connect();
            await runner.query(`select pg_advisory_lock(${ LOCK })`);
        },

        unlock: async () =>
        {
            try
            {
                await runner.query(`select pg_advisory_unlock(${ LOCK })`);
            }
            finally
            {
                await runner.release();
            }
        },

        empty: () => holdsNothing(db),

        versioned: () => runner.hasTable(MIGRATIONS_TABLE),

        build: () => syncSchema(db),

        stamp: async () =>
        {
            await db.runMigrations({ transaction: 'all', fake: true });
            await writeRules();
        },

        rulesMoved: async () =>
        {
            if (!await runner.hasTable(RULES_TABLE))
            {
                return true;
            }

            const rows = await db.query(`select hash from ${ RULES_TABLE } where id = 1`) as { hash: string }[];

            return rows[0]?.hash !== rules;
        },

        apply: async () => (await db.runMigrations({ transaction: 'each' })).map((one) => one.name),

        settle: async () =>
        {
            // One transaction: dropped and re-added one at a time, a check the rows break would leave
            // its table with no rule at all in its place.
            await db.transaction(async (tx) => rewriteChecks(db, tx));
            await createUnexpressibleIndexes(db);
            await writeRules();
        },

        indexes: () => createUnexpressibleIndexes(db),

        drift: async () => meaningful((await db.driver.createSchemaBuilder().log()).upQueries)
    };
}

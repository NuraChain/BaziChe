import { createHash } from 'node:crypto';

import { DataSource, type DataSourceOptions, type MigrationInterface } from 'typeorm';

import { queueRunners } from '../lib/one-at-a-time.ts';
import { MIGRATIONS } from './migrations/index.ts';
import { keptFirst, meaningful, type Statement } from './drift.ts';
import { INDEXES_TYPEORM_CANNOT_EXPRESS, createUnexpressibleIndexes, holdsNothing, rewriteChecks, syncSchema } from './schema.ts';

/** The table the applied migrations are written in, one row each. */
export const MIGRATIONS_TABLE = 'schema_migrations';

/** The versions a start made by itself from the entities, one row each, with what it ran. */
export const VERSIONS_TABLE = 'schema_versions';

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

    /** Applies those statements in one transaction, a copy of what each would lose taken first, and writes them down as the next version. */
    change(statements: readonly Statement[]): Promise<Changed>;
}

/** One version a start made by itself: its number, what it ran, and the tables that keep what it would have lost. */
export interface Changed
{
    version: number;
    statements: string[];
    kept: string[];
}

export type Migrated =
    | { done: 'built' }
    | { done: 'adopted'; changed: Changed | null }
    | { done: 'migrated'; applied: string[]; changed: Changed | null };

export interface MigrationLog
{
    info(event: string, fields?: Record<string, unknown>): void;
    warn(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Brings the database to the entities on every boot, before anything reads it, with no command for
 * anybody to run.
 *
 * - **Empty**: built from the entities, and every migration written down as applied, because what
 *   they would do is already done.
 * - **Never versioned** (built by `syncSchema` before this existed): adopted, every migration written
 *   down as applied, then changed like any other.
 * - **Versioned**: every migration file not yet applied runs, oldest first, each in a transaction of
 *   its own; the first that fails rolls back and stops the boot. A file is for what the entities
 *   cannot say: rows moved, a column renamed with its values.
 *
 * Then whatever still differs from the entities is applied by the start itself, in one transaction,
 * and written down as the next version (`schema_versions`). What a statement would lose (a column
 * dropped or retyped, a table dropped) is copied to a `kept_` table first, so no start ever loses a
 * row; one the rows cannot take (a NOT NULL column with no default on a table that has rows, a value
 * that does not cast) rolls the whole version back and stops the boot, nothing moved. The CHECKs
 * are rewritten after anything changed, and whenever their fingerprint moved (`rulesOf`), which no
 * diff can see.
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
        else
        {
            const adopting = !await target.versioned();
            const applied = adopting ? [] : await target.apply();

            if (adopting)
            {
                await target.stamp();
            }

            const behind = await target.drift();
            const changed = behind.length === 0 ? null : await target.change(behind);

            // A database synced before versions existed may hold a CHECK from before its entity
            // changed, which nothing about its tables shows: an adopted one is settled whatever.
            if (adopting || applied.length > 0 || changed !== null || await target.rulesMoved())
            {
                await target.settle();
            }

            if (changed !== null && changed.kept.length > 0)
            {
                log.warn('a change dropped or retyped something that held rows: they are kept beside it', { version: changed.version, kept: changed.kept });
            }

            migrated = adopting ? { done: 'adopted', changed } : { done: 'migrated', applied, changed };
        }

        await target.indexes();

        const left = await target.drift();

        if (left.length > 0)
        {
            log.warn('the entities still differ from the database after it was changed to match them', {
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
    return queueRunners(new DataSource({
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
    } as DataSourceOptions));
}

export function targetOf(db: DataSource): MigrationTarget
{
    const runner = db.createQueryRunner();
    const rules = rulesOf(db);

    const keysOf = (table: string) =>
        db.entityMetadatas.find((entity) => entity.tableName === table)?.primaryColumns.map((column) => column.databaseName) ?? [];

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

        drift: async () => meaningful((await db.driver.createSchemaBuilder().log()).upQueries),

        change: async (statements) => await db.transaction(async (tx) =>
        {
            await tx.query(`create table if not exists ${ VERSIONS_TABLE } (version serial primary key, at timestamptz not null default now(), statements jsonb not null, kept text[] not null default '{}')`);

            const queries = statements.map((one) => one.query);
            const [row] = await tx.query(`insert into ${ VERSIONS_TABLE } (statements) values ($1) returning version`, [JSON.stringify(queries)]) as { version: number }[];
            const planned = keptFirst(statements, row.version, keysOf);

            for (const statement of planned.statements)
            {
                await tx.query(statement.query, statement.parameters);
            }

            await tx.query(`update ${ VERSIONS_TABLE } set kept = $2 where version = $1`, [row.version, planned.kept]);

            return { version: row.version, statements: queries, kept: planned.kept };
        })
    };
}

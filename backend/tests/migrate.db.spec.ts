import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, type DataSourceOptions, type MigrationInterface, type QueryRunner } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { BehindAndDestructive, MIGRATIONS_TABLE, RULES_TABLE, migrate, migrationSource, rulesOf, targetOf } from '../src/db/migrate.ts';
import { syncSchema } from '../src/db/schema.ts';

/**
 * A start against a real Postgres: an empty database built and versioned, one built before versions
 * adopted (and refused when that would lose data), a migration applied once and never again, one
 * that fails rolled back whole, two starts at once migrating once, and a CHECK that changed with no
 * migration rewritten all the same. OPT-IN, like the other `.db.spec` suites, on a database of its own.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

const PROBE = 'nura_migrate_probe';

const probeUrl = () => new URL(url ?? '').toString().replace(/\/[^/]*$/, `/${ PROBE }`);

const OPTIONS = (): DataSourceOptions => ({ type: 'postgres', uuidExtension: 'pgcrypto', url: probeUrl(), entities, synchronize: false, logging: ['error'] });

const quiet = { info: () => undefined, warn: () => undefined };

class AddProbeTable1900000000000 implements MigrationInterface
{
    name = 'AddProbeTable1900000000000';

    async up(runner: QueryRunner)
    {
        await runner.query('create table probe_added (id int primary key)');
        await runner.query('insert into probe_counter (n) values (1)');
    }

    async down(runner: QueryRunner)
    {
        await runner.query('drop table probe_added');
    }
}

class FailsHalfway1900000000001 implements MigrationInterface
{
    name = 'FailsHalfway1900000000001';

    async up(runner: QueryRunner)
    {
        await runner.query('create table probe_half (id int)');
        await runner.query('select 1 / 0');
    }

    async down()
    {
        // Never reached.
    }
}

let base: DataSource;

/** A start: its own migrator, as main.ts makes one, and gone once it has run. */
const start = async (migrations: (new () => MigrationInterface)[] = []) =>
{
    const migrator = migrationSource(OPTIONS(), migrations);
    await migrator.initialize();

    try
    {
        return await migrate(targetOf(migrator), quiet);
    }
    finally
    {
        await migrator.destroy();
    }
};

const onProbe = async <T>(work: (db: DataSource) => Promise<T>) =>
{
    const db = new DataSource(OPTIONS());
    await db.initialize();

    try
    {
        return await work(db);
    }
    finally
    {
        await db.destroy();
    }
};

const tables = (db: DataSource) => db.query(`select tablename as t from pg_tables where schemaname = 'public'`).then((rows: { t: string }[]) => rows.map((row) => row.t));

const applied = (db: DataSource) => db.query(`select name from ${ MIGRATIONS_TABLE } order by id`).then((rows: { name: string }[]) => rows.map((row) => row.name));

describe.skipIf(!active)('a start migrating the database, against a real Postgres', () =>
{
    beforeAll(async () =>
    {
        base = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await base.initialize();
    }, 60_000);

    beforeEach(async () =>
    {
        await base.query(`drop database if exists ${ PROBE } with (force)`);
        await base.query(`create database ${ PROBE }`);
        await onProbe((db) => db.query('create extension if not exists citext').then(() => db.query('create extension if not exists pgcrypto')));
    }, 60_000);

    afterAll(async () =>
    {
        if (base?.isInitialized)
        {
            await base.query(`drop database if exists ${ PROBE } with (force)`);
            await base.destroy();
        }
    }, 60_000);

    it('builds an empty database, writes the migrations down as done, and finds nothing left to change, then or after', async () =>
    {
        expect(await start([AddProbeTable1900000000000])).toEqual({ done: 'built' });

        await onProbe(async (db) =>
        {
            expect(await tables(db)).toEqual(expect.arrayContaining(['channels', 'nft_tokens', MIGRATIONS_TABLE, RULES_TABLE]));
            expect(await tables(db), 'a migration written down as done was not run').not.toContain('probe_added');
            expect(await applied(db)).toEqual(['AddProbeTable1900000000000']);
            expect((await db.query(`select hash from ${ RULES_TABLE }`))[0].hash).toBe(rulesOf(db));
            expect(await targetOf(db).drift(), 'a database just built differs from the entities in something the noise does not cover').toEqual([]);
        });

        expect(await start([AddProbeTable1900000000000])).toEqual({ done: 'migrated', applied: [] });
    }, 300_000);

    it('adopts a database built before versions as it stands, and from then on is versioned', async () =>
    {
        await onProbe((db) => syncSchema(db));

        expect(await start()).toEqual({ done: 'adopted', synced: false });
        await onProbe(async (db) => expect(await tables(db)).toContain(MIGRATIONS_TABLE));
        expect(await start()).toEqual({ done: 'migrated', applied: [] });
    }, 300_000);

    it('adopts one that only lacks something, building it, with the rows it had kept', async () =>
    {
        await onProbe(async (db) =>
        {
            await syncSchema(db);
            await db.query(`alter table channel_votes drop column voted_at`);
            await db.query(`insert into users (handle, display_name, hue) values ('kept', 'Kept', 1)`);
        });

        expect(await start()).toEqual({ done: 'adopted', synced: true });

        await onProbe(async (db) =>
        {
            expect((await db.query(`select column_name from information_schema.columns where table_name = 'channel_votes' and column_name = 'voted_at'`)).length).toBe(1);
            expect((await db.query(`select handle from users`)).map((row: { handle: string }) => row.handle)).toEqual(['kept']);
        });
    }, 300_000);

    it('refuses to adopt one that would lose a column with its data, and changes nothing', async () =>
    {
        await onProbe(async (db) =>
        {
            await syncSchema(db);
            await db.query(`alter table channels add column somebodys_notes text`);
        });

        const refused = await start().catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(BehindAndDestructive);
        expect((refused as BehindAndDestructive).statements.join(' ')).toContain('somebodys_notes');

        await onProbe(async (db) =>
        {
            expect(await tables(db)).not.toContain(MIGRATIONS_TABLE);
            expect((await db.query(`select column_name from information_schema.columns where table_name = 'channels' and column_name = 'somebodys_notes'`)).length).toBe(1);
        });
    }, 300_000);

    it('applies a migration added later once, and never again', async () =>
    {
        await start();
        await onProbe((db) => db.query('create table probe_counter (n int)'));

        expect(await start([AddProbeTable1900000000000])).toEqual({ done: 'migrated', applied: ['AddProbeTable1900000000000'] });
        expect(await start([AddProbeTable1900000000000])).toEqual({ done: 'migrated', applied: [] });

        await onProbe(async (db) =>
        {
            expect(await tables(db)).toContain('probe_added');
            expect((await db.query('select count(*)::int as n from probe_counter'))[0].n).toBe(1);
            expect(await applied(db)).toEqual(['AddProbeTable1900000000000']);
        });
    }, 300_000);

    it('rolls a failing migration back whole, writes nothing down, and stops', async () =>
    {
        await start();

        const failed = await start([FailsHalfway1900000000001]).catch((error: unknown) => error);

        expect((failed as Error).message).toContain('division by zero');

        await onProbe(async (db) =>
        {
            expect(await tables(db), 'half a migration stayed behind').not.toContain('probe_half');
            expect(await applied(db)).toEqual([]);
        });
    }, 300_000);

    it('migrates once when two servers start together', async () =>
    {
        await start();
        await onProbe((db) => db.query('create table probe_counter (n int)'));

        const both = await Promise.all([start([AddProbeTable1900000000000]), start([AddProbeTable1900000000000])]);

        expect(both.map((one) => (one.done === 'migrated' ? one.applied.length : -1)).sort()).toEqual([0, 1]);
        await onProbe(async (db) => expect((await db.query('select count(*)::int as n from probe_counter'))[0].n).toBe(1));
    }, 300_000);

    it('rewrites a CHECK that changed with no migration for it, as a deploy that only changed a rule would need', async () =>
    {
        await start();

        await onProbe(async (db) =>
        {
            // What a database holds when its entity widened a rule after it was built: the old, narrower one.
            await db.query(`alter table notifications drop constraint notifications_kind_known`);
            await db.query(`alter table notifications add constraint notifications_kind_known check (kind in ('message'))`);
            await db.query(`update ${ RULES_TABLE } set hash = 'the rules of an older build'`);
        });

        expect(await start()).toEqual({ done: 'migrated', applied: [] });

        await onProbe(async (db) =>
        {
            const [rule] = await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_kind_known'`) as { def: string }[];

            expect(rule.def).toContain('channel-invite');
            expect((await db.query(`select hash from ${ RULES_TABLE }`))[0].hash).toBe(rulesOf(db));
        });
    }, 300_000);
});

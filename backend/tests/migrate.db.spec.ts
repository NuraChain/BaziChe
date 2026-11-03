import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, type DataSourceOptions, type MigrationInterface, type QueryRunner } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { MIGRATIONS_TABLE, RULES_TABLE, VERSIONS_TABLE, migrate, migrationSource, rulesOf, targetOf } from '../src/db/migrate.ts';
import { FillMessengerColumns1793682422851 } from '../src/db/migrations/1793682422851-FillMessengerColumns.ts';
import { syncSchema } from '../src/db/schema.ts';

/**
 * A start against a real Postgres: an empty database built and versioned, one built before versions
 * adopted (what it would lose kept beside it), an entity change with no file applied as a version,
 * one the rows cannot take rolled back whole, a migration applied once and never again, one that
 * fails rolled back whole, two starts at once migrating once, and a CHECK that changed with no
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

const columnsOf = (db: DataSource, table: string) =>
    db.query(`select column_name as c from information_schema.columns where table_name = $1`, [table]).then((rows: { c: string }[]) => rows.map((row) => row.c));

const applied = (db: DataSource) => db.query(`select name from ${ MIGRATIONS_TABLE } order by id`).then((rows: { name: string }[]) => rows.map((row) => row.name));

const FILLED = FillMessengerColumns1793682422851.name;

const EVERY_RIGHT = ['info', 'invite', 'approve', 'remove', 'ban', 'delete', 'pin', 'members', 'calls'];

/**
 * A group with an owner, an admin holding one right and a member, its room, and a file sent in it,
 * each in the shape the entities give them now, with roles that began an hour after they joined.
 */
const groupWithAFile = async (db: DataSource) =>
{
    await db.query(`insert into users (handle, display_name, hue) values ('old.owner', 'Owner', 1), ('old.admin', 'Admin', 2), ('old.member', 'Member', 3)`);

    const ids = Object.fromEntries((await db.query(`select handle::text as handle, id from users`) as { handle: string; id: string }[]).map((row) => [row.handle, row.id]));

    await db.query(
        `insert into groups (slug, name, crest, hue, privacy, created_by, members_send, members_media, members_add, members_pin,
                             members_info, members_call, members_join_call, members_speak, approval)
         values ('old-crew', 'Old crew', 'dice', 1, 'public', $1, false, false, false, true, true, false, false, false, true)`,
        [ids['old.owner']]
    );

    const [group] = await db.query(`select id from groups`) as { id: string }[];

    await db.query(
        `insert into group_members (group_id, user_id, role, rights, role_since, joined_at)
         values ($1, $2, 'owner', null, now() - interval '1 day' + interval '1 hour', now() - interval '1 day'),
                ($1, $3, 'admin', array['pin']::text[], now() - interval '1 day' + interval '1 hour', now() - interval '1 day'),
                ($1, $4, 'member', null, null, now() - interval '1 day')`,
        [group.id, ids['old.owner'], ids['old.admin'], ids['old.member']]
    );
    await db.query(`insert into conversations (kind, group_id) values ('group', $1)`, [group.id]);

    const [room] = await db.query(`select id from conversations where group_id = $1`, [group.id]) as { id: string }[];
    const device = 'od00000000000000000001';
    const file = crypto.randomUUID();

    await db.query(
        `insert into devices (id, user_id, label, exchange_key, signing_key, attested, attested_address, attested_message, attested_signature)
         values ($1, $2, 'Old', 'exchange', 'signing', 'wallet', '0x0000000000000000000000000000000000000000', 'message', 'signature')`,
        [device, ids['old.owner']]
    );
    await db.query(
        `insert into conversation_epochs (conversation_id, epoch, minted_by, recipients, signature, confirmation)
         values ($1, 1, $2, $3, 'signature', 'confirmation')`,
        [room.id, device, device]
    );
    await db.query(`insert into chat_files (id, uploader_id, bytes, size) values ($1, $2, $3, 4096)`, [file, ids['old.owner'], Buffer.alloc(4096, 9)]);
    await db.query(
        `insert into messages (conversation_id, sender_id, kind, body, epoch, seq, iv, sender_device_id, signature, client_at, commitment, frank, file_id, file_as)
         values ($1, $2, 'file', 'a sealed document', 1, 1, 'nonce', $3, 'signature', now(), 'a-commitment', 'a-frank', $4, 'photo')`,
        [room.id, ids['old.owner'], device, file]
    );
};

const switchesOf = (db: DataSource) => db.query(
    `select members_send as send, members_media as media, members_add as add, members_pin as pin, members_info as info,
            members_call as call, members_join_call as join, members_speak as speak, approval
       from groups`
);

/** Each member's role, rights, and how many seconds after they joined their role began. */
const rolesOf = (db: DataSource) => db.query(
    `select role, rights, extract(epoch from role_since - joined_at)::int as since
       from group_members
      order by case role when 'owner' then 0 when 'admin' then 1 else 2 end`
) as Promise<{ role: string; rights: string[] | null; since: number | null }[]>;

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

        expect(await start([AddProbeTable1900000000000])).toEqual({ done: 'migrated', applied: [], changed: null });
    }, 300_000);

    it('adopts a database built before versions as it stands, and from then on is versioned', async () =>
    {
        await onProbe((db) => syncSchema(db));

        expect(await start()).toEqual({ done: 'adopted', changed: null });
        await onProbe(async (db) => expect(await tables(db)).toContain(MIGRATIONS_TABLE));
        expect(await start()).toEqual({ done: 'migrated', applied: [], changed: null });
    }, 300_000);

    it('adopts one that only lacks something, changing it as version 1, with the rows it had kept', async () =>
    {
        await onProbe(async (db) =>
        {
            await syncSchema(db);
            await db.query(`alter table channel_votes drop column voted_at`);
            await db.query(`insert into users (handle, display_name, hue) values ('kept', 'Kept', 1)`);
        });

        const done = await start();

        expect(done.done).toBe('adopted');
        expect(done.done === 'adopted' ? done.changed?.version : null).toBe(1);

        await onProbe(async (db) =>
        {
            expect(await columnsOf(db, 'channel_votes')).toContain('voted_at');
            expect((await db.query(`select handle from users`)).map((row: { handle: string }) => row.handle)).toEqual(['kept']);
            expect(await targetOf(db).drift()).toEqual([]);
        });
    }, 300_000);

    it('adopts one holding a column the entities dropped, keeping its rows in a table beside it', async () =>
    {
        await onProbe(async (db) =>
        {
            await syncSchema(db);
            await db.query(`alter table users add column somebodys_notes text`);
            await db.query(`insert into users (handle, display_name, hue, somebodys_notes) values ('noted', 'Noted', 1, 'remember this')`);
        });

        const done = await start();
        const changed = done.done === 'adopted' ? done.changed : null;

        expect(changed?.kept).toEqual([`kept_${ changed?.version }_users__somebodys_notes`]);

        await onProbe(async (db) =>
        {
            expect(await columnsOf(db, 'users')).not.toContain('somebodys_notes');
            expect(await db.query(`select u.handle, k.somebodys_notes as notes from "${ changed!.kept[0] }" k join users u on u.id = k.id`)).toEqual([{ handle: 'noted', notes: 'remember this' }]);
            expect(await targetOf(db).drift(), 'a kept table is something a later diff sees').toEqual([]);
        });
    }, 300_000);

    it('changes a versioned database to an entity that changed with no migration for it, once, as the next version', async () =>
    {
        await start();
        await onProbe((db) => db.query(`alter table channel_votes drop column voted_at`));

        const done = await start();

        expect(done).toEqual({ done: 'migrated', applied: [], changed: { version: 1, statements: [expect.stringContaining('voted_at')], kept: [] } });
        expect(await start()).toEqual({ done: 'migrated', applied: [], changed: null });

        await onProbe(async (db) =>
        {
            expect(await columnsOf(db, 'channel_votes')).toContain('voted_at');
            expect(await db.query(`select version, statements from ${ VERSIONS_TABLE }`)).toEqual([{ version: 1, statements: [expect.stringContaining('voted_at')] }]);
        });
    }, 300_000);

    it('rolls a change the rows cannot take back whole, writes no version, and stops', async () =>
    {
        await start();

        await onProbe(async (db) =>
        {
            await db.query(`insert into users (handle, display_name, hue) values ('there', 'There', 1)`);
            await db.query(`alter table users drop column display_name`);
        });

        const failed = await start().catch((error: unknown) => error);

        expect((failed as { driverError?: { code?: string } }).driverError?.code, 'a NOT NULL column with no default, added to a table with rows').toBe('23502');

        await onProbe(async (db) =>
        {
            expect(await columnsOf(db, 'users')).not.toContain('display_name');
            expect(await db.query(`select count(*)::int as n from ${ VERSIONS_TABLE }`).catch(() => [{ n: 0 }])).toEqual([{ n: 0 }]);
        });
    }, 300_000);

    it('applies a migration added later once, and never again', async () =>
    {
        await start();
        await onProbe((db) => db.query('create table probe_counter (n int)'));

        expect(await start([AddProbeTable1900000000000])).toEqual({ done: 'migrated', applied: ['AddProbeTable1900000000000'], changed: null });
        expect(await start([AddProbeTable1900000000000])).toEqual({ done: 'migrated', applied: [], changed: null });

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

        expect(await start()).toEqual({ done: 'migrated', applied: [], changed: null });

        await onProbe(async (db) =>
        {
            const [rule] = await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_kind_known'`) as { def: string }[];

            expect(rule.def).toContain('channel-invite');
            expect((await db.query(`select hash from ${ RULES_TABLE }`))[0].hash).toBe(rulesOf(db));
        });
    }, 300_000);

    it('gives rows from before the messenger what a row made now is given, and the start then holds them to its rules', async () =>
    {
        await start();

        await onProbe(async (db) =>
        {
            await groupWithAFile(db);

            // What a database built before the messenger's groups and files holds: the rows, and none of these.
            await db.query(
                `alter table groups drop column members_send, drop column members_media, drop column members_add, drop column members_pin,
                                    drop column members_info, drop column members_call, drop column members_join_call,
                                    drop column members_speak, drop column approval`
            );
            await db.query(`alter table group_members drop column rights, drop column role_since`);
            await db.query(`alter table messages drop column file_as`);
        });

        const done = await start([FillMessengerColumns1793682422851]);

        expect(done).toEqual({ done: 'migrated', applied: [FILLED], changed: expect.objectContaining({ kept: [] }) });
        expect(await start([FillMessengerColumns1793682422851])).toEqual({ done: 'migrated', applied: [], changed: null });

        await onProbe(async (db) =>
        {
            expect(await switchesOf(db)).toEqual([{ send: true, media: true, add: true, pin: false, info: false, call: true, join: true, speak: true, approval: false }]);
            expect(await rolesOf(db)).toEqual([
                { role: 'owner', rights: null, since: 0 },
                { role: 'admin', rights: EVERY_RIGHT, since: 0 },
                { role: 'member', rights: null, since: null }
            ]);
            expect(await db.query(`select kind, file_as from messages`)).toEqual([{ kind: 'file', file_as: 'file' }]);
            expect(await targetOf(db).drift()).toEqual([]);
        });
    }, 300_000);

    it('changes nothing on a database that already holds what it gives', async () =>
    {
        await start();
        await onProbe(groupWithAFile);

        expect(await start([FillMessengerColumns1793682422851])).toEqual({ done: 'migrated', applied: [FILLED], changed: null });

        await onProbe(async (db) =>
        {
            expect(await switchesOf(db)).toEqual([{ send: false, media: false, add: false, pin: true, info: true, call: false, join: false, speak: false, approval: true }]);
            expect(await rolesOf(db)).toEqual([
                { role: 'owner', rights: null, since: 3600 },
                { role: 'admin', rights: ['pin'], since: 3600 },
                { role: 'member', rights: null, since: null }
            ]);
            expect(await db.query(`select file_as from messages`)).toEqual([{ file_as: 'photo' }]);
        });
    }, 300_000);
});

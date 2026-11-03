import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { destructive, keptFirst, meaningful, type Statement } from '../src/db/drift.ts';
import { migrate, type MigrationTarget } from '../src/db/migrate.ts';
import { MIGRATION_NAME, migrationSourceOf, registered } from '../src/db/migration-file.ts';
import { MIGRATIONS } from '../src/db/migrations/index.ts';
import { HAND_BUILT_INDEX_NAMES } from '../src/db/schema.ts';

/**
 * What a start does to the database, step by step, against a database that answers as told: built
 * when empty, adopted once when it predates versions, every pending migration applied, what still
 * differs changed by the start itself as a version, the rules rewritten when they moved, and one
 * lock round all of it.
 */

interface World
{
    empty: boolean;
    versioned: boolean;
    drift: Statement[][];
    pending: string[];
    rulesMoved: boolean;
    fail?: string;
}

const run = async (world: World) =>
{
    const did: string[] = [];
    const warned: unknown[] = [];
    let drifts = 0;

    const target: MigrationTarget = {
        lock: async () =>
        {
            did.push('lock');
        },
        unlock: async () =>
        {
            did.push('unlock');
        },
        empty: async () => world.empty,
        versioned: async () => world.versioned,
        build: async () =>
        {
            did.push('build');
        },
        stamp: async () =>
        {
            did.push('stamp');
        },
        rulesMoved: async () => world.rulesMoved,
        apply: async () =>
        {
            if (world.fail !== undefined)
            {
                throw new Error(world.fail);
            }
            did.push(`apply ${ world.pending.join(' ') }`.trim());
            return world.pending;
        },
        settle: async () =>
        {
            did.push('settle');
        },
        indexes: async () =>
        {
            did.push('indexes');
        },
        drift: async () => world.drift[drifts++] ?? [],
        change: async (statements) =>
        {
            did.push(`change ${ statements.map((one) => one.query).join('; ') }`);
            return { version: 7, statements: statements.map((one) => one.query), kept: keptFirst(statements, 7, () => ['id']).kept };
        }
    };

    const done = await migrate(target, { info: () => undefined, warn: (_event, fields) => warned.push(fields) }).catch((error: unknown) => error);

    return { done, did, warned };
};

const world = (over: Partial<World> = {}): World => ({ empty: false, versioned: true, drift: [], pending: [], rulesMoved: false, ...over });

const ADD = { query: 'ALTER TABLE "channels" ADD "topic" text' };
const DROP = { query: 'ALTER TABLE "channels" DROP COLUMN "bio"' };

describe('a start, against the database it finds', () =>
{
    it('builds an empty database from the entities and writes every migration down as done', async () =>
    {
        const ran = await run(world({ empty: true }));

        expect(ran.done).toEqual({ done: 'built' });
        expect(ran.did).toEqual(['lock', 'build', 'stamp', 'indexes', 'unlock']);
    });

    it('adopts a database built before versions as it stands, rewriting its rules once, when nothing differs', async () =>
    {
        const ran = await run(world({ versioned: false }));

        expect(ran.done).toEqual({ done: 'adopted', changed: null });
        expect(ran.did).toEqual(['lock', 'stamp', 'settle', 'indexes', 'unlock']);
    });

    it('adopts one that lacks something by changing it to the entities, as a version', async () =>
    {
        const ran = await run(world({ versioned: false, drift: [[ADD]] }));

        expect(ran.done).toEqual({ done: 'adopted', changed: { version: 7, statements: [ADD.query], kept: [] } });
        expect(ran.did).toEqual(['lock', 'stamp', `change ${ ADD.query }`, 'settle', 'indexes', 'unlock']);
    });

    it('applies what is pending and rewrites the rules after, and on the next start applies nothing', async () =>
    {
        const first = await run(world({ pending: ['AddChannelTopic1730000000000'] }));

        expect(first.done).toEqual({ done: 'migrated', applied: ['AddChannelTopic1730000000000'], changed: null });
        expect(first.did).toEqual(['lock', 'apply AddChannelTopic1730000000000', 'settle', 'indexes', 'unlock']);

        const second = await run(world());

        expect(second.done).toEqual({ done: 'migrated', applied: [], changed: null });
        expect(second.did).toEqual(['lock', 'apply', 'indexes', 'unlock']);
    });

    it('changes what an entity says and no migration file covers by itself, after the files, and settles the rules', async () =>
    {
        const ran = await run(world({ pending: ['AddChannelTopic1730000000000'], drift: [[ADD]] }));

        expect(ran.done).toEqual({ done: 'migrated', applied: ['AddChannelTopic1730000000000'], changed: { version: 7, statements: [ADD.query], kept: [] } });
        expect(ran.did).toEqual(['lock', 'apply AddChannelTopic1730000000000', `change ${ ADD.query }`, 'settle', 'indexes', 'unlock']);
        expect(ran.warned).toEqual([]);
    });

    it('changes one that drops something too, and says where its rows were kept', async () =>
    {
        const ran = await run(world({ drift: [[ADD, DROP]] }));

        expect((ran.done as { changed: unknown }).changed).toEqual({ version: 7, statements: [ADD.query, DROP.query], kept: ['kept_7_channels__bio'] });
        expect(ran.warned).toEqual([{ version: 7, kept: ['kept_7_channels__bio'] }]);
    });

    it('rewrites the rules when only a CHECK changed, which no diff can see', async () =>
    {
        expect((await run(world({ rulesMoved: true }))).did).toEqual(['lock', 'apply', 'settle', 'indexes', 'unlock']);
    });

    it('stops at a migration that fails, and lets the lock go', async () =>
    {
        const ran = await run(world({ fail: 'violates check constraint' }));

        expect((ran.done as Error).message).toBe('violates check constraint');
        expect(ran.did).toEqual(['lock', 'unlock']);
    });

    it('says what still differs once it changed what it could, naming the statements, and starts all the same', async () =>
    {
        const ran = await run(world({ drift: [[ADD], [ADD]] }));

        expect((ran.done as { done: string }).done).toBe('migrated');
        expect(ran.warned).toEqual([{ statements: [ADD.query] }]);
    });
});

describe('what a change by itself would lose', () =>
{
    const keys = (table: string) => (table === 'channel_votes' ? ['channel_id', 'user_id'] : table === 'channels' ? ['id'] : []);

    it('is copied first, with the primary key beside it, and the change runs as it was', () =>
    {
        const planned = keptFirst([ADD, DROP], 3, keys);

        expect(planned.statements.map((one) => one.query)).toEqual([
            ADD.query,
            'CREATE TABLE "kept_3_channels__bio" AS SELECT "id", "bio" FROM "channels"',
            DROP.query
        ]);
        expect(planned.kept).toEqual(['kept_3_channels__bio']);
    });

    it('keeps a retyped column, a column of a table with no known key whole, and a dropped table whole, each once', () =>
    {
        const planned = keptFirst([
            { query: 'ALTER TABLE "channel_votes" ALTER COLUMN "weight" TYPE integer' },
            { query: 'ALTER TABLE "channel_votes" DROP COLUMN "weight"' },
            { query: 'ALTER TABLE "probe" DROP COLUMN "note"' },
            { query: 'DROP TABLE "old_things"' }
        ], 4, keys);

        expect(planned.statements.map((one) => one.query).filter((one) => one.startsWith('CREATE'))).toEqual([
            'CREATE TABLE "kept_4_channel_votes__weight" AS SELECT "channel_id", "user_id", "weight" FROM "channel_votes"',
            'CREATE TABLE "kept_4_probe__note" AS TABLE "probe"',
            'CREATE TABLE "kept_4_old_things" AS TABLE "old_things"'
        ]);
        expect(planned.statements).toHaveLength(7);
    });

    it('leaves what loses nothing as it is, and names a copy within what Postgres keeps of a name', () =>
    {
        const index = { query: 'CREATE INDEX "x" ON "channels" ("slug")' };

        expect(keptFirst([ADD, index], 1, keys)).toEqual({ statements: [ADD, index], kept: [] });
        expect(keptFirst([{ query: `ALTER TABLE "${ 'a'.repeat(60) }" DROP COLUMN "b"` }], 12, keys).kept[0]).toHaveLength(63);
    });
});

describe('what TypeORM\'s diff says', () =>
{
    it('leaves out the hand-built indexes it always drops and the default it always re-issues', () =>
    {
        const noise = [
            ...HAND_BUILT_INDEX_NAMES.map((name) => ({ query: `DROP INDEX "public"."${ name }"` })),
            { query: 'ALTER TABLE "conversation_members" ALTER COLUMN "last_read_at" SET DEFAULT to_timestamp((0)::double precision)' }
        ];

        expect(meaningful([...noise, ADD])).toEqual([ADD]);
        expect(meaningful([{ query: 'DROP INDEX "public"."channels_public"' }]), 'an index the entities do name is no noise').toHaveLength(1);
    });

    it('finds what loses data: a table or a column dropped, a type changed', () =>
    {
        const loses = [
            { query: 'DROP TABLE "channel_votes"' },
            DROP,
            { query: 'ALTER TABLE "channels" ALTER COLUMN "bio" TYPE varchar(10)' }
        ];

        expect(destructive([ADD, ...loses])).toEqual(loses);
        expect(destructive([ADD, { query: 'CREATE INDEX "x" ON "channels" ("slug")' }])).toEqual([]);
    });
});

describe('a migration\'s file', () =>
{
    it('holds its statements as strings, whatever they say, under a class named for it and its moment', () =>
    {
        const source = migrationSourceOf('AddChannelTopic', 1730000000000, [ADD, { query: 'UPDATE "x" SET "y" = $1', parameters: ['it\'s `odd` ${ here }'] }], [{ query: 'ALTER TABLE "channels" DROP COLUMN "topic"' }]);

        expect(source).toContain('export class AddChannelTopic1730000000000 implements MigrationInterface');
        expect(source).toContain(`name = 'AddChannelTopic1730000000000';`);
        expect(source).toContain('await runner.query("ALTER TABLE \\"channels\\" ADD \\"topic\\" text");');
        expect(source).toContain('await runner.query("UPDATE \\"x\\" SET \\"y\\" = $1", ["it\'s `odd` ${ here }"]);');
        expect(source.indexOf('DROP COLUMN'), 'the way back is in down').toBeGreaterThan(source.indexOf('async down'));
        expect(source.indexOf('ADD \\"topic'), 'the way forward is in up').toBeGreaterThan(source.indexOf('async up'));
        expect(source.indexOf('ADD \\"topic')).toBeLessThan(source.indexOf('async down'));
    });

    it('is added to the list after the others, its import beside theirs', () =>
    {
        const live = readFileSync(new URL('../src/db/migrations/index.ts', import.meta.url), 'utf8');
        const empty = live.replace(/^import \{ \w+ \} from '\.\/\d{13}-\w+\.ts';\n/gm, '').replace(/= \[[^\]]*\];/, '= [];');
        const once = registered(empty, 'AddChannelTopic', 1730000000000);
        const twice = registered(once, 'DropOldColumn', 1730000000001);

        expect(twice).toContain(`import { AddChannelTopic1730000000000 } from './1730000000000-AddChannelTopic.ts';\nimport { DropOldColumn1730000000001 } from './1730000000001-DropOldColumn.ts';`);
        expect(twice).toMatch(/export const MIGRATIONS: \(new \(\) => MigrationInterface\)\[\] = \[\n {4}AddChannelTopic1730000000000,\n {4}DropOldColumn1730000000001\n\];/);
        expect(registered(live, 'AddChannelTopic', 1730000000000)).toContain(`\n    ${ MIGRATIONS.at(-1)?.name },\n    AddChannelTopic1730000000000\n];`);
    });

    it('is named in PascalCase', () =>
    {
        expect(['AddChannelTopic', 'Nft2'].every((name) => MIGRATION_NAME.test(name))).toBe(true);
        expect(['add-topic', 'x', 'Drop Table', ''].some((name) => MIGRATION_NAME.test(name))).toBe(false);
    });
});

describe('the migrations', () =>
{
    it('are every file in the folder, each once, listed oldest first', () =>
    {
        const files = readdirSync(new URL('../src/db/migrations/', import.meta.url)).filter((file) => file !== 'index.ts').sort();
        const named = files.map((file) => /^(\d{13})-([A-Za-z0-9]+)\.ts$/.exec(file));

        expect(named.every((one) => one !== null), `a file in the folder is not <milliseconds>-<Name>.ts: ${ files.join(', ') }`).toBe(true);
        expect(MIGRATIONS.map((kind) => kind.name)).toEqual(named.map((one) => `${ one![2] }${ one![1] }`));
    });
});

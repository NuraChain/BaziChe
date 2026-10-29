import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { behindTheEntities, holdsNothing, syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';

/**
 * A production start builds the schema onto a database that holds none of it, and changes nothing in
 * one that holds any of it: `npm run schema:sync` does that, after a dump. OPT-IN, like the other
 * `.db.spec` suites, on a throwaway database of its own.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

const PROBE = 'nura_first_start_probe';

let base: DataSource;
let probe: DataSource;

const probeUrl = () => new URL(url ?? '').toString().replace(/\/[^/]*$/, `/${ PROBE }`);

describe('a start', () =>
{
    it('builds the schema at every start in development, and in production only onto a database holding none of it', () =>
    {
        const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

        expect(main).toMatch(/if \(config\.databaseSync \|\| await holdsNothing\(dataSource\)\)\s*\{\s*try\s*\{\s*await syncSchema\(dataSource\);/);
    });
});

describe.skipIf(!active)('a database nothing was built in', () =>
{
    beforeAll(async () =>
    {
        base = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await base.initialize();
        await base.query(`drop database if exists ${ PROBE }`);
        await base.query(`create database ${ PROBE }`);

        probe = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url: probeUrl(), entities, synchronize: false, logging: ['error'] });
        await probe.initialize();
    }, 60_000);

    afterAll(async () =>
    {
        if (probe?.isInitialized)
        {
            await probe.destroy();
        }
        if (base?.isInitialized)
        {
            await base.query(`drop database if exists ${ PROBE }`);
            await base.destroy();
        }
    }, 60_000);

    it('is new, or holds only tables of another program\'s, until the schema is built in it', async () =>
    {
        expect(await holdsNothing(probe)).toBe(true);

        await probe.query('create table not_ours (id int)');

        expect(await holdsNothing(probe), 'a table of another program\'s').toBe(true);

        await syncSchema(probe);

        expect(await holdsNothing(probe)).toBe(false);
        expect(await probe.query('select count(*)::int as tables from information_schema.tables where table_name = \'not_ours\''), 'the build touched another program\'s table').toEqual([{ tables: 1 }]);
    }, 180_000);

    it('is not one that holds any one table of the schema, however little of it', async () =>
    {
        await probe.query('drop schema public cascade');
        await probe.query('create schema public');
        await probe.query('create table games (id text primary key)');

        expect(await holdsNothing(probe)).toBe(false);
    });

    it('is told apart from one an update left behind, which the catalogue finds lacking a column or a table', async () =>
    {
        const seededAfter = async (change: string) =>
        {
            await probe.query('drop schema public cascade');
            await probe.query('create schema public');
            await syncSchema(probe);
            await probe.query(change);

            return await seedReference(probe).then(() => null, (error: unknown) => error);
        };

        expect(behindTheEntities(await seededAfter('alter table achievements drop column blurb_fa')), 'a column').toBe(true);
        expect(behindTheEntities(await seededAfter('drop table achievements cascade')), 'a table').toBe(true);
        expect(behindTheEntities(new Error('the database went away'))).toBe(false);
        expect(behindTheEntities(null)).toBe(false);
    }, 300_000);
});

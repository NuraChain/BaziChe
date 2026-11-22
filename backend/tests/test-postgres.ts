import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';

/** A maintenance database where the caller may create and drop a private temporary database. */
export const testPostgres = process.env.ARCADE_TEST_POSTGRES ?? process.env.POKER_TEST_POSTGRES;

export async function withPostgres(test: (db: DataSource) => Promise<void>)
{
    const admin = new DataSource({ type: 'postgres', url: testPostgres });
    await admin.initialize();
    const name = 'arcade_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(testPostgres!);
    url.pathname = '/' + name;
    const db = new DataSource({ type: 'postgres', url: url.toString(), entities, uuidExtension: 'pgcrypto' });
    try
    {
        await admin.query('create database ' + name);
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        await test(db);
    }
    finally
    {
        if (db.isInitialized) await db.destroy();
        await admin.query('drop database if exists ' + name);
        await admin.destroy();
    }
}

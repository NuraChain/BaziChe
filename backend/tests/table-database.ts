import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { entities } from '../src/entities/index.ts';
import { User } from '../src/entities/user.entity.ts';

/** Opt-in Postgres integration tests create and remove their own database on this server. */
export const postgres = process.env.ARCADE_TEST_POSTGRES;

export async function tableDatabase()
{
    const server = await new DataSource({ type: 'postgres', url: postgres! }).initialize();
    const name = `arcade_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(postgres!);
    url.pathname = '/' + name;
    const db = new DataSource({ type: 'postgres', url: url.href, uuidExtension: 'pgcrypto', entities });
    await server.query(`create database "${name}"`);
    const close = async () =>
    {
        if (db.isInitialized)
        {
            await db.destroy();
        }
        try
        {
            await server.query(`drop database "${name}"`);
        }
        finally
        {
            await server.destroy();
        }
    };
    try
    {
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        const person = async (handle: string) =>
        {
            const result = await db.getRepository(User).insert({ handle, displayName: handle, hue: 0 });
            return result.identifiers[0].id as string;
        };
        return { db, table: createTableService(db, createSocialService(db)), person, close };
    }
    catch (error)
    {
        await close();
        throw error;
    }
}

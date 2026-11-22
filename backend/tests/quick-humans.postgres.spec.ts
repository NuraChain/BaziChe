import { expect, it } from 'vitest';
import { createSeatFiller } from '../src/domains/system/fill.ts';
import { postgres, tableDatabase } from './table-database.ts';

it.skipIf(!postgres)('matches human-only requests and keeps system fill out across sweeps and retries', async () =>
{
    const { db, table, person, close } = await tableDatabase();
    try
    {
        const [ann, bob, cal, dee] = await Promise.all(['ann', 'bob', 'cal', 'dee'].map(person));
        const here = (ids: readonly string[]) => new Set(ids);
        const ask = { game: 'ludo', voice: 'off' as const, seats: 4 };
        const usual = await table.quick(ann, ask, here);
        const only = { ...ask, humansOnly: true };
        const [first, second] = await Promise.all([table.quick(bob, only, here), table.quick(cal, only, here)]);
        expect(first.id).toBe(second.id);
        expect(first.id).not.toBe(usual.id);
        expect((await table.quick(bob, only, here)).id).toBe(first.id);

        await db.query("insert into settings (key, value) values ('system-players', $1)", [JSON.stringify({ on: true, wait: 5 })]);
        await db.query("update table_seats set joined_at = now() - interval '1 minute' where user_id is not null");
        const filler = createSeatFiller(db, new Set(['ludo']));
        const hooks = { start: async () => {}, changed: async () => {} };
        const swept = await filler.sweep(5000, here, hooks);
        expect(swept.failed).toEqual([]);
        expect(swept.seated).toBe(1);
        expect((await table.quick(dee, only, here)).id).toBe(first.id);
        const occupants = await db.query(`select s.table_id from table_seats s
            join system_players sp on sp.user_id = s.user_id`) as { table_id: string }[];
        expect(occupants).toEqual([{ table_id: usual.id }]);
        expect((await table.quick(ann, only, here)).id).toBe(first.id);
    }
    finally
    {
        await close();
    }
}, 30_000);

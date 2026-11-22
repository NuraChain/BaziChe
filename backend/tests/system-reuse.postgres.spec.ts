import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSeatFiller } from '../src/domains/system/fill.ts';
import { Match, MatchPlayer, Setting, SystemPlayer, Table, TableSeat } from '../src/entities/index.ts';
import { postgres, tableDatabase } from './table-database.ts';

it.skipIf(!postgres).each([2, 40])('reuses a pool capped at %i across closed games, restarts and competing workers', async (most) =>
{
    const { db, table, person, close } = await tableDatabase();
    try
    {
        const matches = createMatchService(db, createAchieveService(db));
        const makeFiller = () => createSeatFiller(db, new Set(['chess']));
        const setting = (on: boolean) => db.getRepository(Setting).save({ key: 'system-players', value: JSON.stringify({ on, wait: 5, most }) });
        const here = (ids: readonly string[]) => new Set(ids);
        const live = new Map<string, { match: string; bot: string }>();
        const hooks = {
            async start(bot: string, tableId: string)
            {
                const started = await matches.start(bot, tableId);
                live.set(tableId, { match: started.match.id, bot });
            },
            changed: async () => {}
        };
        const filler = makeFiller();
        const sweep = () => filler.sweep(10000, here, hooks);
        const waiting = async (player: string, humansOnly = false, clock: '5+0' | '3+2' = '5+0') =>
        {
            const { id } = await table.quick(player, { game: 'chess', seats: 2, voice: 'off', humansOnly, clock }, here);
            await db.getRepository(TableSeat).update({ tableId: id, userId: player }, { joinedAt: () => "now() - interval '1 minute'" });
            return id;
        };
        const inPlay = [];
        await setting(true);
        for (let i = 0; i < most; i += 1)
        {
            const player = await person('host' + i);
            const id = await waiting(player);
            expect(await sweep()).toMatchObject({ started: 1, seated: 1, failed: [] });
            inPlay.push({ player, id, ...live.get(id)! });
        }
        expect(new Set(inPlay.map(row => row.bot)).size).toBe(most);
        const nextPlayer = await person('next-player');
        const next = await waiting(nextPlayer);
        expect(await sweep()).toMatchObject({ started: 0, seated: 0, failed: [] });

        const first = inPlay[0];
        await matches.act(first.player, first.match, { play: null, key: randomUUID() });
        expect(await db.getRepository(Table).existsBy({ id: first.id, status: 'closed' })).toBe(true);
        expect(await db.getRepository(TableSeat).existsBy({ tableId: first.id, userId: first.bot })).toBe(true);
        expect(await db.getRepository(MatchPlayer).existsBy({ matchId: first.match, userId: first.bot })).toBe(true);

        await setting(false);
        expect(await sweep()).toMatchObject({ started: 0, seated: 0, failed: [] });
        await setting(true);
        const rival = await person('other-host');
        const competing = await waiting(rival, false, '3+2');
        const workers = [makeFiller(), makeFiller()];
        const passes = await Promise.all(workers.map(worker => worker.sweep(10000, here, hooks)));
        expect(passes.flatMap(pass => pass.failed)).toEqual([]);
        expect(passes.reduce((total, pass) => total + pass.started, 0)).toBe(1);
        expect(live.get(next)?.bot).toBe(first.bot);
        expect(live.has(competing)).toBe(false);
        await table.close(rival, competing);

        for (let i = 0; i < 3; i += 1)
        {
            const current = [...live.values()].at(-1)!;
            await matches.act(nextPlayer, current.match, { play: null, key: randomUUID() });
            const rematch = await waiting(nextPlayer);
            expect(await sweep()).toMatchObject({ started: 1, seated: 1, failed: [] });
            expect(live.get(rematch)?.bot).toBe(first.bot);
        }
        expect(await db.getRepository(SystemPlayer).count()).toBe(most);

        const current = [...live.values()].at(-1)!;
        await matches.act(nextPlayer, current.match, { play: null, key: randomUUID() });
        const only = await waiting(nextPlayer, true);
        expect(await sweep()).toMatchObject({ started: 0, seated: 0, failed: [] });
        expect(await db.getRepository(Match).countBy({ tableId: only })).toBe(0);
        await table.close(nextPlayer, only);

        await db.getRepository(SystemPlayer).update({ userId: first.bot }, { retiredAt: new Date() });
        const replacement = await waiting(nextPlayer);
        expect(await sweep()).toMatchObject({ started: 1, seated: 1, failed: [] });
        expect(live.get(replacement)?.bot).not.toBe(first.bot);
        expect(await db.getRepository(SystemPlayer).count()).toBe(most + 1);
    }
    finally
    {
        await close();
    }
}, 120_000);

it.skipIf(!postgres)('recovers a system chair after a failed start and an abandoned game', async () =>
{
    const { db, table, person, close } = await tableDatabase();
    try
    {
        const matches = createMatchService(db, createAchieveService(db));
        const [first, next] = await Promise.all(['first-host', 'next-host'].map(person));
        const ask = { game: 'chess', seats: 2, voice: 'off' as const };
        await db.getRepository(Setting).save({ key: 'system-players', value: JSON.stringify({ on: true, most: 1, wait: 5 }) });
        let online = first;
        const here = (ids: readonly string[]) => new Set(ids.filter(id => id === online));
        const age = (tableId: string) => db.getRepository(TableSeat).createQueryBuilder().update()
            .set({ joinedAt: () => "now() - interval '2 minutes'" })
            .where('table_id = :tableId and user_id is not null', { tableId }).execute();
        const old = await table.quick(first, { ...ask, clock: '3+2' }, here);
        await age(old.id);
        const crashed = createSeatFiller(db, new Set(['chess']));
        const failed = await crashed.sweep(10000, here, { changed: async () => {}, start: async () => { throw new Error('Start interrupted'); } });
        expect(failed).toMatchObject({ seated: 1, started: 0, failed: [{ tableId: old.id, reason: 'Start interrupted' }] });
        await age(old.id);

        online = next;
        const fresh = await table.quick(next, { ...ask, clock: '5+0' }, here);
        await age(fresh.id);
        const restored = createSeatFiller(db, new Set(['chess']));
        let matchId = '';
        const hooks = {
            start: async (bot: string, id: string) => { matchId = (await matches.start(bot, id)).match.id; },
            changed: async () => {}
        };
        expect(await restored.sweep(10000, here, hooks)).toMatchObject({ stood: 1, seated: 1, started: 1, failed: [] });
        expect(await db.getRepository(SystemPlayer).count()).toBe(1);

        // A staff void finishes the match and clears readiness, leaving its table open.
        await db.transaction(tx => matches.voidIn(tx, matchId));
        await age(fresh.id);
        await db.getRepository(Match).update(matchId, { finishedAt: () => "now() - interval '1 minute'", startedAt: () => "now() - interval '2 minutes'" });
        expect(await createSeatFiller(db, new Set(['chess'])).sweep(10000, here, hooks)).toMatchObject({ stood: 1, seated: 0, failed: [] });
        expect(await db.getRepository(MatchPlayer).countBy({ matchId })).toBe(2);
        online = first;
        expect(await restored.sweep(10000, here, hooks)).toMatchObject({ started: 0, failed: [] });
        await table.close(first, old.id);
        const back = await table.quick(first, ask, here);
        await age(back.id);
        expect(await restored.sweep(10000, here, hooks)).toMatchObject({ seated: 1, started: 1, failed: [] });
        expect(await db.getRepository(SystemPlayer).count()).toBe(1);
    }
    finally
    {
        await close();
    }
}, 30_000);

it.skipIf(!postgres)('reaches a present player beyond a whole page of absent waiting tables', async () =>
{
    const { db, table, person, close } = await tableDatabase();
    try
    {
        await db.getRepository(Setting).save({ key: 'system-players', value: JSON.stringify({ on: true, wait: 5, most: 1 }) });
        const ask = { game: 'chess', seats: 2, voice: 'off' as const };
        const absent = () => new Set<string>();
        for (let i = 0; i < 50; i++)
        {
            await table.quick(await person('absent' + i), ask, absent);
        }
        const online = await person('waiting');
        const { id } = await table.quick(online, ask, absent);
        await db.query("update table_seats set joined_at = joined_at - interval '2 minutes' where user_id is not null");
        const here = (ids: readonly string[]) => new Set(ids.filter(user => user === online));
        const starts: string[] = [];
        const matches = createMatchService(db, createAchieveService(db));
        const hooks = {
            start: async (bot: string, started: string) => { await matches.start(bot, started); starts.push(started); },
            changed: async () => {}
        };
        const filler = createSeatFiller(db, new Set(['chess']));
        for (let n = 0; n < 3 && starts.length === 0; n++)
        {
            expect((await filler.sweep(10000, here, hooks)).failed).toEqual([]);
        }
        expect(starts).toEqual([id]);
    }
    finally
    {
        await close();
    }
}, 30_000);

it.skipIf(!postgres)('preserves capped capacity for a game that can actually start', async () =>
{
    const { db, table, person, close } = await tableDatabase();
    try
    {
        await db.getRepository(Setting).save({ key: 'system-players', value: JSON.stringify({ on: true, wait: 5, most: 1 }) });
        const here = (ids: readonly string[]) => new Set(ids);
        const filler = createSeatFiller(db, new Set(['ludo', 'chess']));
        const started: string[] = [];
        const matches = createMatchService(db, createAchieveService(db));
        const hooks = {
            start: async (bot: string, id: string) => { await matches.start(bot, id); started.push(id); },
            changed: async () => {}
        };
        await table.quick(await person('large'), { game: 'ludo', seats: 4, voice: 'off' }, here);
        await db.query("update table_seats set joined_at = now() - interval '2 minutes' where user_id is not null");
        await filler.sweep(10000, here, hooks);
        const { id } = await table.quick(await person('small'), { game: 'chess', seats: 2, voice: 'off' }, here);
        await db.query("update table_seats set joined_at = now() - interval '2 minutes' where user_id is not null");
        expect((await filler.sweep(10000, here, hooks)).failed).toEqual([]);
        expect(started).toEqual([id]);
        expect(await db.getRepository(SystemPlayer).count()).toBe(1);
    }
    finally
    {
        await close();
    }
}, 30_000);

it.skipIf(!postgres)('honors a switch turned off during a sweep before seating at the next table', async () =>
{
    const { db, table, person, close } = await tableDatabase();
    try
    {
        const setting = (on: boolean) => db.getRepository(Setting).save({ key: 'system-players', value: JSON.stringify({ on, wait: 5, most: 2 }) });
        await setting(true);
        const here = (ids: readonly string[]) => new Set(ids);
        const ask = { game: 'chess', seats: 2, voice: 'off' as const };
        await table.quick(await person('first'), { ...ask, clock: '3+2' }, here);
        await table.quick(await person('second'), { ...ask, clock: '5+0' }, here);
        await db.query("update table_seats set joined_at = joined_at - interval '2 minutes' where user_id is not null");
        const filler = createSeatFiller(db, new Set(['chess']));
        const matches = createMatchService(db, createAchieveService(db));
        const hooks = {
            start: async (bot: string, id: string) => { await matches.start(bot, id); await setting(false); },
            changed: async () => {}
        };
        expect(await filler.sweep(10000, here, hooks)).toMatchObject({ seated: 1, started: 1, failed: [] });
        expect(await filler.sweep(10000, here, hooks)).toMatchObject({ seated: 0, started: 0, failed: [] });
        await setting(true);
        expect(await filler.sweep(10000, here, hooks)).toMatchObject({ seated: 1, started: 1, failed: [] });
    }
    finally
    {
        await close();
    }
}, 30_000);

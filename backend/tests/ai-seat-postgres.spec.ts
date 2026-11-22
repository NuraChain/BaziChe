import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { SystemPlayer, Table, User } from '../src/entities/index.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { buildPorts } from '../src/services.ts';
import type { ServerConfig } from '../src/env.ts';
import { testPostgres, withPostgres } from './test-postgres.ts';

it.skipIf(!testPostgres)('discloses the same AI seat to the player, waiting spectator, live spectator and result reader', () => withPostgres(async (db) =>
{
    const [human, ai, viewer] = await db.getRepository(User).save(['robotFan', 'sara', 'watcher'].map((handle) => ({ handle, displayName: handle, hue: 10 })));
    await db.getRepository(SystemPlayer).insert({ userId: ai.id, skill: 'advanced', style: 123 });

    const table = createTableService(db, createSocialService(db));
    const ports = buildPorts(db, {
        env: 'test', origin: 'http://localhost:3100', secret: 'test-secret', chainId: '', rpcUrl: '', adminWallet: ''
    } as ServerConfig);
    const made = await table.create(human.id, {
        game: 'poker', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false,
        blinds: 'low', chat: false, voice: 'off', teams: false, invitees: []
    });
    expect((await ports.social.shown('sara'))?.person.ai).toBe(true);
    expect((await ports.social.shown('robotFan'))?.person.ai).toBeUndefined();
    expect((await ports.social.view(viewer.id, 'sara'))?.person.ai).toBe(true);
    expect((await ports.social.names(['sara', 'robotFan'])).find((p) => p.handle === 'sara')?.ai).toBe(true);
    const empty = (await ports.table.view(viewer.id, made.id))!;
    expect(empty.chairs.every((chair) => chair.ai === undefined)).toBe(true);
    await table.claimSeat(ai.id, made.id);
    const waiting = (await ports.table.view(viewer.id, made.id))!;
    expect(waiting.chairs.map((chair) => [chair.who, chair.ai])).toEqual([['robotFan', undefined], ['sara', true]]);
    expect(waiting.conversationId).toBeUndefined();

    for (const user of [human, ai]) await table.setReady(user.id, made.id, true);
    const live = await ports.match.start(human.id, made.id);
    const watch = (await ports.match.watch(viewer.id, live.id, null))!;
    const waitingNames = waiting.chairs.map((chair) => [chair.who, chair.ai]);
    for (const match of [live, watch.match])
    {
        expect(match.players.map((p) => [p.who, p.ai])).toEqual(waitingNames);
        expect(match.players[1]).not.toHaveProperty('skill');
        expect(match.players[1]).not.toHaveProperty('user_id');
    }
    expect(watch.match.mine).toBeUndefined();
    expect(watch.match.view).toMatchObject({ kind: 'poker', hole: [] });
    expect((await ports.match.watchable(viewer.id, 'poker')).tables[0].aiPlayers).toEqual(['sara']);
    await ports.match.resign(human.id, live.id, { key: randomUUID() });
    const result = await ports.match.view(human.id, live.id);
    expect(result?.players.find((p) => p.seat === 1)?.ai).toBe(true);
    expect((await ports.match.history(human.id, null)).matches[0].aiPlayers).toEqual(['sara']);

    await db.getRepository(Table).update(made.id, { privacy: 'invite' });
    expect(await ports.match.watch(viewer.id, live.id, null)).toBeNull();
}), 90000);

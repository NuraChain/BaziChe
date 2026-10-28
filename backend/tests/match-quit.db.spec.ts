import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Block, Conversation, Match, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import type { MatchEvent, MatchView } from '../src/schemas.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;

let seq = 0;

const pushed: { userId: string; match: MatchView }[] = [];

const rung: { match: MatchView; viewers: string[]; events: MatchEvent[] }[] = [];

/** Whoever the hub would say is looking at the table: in a browser, everybody who read it lately. */
const lookers = new Set<string>();

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: (pushes) =>
    {
        pushed.push(...pushes);
    },
    gameWatched: (viewers, match, events) =>
    {
        rung.push({ match, viewers: [...viewers], events });
    },
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `g${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Gone ${ seq }`,
        hue: seq % 360
    });

    return made.id;
};

const started = async (seats = 3) =>
{
    const players: string[] = [];

    for (let seat = 0; seat < seats; seat += 1)
    {
        players.push(await makeUser());
    }

    const table = await ports.table.create(players[0], {
        game: 'ludo',
        seats,
        mode: 'live',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: []
    });

    for (const player of players.slice(1))
    {
        await ports.table.claim(player, table.id);
    }

    for (const player of players)
    {
        await ports.table.setReady(player, table.id, true);
    }

    return { players, tableId: table.id, match: await ports.match.start(players[0], table.id) };
};

const live = async (matchId: string) => await db.getRepository(Match).findOneByOrFail({ id: matchId });

const step = async (matchId: string, players: readonly string[]) =>
{
    const { rev } = await live(matchId);
    const anybody = await ports.match.view(players[0], matchId);
    const mover = players[anybody!.turn!];
    const mine = await ports.match.view(mover, matchId);
    const board = mine!.view;

    if (board.kind !== 'ludo')
    {
        throw new Error('not a ludo board');
    }

    await ports.match.play(mover, matchId, {
        key: randomUUID(),
        rev,
        play: board.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: board.moves[0] }
    });

    return (await live(matchId)).rev;
};

const after = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index + 1);

describe.skipIf(!active)('a seat that has quit a game still being played, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        ports = buildPorts(db, {
            secret: 'a-test-secret-that-is-long-enough-to-use',
            origin: 'http://localhost:1',
            env: 'test',
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: ''
        } as Parameters<typeof buildPorts>[1], listener, { present: (userIds) => new Set(userIds), looking: () => [...lookers] });
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        pushed.length = 0;
        rung.length = 0;
        lookers.clear();
    });

    it('is answered with the board as its own leaving left it', async () =>
    {
        const { players, match } = await started();
        const gone = await ports.match.resign(players[2], match.id, { key: 'gives-up' });
        const left = (await live(match.id)).rev;

        expect((await live(match.id)).finishedAt).toBeNull();
        expect(gone.match.rev).toBe(left);
        expect(gone.match.mine).toBe(2);
        expect(gone.match.players.find((player) => player.seat === 2)?.result).toBe('abandoned');
    });

    it('goes on following the game live from its own seat, on every route it can ask', async () =>
    {
        const { players, tableId, match } = await started();

        await ports.match.resign(players[2], match.id, { key: 'gives-up' });

        const left = (await live(match.id)).rev;
        const now = await step(match.id, players);

        expect(now).toBeGreaterThan(left);
        expect((await ports.match.view(players[0], match.id))?.rev, 'somebody still playing sees it live').toBe(now);
        expect((await ports.match.view(players[2], match.id))?.rev, 'a seat that gave up was held back from the game it sits out').toBe(now);
        expect((await ports.match.view(players[2], match.id))?.mine).toBe(2);

        const since = await ports.match.since(players[2], match.id, left);

        expect(since?.match.rev).toBe(now);
        expect(since?.events.map((event) => event.rev)).toEqual(after(left, now));

        const again = await ports.match.resign(players[2], match.id, { key: 'gives-up' });

        expect(again.applied).toBe('already');
        expect(again.match.rev).toBe(now);
        expect((await ports.match.start(players[2], tableId)).rev, 'pressing Start at a table with a game on answers that game').toBe(now);
    });

    it('is shown each move as it is made, the board somebody watching is shown', async () =>
    {
        const { players, match } = await started();
        const watcher = await makeUser();

        await ports.match.resign(players[2], match.id, { key: 'gives-up' });

        const left = (await live(match.id)).rev;
        const now = await step(match.id, players);
        const mine = await ports.match.view(players[2], match.id);
        const theirs = await ports.match.watch(watcher, match.id, left);
        const since = await ports.match.since(players[2], match.id, left);

        expect(mine?.rev).toBe(now);
        expect(theirs?.match.rev).toBe(now);
        expect(mine?.view).toEqual(theirs?.match.view);
        expect(mine?.remainingMs, 'the clock of the turn being played').toBeGreaterThan(0);
        expect(theirs?.match.remainingMs, 'somebody watching is shown the same clock').toBeGreaterThan(0);
        expect(theirs?.events.map((event) => event.rev)).toEqual(after(left, now));
        expect(theirs?.events, 'somebody watching and a seat that gave up are told the same things').toEqual(since?.events);
    });

    it('is pushed what the watchers are pushed, and never a player\'s move', async () =>
    {
        const { players, match } = await started();

        players.forEach((player) => lookers.add(player));
        pushed.length = 0;
        rung.length = 0;
        await ports.match.resign(players[2], match.id, { key: 'gives-up' });

        expect(pushed.map((push) => push.userId).sort(), 'its own leaving is told to the two still playing').toEqual([players[0], players[1]].sort());

        pushed.length = 0;
        rung.length = 0;
        await step(match.id, players);

        expect(pushed.map((push) => push.userId).sort()).toEqual([players[0], players[1]].sort());
        expect(rung).toHaveLength(1);
        expect(rung[0].viewers, 'a seat still playing was pushed the watchers\' board beside its own').toEqual([players[2]]);
        expect(rung[0].match.rev, 'the watchers were pushed a board behind the move').toBe((await live(match.id)).rev);
        expect(rung[0].match.mine, 'the watchers were pushed somebody\'s seat').toBeUndefined();
    });

    it('is told the end with everybody, and reads the finished game whole', async () =>
    {
        const { players, match } = await started();

        await ports.match.resign(players[2], match.id, { key: 'gives-up' });
        await step(match.id, players);
        pushed.length = 0;
        await ports.match.resign(players[1], match.id, { key: 'gives-up-too' });

        const ended = await live(match.id);

        expect(ended.finishedAt).not.toBeNull();
        expect(pushed.map((push) => push.userId).sort()).toEqual([...players].sort());
        expect((await ports.match.view(players[2], match.id))?.rev).toBe(ended.rev);
        expect((await ports.match.view(players[2], match.id))?.finishedAt).toBeDefined();
    });

    it('pushes the watchers what the watch read answers, at a game whose seats hold what nobody else may see', async () =>
    {
        const players = [await makeUser(), await makeUser()];
        const stranger = await makeUser();
        const table = await ports.table.create(players[0], {
            game: 'hokm', seats: 2, mode: 'live', privacy: 'public', target: 7, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: []
        });

        await ports.table.claim(players[1], table.id);

        for (const player of players)
        {
            await ports.table.setReady(player, table.id, true);
        }

        rung.length = 0;
        [...players, stranger].forEach((one) => lookers.add(one));

        const match = await ports.match.start(players[0], table.id);
        const pushed = rung.at(-1);
        const read = await ports.match.watch(stranger, match.id, match.rev - 1);
        const seated = await ports.match.view(players[0], match.id);

        expect(pushed?.viewers, 'the watchers were pushed nothing as the game began').toEqual([stranger]);
        expect(pushed!.match.view).toEqual(read!.match.view);
        expect(pushed!.events).toEqual(read!.events);
        expect(pushed!.match.view, 'a seat\'s own board is not what anybody watching is shown').not.toEqual(seated!.view);
    });

    it('pushes somebody looking at the table only while they may still watch it', async () =>
    {
        const { players, tableId, match } = await started();
        const stranger = await makeUser();
        const reached = async () =>
        {
            rung.length = 0;
            await step(match.id, players);

            return rung.flatMap((one) => one.viewers);
        };

        [...players, stranger].forEach((one) => lookers.add(one));

        expect(await reached()).toEqual([stranger]);

        await db.getRepository(Block).insert({ userId: players[0], blockedId: stranger });

        expect(await reached(), 'the host blocked somebody and the game went on reaching them').toEqual([]);

        await db.getRepository(Block).delete({ userId: players[0], blockedId: stranger });
        await db.getRepository(Table).update({ id: tableId }, { privacy: 'friends' });

        expect(await reached(), 'a table closed to somebody went on showing them its game').toEqual([]);

        await ports.match.resign(players[2], match.id, { key: 'gives-up' });

        expect(await reached(), 'a seat that gave up stopped being shown the game at its own table').toEqual([players[2]]);
    });

    it('holds for somebody who walked away from the table as it does for somebody who gave up in their chair', async () =>
    {
        const { players, tableId, match } = await started();

        await ports.table.leave(players[2], tableId, true);

        const left = (await live(match.id)).rev;
        const now = await step(match.id, players);

        expect((await live(match.id)).finishedAt).toBeNull();
        expect(now).toBeGreaterThan(left);
        expect((await ports.match.view(players[2], match.id))?.rev).toBe(now);
        expect((await ports.match.since(players[2], match.id, left))?.events.map((event) => event.rev)).toEqual(after(left, now));
    });

    it('changes nothing for a game of two, which a leaving ends', async () =>
    {
        const { players, match } = await started(2);

        pushed.length = 0;

        const gone = await ports.match.resign(players[1], match.id, { key: 'gives-up' });

        expect(gone.match.finishedAt).toBeDefined();
        expect(pushed.map((push) => push.userId).sort()).toEqual([...players].sort());
    });

    describe('how it went is said, to everybody who is shown that it went', () =>
    {
        const exitOf = (view: MatchView | null | undefined, seat: number) => view?.players.find((player) => player.seat === seat)?.exit;

        const missed = async (matchId: string, players: readonly string[], seat: number) =>
        {
            for (let turn = 0; turn < 60; turn += 1)
            {
                const now = await ports.match.view(players[0], matchId);

                if (now?.players.find((player) => player.seat === seat)?.result !== undefined || now?.finishedAt !== undefined)
                {
                    return;
                }

                if (now?.turn === seat)
                {
                    await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [matchId]);
                    await ports.jobs.sweepTurns(2000);
                }
                else
                {
                    await step(matchId, players);
                }
            }
        };

        it('says a seat gave up, to the others still playing and in the answer it gets itself', async () =>
        {
            const { players, match } = await started();
            const gone = await ports.match.resign(players[2], match.id, { key: 'gives-up' });

            expect(exitOf(gone.match, 2)).toBe('resign');
            expect(exitOf(await ports.match.view(players[0], match.id), 2)).toBe('resign');
            expect(exitOf(await ports.match.view(players[0], match.id), 0), 'somebody still playing has not gone any way').toBeUndefined();
            expect(exitOf(pushed.at(-1)?.match, 2)).toBe('resign');
        });

        it('says a seat walked away from the table', async () =>
        {
            const { players, tableId, match } = await started();

            await ports.table.leave(players[2], tableId, true);

            expect(exitOf(await ports.match.view(players[0], match.id), 2)).toBe('left');
        });

        it('says a seat ran out of time, once it has missed as many turns as end a game for it', async () =>
        {
            const { players, match } = await started();

            await missed(match.id, players, 2);

            const now = await ports.match.view(players[0], match.id);

            expect(now?.players.find((player) => player.seat === 2)?.result).toBe('abandoned');
            expect(exitOf(now, 2)).toBe('timeout');
        });

        it('says it to somebody watching the moment the board they are shown has it', async () =>
        {
            const { players, match } = await started();
            const watcher = await makeUser();
            const before = (await live(match.id)).rev;

            await ports.match.resign(players[2], match.id, { key: 'gives-up' });

            const forfeits = (seen: Awaited<ReturnType<typeof ports.match.watch>>) =>
                (seen?.events ?? []).flatMap((event) => (event.log.kind === 'ludo' ? event.log.moves : [])).filter((move) => move.e === 'forfeit');

            const shown = await ports.match.watch(watcher, match.id, before);

            expect(shown?.match.players.find((player) => player.seat === 2)?.result).toBe('abandoned');
            expect(exitOf(shown?.match, 2)).toBe('resign');
            expect(forfeits(shown).map((move) => move.seat)).toEqual([2]);
        });

        it('goes on saying it once the game is over, each seat the way it went itself', async () =>
        {
            const { players, tableId, match } = await started();

            await ports.match.resign(players[2], match.id, { key: 'gives-up' });
            await ports.table.leave(players[1], tableId, true);

            const ended = await ports.match.view(players[0], match.id);

            expect(ended?.finishedAt).toBeDefined();
            expect(exitOf(ended, 2)).toBe('resign');
            expect(exitOf(ended, 1)).toBe('left');
            expect(exitOf(ended, 0), 'whoever is left has a result and went no way').toBeUndefined();
            expect(ended?.players.find((player) => player.seat === 0)?.result).toBeDefined();
        });
    });
});

import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { expect, it } from 'vitest';

import { entities, Match, MatchPlayer, Table, Tournament, User } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { toCall } from '../src/domains/match/poker/betting.ts';
import type { PokerState } from '../src/domains/match/poker/state.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { createTournamentService } from '../src/domains/tournament/service.ts';

/** Set this to a PostgreSQL maintenance database on which the test may create a temporary database. */
const maintenance = process.env.POKER_TEST_POSTGRES;

it.skipIf(!maintenance)('deals real poker matches, survives a restart and advances the actual winning seats', async () =>
{
    const admin = new DataSource({ type: 'postgres', url: maintenance });
    await admin.initialize();
    const name = 'arcade_poker_' + randomUUID().replaceAll('-', '');
    const url = new URL(maintenance!);
    url.pathname = '/' + name;
    const db = new DataSource({ type: 'postgres', url: url.toString(), entities, uuidExtension: 'pgcrypto' });

    try
    {
        await admin.query('create database ' + name);
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        const users = await db.getRepository(User).save(Array.from({ length: 12 }, (_, n) => ({
            handle: 'player' + n, displayName: 'Player ' + n, hue: n
        })));
        const table = createTableService(db, createSocialService(db));
        const match = createMatchService(db, createAchieveService(db));
        const reconnect = () => createTournamentService(db, {
            seat: table.seatForTournament, deal: match.dealTournament,
            forfeit: (tx, userId, tableId) => match.walkOut(tx, userId, tableId, true)
        });
        let tournaments = reconnect();
        const tournament = (await tournaments.create(users[0].id, {
            name: 'Cup', game: 'poker', format: 'single', size: 12, listed: true, bestOf: 1,
            startsAt: new Date(Date.now() + 3600000).toISOString()
        }))!;
        expect(tournament.format).toBe('shootout');
        for (const user of users.slice(1)) await tournaments.join(user.id, tournament.code);

        const openRound = async () =>
        {
            await db.getRepository(Tournament).update(tournament.id, { nextRoundAt: new Date(0) });
            return (await tournaments.advance(tournament.id))!.rung;
        };
        const tables = await openRound();
        expect(tables.map((one) => one.players.length)).toEqual([6, 6]);

        // The first table is full. The second misses players in the middle and must re-index the survivors.
        const active = [tables[0].players, [tables[1].players[1], tables[1].players[4], tables[1].players[5]]];
        for (const [index, one] of tables.entries())
        {
            const member = one.players[5];
            expect((await tournaments.detail(member, tournament.code))!.myGame).toBe(one.tableId);
            for (const userId of active[index]) await table.setReady(userId, one.tableId, true);
        }

        const first = (await tournaments.advance(tournament.id))!.dealt;
        expect(first.map((one) => one.players.length)).toEqual([6]);
        await db.getRepository(Table).update(tables[1].tableId, { createdAt: new Date(0) });
        const second = (await tournaments.advance(tournament.id))!.dealt;
        expect(second.map((one) => one.players.length)).toEqual([3]);
        tournaments = reconnect();
        expect((await tournaments.advance(tournament.id))!.dealt).toEqual([]);

        // Everyone plays three streets, then the other seats resign. This also exercises normal match settlement.
        const winAtLastSeat = async (matchId: string, players: MatchPlayer[], remove = false) =>
        {
            const turns = players.map(() => 0);
            while (turns.some((count) => count < 3))
            {
                const current = await db.getRepository(Match).findOneByOrFail({ id: matchId });
                const state = current.state as unknown as PokerState;
                const verb = toCall(state, state.turn) > 0 ? 'call' : 'check';
                await match.act(players[state.turn].userId, matchId, { play: { kind: 'poker', verb }, rev: current.rev, key: randomUUID() });
                turns[state.turn] += 1;
            }

            if (remove)
            {
                const removed = await db.transaction(async (tx) => tournaments.staff.remove(tx, await tournaments.staff.lock(tx, tournament.code), players[0].userId));
                expect(removed).toMatchObject({ match: null, walked: { matchId } });
                expect((await db.getRepository(Match).findOneByOrFail({ id: matchId })).finishedAt).toBeNull();
            }

            for (const player of players.slice(remove ? 1 : 0, -1))
            {
                await match.act(player.userId, matchId, { play: null, key: randomUUID() });
            }

            const ended = await db.getRepository(Match).findOneByOrFail({ id: matchId });
            expect(ended).toMatchObject({ outcome: 'won', winnerSeat: players.length - 1 });
            return players.at(-1)!;
        };

        const finalists: string[] = [];
        for (const [index, one] of [...first, ...second].entries())
        {
            const players = await db.getRepository(MatchPlayer).find({ where: { matchId: one.matchId }, order: { seat: 'ASC' } });
            expect(players.map((p) => p.userId)).toEqual(active[index]);
            expect((await db.getRepository(Match).findOneByOrFail({ id: one.matchId })).seats).toBe(players.length);
            const winner = await winAtLastSeat(one.matchId, players, index === 0);
            finalists.push(winner.userId);
        }

        await tournaments.advance(tournament.id);
        tournaments = reconnect();
        const [final] = await openRound();
        expect(final.players.sort()).toEqual(finalists.sort());
        for (const userId of final.players) await table.setReady(userId, final.tableId, true);
        const finalMatch = (await tournaments.advance(tournament.id))!.dealt[0];
        const finalPlayers = await db.getRepository(MatchPlayer).find({ where: { matchId: finalMatch.matchId }, order: { seat: 'ASC' } });
        const champion = await winAtLastSeat(finalMatch.matchId, finalPlayers);
        await reconnect().advance(tournament.id);

        const detail = (await tournaments.detail(users[0].id, tournament.code))!;
        expect(detail.status).toBe('finished');
        expect(detail.games.map((game) => game.seats?.length).sort()).toEqual([2, 3, 6]);
        expect(detail.champion).toBe(users.find((u) => u.id === champion.userId)!.handle);
        expect(detail.standings.filter((row) => row.place === 1)).toHaveLength(1);

        const options = { name: 'Cup', game: 'poker', size: 4, bestOf: 1, listed: true, startsAt: new Date(Date.now() + 3600000).toISOString() };
        for (const readyCount of [0, 1])
        {
            const small = (await tournaments.create(users[0].id, { ...options, format: 'shootout' }))!;
            for (const user of users.slice(1, 4)) await tournaments.join(user.id, small.code);
            await db.getRepository(Tournament).update(small.id, { nextRoundAt: new Date(0) });
            const [waiting] = (await tournaments.advance(small.id))!.rung;
            if (readyCount === 1) await table.setReady(waiting.players[3], waiting.tableId, true);
            await db.getRepository(Table).update(waiting.tableId, { createdAt: new Date(0) });
            const settled = (await reconnect().advance(small.id))!;
            expect(settled.dealt).toEqual([]);
            expect(settled.rung).toEqual([{ tableId: waiting.tableId, players: expect.arrayContaining(waiting.players) }]);
            const done = (await tournaments.detail(users[0].id, small.code))!;
            expect(done.status).toBe('finished');
            expect(done.games[0].how).toBe(readyCount === 1 ? 'bye' : 'void');
            expect(done.champion).toBe(readyCount === 1 ? users.find((u) => u.id === waiting.players[3])!.handle : undefined);
        }

        // A pre-shootout tournament is identified by its stored format even after a deployment.
        const old = (await tournaments.create(users[0].id, { ...options, game: 'chess', format: 'single' }))!;
        await db.getRepository(Tournament).update(old.id, { game: 'poker' });
        for (const user of users.slice(1, 4)) await tournaments.join(user.id, old.code);
        await db.getRepository(Tournament).update(old.id, { nextRoundAt: new Date(0) });
        expect((await reconnect().advance(old.id))!.rung.map((one) => one.players.length)).toEqual([2, 2]);
        expect((await tournaments.detail(users[0].id, old.code))!.format).toBe('single');
    }
    finally
    {
        if (db.isInitialized) await db.destroy();
        await admin.query('drop database if exists ' + name);
        await admin.destroy();
    }
}, 90000);

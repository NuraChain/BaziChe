import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { decodeFunctionData, getAddress, toHex, type Hex } from 'viem';

import { MARKETS_ABI, marketIdOf, termsHashOf } from '../src/chain/markets.ts';
import { Market, MarketDisclosure, MarketPosition, PaidAccount, Table, User, Wallet, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import { FAKE_MARKETS, fakeMarkets } from './fake-markets.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NURA = 10n ** 18n;

const HERE = 'cf-ipcountry';

let db: DataSource;

let seq = 0;

const rung: [string, string][] = [];

const lookers = new Map<string, string[]>();

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        rung.push([userId, what]);
    },
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    chainId: '',
    rpcUrl: '',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    vaultAddress: '',
    shopAddress: '',
    tipsAddress: '',
    adminWallet: '',
    marketCountries: ['DE', 'NL'],
    marketCountryHeader: HERE
} as Parameters<typeof buildPorts>[1];

/** A request from a country, as the proxy says it: nothing at all when it says nothing. */
const from = (country: string | null) => (name: string) => (name === HERE ? country : null);

const DE = from('de');

const door = (fake = fakeMarkets()): { ports: Services; fake: ReturnType<typeof fakeMarkets> } =>
    ({
        ports: buildPorts(db, CONFIG, listener, { present: (ids) => new Set(ids), looking: (tableId) => lookers.get(tableId) ?? [] }, undefined, undefined, undefined, undefined, undefined, fake.chain),
        fake
    });

interface Person
{
    id: string;
    handle: string;
    address: string | null;
}

const person = async (options: { wallet?: boolean; minor?: boolean; terms?: boolean; resting?: boolean; disclosed?: boolean } = {}): Promise<Person> =>
{
    seq += 1;

    const n = seq;
    const minor = options.minor ?? false;
    const user = await db.getRepository(User).save({
        handle: `bettor${ n }`,
        displayName: `Bettor ${ n }`,
        hue: 40,
        kind: 'wallet',
        isMinor: minor,
        allowStrangerMessages: !minor
    });
    const address = options.wallet === false ? null : getAddress(`0x${ (0xbe770000 + n).toString(16).padStart(40, '0') }`);

    if (address !== null)
    {
        await db.getRepository(Wallet).insert({ userId: user.id, address, attestation: 'wallet', lastUsedAt: new Date() });
    }

    if (options.terms !== false)
    {
        await db.getRepository(PaidAccount).insert({ userId: user.id, acceptedAt: new Date(), breakUntil: options.resting === true ? new Date(Date.now() + 86_400_000) : null });
    }

    if (options.disclosed !== false)
    {
        await db.getRepository(MarketDisclosure).insert({ userId: user.id });
    }

    return { id: user.id, handle: user.handle, address };
};

/** A live game of Ludo between `players` at a table of the privacy and pace asked for. */
const liveGame = async (ports: Services, players: readonly Person[], options: { privacy?: 'public' | 'invite'; mode?: 'live' | 'turns' } = {}) =>
{
    const privacy = options.privacy ?? 'public';
    const table = await ports.table.create(players[0].id, {
        game: 'ludo',
        seats: players.length,
        mode: options.mode ?? 'live',
        privacy,
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: privacy === 'invite' ? players.slice(1).map((one) => one.handle) : []
    });

    for (const player of players.slice(1))
    {
        await ports.table.claim(player.id, table.id);
    }

    for (const player of players)
    {
        await ports.table.setReady(player.id, table.id, true);
    }

    const match = await ports.match.start(players[0].id, table.id);

    return { tableId: table.id, matchId: match.id };
};

const refusal = async (call: Promise<unknown>) =>
{
    try
    {
        await call;
        return null;
    }
    catch (error)
    {
        const { status, code, details } = error as { status?: number; code?: string; details?: unknown };

        return { status, code, ...(details === undefined ? {} : { details }) };
    }
};

const marketRow = (id: string) => db.getRepository(Market).findOneByOrFail({ id });

const positionRow = (id: string) => db.getRepository(MarketPosition).findOneByOrFail({ id });

/** The market's close moved to `seconds` from now, by hand, as time passing would. */
const closeIn = (marketId: string, seconds: number) =>
    db.query(`update markets set closes_at = date_trunc('second', now() + make_interval(secs => $2)) where id = $1`, [marketId, seconds]);

/** A game of two at a public table, a watcher, and the market on the game as the watcher reads it. */
const watched = async () =>
{
    const { ports, fake } = door();
    const host = await person();
    const guest = await person();
    const watcher = await person();
    const game = await liveGame(ports, [host, guest]);
    const market = await ports.markets.view(watcher.id, DE, game.matchId);

    return { ports, fake, host, guest, watcher, game, market };
};

/** The bettor's wallet sends the last placement asked of the contract, and the contract takes it. */
const mined = (fake: ReturnType<typeof fakeMarkets>) =>
{
    const last = fake.placed.at(-1)!;

    fake.take(last.ticket);

    return last;
};

const sweep = (ports: Services) => ports.jobs.sweepMarkets(10_000);

describe.skipIf(!active)('markets, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
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
        await db.getRepository(User).createQueryBuilder().delete().execute();
        rung.length = 0;
        lookers.clear();
    });

    describe('who may take a position', () =>
    {
        it('is nobody where no markets contract is configured, and nothing that needs one is answered', async () =>
        {
            const { ports } = door(fakeMarkets(false));
            const one = await person();

            expect(await ports.markets.state(one.id, DE)).toEqual({ open: false });
            expect(await refusal(ports.markets.view(one.id, DE, randomUUID()))).toEqual({ status: 404, code: 'market-off' });
            expect(await refusal(ports.markets.place(one.id, DE, randomUUID(), { outcome: 0, amount: NURA.toString() }))).toEqual({ status: 404, code: 'market-off' });
            expect(await refusal(ports.markets.claim(one.id, [randomUUID()]))).toEqual({ status: 404, code: 'market-off' });
        });

        it('is asked where they are first, then the rules of paid play, then what a market is', async () =>
        {
            const { ports } = door();
            const mayOf = async (who: Person, header = DE) => (await ports.markets.state(who.id, header) as { may: string }).may;
            const ready = await person();

            expect(await mayOf(ready)).toBe('yes');
            expect(await mayOf(ready, from('US')), 'a country nobody named').toBe('market-region');
            expect(await mayOf(ready, from(null)), 'a request the proxy said nothing about').toBe('market-region');
            expect(await mayOf(await person({ wallet: false }))).toBe('market-wallet');
            expect(await mayOf(await person({ minor: true }))).toBe('market-minor');
            expect(await mayOf(await person({ terms: false }))).toBe('market-terms');
            expect(await mayOf(await person({ resting: true }))).toBe('market-break');
            expect(await mayOf(await person({ disclosed: false }))).toBe('market-disclosure');
            expect(await mayOf(await person({ minor: true }), from('US')), 'where they are comes before everything').toBe('market-region');
        });

        it('says the limits in wei, and takes what a market is as read once, ringing the reader', async () =>
        {
            const { ports } = door();
            const one = await person({ disclosed: false });
            const state = await ports.markets.disclose(one.id, DE);

            expect(state).toMatchObject({
                open: true,
                may: 'yes',
                least: NURA.toString(),
                most: (500n * NURA).toString(),
                perBettor: (1_000n * NURA).toString(),
                perDay: (2_000n * NURA).toString(),
                pool: (100_000n * NURA).toString(),
                feeBps: 0,
                window: 90
            });
            expect(rung).toContainEqual([one.id, 'markets']);
            expect(await ports.markets.disclose(one.id, DE), 'read twice is read once').toMatchObject({ may: 'yes' });
        });
    });

    describe('the market on a game', () =>
    {
        it('is written the first time somebody may see it, once whoever asks, with a seat an outcome and nothing to stake on yet', async () =>
        {
            const { ports } = door();
            const host = await person();
            const guest = await person();
            const watcher = await person();
            const other = await person();
            const game = await liveGame(ports, [host, guest]);
            const [first, second] = await Promise.all([
                ports.markets.view(watcher.id, DE, game.matchId),
                ports.markets.view(other.id, DE, game.matchId)
            ]);

            expect(first.id).toBe(second.id);
            expect(await db.getRepository(Market).countBy({ matchId: game.matchId })).toBe(1);
            expect(first).toMatchObject({
                match: game.matchId,
                game: 'ludo',
                state: 'open',
                feeBps: 0,
                minBettors: 2,
                minOutcomes: 2,
                pool: '0',
                bettors: 0,
                mine: []
            });
            expect(first.outcomes).toEqual([
                { choice: { kind: 'seat', seat: 0, who: host.handle }, pool: '0' },
                { choice: { kind: 'seat', seat: 1, who: guest.handle }, pool: '0' }
            ]);

            const started = (await db.query('select started_at from matches where id = $1', [game.matchId]) as { started_at: Date }[])[0].started_at;
            const closes = new Date(first.closesAt).getTime();

            expect(closes, 'ninety seconds after the game started, in whole seconds').toBe(Math.floor((new Date(started).getTime() + 90_000) / 1000) * 1000);
        });

        it('is not there for a table by invitation, a game a move a day, one the reader may not watch, or one whose window has gone by', async () =>
        {
            const { ports } = door();
            const [a, b, c, d, e, f] = await Promise.all([person(), person(), person(), person(), person(), person()]);
            const watcher = await person();
            const missing = { status: 404, code: 'market-missing' };

            const invite = await liveGame(ports, [a, b], { privacy: 'invite' });
            expect(await refusal(ports.markets.view(watcher.id, DE, invite.matchId))).toEqual(missing);
            expect(await refusal(ports.markets.view(a.id, DE, invite.matchId)), 'not even to somebody who sits at it').toEqual(missing);

            const turns = await liveGame(ports, [c, d], { mode: 'turns' });
            expect(await refusal(ports.markets.view(watcher.id, DE, turns.matchId))).toEqual(missing);

            const late = await liveGame(ports, [e, f]);
            await db.query(`update matches set started_at = now() - interval '2 minutes' where id = $1`, [late.matchId]);
            expect(await refusal(ports.markets.view(watcher.id, DE, late.matchId))).toEqual(missing);

            await ports.social.block(watcher.id, e.handle);
            await db.query(`update matches set started_at = now() where id = $1`, [late.matchId]);
            expect(await refusal(ports.markets.view(watcher.id, DE, late.matchId)), 'a host the reader blocked').toEqual(missing);

            expect(await refusal(ports.markets.view(watcher.id, DE, 'not-a-uuid'))).toEqual(missing);
            expect(await refusal(ports.markets.view(watcher.id, DE, randomUUID()))).toEqual(missing);
            expect(await db.getRepository(Market).count(), 'nothing written for any of them').toBe(0);
        });

        it('is shown nowhere markets are not offered, and to no minor', async () =>
        {
            const { ports } = door();
            const [a, b] = await Promise.all([person(), person()]);
            const game = await liveGame(ports, [a, b]);
            const minor = await person({ minor: true });
            const watcher = await person();

            expect(await refusal(ports.markets.view(watcher.id, from('US'), game.matchId))).toEqual({ status: 451, code: 'market-region' });
            expect(await refusal(ports.markets.view(minor.id, DE, game.matchId))).toEqual({ status: 409, code: 'market-minor' });
        });
    });

    describe('a position', () =>
    {
        it('is written with a ticket for this market\'s terms, and answered with the place call for the bettor\'s own wallet', async () =>
        {
            const { ports, fake, watcher, market } = await watched();
            const amount = 25n * NURA;
            const paying = await ports.markets.place(watcher.id, DE, market.id, { outcome: 1, amount: amount.toString() });
            const { terms, ticket } = fake.placed.at(-1)!;
            const placed = decodeFunctionData({ abi: MARKETS_ABI, data: paying.call.data as Hex });

            expect(paying.position).toMatchObject({ market: market.id, outcome: 1, amount: amount.toString(), state: 'prepared' });
            expect(paying.call).toMatchObject({ from: watcher.address, to: FAKE_MARKETS, value: toHex(amount), chainId: 31337 });
            expect(placed.functionName).toBe('place');
            expect(ticket).toMatchObject({
                id: marketIdOf(paying.position.id),
                market: marketIdOf(market.id),
                terms: termsHashOf(terms),
                bettor: watcher.address,
                outcome: 1,
                amount
            });
            expect(terms).toMatchObject({ market: marketIdOf(market.id), outcomes: 2, closesAt: BigInt(new Date(market.closesAt).getTime() / 1000), feeBps: 0, minBettors: 2, minOutcomes: 2 });
            expect(ticket.deadline, 'never past the close').toBeLessThanOrEqual(terms.closesAt);
            expect(Number(ticket.deadline), 'and two minutes at most').toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 120);
            expect(rung).toContainEqual([watcher.id, 'markets']);

            const again = await ports.markets.place(watcher.id, DE, market.id, { outcome: 1, amount: amount.toString() });

            expect(again.position.id, 'asked again, the same position while its ticket has time').toBe(paying.position.id);
            expect(await db.getRepository(MarketPosition).count()).toBe(1);
        });

        it('is refused to a player of the game, for an outcome or an amount the market does not take, and once the market or its game is over', async () =>
        {
            const { ports, host, watcher, market, game } = await watched();
            const one = NURA.toString();

            expect(await refusal(ports.markets.place(host.id, DE, market.id, { outcome: 0, amount: one }))).toEqual({ status: 409, code: 'market-playing' });
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 2, amount: one }))).toEqual({ status: 422, code: 'market-outcome' });
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (NURA - 1n).toString() }))).toEqual({ status: 422, code: 'market-amount' });
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (500n * NURA + 1n).toString() }))).toEqual({ status: 422, code: 'market-amount' });
            expect(await refusal(ports.markets.place(watcher.id, DE, randomUUID(), { outcome: 0, amount: one }))).toEqual({ status: 404, code: 'market-missing' });
            expect(await refusal(ports.markets.place(watcher.id, from('US'), market.id, { outcome: 0, amount: one }))).toEqual({ status: 451, code: 'market-region' });

            await closeIn(market.id, 3);
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: one })), 'too near the close to be placed in time').toEqual({ status: 409, code: 'market-closed' });

            await closeIn(market.id, 60);
            await ports.match.resign(host.id, game.matchId, { key: randomUUID() });
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: one })), 'no ticket for a game that is over').toEqual({ status: 409, code: 'market-closed' });
            expect(await db.getRepository(MarketPosition).count()).toBe(0);
        });

        it('is held to what one bettor may stake in a market and in a day, and to the pool, counting what may still be placed', async () =>
        {
            const { ports, fake, watcher, market } = await watched();
            const most = (500n * NURA).toString();

            await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: most });
            await ports.markets.place(watcher.id, DE, market.id, { outcome: 1, amount: most });

            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: NURA.toString() }))).toEqual({ status: 409, code: 'market-limit', details: { limit: 'bettor' } });

            const late = await person();
            const [a, b] = await Promise.all([person(), person()]);
            const other = await liveGame(ports, [a, b]);
            const elsewhere = await ports.markets.view(late.id, DE, other.matchId);

            await db.getRepository(MarketPosition).insert({ marketId: elsewhere.id, bettorId: late.id, address: late.address!.toLowerCase(), outcome: 0, amount: (1_999n * NURA).toString(), deadline: new Date(), state: 'confirmed', confirmedAt: new Date() });
            expect(await refusal(ports.markets.place(late.id, DE, market.id, { outcome: 0, amount: (2n * NURA).toString() }))).toEqual({ status: 409, code: 'market-limit', details: { limit: 'day' } });

            const crowd = await person();

            await db.getRepository(MarketPosition).insert({ marketId: market.id, bettorId: crowd.id, address: crowd.address!.toLowerCase(), outcome: 1, amount: (99_000n * NURA).toString(), deadline: new Date(), state: 'confirmed', confirmedAt: new Date() });
            expect(await refusal(ports.markets.place(late.id, DE, market.id, { outcome: 0, amount: NURA.toString() }))).toEqual({ status: 409, code: 'market-limit', details: { limit: 'pool' } });

            expect(fake.placed.filter((one) => one.ticket.bettor === late.address), 'nothing signed for a position past a limit').toHaveLength(0);
        });

        it('leaves nothing behind when the wallet cannot pay or the contract would refuse it, and says which in its own word', async () =>
        {
            const { ports, fake, watcher, market } = await watched();
            const five = (5n * NURA).toString();

            fake.state.balance = 3n * NURA;
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: five }))).toEqual({ status: 409, code: 'market-funds', details: { amount: five, held: (3n * NURA).toString() } });

            fake.state.balance = 10n ** 24n;
            fake.state.refusePlace = 'EnforcedPause';
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: five }))).toEqual({ status: 409, code: 'market-paused' });

            fake.state.refusePlace = 'MarketClosed';
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: five }))).toEqual({ status: 409, code: 'market-closed' });

            fake.state.refusePlace = 'InvalidSignature';
            expect(await refusal(ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: five }))).toEqual({ status: 409, code: 'market-refused', details: { error: 'InvalidSignature' } });
            expect(await db.getRepository(MarketPosition).count()).toBe(0);
        });
    });

    describe('the worker, for each position', () =>
    {
        it('believes one once the contract holds it as it was prepared, counts it in its pool and rings whoever looks at the table', async () =>
        {
            const { ports, fake, watcher, market, game, host } = await watched();
            const paying = await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (10n * NURA).toString() });

            lookers.set(game.tableId, [host.id]);
            mined(fake);
            await ports.markets.sent(watcher.id, paying.position.id, `0x${ 'ab'.repeat(32) }`);
            rung.length = 0;

            expect((await sweep(ports)).placed).toBe(1);
            expect((await positionRow(paying.position.id)).state).toBe('confirmed');

            const seen = await ports.markets.view(watcher.id, DE, game.matchId);

            expect(seen.outcomes.map((one) => one.pool)).toEqual([(10n * NURA).toString(), '0']);
            expect([seen.pool, seen.bettors]).toEqual([(10n * NURA).toString(), 1]);
            expect(seen.mine.map((one) => one.state)).toEqual(['confirmed']);
            expect(rung).toEqual(expect.arrayContaining([[watcher.id, 'markets'], [host.id, 'markets']]));
            expect((await sweep(ports)).placed, 'and once').toBe(0);
        });

        it('says the contract\'s word for one its transaction was refused, and lets go of one that can never be placed', async () =>
        {
            const { ports, fake, watcher, market } = await watched();
            const refused = await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (10n * NURA).toString() });
            const forgotten = await ports.markets.place(watcher.id, DE, market.id, { outcome: 1, amount: (10n * NURA).toString() });
            const hash: Hex = `0x${ 'cd'.repeat(32) }`;

            await ports.markets.sent(watcher.id, refused.position.id, hash);
            fake.receipts.set(hash, 'reverted');
            fake.state.refusePlace = 'TicketExpired';
            await db.query(`update market_positions set deadline = now() - interval '6 minutes' where id = $1`, [forgotten.position.id]);

            const moved = await sweep(ports);

            expect([moved.refused, moved.lapsed]).toEqual([1, 1]);
            expect(await positionRow(refused.position.id)).toMatchObject({ state: 'reverted', failure: 'TicketExpired' });
            expect(await positionRow(forgotten.position.id)).toMatchObject({ state: 'expired', failure: null });
        });

        it('believes nobody\'s position held under a ticket in place of the one prepared, and says so as a fault', async () =>
        {
            const { ports, fake, watcher, market } = await watched();
            const paying = await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (10n * NURA).toString() });

            fake.take(fake.placed.at(-1)!.ticket, { outcome: 1 });

            const moved = await sweep(ports);

            expect(moved.faults.map((one) => one.error)).toEqual([`mismatch:${ paying.position.id }`]);
            expect(await positionRow(paying.position.id)).toMatchObject({ state: 'reverted', failure: 'mismatch' });
        });
    });

    describe('the worker, for each market', () =>
    {
        /** Two people back each outcome, the market closes, and the game ends with the host winning. */
        const backed = async () =>
        {
            const setting = await watched();
            const { ports, fake, market, host, game } = setting;
            const others = [await person(), await person(), await person()];
            const stakes: [Person, number, bigint][] = [[setting.watcher, 0, 10n], [others[0], 1, 30n], [others[1], 1, 10n], [others[2], 0, 50n]];
            const ids: string[] = [];

            for (const [who, outcome, amount] of stakes)
            {
                ids.push((await ports.markets.place(who.id, DE, market.id, { outcome, amount: (amount * NURA).toString() })).position.id);
                mined(fake);
            }

            await sweep(ports);
            await closeIn(market.id, -30);
            await ports.match.resign(setting.guest.id, game.matchId, { key: randomUUID() });

            return { ...setting, ids, stakes, others, winner: 0, hostSeat: host };
        };

        it('settles a game that ended after the close on the outcome that happened, once, and writes down what the chain then holds', async () =>
        {
            const { ports, fake, market, ids } = await backed();
            const key = marketIdOf(market.id);

            expect((await sweep(ports)).sent).toBe(1);
            expect(fake.sent).toEqual([`settle ${ key } 0`]);
            expect(await marketRow(market.id)).toMatchObject({ state: 'closing', outcome: 0 });

            await sweep(ports);
            expect(fake.sent, 'nothing sent again while its transaction waits').toHaveLength(1);

            const claimableAt = BigInt(Math.floor(Date.now() / 1000) + 900);

            fake.resolve(key, 'settled', 0, claimableAt);
            rung.length = 0;
            expect((await sweep(ports)).settled).toBe(1);

            const row = await marketRow(market.id);

            expect(row).toMatchObject({ state: 'settled', outcome: 0 });
            expect(row.claimableAt?.getTime()).toBe(Number(claimableAt) * 1000);
            expect(rung.map(([who]) => who).sort(), 'every bettor').toEqual([...new Set((await db.getRepository(MarketPosition).findBy({ marketId: market.id })).map((one) => one.bettorId))].sort());
            expect(ids).toHaveLength(4);
        });

        it('calls off, never settles, a market whose game ended before its close, or one the staff ended as no contest', async () =>
        {
            const early = await watched();

            await early.ports.markets.place(early.watcher.id, DE, early.market.id, { outcome: 0, amount: (5n * NURA).toString() });
            mined(early.fake);
            await early.ports.match.resign(early.guest.id, early.game.matchId, { key: randomUUID() });
            await sweep(early.ports);

            expect(early.fake.sent).toEqual([`cancel ${ marketIdOf(early.market.id) }`]);
            expect(await marketRow(early.market.id)).toMatchObject({ state: 'closing', outcome: null });

            const voided = await watched();

            await voided.ports.markets.place(voided.watcher.id, DE, voided.market.id, { outcome: 0, amount: (5n * NURA).toString() });
            mined(voided.fake);
            await closeIn(voided.market.id, -30);
            await db.query(
                `update matches set finished_at = now(), deadline_at = null, outcome = 'abandoned', state = jsonb_set(state, '{voided}', 'true') where id = $1`,
                [voided.game.matchId]
            );
            await sweep(voided.ports);

            expect(voided.fake.sent).toEqual([`cancel ${ marketIdOf(voided.market.id) }`]);
        });

        it('calls it off when the chain still took positions at the end, its clock behind this one', async () =>
        {
            const { ports, fake, market, guest, game, watcher } = await watched();

            await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (5n * NURA).toString() });
            mined(fake);
            await closeIn(market.id, -5);
            fake.state.clock = BigInt(Math.floor(Date.now() / 1000) - 30);
            await ports.match.resign(guest.id, game.matchId, { key: randomUUID() });
            await sweep(ports);

            expect(fake.sent).toEqual([`cancel ${ marketIdOf(market.id) }`]);
        });

        it('settles a game that ended well after the close on a quiet chain, whose newest block is minutes old', async () =>
        {
            const { ports, fake, market, guest, game, watcher } = await watched();

            await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (5n * NURA).toString() });
            mined(fake);
            await closeIn(market.id, -40);
            fake.state.clock = BigInt(Math.floor(Date.now() / 1000) - 300);
            await ports.match.resign(guest.id, game.matchId, { key: randomUUID() });
            await sweep(ports);

            expect(fake.sent).toEqual([`settle ${ marketIdOf(market.id) } 0`]);
        });

        it('waits for the chain\'s own clock to reach the close, and sends again once it has', async () =>
        {
            const { ports, fake, market } = await backed();

            fake.state.refuseSend = 'MarketOpen';
            await sweep(ports);

            expect(fake.sent).toEqual([]);
            expect(await marketRow(market.id)).toMatchObject({ state: 'closing', failure: 'MarketOpen' });

            fake.state.refuseSend = null;
            await sweep(ports);

            expect(fake.sent).toEqual([`settle ${ marketIdOf(market.id) } 0`]);
            expect((await marketRow(market.id)).failure).toBeNull();
        });

        it('sends again a transaction the chain reverted, and nothing for a market the chain resolved already', async () =>
        {
            const { ports, fake, market } = await backed();
            const key = marketIdOf(market.id);

            await sweep(ports);
            fake.receipts.set((await marketRow(market.id)).txHash as Hex, 'reverted');
            await sweep(ports);

            expect(fake.sent).toEqual([`settle ${ key } 0`, `settle ${ key } 0`]);

            fake.resolve(key, 'refunded', 1);
            expect((await sweep(ports)).refunded).toBe(1);
            expect(await marketRow(market.id), 'the outcome the chain holds').toMatchObject({ state: 'refunded', outcome: 1, claimableAt: null });
            expect(fake.sent).toHaveLength(2);
        });

        it('writes down a market nobody placed in as empty, once no ticket could still open it, and sends nothing', async () =>
        {
            const { ports, fake, market } = await watched();

            await closeIn(market.id, -60);
            expect((await sweep(ports)).empty, 'a ticket could still be on its way').toBe(0);

            await closeIn(market.id, -360);
            expect((await sweep(ports)).empty).toBe(1);
            expect(await marketRow(market.id)).toMatchObject({ state: 'empty' });
            expect(fake.sent).toEqual([]);
        });

        it('leaves a market nobody placed in alone when its game ends early, until no ticket could still open it', async () =>
        {
            const { ports, fake, market, guest, game } = await watched();

            await ports.match.resign(guest.id, game.matchId, { key: randomUUID() });
            await sweep(ports);

            expect(await marketRow(market.id), 'a ticket signed before the end could still be placed').toMatchObject({ state: 'closing', outcome: null });

            await closeIn(market.id, -360);
            expect((await sweep(ports)).empty).toBe(1);
            expect(fake.sent).toEqual([]);
        });

        it('hears that the owner overturned a settled market in its dispute window, and calls it off', async () =>
        {
            const { ports, fake, market } = await backed();
            const key = marketIdOf(market.id);

            await sweep(ports);
            fake.resolve(key, 'settled', 0, BigInt(Math.floor(Date.now() / 1000) + 900));
            await sweep(ports);
            fake.resolve(key, 'cancelled', 0);

            expect((await sweep(ports)).cancelled).toBe(1);
            expect(await marketRow(market.id)).toMatchObject({ state: 'cancelled', claimableAt: null });
        });
    });

    describe('what a position came to, and its claim', () =>
    {
        it('lists the reader\'s positions with their share of the pool, their stake back, or nothing, newest first', async () =>
        {
            const { ports, fake, market, stakes, others } = await (async () =>
            {
                const setting = await watched();
                const { ports: p, fake: f, market: m, game } = setting;
                const people = [await person(), await person()];
                const placed: [Person, number, bigint][] = [[setting.watcher, 0, 10n], [people[0], 1, 30n], [people[1], 1, 10n]];

                for (const [who, outcome, amount] of placed)
                {
                    await p.markets.place(who.id, DE, m.id, { outcome, amount: (amount * NURA).toString() });
                    mined(f);
                }

                await sweep(p);
                await closeIn(m.id, -30);
                await p.match.resign(setting.host.id, game.matchId, { key: randomUUID() });
                await sweep(p);
                f.resolve(marketIdOf(m.id), 'settled', 1, BigInt(Math.floor(Date.now() / 1000) - 1));
                await sweep(p);

                return { ...setting, stakes: placed, others: people };
            })();

            const loser = (await ports.markets.positions(stakes[0][0].id, null)).positions[0];
            const big = (await ports.markets.positions(others[0].id, null)).positions[0];
            const small = (await ports.markets.positions(others[1].id, null)).positions[0];

            expect(loser).toMatchObject({ result: 'lost' });
            expect(loser.payout).toBeUndefined();
            expect(big).toMatchObject({ result: 'won', payout: (37n * NURA + NURA / 2n).toString() });
            expect(small).toMatchObject({ result: 'won', payout: (12n * NURA + NURA / 2n).toString() });
            expect(big.claimableAt).toBeDefined();
            expect(fake.placed).toHaveLength(3);
            expect(market.state).toBe('open');
        });

        it('composes the claim from the wallet that placed it once the contract would pay, and reads what it paid off its receipt', async () =>
        {
            const setting = await watched();
            const { ports, fake, market, game, host, watcher } = setting;
            const backer = await person();

            const mine = (await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (10n * NURA).toString() })).position.id;
            mined(fake);
            await ports.markets.place(backer.id, DE, market.id, { outcome: 1, amount: (30n * NURA).toString() });
            mined(fake);
            await sweep(ports);

            expect(await refusal(ports.markets.claim(watcher.id, [mine])), 'nothing is owed while the market is open').toEqual({ status: 409, code: 'market-unclaimable' });

            await closeIn(market.id, -30);
            await ports.match.resign(setting.guest.id, game.matchId, { key: randomUUID() });
            await sweep(ports);
            fake.resolve(marketIdOf(market.id), 'settled', 0, BigInt(Math.floor(Date.now() / 1000) + 900));
            await sweep(ports);

            expect(await refusal(ports.markets.claim(watcher.id, [mine])), 'nor in the dispute window').toEqual({ status: 409, code: 'market-unclaimable' });

            await db.query(`update markets set claimable_at = now() - interval '1 second' where id = $1`, [market.id]);

            const call = await ports.markets.claim(watcher.id, [mine]);

            expect(call).toMatchObject({ from: watcher.address, to: FAKE_MARKETS, value: '0x0' });
            expect(decodeFunctionData({ abi: MARKETS_ABI, data: call.data as Hex }).args).toEqual([[marketIdOf(mine)]]);
            expect(await refusal(ports.markets.claim(host.id, [mine])), 'nobody claims somebody else\'s').toEqual({ status: 409, code: 'market-unclaimable' });
            expect(await refusal(ports.markets.claim(backer.id, [(await db.getRepository(MarketPosition).findOneByOrFail({ bettorId: backer.id })).id])), 'nor one that lost').toEqual({ status: 409, code: 'market-unclaimable' });

            const hash: Hex = `0x${ 'ef'.repeat(32) }`;
            const sent = await ports.markets.claimSent(watcher.id, hash, [mine]);

            expect(sent.positions.map((one) => one.claimHash)).toEqual([hash]);
            await sweep(ports);
            expect((await positionRow(mine)).claimedAt, 'not before its receipt says so').toBeNull();

            fake.claims.set(hash, [{ ticket: marketIdOf(mine), amount: 40n * NURA }]);
            expect((await sweep(ports)).claimed).toBe(1);
            expect(await positionRow(mine)).toMatchObject({ paid: (40n * NURA).toString() });
            expect((await positionRow(mine)).claimedAt).not.toBeNull();
            expect(await refusal(ports.markets.claim(watcher.id, [mine])), 'and never twice').toEqual({ status: 409, code: 'market-unclaimable' });
        });

        it('forgets a claim whose transaction reverted, so it can be claimed again', async () =>
        {
            const { ports, fake, market, game, watcher, guest } = await watched();
            const mine = (await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (10n * NURA).toString() })).position.id;

            mined(fake);
            await sweep(ports);
            await ports.match.resign(guest.id, game.matchId, { key: randomUUID() });
            await sweep(ports);
            fake.resolve(marketIdOf(market.id), 'cancelled');
            await sweep(ports);

            const hash: Hex = `0x${ '12'.repeat(32) }`;

            await ports.markets.claim(watcher.id, [mine]);
            await ports.markets.claimSent(watcher.id, hash, [mine]);
            fake.claims.set(hash, 'reverted');
            await sweep(ports);

            expect(await positionRow(mine)).toMatchObject({ claimHash: null, claimedAt: null });
            expect((await ports.markets.claim(watcher.id, [mine])).to, 'a stake back is claimable at once').toBe(FAKE_MARKETS);
        });

        it('writes down a position claimed by a call this server never saw, with what it paid only where that is known', async () =>
        {
            const { ports, fake, market, game, watcher, guest } = await watched();
            const mine = (await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (10n * NURA).toString() })).position.id;
            const ticket = fake.placed.at(-1)!.ticket;

            fake.take(ticket);
            await sweep(ports);
            await ports.match.resign(guest.id, game.matchId, { key: randomUUID() });
            await sweep(ports);
            fake.resolve(marketIdOf(market.id), 'cancelled');
            await sweep(ports);

            fake.positions.set(ticket.id, { bettor: ticket.bettor, outcome: 0, amount: ticket.amount, claimed: true });
            fake.state.refuseClaim = ['AlreadyClaimed'];

            expect(await refusal(ports.markets.claim(watcher.id, [mine]))).toEqual({ status: 409, code: 'market-unclaimable' });
            expect(await positionRow(mine), 'a stake back is the stake').toMatchObject({ paid: (10n * NURA).toString() });
            expect((await positionRow(mine)).claimedAt).not.toBeNull();
        });

        it('writes down a winner claimed by a call this server never saw with no amount, since a share depends on who claimed first', async () =>
        {
            const { ports, fake, market, game, watcher, guest } = await watched();
            const backer = await person();
            const mine = (await ports.markets.place(watcher.id, DE, market.id, { outcome: 0, amount: (10n * NURA).toString() })).position.id;
            const ticket = fake.placed.at(-1)!.ticket;

            fake.take(ticket);
            await ports.markets.place(backer.id, DE, market.id, { outcome: 1, amount: (30n * NURA).toString() });
            mined(fake);
            await sweep(ports);
            await closeIn(market.id, -30);
            await ports.match.resign(guest.id, game.matchId, { key: randomUUID() });
            await sweep(ports);
            fake.resolve(marketIdOf(market.id), 'settled', 0, BigInt(Math.floor(Date.now() / 1000) - 1));
            await sweep(ports);

            fake.positions.set(ticket.id, { bettor: ticket.bettor, outcome: 0, amount: ticket.amount, claimed: true });
            fake.state.refuseClaim = ['AlreadyClaimed'];

            expect(await refusal(ports.markets.claim(watcher.id, [mine]))).toEqual({ status: 409, code: 'market-unclaimable' });
            expect(await positionRow(mine)).toMatchObject({ paid: null });
            expect((await positionRow(mine)).claimedAt).not.toBeNull();
        });
    });
});

import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, IsNull } from 'typeorm';
import { getAddress, zeroAddress, type Address, type Hex } from 'viem';

import { marketIdOf } from '../src/chain/markets.ts';
import { itemOf, orderIdOf } from '../src/chain/shop.ts';
import { tipIdOf } from '../src/chain/tips.ts';
import { vaultIdOf } from '../src/chain/vault.ts';
import { Discrepancy, Donation, Escrow, Market, MarketPosition, Notification, OwnedItem, ShopOrder, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { AUDIT_PAGE } from '../src/domains/reconcile/audit.ts';
import { LOOKS } from '../src/domains/shop/catalogue.ts';
import { buildPorts, type Note, type Services, type WriteListener } from '../src/services.ts';
import { fakeMarkets } from './fake-markets.ts';
import { fakeShop } from './fake-shop.ts';
import { fakeTips } from './fake-tips.ts';
import { fakeVault } from './fake-vault.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NURA = 10n ** 18n;

const OWNER_WALLET = '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc';

const LOOK = LOOKS[0].id;

let db: DataSource;

let seq = 0;

const rung: [string, string][] = [];

const said: { event: string; fields: Record<string, unknown>; level?: string }[] = [];

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

const waitingOnLocks = async () =>
    (await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ) as { count: number }[])[0].count;

const note: Note = (event, fields, level) =>
{
    said.push({ event, fields, level });
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
    adminWallet: OWNER_WALLET
} as Parameters<typeof buildPorts>[1];

interface Person
{
    id: string;
    handle: string;
    address: string;
}

let vault: ReturnType<typeof fakeVault>;
let shop: ReturnType<typeof fakeShop>;
let tips: ReturnType<typeof fakeTips>;
let markets: ReturnType<typeof fakeMarkets>;
let ports: Services;

const open = (configured = { vault: true, shop: true, tips: true, markets: true }) =>
{
    vault = fakeVault(configured.vault);
    shop = fakeShop(configured.shop);
    tips = fakeTips(configured.tips);
    markets = fakeMarkets(configured.markets);
    ports = buildPorts(db, CONFIG, listener, { present: (ids) => new Set(ids) }, note, vault.vault, undefined, shop.shop, tips.tips, markets.chain);
};

const pass = () => ports.jobs.reconcile(20_000);

const person = async (address?: string): Promise<Person> =>
{
    seq += 1;

    const wallet = address ?? getAddress(`0x${ (0xc4ec0000 + seq).toString(16).padStart(40, '0') }`).toLowerCase();
    const user = await db.getRepository(User).save({ handle: `checked${ seq }`, displayName: `Checked ${ seq }`, hue: 200, kind: 'wallet' });

    await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`, [user.id, wallet]);

    return { id: user.id, handle: user.handle, address: wallet };
};

const tableOf = (game: string, seats = 2) => ({
    game,
    seats,
    mode: 'live' as const,
    privacy: 'public' as const,
    target: 0,
    cube: false,
    blinds: 'low' as const,
    chat: true,
    voice: 'off' as const,
    teams: false,
    invitees: []
});

/** A game of Ludo being played between two people, at a table of its own. */
const game = async () =>
{
    const host = await person();
    const guest = await person();
    const opened = await ports.table.create(host.id, tableOf('ludo'));

    await ports.table.claim(guest.id, opened.id);
    await ports.table.setReady(host.id, opened.id, true);
    await ports.table.setReady(guest.id, opened.id, true);

    const match = await ports.match.start(host.id, opened.id);

    return { tableId: opened.id, matchId: match.id, host, guest };
};

const hex = () => `0x${ randomBytes(32).toString('hex') }`;

const HELD_FEE = 500;

/** A paid game written by hand at a table of its own, its two players' stakes of `nura` each. */
const escrow = async (state: string, options: { nura?: bigint; winners?: number | null; closeTx?: string | null; created?: string } = {}) =>
{
    const players = [await person(), await person()];
    const table = await ports.table.create(players[0].id, tableOf('ludo'));
    const amount = (options.nura ?? 10n) * NURA;
    const winners = options.winners === undefined ? (state === 'settling' || state === 'settled' ? 1 : null) : options.winners;
    const [made] = await db.query(
        `insert into escrows (table_id, game, amount, fee_bps, state, winners, close_tx, created_at)
         values ($1, 'ludo', $2, $3, $4, $5, $6, now() - $7::interval) returning id`,
        [table.id, amount.toString(), HELD_FEE, state, winners, options.closeTx ?? null, options.created ?? '1 minute']
    ) as { id: string }[];

    for (const [seat, player] of players.entries())
    {
        await db.query(
            `insert into escrow_seats (escrow_id, seat, user_id, address, nonce, commitment, secret, deadline, signature)
             values ($1, $2, $3, $4, $5, $6, $7, now() + interval '1 hour', $8)`,
            [made.id, seat, player.id, player.address, hex(), hex(), hex(), `0x${ 'e'.repeat(130) }`]
        );
    }

    return { id: made.id, amount, players };
};

/** The vault holds the escrow's game in `status`, with the stakes the row says unless told otherwise. */
const vaultHolds = (row: { id: string; amount: bigint; players: Person[] }, status: 'open' | 'settled' | 'refunded' | 'reclaimed', terms: Partial<{ amount: bigint; feeBps: number; players: Address[] }> = {}) =>
{
    const id = vaultIdOf(row.id);

    vault.games.set(id, status);
    vault.stakes.set(id, { amount: row.amount, feeBps: HELD_FEE, players: row.players.map((one) => getAddress(one.address)), ...terms });
};

/** An order written by hand in `state`, for its buyer, of one look. */
const order = async (state: string, options: { price?: bigint; created?: string } = {}) =>
{
    const buyer = await person();
    const price = options.price ?? 5n * NURA;
    const paid = state === 'paid' || state === 'refunded';
    const [made] = await db.query(
        `insert into shop_orders (buyer_id, recipient_id, item_id, price, buyer_address, deadline, state, paid_at, delivered, refunded_at, failure, tx_hash, created_at)
         values ($1, $1, $2, $3, $4, now() - interval '20 minutes', $5, $6, $7, $8, $9, $10, now() - $11::interval) returning id`,
        [
            buyer.id,
            LOOK,
            price.toString(),
            buyer.address,
            state,
            paid ? new Date() : null,
            paid ? true : null,
            state === 'refunded' ? new Date() : null,
            state === 'failed' ? 'EnforcedPause' : null,
            state === 'sent' ? hex() : null,
            options.created ?? '40 minutes'
        ]
    ) as { id: string }[];

    return { id: made.id, buyer, price };
};

/** The shop holds a sale under the order, to its buyer at its price unless told otherwise. */
const shopSold = (row: { id: string; buyer: Person; price: bigint }, options: { refunded?: boolean; buyer?: string; price?: bigint } = {}) =>
    shop.sell({
        order: orderIdOf(row.id),
        buyer: getAddress(options.buyer ?? row.buyer.address),
        item: itemOf(LOOK),
        price: options.price ?? row.price,
        referrer: zeroAddress,
        deadline: 0n
    }, options.refunded ?? false);

/** A gift written by hand in `state`, from somebody watching a game to its host. */
const donation = async (state: string) =>
{
    const { matchId, host } = await game();
    const giver = await person();
    const amount = 5n * NURA;
    const [made] = await db.query(
        `insert into donations (giver_id, receiver_id, match_id, amount, giver_address, receiver_address, deadline, state, confirmed_at, failure, tx_hash)
         values ($1, $2, $3, $4, $5, $6, now() - interval '40 minutes', $7, $8, $9, $10) returning id`,
        [
            giver.id,
            host.id,
            matchId,
            amount.toString(),
            giver.address,
            host.address,
            state,
            state === 'confirmed' ? new Date() : null,
            state === 'reverted' || state === 'failed' ? (state === 'failed' ? 'mismatch' : 'TipExpired') : null,
            state === 'sent' ? hex() : null
        ]
    ) as { id: string }[];

    return { id: made.id, giver, receiver: host, amount };
};

/** A market on a game being played, written by hand: two seats and nothing else to back. */
const market = async (state: string, options: { outcome?: number | null; claimableAt?: string | null } = {}) =>
{
    const { matchId, tableId, host, guest } = await game();
    const settled = state === 'settled';
    const [made] = await db.query(
        `insert into markets (match_id, table_id, game, outcomes, choices, closes_at, fee_bps, max_stake, max_per_bettor, max_pool, min_bettors, min_outcomes, state, outcome, claimable_at)
         values ($1, $2, 'ludo', 2, $3, now() - interval '30 minutes', 0, $4, $4, $4, 2, 2, $5, $6, $7) returning id`,
        [
            matchId,
            tableId,
            JSON.stringify([{ kind: 'seat', seat: 0 }, { kind: 'seat', seat: 1 }]),
            (1000n * NURA).toString(),
            state,
            options.outcome === undefined ? (settled || state === 'refunded' ? 0 : null) : options.outcome,
            settled ? (options.claimableAt === undefined ? new Date(Date.now() - 20 * 60_000) : options.claimableAt) : null
        ]
    ) as { id: string }[];

    return { id: made.id, matchId, host, guest };
};

const claimTime = (id: string) => db.getRepository(Market).findOneByOrFail({ id }).then((row) => BigInt(Math.floor((row.claimableAt?.getTime() ?? 0) / 1000)));

/** A position written by hand in `state`, on the market's first outcome unless told another. */
const position = async (marketId: string, state: string, options: { claimed?: boolean; claimHash?: string | null; failure?: string; outcome?: number; created?: string } = {}) =>
{
    const bettor = await person();
    const amount = 25n * NURA;
    const [made] = await db.query(
        `insert into market_positions (market_id, bettor_id, address, outcome, amount, deadline, state, confirmed_at, claimed_at, claim_hash, claim_sent_at, failure, created_at)
         values ($1, $2, $3, $10, $4, now() - interval '20 minutes', $5, $6, $7, $8::varchar, case when $8::varchar is null then null else now() end, $9, now() - $11::interval) returning id`,
        [
            marketId,
            bettor.id,
            bettor.address,
            amount.toString(),
            state,
            state === 'confirmed' ? new Date() : null,
            options.claimed === true ? new Date() : null,
            options.claimHash ?? null,
            state === 'reverted' ? options.failure ?? 'MarketClosed' : null,
            options.outcome ?? 0,
            options.created ?? '1 minute'
        ]
    ) as { id: string }[];

    return { id: made.id, bettor, amount };
};

const placed = (row: { id: string; bettor: Person; amount: bigint }, as: Partial<{ outcome: number; amount: bigint; claimed: boolean; bettor: Address }> = {}) =>
    markets.positions.set(marketIdOf(row.id), { bettor: getAddress(row.bettor.address), outcome: 0, amount: row.amount, claimed: false, ...as });

const rowsAbout = (record: string) => db.getRepository(Discrepancy).find({ where: { record }, order: { firstSeen: 'ASC' } });

const openRows = () => db.getRepository(Discrepancy).find({ where: { resolvedAt: IsNull() }, order: { firstSeen: 'ASC' } });

const kindsOf = async (record: string) => (await rowsAbout(record)).map((row) => `${ row.kind } ${ row.resolution ?? 'open' }`);

const warned = (event: string, record: string) => said.filter((one) => one.event === event && one.fields.record === record && one.level === 'warn');

describe.skipIf(!active)('the database and NuraChain, checked against each other', () =>
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
            await db.query('truncate table users cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Discrepancy).createQueryBuilder().delete().execute();
        await db.getRepository(Escrow).createQueryBuilder().delete().execute();
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.query('truncate table users cascade');
        rung.length = 0;
        said.length = 0;
        open();
    });

    describe('a paid game, against the vault', () =>
    {
        it('finds nothing where the vault holds every game as the database does', async () =>
        {
            const played = await escrow('open');
            const paid = await escrow('settled');
            const failed = await escrow('failed');

            vaultHolds(played, 'open');
            vaultHolds(paid, 'settled');

            const done = await pass();

            expect(done.compared).toBeGreaterThanOrEqual(3);
            expect(await openRows()).toEqual([]);
            expect(await rowsAbout(failed.id)).toEqual([]);
        });

        it('records a game paid here that the vault gave back for a person, says so, and resolves it once the two agree', async () =>
        {
            const paid = await escrow('settled');

            vaultHolds(paid, 'refunded');
            await pass();

            const [row] = await rowsAbout(paid.id);

            expect(row).toMatchObject({ family: 'escrow', kind: 'escrow-state', db: { state: 'settled' }, chain: { state: 'refunded' }, resolvedAt: null, resolution: null });
            expect(row.about).toMatchObject({ game: 'ludo', amount: paid.amount.toString(), who: paid.players.map((one) => one.handle).join(', ') });
            expect(warned('chain and database disagree', paid.id)).toHaveLength(1);
            expect(warned('chain and database disagree', paid.id)[0].fields).toMatchObject({ family: 'escrow', kind: 'escrow-state', db: { state: 'settled' }, chain: { state: 'refunded' } });

            await pass();

            const [again] = await rowsAbout(paid.id);

            expect(again.id, 'one row while it lasts').toBe(row.id);
            expect(again.firstSeen).toEqual(row.firstSeen);
            expect(again.lastSeen.getTime()).toBeGreaterThan(row.lastSeen.getTime());
            expect(warned('chain and database disagree', paid.id), 'said once, when it was found').toHaveLength(1);

            vaultHolds(paid, 'settled');
            await pass();

            expect(await rowsAbout(paid.id)).toMatchObject([{ id: row.id, resolution: 'agreed' }]);
            expect((await rowsAbout(paid.id))[0].resolvedAt).not.toBeNull();
            expect(warned('chain and database agree again', paid.id).map((one) => one.fields)).toEqual([{ family: 'escrow', record: paid.id, kind: 'escrow-state', how: 'agreed' }]);
        });

        it('records stakes locked here that the vault does not hold, and a game the vault resolved while it is still being played', async () =>
        {
            const ghost = await escrow('open');
            const reclaimed = await escrow('open');

            vaultHolds(reclaimed, 'reclaimed');
            await pass();

            expect(await kindsOf(ghost.id)).toEqual(['escrow-state open']);
            expect((await rowsAbout(ghost.id))[0]).toMatchObject({ db: { state: 'open' }, chain: { state: 'none' } });
            expect((await rowsAbout(reclaimed.id))[0]).toMatchObject({ kind: 'escrow-state', db: { state: 'open' }, chain: { state: 'reclaimed' } });
        });

        it('leaves a game the stake worker is still moving to it, and records only what it can never move', async () =>
        {
            const paying = await escrow('settling');
            const giving = await escrow('refunding');
            const lost = await escrow('settling');
            const wrong = await escrow('refunding');
            const locking = await escrow('locking');

            vaultHolds(paying, 'open');
            vaultHolds(giving, 'refunded');
            vaultHolds(wrong, 'settled');
            vaultHolds(locking, 'settled');

            await pass();

            expect(await rowsAbout(paying.id)).toEqual([]);
            expect(await rowsAbout(giving.id)).toEqual([]);
            expect(await rowsAbout(locking.id), 'a lock is the worker\'s whatever the vault says').toEqual([]);
            expect((await rowsAbout(lost.id))[0]).toMatchObject({ kind: 'escrow-state', db: { state: 'settling' }, chain: { state: 'none' } });
            expect((await rowsAbout(wrong.id))[0]).toMatchObject({ kind: 'escrow-state', db: { state: 'refunding' }, chain: { state: 'settled' } });
        });

        it('records a game the vault holds with other stakes, another fee or other players', async () =>
        {
            const more = await escrow('open');
            const fee = await escrow('open');
            const others = await escrow('open');
            const stranger = getAddress(`0x${ 'ab'.repeat(20) }`);

            vaultHolds(more, 'open', { amount: 11n * NURA });
            vaultHolds(fee, 'open', { feeBps: 700 });
            vaultHolds(others, 'open', { players: [getAddress(others.players[0].address), stranger] });

            await pass();

            expect((await rowsAbout(more.id))[0]).toMatchObject({
                kind: 'escrow-stakes',
                db: { amount: (10n * NURA).toString(), fee: '500' },
                chain: { amount: (11n * NURA).toString(), fee: '500' }
            });
            expect((await rowsAbout(fee.id))[0]).toMatchObject({ kind: 'escrow-stakes', chain: { fee: '700' } });
            expect((await rowsAbout(others.id))[0]).toMatchObject({
                kind: 'escrow-stakes',
                db: { players: others.players.map((one) => one.address).join(',') },
                chain: { players: [others.players[0].address, stranger.toLowerCase()].join(',') }
            });
        });

        it('reads the seats a payment paid off its receipt, and records a payment to other seats with who they are', async () =>
        {
            const right = hex();
            const wrong = hex();
            const fair = await escrow('settled', { winners: 1, closeTx: right });
            const unfair = await escrow('settled', { winners: 1, closeTx: wrong });

            vaultHolds(fair, 'settled');
            vaultHolds(unfair, 'settled');
            vault.receipts.set(right as Hex, 'success');
            vault.receipts.set(wrong as Hex, 'success');
            vault.paid.set(right as Hex, { id: vaultIdOf(fair.id), winners: 1n });
            vault.paid.set(wrong as Hex, { id: vaultIdOf(unfair.id), winners: 2n });

            await pass();

            expect(await rowsAbout(fair.id)).toEqual([]);
            expect((await rowsAbout(unfair.id))[0]).toMatchObject({
                kind: 'escrow-winners',
                db: { seats: '0', winners: unfair.players[0].handle },
                chain: { seats: '1', winners: unfair.players[1].handle },
                about: { tx: wrong }
            });
        });

        it('compares a game being played however old it is, and a game that is over only for a week', async () =>
        {
            const old = await escrow('open', { created: '30 days' });
            const over = await escrow('settled', { created: '8 days' });

            await pass();

            expect(await kindsOf(old.id)).toEqual(['escrow-state open']);
            expect(await rowsAbout(over.id)).toEqual([]);
        });

        it('never sends the vault anything', async () =>
        {
            await escrow('open');
            await escrow('settling');
            await escrow('refunding');
            await pass();

            expect([vault.opened, vault.settled, vault.refunded]).toEqual([[], [], []]);
        });
    });

    describe('a shop order, against the sale the shop holds', () =>
    {
        it('finds nothing where the shop holds every order as the database does', async () =>
        {
            const paid = await order('paid');
            const refunded = await order('refunded');
            const lapsed = await order('expired');

            shopSold(paid);
            shopSold(refunded, { refunded: true });
            await pass();

            expect([...await rowsAbout(paid.id), ...await rowsAbout(refunded.id), ...await rowsAbout(lapsed.id)]).toEqual([]);
        });

        it('records a look delivered with no payment the shop holds, and one the owner refunded on the contract, for a person', async () =>
        {
            const unpaid = await order('paid');
            const refunded = await order('paid');

            shopSold(refunded, { refunded: true });
            await pass();

            expect((await rowsAbout(unpaid.id))[0]).toMatchObject({ kind: 'order-state', db: { state: 'paid' }, chain: { state: 'unsold' }, resolution: null });
            expect((await rowsAbout(refunded.id))[0]).toMatchObject({ kind: 'order-state', db: { state: 'paid' }, chain: { state: 'refunded' }, resolution: null });
            expect(await db.getRepository(OwnedItem).countBy({ orderId: refunded.id }), 'nothing here takes a look back').toBe(0);
            expect(await db.getRepository(ShopOrder).findOneByOrFail({ id: refunded.id })).toMatchObject({ state: 'paid' });
        });

        it('delivers a sale the shop holds for an order that ran out here, through the shop worker, and writes it down as put right', async () =>
        {
            const lapsed = await order('expired');
            const failed = await order('failed');
            const refunded = await order('expired');

            shopSold(lapsed);
            shopSold(failed);
            shopSold(refunded, { refunded: true });
            await pass();

            expect(await db.getRepository(ShopOrder).findOneByOrFail({ id: lapsed.id })).toMatchObject({ state: 'paid', delivered: true });
            expect(await db.getRepository(OwnedItem).findOneByOrFail({ orderId: lapsed.id })).toMatchObject({ userId: lapsed.buyer.id, itemId: LOOK, via: 'purchase' });
            expect(await db.getRepository(ShopOrder).findOneByOrFail({ id: failed.id })).toMatchObject({ state: 'paid', failure: null });
            expect(await db.getRepository(ShopOrder).findOneByOrFail({ id: refunded.id })).toMatchObject({ state: 'refunded', delivered: false });
            expect(await rowsAbout(lapsed.id)).toMatchObject([{ kind: 'order-state', db: { state: 'expired' }, chain: { state: 'sold' }, resolution: 'put-right' }]);
            expect(await rowsAbout(refunded.id)).toMatchObject([{ db: { state: 'expired' }, chain: { state: 'refunded' }, resolution: 'put-right' }]);
            expect(warned('chain and database disagree', lapsed.id)).toHaveLength(1);
            expect(warned('chain and database agree again', lapsed.id).map((one) => one.fields.how)).toEqual(['put-right']);
            expect(rung).toContainEqual([lapsed.buyer.id, 'shop']);

            await pass();

            expect(await rowsAbout(lapsed.id), 'what was put right agrees the next time').toHaveLength(1);
        });

        it('records a sale under an order to anybody or at any price but the quote\'s, and delivers nothing for it', async () =>
        {
            const stolen = await order('expired');
            const cheap = await order('paid');
            const stranger = `0x${ 'cd'.repeat(20) }`;

            shopSold(stolen, { buyer: stranger });
            shopSold(cheap, { price: NURA });
            await pass();

            expect((await rowsAbout(stolen.id))[0]).toMatchObject({ kind: 'order-sale', db: { address: stolen.buyer.address }, chain: { address: stranger }, resolution: null });
            expect((await rowsAbout(cheap.id))[0]).toMatchObject({ kind: 'order-sale', db: { amount: cheap.price.toString() }, chain: { amount: NURA.toString() } });
            expect(await db.getRepository(ShopOrder).findOneByOrFail({ id: stolen.id })).toMatchObject({ state: 'expired' });
        });

        it('leaves an order the shop worker is still moving to it', async () =>
        {
            const sent = await order('sent');
            const quoted = await order('quoted');

            await pass();

            expect([...await rowsAbout(sent.id), ...await rowsAbout(quoted.id)]).toEqual([]);
            expect(shop.asked.filter((one) => one.startsWith('sale'))).not.toContain(`sale ${ orderIdOf(sent.id) }`);
        });
    });

    describe('a gift, against what the gifts contract holds', () =>
    {
        it('records a gift counted here that the contract does not hold, or holds as another, for a person', async () =>
        {
            const missing = await donation('confirmed');
            const other = await donation('confirmed');
            const fine = await donation('confirmed');

            tips.give(other.giver.address, tipIdOf(other.id), other.receiver.address, 9n * NURA);
            tips.give(fine.giver.address, tipIdOf(fine.id), fine.receiver.address, fine.amount);
            await pass();

            expect((await rowsAbout(missing.id))[0]).toMatchObject({ kind: 'donation-state', db: { state: 'confirmed' }, chain: { state: 'none' } });
            expect((await rowsAbout(other.id))[0]).toMatchObject({ kind: 'donation-gift', db: { amount: other.amount.toString() }, chain: { amount: (9n * NURA).toString() } });
            expect(await rowsAbout(fine.id)).toEqual([]);
        });

        it('confirms a gift the contract holds as prepared after it was let go of here, telling the player once, through the donation worker', async () =>
        {
            const late = await donation('expired');
            const replayed = await donation('reverted');

            tips.give(late.giver.address, tipIdOf(late.id), late.receiver.address, late.amount);
            tips.give(replayed.giver.address, tipIdOf(replayed.id), replayed.receiver.address, replayed.amount);
            await pass();

            expect(await db.getRepository(Donation).findOneByOrFail({ id: late.id })).toMatchObject({ state: 'confirmed', failure: null });
            expect(await db.getRepository(Donation).findOneByOrFail({ id: replayed.id })).toMatchObject({ state: 'confirmed', failure: null });
            expect(await rowsAbout(late.id)).toMatchObject([{ kind: 'donation-state', db: { state: 'expired' }, chain: { state: 'held' }, resolution: 'put-right' }]);
            expect(await db.getRepository(Notification).countBy({ userId: late.receiver.id, kind: 'donation' })).toBe(1);

            await pass();

            expect(await db.getRepository(Notification).countBy({ userId: late.receiver.id, kind: 'donation' }), 'told once').toBe(1);
        });

        it('fails a gift the contract holds as another after it was let go of here, as the worker does, and leaves a failed one be', async () =>
        {
            const swapped = await donation('expired');
            const failed = await donation('failed');

            tips.give(swapped.giver.address, tipIdOf(swapped.id), swapped.giver.address, swapped.amount);
            tips.give(failed.giver.address, tipIdOf(failed.id), failed.giver.address, failed.amount);
            await pass();

            expect(await db.getRepository(Donation).findOneByOrFail({ id: swapped.id })).toMatchObject({ state: 'failed', failure: 'mismatch' });
            expect(await rowsAbout(swapped.id)).toMatchObject([{ kind: 'donation-gift', resolution: 'put-right' }]);
            expect(await rowsAbout(failed.id)).toEqual([]);
        });
    });

    describe('a market and its positions, against the markets contract', () =>
    {
        it('writes an overturn the market worker was not asking about any more, through its own resolve', async () =>
        {
            const overturned = await market('settled');

            markets.resolve(marketIdOf(overturned.id), 'cancelled', 0, await claimTime(overturned.id));
            await pass();

            expect(await db.getRepository(Market).findOneByOrFail({ id: overturned.id })).toMatchObject({ state: 'cancelled', claimableAt: null });
            expect(await rowsAbout(overturned.id)).toMatchObject([{ kind: 'market-state', db: { state: 'settled' }, chain: { state: 'cancelled' }, resolution: 'put-right' }]);
        });

        it('records another winner, another claim time and a market nobody placed in that the chain holds, for a person', async () =>
        {
            const winner = await market('settled');
            const later = await market('settled');
            const empty = await market('empty');

            markets.resolve(marketIdOf(winner.id), 'settled', 1, await claimTime(winner.id));
            markets.resolve(marketIdOf(later.id), 'settled', 0, (await claimTime(later.id)) + 600n);
            markets.resolve(marketIdOf(empty.id), 'open');
            await pass();

            expect((await rowsAbout(winner.id))[0]).toMatchObject({
                kind: 'market-winner',
                db: { outcome: '0', backed: winner.host.handle },
                chain: { outcome: '1', backed: winner.guest.handle }
            });
            expect((await rowsAbout(later.id))[0]).toMatchObject({ kind: 'market-claimable' });
            expect((await rowsAbout(empty.id))[0]).toMatchObject({ kind: 'market-state', db: { state: 'empty' }, chain: { state: 'open' } });
            expect(await db.getRepository(Market).findOneByOrFail({ id: winner.id }), 'the outcome the server decided is not overwritten').toMatchObject({ outcome: 0 });
        });

        it('leaves a market the worker is still moving to it, one in its dispute window among them', async () =>
        {
            const taking = await market('open');
            const disputed = await market('settled', { claimableAt: new Date(Date.now() + 60_000).toISOString() });

            markets.resolve(marketIdOf(taking.id), 'cancelled');
            markets.resolve(marketIdOf(disputed.id), 'cancelled');
            await pass();

            expect([...await rowsAbout(taking.id), ...await rowsAbout(disputed.id)]).toEqual([]);
        });

        it('records a stake counted here that the chain does not hold, and one held under the ticket that is not the one prepared', async () =>
        {
            const { id } = await market('settled');
            const missing = await position(id, 'confirmed');
            const forged = await position(id, 'reverted', { failure: 'mismatch' });

            markets.resolve(marketIdOf(id), 'settled', 0, await claimTime(id));
            placed(forged, { amount: 400n * NURA, outcome: 1 });
            await pass();

            expect((await rowsAbout(missing.id))[0]).toMatchObject({ family: 'position', kind: 'position-state', db: { state: 'confirmed' }, chain: { state: 'none' } });
            expect((await rowsAbout(forged.id))[0]).toMatchObject({
                kind: 'position-ticket',
                db: { amount: forged.amount.toString(), outcome: '0' },
                chain: { amount: (400n * NURA).toString(), outcome: '1' }
            });
        });

        it('confirms a ticket the chain took after it was let go of here, and writes down a claim this server never read, through the market worker\'s own writes', async () =>
        {
            const { id } = await market('settled');
            const late = await position(id, 'expired');
            const claimed = await position(id, 'confirmed');
            const waiting = await position(id, 'confirmed', { claimHash: hex() });

            markets.resolve(marketIdOf(id), 'settled', 0, await claimTime(id));
            placed(late);
            placed(claimed, { claimed: true });
            placed(waiting, { claimed: true });
            await pass();

            expect(await db.getRepository(MarketPosition).findOneByOrFail({ id: late.id })).toMatchObject({ state: 'confirmed' });
            expect(await rowsAbout(late.id)).toMatchObject([{ kind: 'position-state', db: { state: 'expired' }, chain: { state: 'placed' }, resolution: 'put-right' }]);

            const written = await db.getRepository(MarketPosition).findOneByOrFail({ id: claimed.id });

            expect(written.claimedAt).not.toBeNull();
            expect(written.paid, 'a winner claimed by a call never read has no amount').toBeNull();
            expect(await rowsAbout(claimed.id)).toMatchObject([{ kind: 'position-claim', db: { state: 'unclaimed' }, chain: { state: 'claimed' }, resolution: 'put-right' }]);
            expect(rung).toContainEqual([claimed.bettor.id, 'markets']);
            expect(await rowsAbout(waiting.id), 'a claim on its way is the worker\'s').toEqual([]);
            expect((await db.getRepository(MarketPosition).findOneByOrFail({ id: waiting.id })).claimedAt).toBeNull();
        });

        it('records a position claimed here that the chain says nobody claimed', async () =>
        {
            const { id } = await market('settled');
            const claimed = await position(id, 'confirmed', { claimed: true });

            markets.resolve(marketIdOf(id), 'settled', 0, await claimTime(id));
            placed(claimed);
            await pass();

            expect((await rowsAbout(claimed.id))[0]).toMatchObject({ kind: 'position-claim', db: { state: 'claimed' }, chain: { state: 'unclaimed' }, resolution: null });
        });

        it('compares a position that can still be claimed however old it is, and leaves a loser past the dispute window to the week', async () =>
        {
            const settled = await market('settled');
            const cancelled = await market('cancelled');
            const loser = await position(settled.id, 'confirmed', { outcome: 1, created: '30 days' });
            const winner = await position(settled.id, 'confirmed', { outcome: 0, created: '30 days' });
            const refund = await position(cancelled.id, 'confirmed', { outcome: 1, created: '30 days' });

            markets.resolve(marketIdOf(settled.id), 'settled', 0, await claimTime(settled.id));
            markets.resolve(marketIdOf(cancelled.id), 'cancelled');
            await pass();

            expect(await rowsAbout(loser.id), 'a loser past the window can never be claimed').toEqual([]);
            expect(await kindsOf(winner.id), 'an old winner not yet claimed').toEqual(['position-state open']);
            expect(await kindsOf(refund.id), 'an old stake back not yet claimed').toEqual(['position-state open']);
        });

        it('compares an old loser while its market is inside the dispute window, which the owner may still overturn', async () =>
        {
            const disputed = await market('settled', { claimableAt: new Date(Date.now() + 60_000).toISOString() });
            const loser = await position(disputed.id, 'confirmed', { outcome: 1, created: '30 days' });

            await pass();

            expect(await kindsOf(loser.id)).toEqual(['position-state open']);
        });
    });

    describe('the contracts\' own books', () =>
    {
        it('records a contract that does not hold what it owes, with both figures, until it does', async () =>
        {
            vault.state.books = { held: 90n, owed: 100n, solvent: false };
            shop.state.books = { held: 5n, owed: 7n, solvent: false };
            markets.state.books = { held: 10n, owed: 10n, solvent: true };
            await pass();

            expect(await rowsAbout('vault')).toMatchObject([{ family: 'contract', kind: 'solvency', db: {}, chain: { held: '90', owed: '100' }, resolution: null }]);
            expect(await rowsAbout('shop')).toMatchObject([{ chain: { held: '5', owed: '7' } }]);
            expect(await rowsAbout('markets')).toEqual([]);

            vault.state.books = { held: 95n, owed: 100n, solvent: false };
            await pass();

            expect(await rowsAbout('vault'), 'one row, saying what the two sides say now').toMatchObject([{ chain: { held: '95', owed: '100' }, resolution: null }]);

            vault.state.books = { held: 100n, owed: 100n, solvent: true };
            await pass();

            expect(await rowsAbout('vault')).toMatchObject([{ resolution: 'agreed' }]);
            expect((await rowsAbout('shop'))[0].resolution).toBeNull();
        });
    });

    describe('calm', () =>
    {
        it('takes a chain it cannot reach for no disagreement, and resolves nothing it could not read', async () =>
        {
            const paid = await escrow('settled');

            vaultHolds(paid, 'refunded');
            expect((await pass()).reached, 'a pass that read every contract says so').toBe(true);
            vault.state.away = true;
            shop.state.away = true;
            tips.state.away = true;
            markets.state.away = true;

            const ghost = await escrow('open');
            const done = await pass();

            expect(await rowsAbout(ghost.id)).toEqual([]);
            expect((await rowsAbout(paid.id))[0], 'what it found stays open while it cannot ask').toMatchObject({ resolution: null });
            expect(done.faults, 'a chain out of reach is no fault').toEqual([]);
            expect(done.reached, 'and the pass says it could not reach it').toBe(false);

            vault.state.away = false;
            await pass();

            expect(await kindsOf(ghost.id)).toEqual(['escrow-state open']);
        });

        it('says it could not reach NuraChain when a contract\'s books alone could not be read, or one record alone', async () =>
        {
            const paid = await escrow('settled');
            const away = () => Promise.reject(Object.assign(new Error('the chain could not be reached'), { status: 503 }));
            const books = vault.vault.books;
            const game = vault.vault.game;

            vaultHolds(paid, 'settled');
            vault.vault.books = away;

            const unbooked = await pass();

            expect(unbooked.faults).toEqual([]);
            expect(unbooked.reached, 'the books out of reach').toBe(false);

            vault.vault.books = books;
            vault.vault.game = away;

            const unread = await pass();

            expect(unread.faults).toEqual([]);
            expect(unread.reached, 'a record out of reach').toBe(false);

            vault.vault.game = game;

            expect((await pass()).reached).toBe(true);
        });

        it('reports a record it could not compare and compares the rest', async () =>
        {
            const broken = await escrow('settled');
            const ghost = await escrow('open');
            const read = vault.vault.game;

            vault.vault.game = async (id) =>
            {
                if (id === vaultIdOf(broken.id))
                {
                    throw new Error('a node that answered nonsense');
                }

                return await read(id);
            };

            const done = await pass();

            expect(done.faults).toEqual([{ family: 'escrow', record: broken.id, error: 'a node that answered nonsense' }]);
            expect(await kindsOf(ghost.id)).toEqual(['escrow-state open']);
        });

        it('compares fifty records of a family a pass, the next fifty the pass after, and starts again at the newest', async () =>
        {
            const rows = [];

            for (let made = 0; made < AUDIT_PAGE + 5; made += 1)
            {
                rows.push(await escrow('open', { created: `${ made + 1 } minutes` }));
            }

            const first = await pass();

            expect(first.found).toBe(AUDIT_PAGE);
            expect(await rowsAbout(rows[AUDIT_PAGE + 4].id), 'the oldest waits for the next pass').toEqual([]);

            await pass();

            expect((await openRows()).length).toBe(AUDIT_PAGE + 5);
        }, 60_000);

        it('reads an open disagreement\'s record again every pass, even once it is older than the week', async () =>
        {
            const over = await escrow('settled');

            vaultHolds(over, 'refunded');
            await pass();
            await db.query(`update escrows set created_at = now() - interval '30 days' where id = $1`, [over.id]);
            vaultHolds(over, 'settled');
            await pass();

            expect(await rowsAbout(over.id)).toMatchObject([{ resolution: 'agreed' }]);
        });

        it('leaves an open disagreement about a record a worker has taken back open, and asks the chain nothing about it', async () =>
        {
            const sent = await order('sent');
            const prepared = await donation('prepared');
            const taking = await market('open');
            const settled = await market('settled');
            const claiming = await position(settled.id, 'confirmed', { claimHash: hex() });
            const read = markets.chain.positionOf;

            markets.resolve(marketIdOf(settled.id), 'settled', 0, await claimTime(settled.id));
            const asked: Hex[] = [];

            markets.chain.positionOf = async (ticket) =>
            {
                asked.push(ticket);
                return await read(ticket);
            };

            for (const [family, record, kind] of [['order', sent.id, 'order-state'], ['donation', prepared.id, 'donation-state'], ['market', taking.id, 'market-state'], ['position', claiming.id, 'position-claim']])
            {
                await db.query(`insert into discrepancies (family, record, kind, db, chain, about) values ($1, $2, $3, '{}', '{}', '{}')`, [family, record, kind]);
            }

            const done = await pass();

            expect(done.faults).toEqual([]);
            expect((await openRows()).map((row) => row.record).sort()).toEqual([sent.id, prepared.id, taking.id, claiming.id].sort());
            expect(shop.asked).not.toContain(`sale ${ orderIdOf(sent.id) }`);
            expect(tips.asked).not.toContain(`tip ${ tipIdOf(prepared.id) }`);
            expect(asked).not.toContain(marketIdOf(claiming.id));
        });

        it('compares nothing of a family whose contract this server does not keep', async () =>
        {
            open({ vault: false, shop: false, tips: false, markets: false });
            await escrow('open');
            await order('paid');

            const done = await pass();

            expect(done, 'a server that keeps no contract watches nothing, and says neither that it reached the chain nor that it could not').toEqual({ compared: 0, found: 0, resolved: 0, faults: [], reached: null });
            expect(await openRows()).toEqual([]);
        });

        it('is one pass at a time: a second asked for while one runs is that one', async () =>
        {
            await escrow('open');

            const [one, two] = await Promise.all([pass(), pass()]);

            expect(one).toBe(two);
            expect((await openRows()).length).toBe(1);
        });
    });

    describe('who reads them', () =>
    {
        const staff = async () =>
        {
            const owner = await person(OWNER_WALLET);
            const admin = await person();
            const moderator = await person();

            await ports.admin.setStaff(owner.id, { handle: admin.handle, role: 'admin', reason: 'Keeps the books' });
            await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Watches the tables' });

            return { owner, admin, moderator, player: await person() };
        };

        it('counts the open ones on the overview for a role that opens Money, and for nobody else', async () =>
        {
            const { owner, admin, moderator } = await staff();
            const ghost = await escrow('open');

            await escrow('open');
            await pass();
            vaultHolds(ghost, 'open');
            await pass();

            expect((await ports.admin.overview(owner.id))?.checks).toBe(1);
            expect((await ports.admin.overview(admin.id))?.checks).toBe(1);
            expect((await ports.admin.overview(moderator.id))?.checks).toBeUndefined();
        });

        it('leaves the count out where this server checks nothing', async () =>
        {
            open({ vault: false, shop: false, tips: false, markets: false });

            const { owner } = await staff();

            expect((await ports.admin.overview(owner.id))?.checks).toBeUndefined();
        });

        it('lists them for a role that opens Money, open ones by default, newest first, with what each side says and when it was first and last seen', async () =>
        {
            const { admin, moderator, player } = await staff();
            const older = await escrow('open');
            const newer = await order('paid');

            await pass();
            vaultHolds(older, 'open');
            await pass();

            const list = await ports.admin.checks(admin.id, {});

            expect(list?.open).toBe(1);
            expect(list?.watching).toEqual(['escrow', 'order', 'donation', 'market', 'position', 'contract']);
            expect(list?.checkedAt).toBeDefined();
            expect(list?.rows.map((row) => row.record)).toEqual([newer.id]);
            expect(list?.rows[0]).toMatchObject({ family: 'order', kind: 'order-state', db: { state: 'paid' }, chain: { state: 'unsold' }, about: { item: LOOK } });
            expect(Date.parse(list!.rows[0].lastSeen)).toBeGreaterThan(Date.parse(list!.rows[0].firstSeen));
            expect((await ports.admin.checks(admin.id, { list: 'closed' }))?.rows).toMatchObject([{ record: older.id, resolution: 'agreed' }]);
            expect((await ports.admin.checks(admin.id, { list: 'all' }))?.rows.map((row) => row.record)).toEqual([newer.id, older.id]);
            expect(await ports.admin.checks(moderator.id, {})).toBeNull();
            expect(await ports.admin.checks(player.id, {})).toBeNull();
        });

        it('pages fifty at a time, every one once, whatever the cursor says', async () =>
        {
            const { owner } = await staff();

            await db.query(
                `insert into discrepancies (family, record, kind, db, chain, about, first_seen, last_seen)
                 select 'escrow', gen_random_uuid()::text, 'escrow-state', '{"state":"open"}', '{"state":"none"}', '{}', now() - (n || ' microseconds')::interval, now()
                 from generate_series(1, 61) as n`
            );

            const first = await ports.admin.checks(owner.id, {});
            const second = await ports.admin.checks(owner.id, { cursor: first?.cursor });
            const nonsense = await ports.admin.checks(owner.id, { cursor: 'not a cursor' });
            const seen = [...first!.rows, ...second!.rows].map((row) => row.id);

            expect(first?.rows).toHaveLength(50);
            expect(second?.rows).toHaveLength(11);
            expect(second?.cursor).toBeUndefined();
            expect(new Set(seen).size).toBe(61);
            expect(nonsense?.rows.map((row) => row.id)).toEqual(first?.rows.map((row) => row.id));
        });
    });

    describe('closed by a person', () =>
    {
        const owned = async () =>
        {
            const owner = await person(OWNER_WALLET);
            const admin = await person();
            const moderator = await person();

            await ports.admin.setStaff(owner.id, { handle: admin.handle, role: 'admin', reason: 'Keeps the books' });
            await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Watches the tables' });

            return { owner, admin, moderator };
        };

        it('is closed by a role that opens Money with a reason, written to the staff\'s log in the same breath, and said', async () =>
        {
            const { admin } = await owned();
            const refunded = await order('paid');

            shopSold(refunded, { refunded: true });
            await pass();

            const [found] = await rowsAbout(refunded.id);
            const done = await ports.admin.closeCheck(admin.id, found.id, { reason: 'The owner refunded it on purpose' });

            expect(done?.open).toBe(0);
            expect(done?.check).toMatchObject({ id: found.id, resolution: 'staff', staff: admin.handle, reason: 'The owner refunded it on purpose' });
            expect(done?.check.resolvedAt).toBeDefined();
            expect((await ports.admin.log(admin.id, { kind: 'check' }))?.rows).toMatchObject([{
                kind: 'check',
                staff: admin.handle,
                staffRole: 'admin',
                reason: 'The owner refunded it on purpose',
                details: { check: found.id, family: 'order', record: refunded.id, kind: 'order-state' }
            }]);
            expect(warned('chain and database disagreement closed', refunded.id).map((one) => one.fields)).toEqual([{ family: 'order', record: refunded.id, kind: 'order-state', by: admin.handle }]);
            expect(warned('chain and database agree again', refunded.id), 'a person closing it is not the two agreeing').toEqual([]);
        });

        it('stays closed while the two sides say what they said, and opens again once either moves', async () =>
        {
            const { owner } = await owned();
            const short = (held: bigint) => ({ held, owed: 100n, solvent: false });

            vault.state.books = short(90n);
            await pass();

            const [found] = await rowsAbout('vault');

            await ports.admin.closeCheck(owner.id, found.id, { reason: 'Topping it up tonight' });
            await pass();
            await pass();

            expect(await rowsAbout('vault'), 'the same words, still closed').toMatchObject([{ id: found.id, resolution: 'staff' }]);

            vault.state.books = short(80n);
            await pass();

            const rows = await rowsAbout('vault');

            expect(rows).toHaveLength(2);
            expect(rows[1]).toMatchObject({ resolution: null, chain: { held: '80', owed: '100' } });
        });

        it('refuses one already closed in its own word, and answers a moderator, a player and an id that names nothing as nothing', async () =>
        {
            const { owner, moderator } = await owned();
            const player = await person();
            const unpaid = await order('paid');

            await pass();

            const [found] = await rowsAbout(unpaid.id);

            expect(await ports.admin.closeCheck(moderator.id, found.id, { reason: 'Not mine to close' })).toBeNull();
            expect(await ports.admin.closeCheck(player.id, found.id, { reason: 'Not mine to close' })).toBeNull();
            expect(await ports.admin.closeCheck(owner.id, 'no-such-id', { reason: 'Looked at it' })).toBeNull();
            expect(await ports.admin.closeCheck(owner.id, '00000000-0000-4000-8000-000000000000', { reason: 'Looked at it' })).toBeNull();

            await ports.admin.closeCheck(owner.id, found.id, { reason: 'Looked at it' });

            await expect(ports.admin.closeCheck(owner.id, found.id, { reason: 'Again' })).rejects.toMatchObject({ status: 409, code: 'staff-check-closed' });
            expect((await rowsAbout(unpaid.id))[0]).toMatchObject({ resolution: 'staff', reason: 'Looked at it' });
        });

        it('lets one close at a time: two closing one disagreement at once close it once', async () =>
        {
            const { owner, admin } = await owned();
            const unpaid = await order('paid');

            await pass();

            const [found] = await rowsAbout(unpaid.id);
            const gate = db.createQueryRunner();

            await gate.connect();
            await gate.startTransaction();
            await gate.query(`select id from discrepancies where id = $1 for update`, [found.id]);

            const closing = Promise.allSettled([
                ports.admin.closeCheck(owner.id, found.id, { reason: 'Mine to close' }),
                ports.admin.closeCheck(admin.id, found.id, { reason: 'Mine to close too' })
            ]);
            const deadline = Date.now() + 5000;

            while (await waitingOnLocks() < 2 && Date.now() < deadline)
            {
                await new Promise((resolve) => setTimeout(resolve, 5));
            }

            expect(await waitingOnLocks(), 'both parked on the row').toBe(2);

            await gate.commitTransaction();
            await gate.release();

            const both = await closing;

            expect(both.map((one) => one.status).sort()).toEqual(['fulfilled', 'rejected']);
            expect((await ports.admin.log(owner.id, { kind: 'check' }))?.rows).toHaveLength(1);
        });
    });

    describe('the queues the monitor reads', () =>
    {
        const sample = () => ports.jobs.sample();

        const age = (table: 'market_positions' | 'shop_orders' | 'donations' | 'escrows', column: string, id: string, minutes: number) =>
            db.query(`update ${ table } set ${ column } = now() - make_interval(mins => $2) where id = $1`, [id, minutes]);

        const finish = (matchId: string, minutes: number) =>
            db.query(`update matches set finished_at = now() - make_interval(mins => $2), outcome = 'won', deadline_at = null where id = $1`, [matchId, minutes]);

        /** A wait read by Postgres's clock a moment after it was written: at least what was written, and less than a minute more. */
        const within = (seconds: number | null | undefined, written: number) =>
        {
            expect(seconds).toBeGreaterThanOrEqual(written);
            expect(seconds).toBeLessThan(written + 60);
        };

        it('says every queue is empty, nothing is stuck and nothing is open, when that is so', async () =>
        {
            expect(await sample()).toEqual({
                queues: [
                    { queue: 'positions', count: 0, oldest: null },
                    { queue: 'claims', count: 0, oldest: null },
                    { queue: 'orders', count: 0, oldest: null },
                    { queue: 'gifts', count: 0, oldest: null },
                    { queue: 'locking', count: 0, oldest: null },
                    { queue: 'paying', count: 0, oldest: null },
                    { queue: 'markets', count: 0, oldest: null }
                ],
                stuck: 0,
                checks: { open: 0, oldest: null }
            });
        });

        it('counts what waits on each worker, and how long the oldest has, in whole seconds by Postgres\'s clock', async () =>
        {
            const live = await market('open');
            const older = await position(live.id, 'prepared');
            const newer = await position(live.id, 'prepared');
            const claiming = await position(live.id, 'confirmed', { claimHash: hex() });

            await position(live.id, 'confirmed');
            await position(live.id, 'prepared');
            await position(live.id, 'confirmed', { claimed: true, claimHash: hex() });
            await db.query(`update market_positions set state = 'sent', tx_hash = $2, created_at = now() - interval '5 minutes' where id = $1`, [older.id, hex()]);
            await db.query(`update market_positions set state = 'sent', tx_hash = $2, created_at = now() - interval '1 minute' where id = $1`, [newer.id, hex()]);
            await age('market_positions', 'claim_sent_at', claiming.id, 3);

            const sent = await order('sent');

            await order('quoted');
            await order('paid');
            await age('shop_orders', 'sent_at', sent.id, 4);

            const given = await donation('sent');

            await donation('confirmed');
            await age('donations', 'sent_at', given.id, 2);

            const locking = await escrow('locking');
            const settling = await escrow('settling');
            const refunding = await escrow('refunding');

            await escrow('open');
            await escrow('settled');
            await age('escrows', 'updated_at', locking.id, 6);
            await age('escrows', 'updated_at', settling.id, 2);
            await age('escrows', 'updated_at', refunding.id, 7);

            const ended = await market('open');
            const closing = await market('closing');
            const ahead = await market('open');
            const settled = await market('settled');

            await finish(ended.matchId, 10);
            await finish(closing.matchId, 40);
            await finish(ahead.matchId, 1);
            await finish(settled.matchId, 10);
            await db.query(`update markets set closes_at = now() + interval '1 minute' where id = $1`, [ahead.id]);
            await db.query(`update markets set closes_at = now() - interval '50 minutes' where id = $1`, [closing.id]);

            const sampled = await sample();
            const of = (queue: string) => sampled.queues.find((one) => one.queue === queue);

            expect(of('positions')?.count, 'positions handed in').toBe(2);
            within(of('positions')?.oldest, 300);
            expect(of('claims')?.count, 'claims on their way').toBe(1);
            within(of('claims')?.oldest, 180);
            expect(of('orders')?.count, 'orders handed in').toBe(1);
            within(of('orders')?.oldest, 240);
            expect(of('gifts')?.count, 'gifts handed in').toBe(1);
            within(of('gifts')?.oldest, 120);
            expect(of('locking')?.count, 'stakes being locked').toBe(1);
            within(of('locking')?.oldest, 360);
            expect(of('paying')?.count, 'games being paid out or given back').toBe(2);
            within(of('paying')?.oldest, 420);
            expect(of('markets')?.count, 'markets due, their close passed and their game over, and not settled').toBe(2);
            within(of('markets')?.oldest, 2400);
        });

        it('counts the paid games stuck by the vault panel\'s own rule', async () =>
        {
            const late = await escrow('locking');
            const erred = await escrow('refunding');
            const waited = await escrow('open');

            await escrow('settling');
            await age('escrows', 'updated_at', late.id, 11);
            await age('escrows', 'updated_at', waited.id, 30);
            await db.query(`update escrows set error = 'InsufficientBalance' where id = $1`, [erred.id]);

            expect((await sample()).stuck).toBe(2);
        });

        it('counts the disagreements still open, and how long the oldest has been', async () =>
        {
            const disagree = (minutes: number, resolved: boolean) => db.query(
                `insert into discrepancies (family, record, kind, db, chain, about, first_seen, last_seen, resolved_at, resolution)
                 values ('order', $1, 'order-state', '{}', '{}', '{}', now() - make_interval(mins => $2), now(),
                         case when $3::boolean then now() end, case when $3::boolean then 'agreed' end)`,
                [randomUUID(), minutes, resolved]
            );

            await disagree(20, false);
            await disagree(5, false);
            await disagree(90, true);

            const { checks } = await sample();

            expect(checks?.open).toBe(2);
            within(checks?.oldest, 1200);
        });

        it('reads no queue of a feature this server does not run, and no count it could not fill', async () =>
        {
            await escrow('locking');
            await order('sent');
            open({ vault: false, shop: false, tips: false, markets: false });

            expect(await sample()).toEqual({ queues: [], stuck: null, checks: null });

            open({ vault: true, shop: false, tips: false, markets: false });

            const vaultOnly = await sample();

            expect(vaultOnly.queues.map((one) => [one.queue, one.count])).toEqual([['locking', 1], ['paying', 0]]);
            expect(vaultOnly.stuck).toBe(0);
            expect(vaultOnly.checks, 'a server that compares the vault keeps its disagreements').toEqual({ open: 0, oldest: null });
        });
    });
});

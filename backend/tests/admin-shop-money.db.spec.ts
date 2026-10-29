import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { encodeFunctionData, getAddress, zeroAddress } from 'viem';

import { errorResponse } from '@azerothjs/http';

import { SHOP_ABI, itemOf, orderIdOf } from '../src/chain/shop.ts';
import { EquippedItem, OwnedItem, ShopOrder, StaffAction, User, entities } from '../src/entities/index.ts';
import { NURA } from '../src/domains/shop/catalogue.ts';
import type { OrderState } from '../src/domains/shop/policy.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import { FAKE_SELLER, FAKE_SHOP, fakeShop } from './fake-shop.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'
];

const OWNER = 5;

const BUYER_ADDRESS = '0x' + 'ab'.repeat(20);

const PRICE = 12n * NURA;

const REASON = 'It delivered nothing they did not own';

const OTHER_SELLER = getAddress('0x00000000000000000000000000000000000000bb');

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    vaultAddress: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

let rung: [string, string][] = [];

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

let db: DataSource;
let ports: Services;
let fake: ReturnType<typeof fakeShop>;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const door = (shop = fakeShop()) =>
{
    fake = shop;
    ports = buildPorts(db, CONFIG, listener, undefined, undefined, undefined, undefined, shop.shop);
};

const makeUser = async (wallet: number | null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({ handle: `m${ seq }x${ Math.floor(Math.random() * 100000) }`, displayName: `Person ${ seq }`, hue: seq % 360, kind: 'wallet' });

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, WALLETS[wallet]]
        );
    }

    return { id: made.id, handle: made.handle };
};

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return null;
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string } };

    return `${ response.status } ${ body.error.code }`;
};

const staff = async () =>
{
    const owner = await makeUser(OWNER);
    const admin = await makeUser(1);
    const moderator = await makeUser(2);

    await ports.admin.setStaff(owner.id, { handle: admin.handle, role: 'admin', reason: 'Runs the shop on weekends' });
    await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the reports' });

    return { owner, admin, moderator };
};

/** An order written by hand in `state`, paid `paidHours` hours ago when it is paid, `delivered` as given. */
const placed = async (buyer: Person, look: string, state: OrderState, extra: { paidHours?: number; delivered?: boolean; recipient?: Person } = {}) =>
{
    const paid = state === 'paid' || state === 'refunded';
    const [made] = await db.query(
        `insert into shop_orders (buyer_id, recipient_id, item_id, price, buyer_address, deadline, state, paid_at, delivered, refunded_at, failure, tx_hash, created_at)
         values ($1, $11, $2, $3, $4, now() - interval '20 minutes', $5, case when $6 then now() - $7 * interval '1 hour' end, $8, $9, null, $10, now() - interval '40 minutes') returning id`,
        [
            buyer.id,
            look,
            PRICE.toString(),
            BUYER_ADDRESS,
            state,
            paid,
            extra.paidHours ?? 1,
            paid ? extra.delivered ?? true : null,
            state === 'refunded' ? new Date() : null,
            paid ? `0x${ randomBytes(32).toString('hex') }` : null,
            (extra.recipient ?? buyer).id
        ]
    ) as { id: string }[];

    return made.id;
};

/** The shop holds the order as sold to its buyer at its price, as a mined `buy` would. */
const sold = (order: string, look: string) => fake.sell({
    order: orderIdOf(order),
    buyer: getAddress(BUYER_ADDRESS),
    item: itemOf(look),
    price: PRICE,
    referrer: zeroAddress,
    deadline: 0n
});

const refunds = async () =>
    (await db.getRepository(StaffAction).find({ where: { kind: 'shop-refund' }, order: { createdAt: 'ASC' } }))
        .map((row) => [row.staffHandle, row.staffRole, row.personHandle, row.reason, row.details]);

describe.skipIf(!active)('the shop\'s money, against a real database', () =>
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
        door();
        rung = [];
        await db.query('truncate table users cascade');
    });

    it('reads the contract\'s books with the reader\'s own wallet\'s roles for a role that opens Money, beside what waits for a person', async () =>
    {
        const { owner, admin, moderator } = await staff();
        const buyer = await makeUser(null);

        await placed(buyer, 'dice.jade', 'paid', { delivered: false });
        await placed(buyer, 'pawns.jade', 'paid');
        const asked = await placed(buyer, 'back.jade', 'paid');

        await ports.admin.shopRefund(owner.id, asked, { reason: REASON });
        fake.state.ledger = { ...fake.state.ledger, revenue: 30n * NURA, owed: 3n * NURA, held: 33n * NURA, ownerAllowed: false, pauserAllowed: true, sellerAllowed: false, chainSeller: OTHER_SELLER };

        expect(await ports.admin.shopMoney(admin.id)).toEqual({
            configured: true,
            shop: FAKE_SHOP,
            chainId: 31337,
            revenue: (30n * NURA).toString(),
            owed: (3n * NURA).toString(),
            held: (33n * NURA).toString(),
            solvent: true,
            share: 1000,
            maxShare: 3000,
            paused: false,
            seller: { address: FAKE_SELLER, allowed: false, named: OTHER_SELLER },
            roles: { owner: false, pauser: true },
            undelivered: 1,
            refunding: 1
        });
        expect(fake.asked).toContain(`ledger ${ getAddress(WALLETS[1]) }`);
        expect(await ports.admin.shopMoney(moderator.id)).toBeNull();
        expect(await ports.admin.shopMoney(buyer.id)).toBeNull();

        door(fakeShop(false));

        expect(await ports.admin.shopMoney(owner.id)).toEqual({ configured: false });
    });

    it('composes the owner\'s calls for the owner\'s own wallet, asked of the contract first, and answers an admin as nothing', async () =>
    {
        const { owner, admin } = await staff();
        const mine = getAddress(WALLETS[OWNER]);
        const next = '0x00000000000000000000000000000000000000aa';

        expect(await ports.admin.shopWithdraw(owner.id, (5n * NURA).toString())).toMatchObject({
            from: mine,
            to: FAKE_SHOP,
            data: encodeFunctionData({ abi: SHOP_ABI, functionName: 'withdraw', args: [mine, 5n * NURA] }),
            chainId: 31337
        });
        expect((await ports.admin.shopShare(owner.id, 1500))?.data).toBe(encodeFunctionData({ abi: SHOP_ABI, functionName: 'setReferralBps', args: [1500] }));
        expect((await ports.admin.shopSeller(owner.id, next))?.data).toBe(encodeFunctionData({ abi: SHOP_ABI, functionName: 'setSeller', args: [getAddress(next)] }));
        expect((await ports.admin.shopPause(owner.id, true))?.data).toBe(encodeFunctionData({ abi: SHOP_ABI, functionName: 'pause' }));
        expect((await ports.admin.shopPause(owner.id, false))?.data).toBe(encodeFunctionData({ abi: SHOP_ABI, functionName: 'unpause' }));
        expect(fake.asked).toEqual([
            `withdraw ${ mine } ${ 5n * NURA } ${ mine }`,
            `share 1500 ${ mine }`,
            `seller ${ getAddress(next) } ${ mine }`,
            `pause ${ mine }`,
            `unpause ${ mine }`
        ]);

        expect(await word(ports.admin.shopShare(owner.id, 3001))).toBe('422 staff-shop-share');
        expect(await word(ports.admin.shopShare(owner.id, -1))).toBe('422 staff-shop-share');
        expect(await word(ports.admin.shopShare(owner.id, 1.5))).toBe('422 staff-shop-share');
        expect(await word(ports.admin.shopSeller(owner.id, '0x123'))).toBe('422 staff-shop-address');
        expect(await word(ports.admin.shopSeller(owner.id, zeroAddress))).toBe('422 staff-shop-address');
        expect(await word(ports.admin.shopWithdraw(owner.id, 'all'))).toBe('422 staff-shop-amount');
        expect(await word(ports.admin.shopWithdraw(owner.id, '0'))).toBe('422 staff-shop-amount');

        fake.state.ownerRefuse = 'InsufficientRevenue';
        expect(await word(ports.admin.shopWithdraw(owner.id, (900n * NURA).toString()))).toBe('409 staff-shop-revenue');
        fake.state.ownerRefuse = 'AccessControlUnauthorizedAccount';
        expect(await word(ports.admin.shopPause(owner.id, true))).toBe('409 staff-shop-role');
        fake.state.ownerRefuse = 'EnforcedPause';
        expect(await word(ports.admin.shopPause(owner.id, true))).toBe('409 staff-shop-paused');
        fake.state.ownerRefuse = 'ExpectedPause';
        expect(await word(ports.admin.shopPause(owner.id, false))).toBe('409 staff-shop-running');
        fake.state.ownerRefuse = 'SomethingNew';
        expect(await word(ports.admin.shopShare(owner.id, 10))).toBe('409 staff-shop-refused');
        fake.state.ownerRefuse = null;

        expect(await ports.admin.shopWithdraw(admin.id, '1')).toBeNull();
        expect(await ports.admin.shopShare(admin.id, 10)).toBeNull();
        expect(await ports.admin.shopSeller(admin.id, next)).toBeNull();
        expect(await ports.admin.shopPause(admin.id, true)).toBeNull();

        door(fakeShop(false));

        expect(await word(ports.admin.shopWithdraw(owner.id, '1'))).toBe('409 staff-shop-off');
    });

    it('asks NuraChain to refund a paid order for its payer and writes the request to the log, and refuses an order that is not paid', async () =>
    {
        const { owner, admin } = await staff();
        const buyer = await makeUser(null);
        const paid = await placed(buyer, 'dice.jade', 'paid', { delivered: false });
        const quoted = await placed(buyer, 'pawns.jade', 'quoted');
        const call = await ports.admin.shopRefund(owner.id, paid, { reason: REASON });

        expect(call).toMatchObject({ from: getAddress(WALLETS[OWNER]), to: FAKE_SHOP, data: encodeFunctionData({ abi: SHOP_ABI, functionName: 'refund', args: [orderIdOf(paid)] }) });
        expect(await refunds()).toEqual([[owner.handle, 'owner', buyer.handle, REASON, { order: paid, item: 'dice.jade', price: PRICE.toString() }]]);
        expect((await ports.admin.shopOrders(owner.id, {}))?.rows.find((one) => one.id === paid)?.refundAsked).toEqual(expect.any(String));
        expect((await ports.admin.shopOrders(owner.id, {}))?.rows.find((one) => one.id === quoted)).not.toHaveProperty('refundAsked');
        expect(await db.getRepository(ShopOrder).findOneByOrFail({ id: paid })).toMatchObject({ state: 'paid' });

        expect(await word(ports.admin.shopRefund(owner.id, quoted, { reason: REASON }))).toBe('409 staff-order-unpaid');
        expect(fake.asked, 'NuraChain asked nothing about an order that is not paid').not.toContain(`refund ${ orderIdOf(quoted) } ${ getAddress(WALLETS[OWNER]) }`);
        expect(await ports.admin.shopRefund(owner.id, 'not-an-order', { reason: REASON })).toBeNull();
        expect(await ports.admin.shopRefund(owner.id, '0a6a3f0e-1111-4222-8333-444455556666', { reason: REASON })).toBeNull();
        expect(await ports.admin.shopRefund(admin.id, paid, { reason: REASON })).toBeNull();

        fake.state.ownerRefuse = 'AlreadyRefunded';

        expect(await word(ports.admin.shopRefund(owner.id, paid, { reason: REASON }))).toBe('409 staff-shop-refunded');
        expect(await refunds()).toHaveLength(1);
    });

    it('writes nothing for an order the worker marked refunded while NuraChain was being asked', async () =>
    {
        const { owner } = await staff();
        const buyer = await makeUser(null);
        const order = await placed(buyer, 'dice.jade', 'paid');
        const asked = fake.shop.refundCall;

        fake.shop.refundCall = async (from, id) =>
        {
            await db.query(`update shop_orders set state = 'refunded', refunded_at = now() where id = $1`, [order]);
            return await asked(from, id);
        };

        try
        {
            expect(await word(ports.admin.shopRefund(owner.id, order, { reason: REASON }))).toBe('409 staff-order-unpaid');
            expect(await refunds()).toEqual([]);
        }
        finally
        {
            fake.shop.refundCall = asked;
        }
    });

    it('takes back what a paid order delivered once NuraChain has refunded it, and asks about it only for a day after the owner asked', async () =>
    {
        const { owner } = await staff();
        const buyer = await makeUser(null);
        const order = await placed(buyer, 'decoration.jade', 'paid');

        await db.getRepository(OwnedItem).insert({ userId: buyer.id, itemId: 'decoration.jade', via: 'purchase', orderId: order, giverId: null });
        await db.getRepository(EquippedItem).insert({ userId: buyer.id, slot: 'profile.decoration', itemId: 'decoration.jade' });
        sold(order, 'decoration.jade');

        expect(await ports.jobs.sweepShop(10_000)).toEqual({ paid: 0, refunded: 0, failed: 0, expired: 0, faults: [] });
        expect(fake.asked, 'a paid order nobody asked to refund').not.toContain(`sale ${ orderIdOf(order) }`);

        await ports.admin.shopRefund(owner.id, order, { reason: REASON });

        expect((await ports.jobs.sweepShop(10_000)).refunded, 'asked, and not refunded yet').toBe(0);
        expect(fake.asked).toContain(`sale ${ orderIdOf(order) }`);
        expect(await db.getRepository(OwnedItem).countBy({ orderId: order })).toBe(1);

        fake.refund(orderIdOf(order));
        rung = [];

        expect((await ports.jobs.sweepShop(10_000)).refunded).toBe(1);
        expect(await db.getRepository(ShopOrder).findOneByOrFail({ id: order })).toMatchObject({ state: 'refunded', refundedAt: expect.any(Date), delivered: true });
        expect(await db.getRepository(OwnedItem).countBy({ orderId: order })).toBe(0);
        expect(await db.getRepository(EquippedItem).countBy({ userId: buyer.id })).toBe(0);
        expect(rung).toEqual([[buyer.id, 'shop'], [buyer.id, 'profile']]);
        expect((await ports.jobs.sweepShop(10_000)).refunded, 'refunded once').toBe(0);

        const later = await placed(buyer, 'dice.jade', 'paid');

        sold(later, 'dice.jade');
        await ports.admin.shopRefund(owner.id, later, { reason: REASON });
        await db.query(`update staff_actions set created_at = now() - interval '25 hours' where kind = 'shop-refund' and details ->> 'order' = $1`, [later]);
        fake.asked.length = 0;
        await ports.jobs.sweepShop(10_000);

        expect(fake.asked, 'a request older than a day').not.toContain(`sale ${ orderIdOf(later) }`);
    });

    it('lists the paid orders that delivered nothing, and none refunded since', async () =>
    {
        const { owner } = await staff();
        const buyer = await makeUser(null);
        const nothing = await placed(buyer, 'dice.jade', 'paid', { delivered: false });

        await placed(buyer, 'pawns.jade', 'paid');
        await placed(buyer, 'back.jade', 'quoted');
        await placed(buyer, 'face.jade', 'refunded', { delivered: false });

        expect((await ports.admin.shopOrders(owner.id, { delivered: 'no' }))?.rows.map((one) => one.id)).toEqual([nothing]);
        expect((await ports.admin.shopOrders(owner.id, {}))?.rows).toHaveLength(4);
    });

    it('refunds a gift to whoever paid for it, takes the look back from whoever was given it, and rings no profile for a look worn at a table', async () =>
    {
        const { owner } = await staff();
        const buyer = await makeUser(null);
        const friend = await makeUser(null);
        const gift = await placed(buyer, 'dice.storm', 'paid', { recipient: friend });

        await db.getRepository(OwnedItem).insert({ userId: friend.id, itemId: 'dice.storm', via: 'gift', orderId: gift, giverId: buyer.id });
        await db.getRepository(EquippedItem).insert({ userId: friend.id, slot: 'ludo.dice', itemId: 'dice.storm' });
        sold(gift, 'dice.storm');
        await ports.admin.shopRefund(owner.id, gift, { reason: REASON });

        expect((await refunds()).map((row) => row[2]), 'the payer is who the money goes back to').toEqual([buyer.handle]);

        fake.refund(orderIdOf(gift));
        rung = [];

        expect((await ports.jobs.sweepShop(10_000)).refunded).toBe(1);
        expect(await db.getRepository(OwnedItem).countBy({ userId: friend.id })).toBe(0);
        expect(await db.getRepository(EquippedItem).countBy({ userId: friend.id })).toBe(0);
        expect(rung).toEqual([[buyer.id, 'shop'], [friend.id, 'shop']]);
        expect((await ports.admin.shopOrders(owner.id, {}))?.rows.find((one) => one.id === gift), 'a refund asked is said of a paid order alone').not.toHaveProperty('refundAsked');
    });

    it('counts the shop\'s sales on the overview for a role that opens Money, by Postgres\'s clock, and nothing where the shop is not open', async () =>
    {
        const { owner, admin, moderator } = await staff();
        const buyer = await makeUser(null);

        await placed(buyer, 'dice.jade', 'paid', { paidHours: 2 });
        await placed(buyer, 'pawns.jade', 'paid', { paidHours: 72, delivered: false });
        await placed(buyer, 'back.jade', 'paid', { paidHours: 24 * 30 });
        await placed(buyer, 'face.jade', 'refunded', { paidHours: 1 });
        await placed(buyer, 'felt.jade', 'quoted');

        expect((await ports.admin.overview(owner.id))?.shop).toEqual({ day: PRICE.toString(), week: (2n * PRICE).toString(), all: (3n * PRICE).toString(), undelivered: 1 });
        expect((await ports.admin.overview(admin.id))?.shop).toEqual({ day: PRICE.toString(), week: (2n * PRICE).toString(), all: (3n * PRICE).toString(), undelivered: 1 });
        expect(await ports.admin.overview(moderator.id)).not.toHaveProperty('shop');

        door(fakeShop(false));

        expect(await ports.admin.overview(owner.id)).not.toHaveProperty('shop');
    });
});

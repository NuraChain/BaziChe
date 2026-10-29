import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';

import { errorResponse } from '@azerothjs/http';

import { EquippedItem, OwnedItem, ShopItem, StaffAction, User, entities } from '../src/entities/index.ts';
import { BUNDLES, FEATURED_FIRST, LOOKS, NURA, SHOP_COLLECTIONS, SHOP_KINDS } from '../src/domains/shop/catalogue.ts';
import { SHOP_ORDERS_PAGE } from '../src/domains/admin/roles.ts';
import type { OrderState } from '../src/domains/shop/policy.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

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

const ADDRESS = '0x' + 'ab'.repeat(20);

const PRICE = (12n * NURA).toString();

const REASON = 'Pricing the looks for the launch week';

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
let seq = 0;

interface Person
{
    id: string;
    handle: string;
    displayName: string;
    hue: number;
}

const makeUser = async (wallet: number | null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `s${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Person ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, WALLETS[wallet]]
        );
    }

    return { id: made.id, handle: made.handle, displayName: made.displayName, hue: made.hue };
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

    await ports.admin.setStaff(owner.id, { handle: admin.handle, role: 'admin', reason: 'Runs the shop on weekends' });

    return { owner, admin };
};

const listed = (id: string) => ([...LOOKS, ...BUNDLES].find((item) => item.id === id)?.price ?? 0n).toString();

const nura = (whole: bigint) => (whole * NURA).toString();

const item = (id: string) => db.getRepository(ShopItem).findOneByOrFail({ id });

const shopActions = async () =>
    (await db.getRepository(StaffAction).find({ where: [{ kind: 'shop-item' }, { kind: 'shop-feature' }, { kind: 'shop-grant' }, { kind: 'shop-revoke' }], order: { createdAt: 'ASC' } }))
        .map((row) => [row.staffHandle, row.staffRole, row.kind, row.personHandle, row.reason, row.details]);

/** An order written by hand in `state`, placed `ago` minutes ago, a gift when it names somebody `for`. */
const placed = async (buyer: Person, look: string, state: OrderState, extra: { for?: Person; ago?: number } = {}) =>
{
    const paid = state === 'paid' || state === 'refunded';
    const hash = state === 'sent' || paid ? `0x${ randomBytes(32).toString('hex') }` : null;
    const [made] = await db.query(
        `insert into shop_orders (buyer_id, recipient_id, item_id, price, buyer_address, deadline, state, paid_at, delivered, refunded_at, failure, tx_hash, created_at)
         values ($1, $2, $3, $4, $5, now() + interval '20 minutes', $6, $7, $8, $9, $10, $11, now() - $12 * interval '1 minute') returning id`,
        [
            buyer.id,
            (extra.for ?? buyer).id,
            look,
            PRICE,
            ADDRESS,
            state,
            paid ? new Date() : null,
            paid ? true : null,
            state === 'refunded' ? new Date() : null,
            state === 'failed' ? 'EnforcedPause' : null,
            hash,
            extra.ago ?? 0
        ]
    ) as { id: string }[];

    return { id: made.id, hash };
};

/** Every look and bundle at the catalogue's price and on sale, and the first collection featured, as the seed leaves them. */
const restore = async () =>
{
    const items = [...LOOKS, ...BUNDLES];

    await db.query(
        `update shop_items s set price = item.price, sale_price = null, sale_until = null, status = 'on-sale'
         from unnest($1::text[], $2::numeric[]) as item(id, price) where s.id = item.id`,
        [items.map((one) => one.id), items.map((one) => one.price.toString())]
    );
    await db.query(`update shop_collections set featured_at = case when id = $1 then now() end`, [FEATURED_FIRST]);
};

const waitingOnLocks = async () =>
    (await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ) as { count: number }[])[0].count;

const parked = async (count: number) =>
{
    const deadline = Date.now() + 5000;

    while (await waitingOnLocks() < count && Date.now() < deadline)
    {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return await waitingOnLocks();
};

describe.skipIf(!active)('Admin › Shop, against a real database', () =>
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
            await restore();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        rung = [];
        await db.query('truncate table users cascade');
        await restore();
    });

    it('lists every look and bundle in the catalogue\'s order with its price, the catalogue\'s, a sale while one runs, its status and how many were sold', async () =>
    {
        const { owner, admin } = await staff();
        const buyer = await makeUser(null);

        await placed(buyer, 'dice.inferno', 'paid');
        await placed(buyer, 'dice.inferno', 'refunded');
        await placed(buyer, 'dice.inferno', 'quoted');
        await placed(buyer, 'bundle.jade', 'paid');
        await db.query(`update shop_items set sale_price = price / 2, sale_until = now() + interval '1 hour' where id = 'pawns.jade'`);
        await db.query(`update shop_items set sale_price = price / 2, sale_until = now() - interval '1 second' where id = 'back.oni'`);
        await db.query(`update shop_items set status = 'retired' where id = 'felt.gold'`);

        const shop = await ports.admin.shop(admin.id);
        const byId = new Map(shop?.items.map((one) => [one.id, one]));
        const running = await item('pawns.jade');

        expect(shop?.featured).toBe(FEATURED_FIRST);
        expect(shop?.items.map((one) => one.id)).toEqual(SHOP_COLLECTIONS.flatMap((collection) => [...SHOP_KINDS.map((kind) => `${ kind }.${ collection }`), `bundle.${ collection }`]));
        expect(shop?.items.every((one) => one.price === one.listed && one.listed === listed(one.id))).toBe(true);
        expect(byId.get('dice.inferno')).toEqual({ id: 'dice.inferno', price: listed('dice.inferno'), listed: listed('dice.inferno'), status: 'on-sale', sold: 1 });
        expect(byId.get('bundle.jade')?.sold).toBe(1);
        expect(byId.get('pawns.jade')?.sale).toEqual({ price: (BigInt(listed('pawns.jade')) / 2n).toString(), until: running.saleUntil?.toISOString() });
        expect(byId.get('back.oni')).not.toHaveProperty('sale');
        expect(byId.get('felt.gold')?.status).toBe('retired');
        expect(await ports.admin.shop(owner.id)).toEqual(shop);
    });

    it('answers a moderator, a player and a suspended admin as a page that is not there, and changes nothing for them', async () =>
    {
        const { owner, admin } = await staff();
        const moderator = await makeUser(2);
        const player = await makeUser(null);

        await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the reports' });
        await db.getRepository(User).update({ id: admin.id }, { isSuspended: true });

        for (const who of [moderator, player, admin])
        {
            expect(await ports.admin.shop(who.id)).toBeNull();
            expect(await ports.admin.shopItem(who.id, 'dice.glow', { price: nura(1n), reason: REASON })).toBeNull();
            expect(await ports.admin.shopFeature(who.id, { collection: 'jade', reason: REASON })).toBeNull();
            expect(await ports.admin.shopOrders(who.id, {})).toBeNull();
        }

        expect((await item('dice.glow')).price).toBe(listed('dice.glow'));
        expect((await ports.admin.shop(owner.id))?.featured).toBe(FEATURED_FIRST);
        expect(await shopActions()).toEqual([]);
    });

    it('changes a look\'s price with a reason, which the shop then charges, and writes nothing for a price it already has', async () =>
    {
        const { admin } = await staff();
        const to = nura(7n);
        const shop = await ports.admin.shopItem(admin.id, 'dice.glow', { price: to, reason: REASON });

        expect(shop?.items.find((one) => one.id === 'dice.glow')).toMatchObject({ price: to, listed: listed('dice.glow') });
        expect((await ports.shop.state(admin.id)).items.find((one) => one.id === 'dice.glow')?.price).toBe(to);
        expect(await ports.admin.shopItem(admin.id, 'dice.glow', { price: to, reason: 'Pressed it again' })).toEqual(shop);
        expect(await shopActions()).toEqual([
            [admin.handle, 'admin', 'shop-item', null, REASON, { item: 'dice.glow', field: 'price', from: listed('dice.glow'), to }]
        ]);
    });

    it('keeps a price above a sale that runs, and lets a sale that ran out go with a price under it', async () =>
    {
        const { admin } = await staff();
        const sale = nura(5n);

        await ports.admin.shopItem(admin.id, 'pawns.glow', { sale: { price: sale, hours: 24 }, reason: REASON });

        expect(await word(ports.admin.shopItem(admin.id, 'pawns.glow', { price: sale, reason: REASON }))).toBe('409 staff-shop-sale');
        expect(await word(ports.admin.shopItem(admin.id, 'pawns.glow', { price: nura(4n), reason: REASON }))).toBe('409 staff-shop-sale');
        expect((await item('pawns.glow')).price).toBe(listed('pawns.glow'));

        const above = await ports.admin.shopItem(admin.id, 'pawns.glow', { price: nura(6n), reason: REASON });

        expect(above?.items.find((one) => one.id === 'pawns.glow')).toMatchObject({ price: nura(6n), sale: { price: sale } });

        await db.query(`update shop_items set sale_until = now() - interval '1 second' where id = 'pawns.glow'`);

        const under = await ports.admin.shopItem(admin.id, 'pawns.glow', { price: nura(2n), reason: 'Cheaper for good' });

        expect(under?.items.find((one) => one.id === 'pawns.glow')).toEqual({ id: 'pawns.glow', price: nura(2n), listed: listed('pawns.glow'), status: 'on-sale', sold: 0 });
        expect(await item('pawns.glow')).toMatchObject({ salePrice: null, saleUntil: null });
    });

    it('puts a look on sale for the hours asked, which the shop then prices it at, and ends the sale, each written to the log', async () =>
    {
        const { owner, admin } = await staff();
        const price = listed('back.glow');
        const sale = (BigInt(price) / 2n).toString();
        const cheaper = (BigInt(price) / 4n).toString();
        const shop = await ports.admin.shopItem(admin.id, 'back.glow', { sale: { price: sale, hours: 72 }, reason: REASON });
        const [ahead] = await db.query(`select extract(epoch from sale_until - now()) / 3600 as hours from shop_items where id = 'back.glow'`) as { hours: string }[];

        expect(Number(ahead.hours)).toBeGreaterThan(71.9);
        expect(Number(ahead.hours)).toBeLessThanOrEqual(72);
        expect(shop?.items.find((one) => one.id === 'back.glow')?.sale?.price).toBe(sale);
        expect((await ports.shop.state(admin.id)).items.find((one) => one.id === 'back.glow')?.sale?.price).toBe(sale);

        await ports.admin.shopItem(owner.id, 'back.glow', { sale: { price: cheaper, hours: 1 }, reason: 'Cheaper for the evening' });

        expect(await word(ports.admin.shopItem(admin.id, 'back.glow', { sale: { price, hours: 1 }, reason: REASON }))).toBe('409 staff-shop-sale');

        const ended = await ports.admin.shopItem(admin.id, 'back.glow', { sale: false, reason: 'The weekend is over' });

        expect(ended?.items.find((one) => one.id === 'back.glow')).not.toHaveProperty('sale');
        expect(await item('back.glow')).toMatchObject({ salePrice: null, saleUntil: null });
        expect(await ports.admin.shopItem(admin.id, 'back.glow', { sale: false, reason: 'Pressed it again' })).toEqual(ended);
        expect(await shopActions()).toEqual([
            [admin.handle, 'admin', 'shop-item', null, REASON, { item: 'back.glow', field: 'sale', to: sale, hours: '72' }],
            [owner.handle, 'owner', 'shop-item', null, 'Cheaper for the evening', { item: 'back.glow', field: 'sale', from: sale, to: cheaper, hours: '1' }],
            [admin.handle, 'admin', 'shop-item', null, 'The weekend is over', { item: 'back.glow', field: 'sale', from: cheaper }]
        ]);
    });

    it('takes a look out of the shop, hidden or retired, and puts it back, and the shop offers it only while it is on sale', async () =>
    {
        const { owner, admin } = await staff();
        const offered = async () => (await ports.shop.state(admin.id)).items.map((one) => one.id);

        await ports.admin.shopItem(admin.id, 'chips.neon', { status: 'hidden', reason: REASON });

        expect(await offered()).not.toContain('chips.neon');

        await ports.admin.shopItem(admin.id, 'chips.neon', { status: 'retired', reason: 'Not coming back' });

        expect(await offered()).not.toContain('chips.neon');

        const back = await ports.admin.shopItem(owner.id, 'chips.neon', { status: 'on-sale', reason: 'Back by request' });

        expect(back?.items.find((one) => one.id === 'chips.neon')?.status).toBe('on-sale');
        expect(await offered()).toContain('chips.neon');
        expect(await ports.admin.shopItem(owner.id, 'chips.neon', { status: 'on-sale', reason: 'Pressed it again' })).toEqual(back);
        expect(await shopActions()).toEqual([
            [admin.handle, 'admin', 'shop-item', null, REASON, { item: 'chips.neon', field: 'status', from: 'on-sale', to: 'hidden' }],
            [admin.handle, 'admin', 'shop-item', null, 'Not coming back', { item: 'chips.neon', field: 'status', from: 'hidden', to: 'retired' }],
            [owner.handle, 'owner', 'shop-item', null, 'Back by request', { item: 'chips.neon', field: 'status', from: 'retired', to: 'on-sale' }]
        ]);
    });

    it('changes one thing at a time, and answers an id the shop does not hold as a page that is not there', async () =>
    {
        const { admin } = await staff();

        expect(await word(ports.admin.shopItem(admin.id, 'dice.glow', { price: nura(3n), status: 'hidden', reason: REASON }))).toBe('422 staff-shop-one');
        expect(await word(ports.admin.shopItem(admin.id, 'dice.glow', { sale: false, status: 'hidden', reason: REASON }))).toBe('422 staff-shop-one');
        expect(await word(ports.admin.shopItem(admin.id, 'dice.glow', { reason: REASON }))).toBe('422 staff-shop-one');
        expect(await ports.admin.shopItem(admin.id, 'dice.nothing', { price: nura(3n), reason: REASON })).toBeNull();
        expect(await ports.admin.shopItem(admin.id, 'x'.repeat(60), { status: 'hidden', reason: REASON })).toBeNull();
        expect(await item('dice.glow')).toMatchObject({ price: listed('dice.glow'), status: 'on-sale' });
        expect(await shopActions()).toEqual([]);
    });

    it('features a collection with a reason, which the shop then leads with, and writes nothing for the one already featured', async () =>
    {
        const { owner, admin } = await staff();
        const shop = await ports.admin.shopFeature(admin.id, { collection: 'jade', reason: REASON });

        expect(shop?.featured).toBe('jade');
        expect((await ports.shop.state(admin.id)).featured).toBe('jade');
        expect(await ports.admin.shopFeature(owner.id, { collection: 'jade', reason: 'Pressed it again' })).toEqual(shop);

        await ports.admin.shopFeature(owner.id, { collection: 'glow', reason: 'Back to the light' });

        expect((await ports.shop.state(admin.id)).featured).toBe('glow');
        expect(await shopActions()).toEqual([
            [admin.handle, 'admin', 'shop-feature', null, REASON, { from: FEATURED_FIRST, to: 'jade' }],
            [owner.handle, 'owner', 'shop-feature', null, 'Back to the light', { from: 'jade', to: 'glow' }]
        ]);
    });

    it('features the newest choice though the one before it carries a later time', async () =>
    {
        const { admin } = await staff();

        await db.query(`update shop_collections set featured_at = now() + interval '1 minute' where id = 'storm'`);

        expect((await ports.shop.state(admin.id)).featured).toBe('storm');

        await ports.admin.shopFeature(admin.id, { collection: 'frost', reason: REASON });

        expect((await ports.shop.state(admin.id)).featured).toBe('frost');
        expect((await ports.admin.shop(admin.id))?.featured).toBe('frost');
    });

    it('writes two changes to one look one after the other when they are made at once', async () =>
    {
        const { owner, admin } = await staff();
        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select id from shop_items where id = 'dice.glow' for update`);

        const both = Promise.all([
            ports.admin.shopItem(admin.id, 'dice.glow', { price: nura(6n), reason: REASON }),
            ports.admin.shopItem(owner.id, 'dice.glow', { price: nura(7n), reason: 'Seven is the price' })
        ]);
        const waited = await parked(2);

        await gate.commitTransaction();
        await gate.release();
        await both;

        const changes = (await shopActions()).map((row) => row[5] as Record<string, string>);
        const first = changes.find((one) => one.from === listed('dice.glow'));
        const second = changes.find((one) => one !== first);

        expect(waited).toBe(2);
        expect(changes).toHaveLength(2);
        expect(second?.from).toBe(first?.to);
        expect((await item('dice.glow')).price).toBe(second?.to);
    });

    it('features one collection after the other when two are chosen at once', async () =>
    {
        const { owner, admin } = await staff();
        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select id from shop_collections where id = 'astral' for update`);

        const both = Promise.all([
            ports.admin.shopFeature(admin.id, { collection: 'jade', reason: REASON }),
            ports.admin.shopFeature(owner.id, { collection: 'frost', reason: 'Frost for the winter' })
        ]);
        const waited = await parked(2);

        await gate.commitTransaction();
        await gate.release();
        await both;

        const choices = (await shopActions()).map((row) => row[5] as Record<string, string>);
        const first = choices.find((one) => one.from === FEATURED_FIRST);
        const second = choices.find((one) => one !== first);

        expect(waited).toBe(2);
        expect(choices).toHaveLength(2);
        expect(second?.from).toBe(first?.to);
        expect((await ports.admin.shop(owner.id))?.featured).toBe(second?.to);
    });

    it('gives somebody the reader outranks a look, which their page then lists and their collection hears of, and nothing for one they own already', async () =>
    {
        const { owner, admin } = await staff();
        const player = await makeUser(null);
        const wearer = await makeUser(null);

        await db.getRepository(OwnedItem).insert({ userId: wearer.id, itemId: 'dice.jade', via: 'purchase', orderId: null, giverId: null });
        await db.getRepository(EquippedItem).insert({ userId: wearer.id, slot: 'ludo.dice', itemId: 'dice.jade' });

        const person = await ports.admin.giveLook(admin.id, player.handle, { item: 'dice.jade', reason: 'For winning the cup' });

        expect(person?.looks).toEqual([{ item: 'dice.jade', via: 'grant', at: expect.any(String), worn: false }]);
        expect(person?.history[0]).toMatchObject({ kind: 'shop-grant', staff: admin.handle, person: player.handle, reason: 'For winning the cup', details: { item: 'dice.jade' } });
        expect(await db.getRepository(OwnedItem).findOneBy({ userId: player.id, itemId: 'dice.jade' })).toMatchObject({ via: 'grant', orderId: null, giverId: null });
        expect(rung).toEqual([[player.id, 'shop']]);
        expect(await shopActions()).toEqual([[admin.handle, 'admin', 'shop-grant', player.handle, 'For winning the cup', { item: 'dice.jade' }]]);

        rung = [];

        const again = await ports.admin.giveLook(owner.id, player.handle, { item: 'dice.jade', reason: 'Pressed it again' });

        expect(again?.looks).toEqual(person?.looks);
        expect(rung).toEqual([]);
        expect(await shopActions()).toHaveLength(1);
    });

    it('gives only a look, never a bundle or a look the catalogue does not have, and nothing over a look they bought', async () =>
    {
        const { admin } = await staff();
        const player = await makeUser(null);

        await db.getRepository(OwnedItem).insert({ userId: player.id, itemId: 'back.oni', via: 'purchase', orderId: null, giverId: null });

        expect(await ports.admin.giveLook(admin.id, player.handle, { item: 'bundle.jade', reason: 'The whole set' })).toBeNull();
        expect(await ports.admin.giveLook(admin.id, player.handle, { item: 'dice.nothing', reason: 'A look we never drew' })).toBeNull();
        expect((await ports.admin.giveLook(admin.id, player.handle, { item: 'back.oni', reason: 'They have it' }))?.looks).toEqual([{ item: 'back.oni', via: 'purchase', at: expect.any(String), worn: false }]);
        expect(await db.getRepository(OwnedItem).findOneBy({ userId: player.id, itemId: 'back.oni' })).toMatchObject({ via: 'purchase' });
        expect(await shopActions()).toEqual([]);
    });

    it('gives one look once when two of the staff give it at once', async () =>
    {
        const { owner, admin } = await staff();
        const player = await makeUser(null);
        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query('select id from users where id = $1 for update', [player.id]);

        const both = Promise.all([
            ports.admin.giveLook(admin.id, player.handle, { item: 'dice.jade', reason: 'For winning the cup' }),
            ports.admin.giveLook(owner.id, player.handle, { item: 'dice.jade', reason: 'For the cup as well' })
        ]);
        const waited = await parked(2);

        await gate.commitTransaction();
        await gate.release();
        await both;

        expect(waited).toBe(2);
        expect(await db.getRepository(OwnedItem).countBy({ userId: player.id })).toBe(1);
        expect(await shopActions()).toHaveLength(1);
    });

    it('leaves a look bought while the gift waited as bought, and writes nothing for the gift', async () =>
    {
        const { admin } = await staff();
        const player = await makeUser(null);
        const delivery = db.createQueryRunner();

        await delivery.connect();
        await delivery.startTransaction();
        await delivery.manager.getRepository(OwnedItem).insert({ userId: player.id, itemId: 'dice.jade', via: 'purchase', orderId: null, giverId: null });

        const gift = ports.admin.giveLook(admin.id, player.handle, { item: 'dice.jade', reason: 'For winning the cup' });
        const waited = await parked(1);

        await delivery.commitTransaction();
        await delivery.release();

        expect(waited).toBe(1);
        expect((await gift)?.looks).toEqual([{ item: 'dice.jade', via: 'purchase', at: expect.any(String), worn: false }]);
        expect(await shopActions()).toEqual([]);
    });

    it('takes back a look the staff gave, off everywhere it was worn, and rings the profile when it was worn there', async () =>
    {
        const { admin } = await staff();
        const player = await makeUser(null);

        await ports.admin.giveLook(admin.id, player.handle, { item: 'dice.jade', reason: 'For winning the cup' });
        await ports.admin.giveLook(admin.id, player.handle, { item: 'decoration.jade', reason: 'For winning the cup' });

        expect((await ports.admin.person(admin.id, player.handle))?.looks.map((one) => one.item)).toEqual(['decoration.jade', 'dice.jade']);

        await db.getRepository(EquippedItem).insert([
            { userId: player.id, slot: 'ludo.dice', itemId: 'dice.jade' },
            { userId: player.id, slot: 'backgammon.dice', itemId: 'dice.jade' },
            { userId: player.id, slot: 'profile.decoration', itemId: 'decoration.jade' }
        ]);
        rung = [];

        const dice = await ports.admin.takeLook(admin.id, player.handle, 'dice.jade', { reason: 'Given by mistake' });

        expect(dice?.looks.map((one) => [one.item, one.worn])).toEqual([['decoration.jade', true]]);
        expect(dice?.history[0]).toMatchObject({ kind: 'shop-revoke', person: player.handle, details: { item: 'dice.jade' } });
        expect(await db.getRepository(EquippedItem).findBy({ userId: player.id, itemId: 'dice.jade' })).toEqual([]);
        expect(rung).toEqual([[player.id, 'shop']]);

        rung = [];
        await ports.admin.takeLook(admin.id, player.handle, 'decoration.jade', { reason: 'Given by mistake' });

        expect(rung).toEqual([[player.id, 'shop'], [player.id, 'profile']]);

        rung = [];

        const none = await ports.admin.takeLook(admin.id, player.handle, 'decoration.jade', { reason: 'Pressed it again' });

        expect(none?.looks).toEqual([]);
        expect(rung).toEqual([]);
        expect((await shopActions()).map((row) => [row[2], row[5]])).toEqual([
            ['shop-grant', { item: 'dice.jade' }],
            ['shop-grant', { item: 'decoration.jade' }],
            ['shop-revoke', { item: 'dice.jade' }],
            ['shop-revoke', { item: 'decoration.jade' }]
        ]);
    });

    it('takes a look back once when two of the staff take it at once', async () =>
    {
        const { owner, admin } = await staff();
        const player = await makeUser(null);

        await ports.admin.giveLook(admin.id, player.handle, { item: 'dice.jade', reason: 'For winning the cup' });

        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select item_id from owned_items where user_id = $1 and item_id = 'dice.jade' for update`, [player.id]);

        const both = Promise.all([
            ports.admin.takeLook(admin.id, player.handle, 'dice.jade', { reason: 'Given by mistake' }),
            ports.admin.takeLook(owner.id, player.handle, 'dice.jade', { reason: 'Given to the wrong person' })
        ]);
        const waited = await parked(2);

        await gate.commitTransaction();
        await gate.release();
        await both;

        expect(waited).toBe(2);
        expect((await shopActions()).map((row) => row[2])).toEqual(['shop-grant', 'shop-revoke']);
    });

    it('keeps a look bought or given by a friend with its owner for good', async () =>
    {
        const { admin } = await staff();
        const player = await makeUser(null);
        const friend = await makeUser(null);

        await db.getRepository(OwnedItem).insert([
            { userId: player.id, itemId: 'back.oni', via: 'purchase', orderId: null, giverId: null },
            { userId: player.id, itemId: 'felt.frost', via: 'gift', orderId: null, giverId: friend.id }
        ]);

        expect(await word(ports.admin.takeLook(admin.id, player.handle, 'back.oni', { reason: 'Not theirs' }))).toBe('409 staff-look-kept');
        expect(await word(ports.admin.takeLook(admin.id, player.handle, 'felt.frost', { reason: 'Not theirs' }))).toBe('409 staff-look-kept');
        expect(await db.getRepository(OwnedItem).countBy({ userId: player.id })).toBe(2);
        expect((await ports.admin.person(admin.id, player.handle))?.looks.find((one) => one.item === 'felt.frost')).toEqual({ item: 'felt.frost', via: 'gift', from: friend.handle, at: expect.any(String), worn: false });
        expect(await shopActions()).toEqual([]);
    });

    it('answers a moderator as nothing, and refuses the reader\'s own account and somebody at the reader\'s rank', async () =>
    {
        const { owner, admin } = await staff();
        const moderator = await makeUser(2);
        const other = await makeUser(3);
        const player = await makeUser(null);

        await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the reports' });
        await ports.admin.setStaff(owner.id, { handle: other.handle, role: 'admin', reason: 'Runs the shop too' });

        expect(await ports.admin.giveLook(moderator.id, player.handle, { item: 'dice.jade', reason: 'From a moderator' })).toBeNull();
        expect(await ports.admin.takeLook(moderator.id, player.handle, 'dice.jade', { reason: 'From a moderator' })).toBeNull();
        expect(await word(ports.admin.giveLook(admin.id, admin.handle, { item: 'dice.jade', reason: 'For myself' }))).toBe('409 staff-self');
        expect(await word(ports.admin.giveLook(admin.id, other.handle, { item: 'dice.jade', reason: 'For a colleague' }))).toBe('409 staff-rank');
        expect(await word(ports.admin.giveLook(admin.id, 'nobody.here', { item: 'dice.jade', reason: 'For nobody' }))).toBe('404 staff-nobody');
        expect((await ports.admin.giveLook(owner.id, other.handle, { item: 'dice.jade', reason: 'For a colleague' }))?.looks.map((one) => one.item)).toEqual(['dice.jade']);
        expect(await db.getRepository(OwnedItem).countBy({ userId: player.id })).toBe(0);
    });

    it('lists the orders newest first with their state, look and people, and finds them by state, look and person', async () =>
    {
        const { admin } = await staff();
        const sara = await makeUser(null);
        const omid = await makeUser(null);
        const mina = await makeUser(null);
        const paid = await placed(sara, 'dice.inferno', 'paid', { ago: 5 });
        const gift = await placed(sara, 'back.jade', 'quoted', { for: mina, ago: 4 });
        const refunded = await placed(omid, 'pawns.storm', 'refunded', { ago: 3 });
        const failed = await placed(omid, 'dice.oni', 'failed', { ago: 2 });
        const sent = await placed(sara, 'felt.glow', 'sent', { ago: 1 });
        const all = await ports.admin.shopOrders(admin.id, {});
        const ids = async (query: Parameters<Services['admin']['shopOrders']>[1]) => (await ports.admin.shopOrders(admin.id, query))?.rows.map((row) => row.id);
        const face = (who: Person) => ({ handle: who.handle, displayName: who.displayName, hue: who.hue });

        expect(all?.rows.map((row) => row.id)).toEqual([sent.id, failed.id, refunded.id, gift.id, paid.id]);
        expect(all?.cursor).toBeUndefined();
        expect(all?.rows[4]).toEqual({
            id: paid.id,
            item: 'dice.inferno',
            price: PRICE,
            state: 'paid',
            buyer: face(sara),
            at: expect.any(String),
            paidAt: expect.any(String),
            hash: paid.hash,
            delivered: true
        });
        expect(all?.rows[3]).toEqual({ id: gift.id, item: 'back.jade', price: PRICE, state: 'quoted', buyer: face(sara), for: face(mina), at: expect.any(String) });
        expect(all?.rows[2]).toMatchObject({ state: 'refunded', delivered: true, hash: refunded.hash });
        expect(all?.rows[1]).toMatchObject({ state: 'failed', failure: 'EnforcedPause' });
        expect(all?.rows[0]).toMatchObject({ state: 'sent', hash: sent.hash });
        expect(await ids({ state: 'paid' })).toEqual([paid.id]);
        expect(await ids({ state: 'refunded' })).toEqual([refunded.id]);
        expect(await ids({ item: 'back.jade' })).toEqual([gift.id]);
        expect(await ids({ person: `@${ mina.handle.toUpperCase() }` })).toEqual([gift.id]);
        expect(await ids({ person: sara.handle })).toEqual([sent.id, gift.id, paid.id]);
        expect(await ids({ person: omid.handle, state: 'failed' })).toEqual([failed.id]);
        expect(await ids({ person: 'nobody.here' })).toEqual([]);
        expect(await ids({ person: '@' })).toEqual(all?.rows.map((row) => row.id));
    });

    it('reads the orders fifty a page, and loses none written in the same millisecond as a page\'s last', async () =>
    {
        const { admin } = await staff();
        const buyer = await makeUser(null);

        await db.query(
            `insert into shop_orders (buyer_id, recipient_id, item_id, price, buyer_address, deadline, state, created_at)
             select $1, $1, 'dice.glow', $2, $3, now(), 'expired', timestamptz '2026-10-29 12:00:00.5+00' - n * interval '1 microsecond'
             from generate_series(1, $4::int) as n`,
            [buyer.id, PRICE, ADDRESS, SHOP_ORDERS_PAGE + 1]
        );

        const order = (await db.query(`select id from shop_orders order by created_at desc, id desc`) as { id: string }[]).map((row) => row.id);
        const first = await ports.admin.shopOrders(admin.id, {});
        const second = await ports.admin.shopOrders(admin.id, { cursor: first?.cursor ?? '' });

        expect(first?.rows).toHaveLength(SHOP_ORDERS_PAGE);
        expect(first?.cursor).toEqual(expect.any(String));
        expect(second?.cursor).toBeUndefined();
        expect([...first?.rows ?? [], ...second?.rows ?? []].map((row) => row.id)).toEqual(order);
        expect(await ports.admin.shopOrders(admin.id, { cursor: 'not-a-cursor' })).toEqual(first);
    });
});

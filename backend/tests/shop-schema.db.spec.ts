import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { EquippedItem, OwnedItem, ShopCollection, ShopItem, ShopOrder, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { BUNDLES, FEATURED_FIRST, LOOKS, NURA, SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;

let seq = 0;

const makeUser = async () =>
{
    seq += 1;
    const handle = `shopper${ seq }`;

    return db.getRepository(User).save({ handle, displayName: `The ${ handle }`, hue: 40, kind: 'wallet' });
};

/** The SQLSTATE a write is refused with, or nothing when it is taken. */
const refusal = async (write: Promise<unknown>) =>
{
    try
    {
        await write;
        return null;
    }
    catch (error)
    {
        return (error as { driverError?: { code?: string } }).driverError?.code ?? 'thrown';
    }
};

const order = (buyer: string, item: string, extra: Partial<ShopOrder> = {}) => db.getRepository(ShopOrder).insert({
    buyerId: buyer,
    recipientId: buyer,
    itemId: item,
    price: (12n * NURA).toString(),
    buyerAddress: '0x' + 'ab'.repeat(20),
    deadline: new Date(Date.now() + 30 * 60_000),
    state: 'quoted',
    ...extra
});

describe.skipIf(!active)('the shop\'s rows', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: [] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 180_000);

    afterAll(async () =>
    {
        await db?.destroy();
    });

    beforeEach(async () =>
    {
        await db.getRepository(EquippedItem).createQueryBuilder().delete().execute();
        await db.getRepository(OwnedItem).createQueryBuilder().delete().execute();
        await db.getRepository(ShopOrder).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    it('are seeded with every look and bundle at its price and on sale, the first collection featured', async () =>
    {
        const items = await db.getRepository(ShopItem).find();
        const byId = new Map(items.map((item) => [item.id, item]));

        expect(items).toHaveLength(LOOKS.length + BUNDLES.length);

        for (const item of [...LOOKS, ...BUNDLES])
        {
            expect(byId.get(item.id)?.price).toBe(item.price.toString());
            expect(byId.get(item.id)?.status).toBe('on-sale');
            expect(byId.get(item.id)?.salePrice).toBeNull();
        }

        const collections = await db.getRepository(ShopCollection).find({ order: { id: 'asc' } });

        expect(collections.map((collection) => collection.id)).toEqual([...SHOP_COLLECTIONS].sort());
        expect(collections.filter((collection) => collection.featuredAt !== null).map((collection) => collection.id)).toEqual([FEATURED_FIRST]);
    });

    it('keep the staff\'s prices, sales, statuses and featured collection through the next seed', async () =>
    {
        const until = new Date(Date.now() + 86_400_000);

        await db.getRepository(ShopItem).update('dice.glow', { price: (7n * NURA).toString(), salePrice: (6n * NURA).toString(), saleUntil: until, status: 'hidden' });
        await db.getRepository(ShopCollection).update(FEATURED_FIRST, { featuredAt: null });
        await db.getRepository(ShopCollection).update('shiraz', { featuredAt: new Date() });

        await seedReference(db);

        const dice = await db.getRepository(ShopItem).findOneByOrFail({ id: 'dice.glow' });

        expect(dice.price).toBe((7n * NURA).toString());
        expect(dice.salePrice).toBe((6n * NURA).toString());
        expect(dice.status).toBe('hidden');
        expect((await db.getRepository(ShopCollection).findOneByOrFail({ id: FEATURED_FIRST })).featuredAt).toBeNull();
        expect((await db.getRepository(ShopCollection).findOneByOrFail({ id: 'shiraz' })).featuredAt).not.toBeNull();

        await db.getRepository(ShopItem).update('dice.glow', { price: (12n * NURA).toString(), salePrice: null, saleUntil: null, status: 'on-sale' });
        await db.getRepository(ShopCollection).update('shiraz', { featuredAt: null });
        await db.getRepository(ShopCollection).update(FEATURED_FIRST, { featuredAt: new Date() });
    });

    it('refuse a sale that is not under the price or has no end', async () =>
    {
        const shop = db.getRepository(ShopItem);
        const until = new Date(Date.now() + 86_400_000);

        expect(await refusal(shop.update('pawns.neon', { salePrice: (12n * NURA).toString(), saleUntil: until }))).toBe('23514');
        expect(await refusal(shop.update('pawns.neon', { salePrice: (5n * NURA).toString() }))).toBe('23514');
        expect(await refusal(shop.update('pawns.neon', { price: '0' }))).toBe('23514');
        expect(await refusal(shop.update('pawns.neon', { status: 'gone' as never }))).toBe('23514');
        expect(await refusal(shop.insert({ id: 'Pawns.Neon', price: '1', status: 'on-sale' }))).toBe('23514');
    });

    it('let somebody choose a look only for its kind\'s slot, and only while it is theirs', async () =>
    {
        const me = await makeUser();
        const owned = db.getRepository(OwnedItem);
        const chosen = db.getRepository(EquippedItem);

        await owned.insert({ userId: me.id, itemId: 'dice.shiraz', via: 'grant' });

        expect(await refusal(chosen.insert({ userId: me.id, slot: 'ludo.dice', itemId: 'dice.shiraz' }))).toBeNull();
        expect(await refusal(chosen.insert({ userId: me.id, slot: 'backgammon.dice', itemId: 'dice.shiraz' }))).toBeNull();
        expect(await refusal(chosen.insert({ userId: me.id, slot: 'ludo.pawns', itemId: 'dice.shiraz' }))).toBe('23514');
        expect(await refusal(chosen.insert({ userId: me.id, slot: 'ludo.yard', itemId: 'yard.glow' }))).toBe('23503');
        expect(await refusal(chosen.insert({ userId: me.id, slot: 'ludo.board', itemId: 'board.glow' }))).toBe('23514');

        await owned.delete({ userId: me.id, itemId: 'dice.shiraz' });

        expect(await chosen.countBy({ userId: me.id })).toBe(0);
    });

    it('own looks and never bundles, and give a giver only to a gift', async () =>
    {
        const me = await makeUser();
        const friend = await makeUser();
        const owned = db.getRepository(OwnedItem);

        expect(await refusal(owned.insert({ userId: me.id, itemId: 'bundle.glow', via: 'purchase' }))).toBe('23514');
        expect(await refusal(owned.insert({ userId: me.id, itemId: 'back.neon', via: 'grant', giverId: friend.id }))).toBe('23514');
        expect(await refusal(owned.insert({ userId: me.id, itemId: 'back.neon', via: 'gift', giverId: friend.id }))).toBeNull();
        expect(await refusal(owned.insert({ userId: me.id, itemId: 'back.neon', via: 'purchase' }))).toBe('23505');
        expect(await refusal(owned.insert({ userId: me.id, itemId: 'back.velvet', via: 'purchase' }))).toBe('23503');
    });

    it('keep one open order per recipient and look, and let one transaction pay one order', async () =>
    {
        const me = await makeUser();
        const hash = '0x' + 'cd'.repeat(32);

        expect(await refusal(order(me.id, 'dice.gold'))).toBeNull();
        expect(await refusal(order(me.id, 'dice.gold'))).toBe('23505');
        expect(await refusal(order(me.id, 'bundle.gold'))).toBeNull();

        await db.getRepository(ShopOrder).update({ itemId: 'dice.gold' }, { state: 'expired' });

        expect(await refusal(order(me.id, 'dice.gold', { state: 'sent', txHash: hash }))).toBeNull();
        expect(await refusal(order(me.id, 'pawns.gold', { state: 'sent', txHash: hash }))).toBe('23505');
    });

    it('make an order\'s state carry what it says', async () =>
    {
        const me = await makeUser();
        const at = new Date();

        expect(await refusal(order(me.id, 'chips.neon', { state: 'sent' }))).toBe('23514');
        expect(await refusal(order(me.id, 'chips.neon', { state: 'paid', delivered: true }))).toBe('23514');
        expect(await refusal(order(me.id, 'chips.neon', { state: 'paid', paidAt: at }))).toBe('23514');
        expect(await refusal(order(me.id, 'chips.neon', { state: 'failed' }))).toBe('23514');
        expect(await refusal(order(me.id, 'chips.neon', { state: 'refunded', paidAt: at, delivered: true }))).toBe('23514');
        expect(await refusal(order(me.id, 'chips.neon', { buyerAddress: '0x' + 'AB'.repeat(20) }))).toBe('23514');
        expect(await refusal(order(me.id, 'chips.neon', { price: '0' }))).toBe('23514');
        expect(await refusal(order(me.id, 'chips.neon', { state: 'paid', paidAt: at, delivered: false }))).toBeNull();
        expect(await refusal(order(me.id, 'chips.gold', { state: 'failed', failure: 'QuoteExpired' }))).toBeNull();
    });
});

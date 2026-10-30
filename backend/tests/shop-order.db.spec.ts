import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, In } from 'typeorm';
import { decodeFunctionData, getAddress, toHex, zeroAddress, type Hex } from 'viem';

import { SHOP_ABI, itemOf, orderIdOf } from '../src/chain/shop.ts';
import { Notification, OwnedItem, Referral, ShopOrder, Table, User, Wallet, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { OWNER_WALLET } from '../src/domains/admin/roles.ts';
import { BUNDLES, FEATURED_FIRST, LOOKS, NURA, bundleOf, bundlePriceFor, lookOf } from '../src/domains/shop/catalogue.ts';
import { buildPorts, type WriteListener } from '../src/services.ts';
import { FAKE_SHOP, fakeShop } from './fake-shop.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;

let seq = 0;

const rung: [string, string][] = [];

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
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

const door = (fake = fakeShop()) => ({ ports: buildPorts(db, CONFIG, listener, undefined, undefined, undefined, undefined, fake.shop), fake });

interface Person
{
    id: string;
    handle: string;
    address: string | null;
}

const person = async (options: { wallet?: boolean; minor?: boolean; suspended?: boolean } = {}): Promise<Person> =>
{
    seq += 1;

    const minor = options.minor ?? false;
    const user = await db.getRepository(User).save({
        handle: `buyer${ seq }`,
        displayName: `Buyer ${ seq }`,
        hue: 40,
        kind: 'wallet',
        isMinor: minor,
        allowStrangerMessages: !minor,
        isSuspended: options.suspended ?? false
    });
    const address = options.wallet === false ? null : getAddress(`0x${ (0xa11ce000 + seq).toString(16).padStart(40, '0') }`);

    if (address !== null)
    {
        await db.getRepository(Wallet).insert({ userId: user.id, address, attestation: 'wallet', lastUsedAt: new Date() });
    }

    return { id: user.id, handle: user.handle, address };
};

const befriend = (one: Person, other: Person) =>
    db.query('insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)', [one.id, other.id]);

const own = (userId: string, ...items: string[]) =>
    db.getRepository(OwnedItem).insert(items.map((itemId) => ({ userId, itemId, via: 'grant' as const })));

const ownedBy = async (userId: string) =>
    (await db.getRepository(OwnedItem).findBy({ userId }))
        .map((row) => ({ item: row.itemId, via: row.via, order: row.orderId, giver: row.giverId }))
        .sort((one, other) => (one.item < other.item ? -1 : 1));

const orderRow = (id: string) => db.getRepository(ShopOrder).findOneByOrFail({ id });

/** The word a refusal carries and what it says beside it, or nothing when the call went through. */
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

const PRICES = [...LOOKS, ...BUNDLES];

const HASH: Hex = `0x${ 'ab'.repeat(32) }`;

/** The shop's rows as the seed leaves them: every price its own, nothing on sale or off the shelves, the first collection featured. */
const reseed = async () =>
{
    await db.query(`update shop_collections set featured_at = case when id = $1 then now() else null end`, [FEATURED_FIRST]);
    await db.query(
        `update shop_items s set price = v.price::numeric, sale_price = null, sale_until = null, status = 'on-sale'
         from unnest($1::text[], $2::text[]) as v(id, price) where s.id = v.id`,
        [PRICES.map((item) => item.id), PRICES.map((item) => item.price.toString())]
    );
};

describe.skipIf(!active)('buying a look with NURA, against a real database', () =>
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
            await reseed();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        await reseed();
        rung.length = 0;
    });

    describe('an order', () =>
    {
        it('is priced for its buyer, signed as a quote good for half an hour, and handed to the wallet as the purchase', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const price = lookOf('dice.shiraz')!.price;
            const bought = await ports.shop.order(buyer.id, 'dice.shiraz', undefined);
            const quote = fake.last();
            const deadline = Date.parse(bought.order.deadline);

            expect(bought.order).toMatchObject({ item: 'dice.shiraz', price: price.toString(), state: 'quoted' });
            expect(Object.keys(bought.order).filter((key) => ['for', 'hash', 'failure', 'delivered', 'paidAt'].includes(key))).toEqual([]);
            expect(quote).toEqual({
                order: orderIdOf(bought.order.id),
                buyer: getAddress(buyer.address!),
                item: itemOf('dice.shiraz'),
                price,
                referrer: zeroAddress,
                deadline: BigInt(deadline / 1000)
            });
            expect(deadline % 1000, 'a deadline the contract reads in whole seconds').toBe(0);
            expect(deadline - Date.now()).toBeGreaterThan(29 * 60_000);
            expect(deadline - Date.now()).toBeLessThanOrEqual(30 * 60_000);
            expect(bought.call).toMatchObject({ from: buyer.address, to: FAKE_SHOP, value: toHex(price), chainId: 31337 });
            expect(decodeFunctionData({ abi: SHOP_ABI, data: bought.call.data as Hex }).args?.[0]).toEqual(quote);
            expect(rung).toContainEqual([buyer.id, 'shop']);

            const other = await person();

            await ports.shop.order(other.id, 'pawns.shiraz', undefined);

            expect((await ports.shop.orders(buyer.id, null)).orders).toEqual([bought.order]);
            expect(await ports.shop.one(buyer.id, bought.order.id)).toEqual(bought.order);
        });

        it('is for a wallet account of an adult, which the shop says before anybody presses Buy, and for nobody where the shop is not open', async () =>
        {
            const { ports } = door();
            const guest = await person({ wallet: false });
            const minor = await person({ minor: true });
            const adult = await person();

            expect(await refusal(ports.shop.order(guest.id, 'dice.shiraz', undefined))).toEqual({ status: 409, code: 'shop-wallet' });
            expect(await refusal(ports.shop.order(minor.id, 'dice.shiraz', undefined))).toEqual({ status: 409, code: 'shop-minor' });
            expect(await ports.shop.state(guest.id)).toMatchObject({ open: true, may: 'shop-wallet' });
            expect(await ports.shop.state(minor.id)).toMatchObject({ open: true, may: 'shop-minor' });
            expect(await ports.shop.state(adult.id)).toMatchObject({ open: true, chainId: 31337, featured: FEATURED_FIRST, may: 'yes' });

            const closed = door(fakeShop(false)).ports;

            const shut = await closed.shop.state(adult.id);

            expect(shut).toMatchObject({ open: false, featured: FEATURED_FIRST, may: 'yes' });
            expect(shut, 'a shop that is turned off named a chain').not.toHaveProperty('chainId');
            expect(shut.items, 'a shop that is turned off kept its catalogue to itself').toEqual((await ports.shop.state(adult.id)).items);
            expect(await refusal(closed.shop.order(adult.id, 'dice.shiraz', undefined))).toEqual({ status: 404, code: 'shop-off' });
            expect(await refusal(closed.shop.balance(adult.id))).toEqual({ status: 404, code: 'shop-off' });
            expect(await refusal(closed.shop.earnings(adult.id))).toEqual({ status: 404, code: 'shop-off' });
            expect(await db.getRepository(ShopOrder).count()).toBe(0);
        });

        it('sells only what is on sale, at the sale\'s price while it lasts, and lists what is on sale', async () =>
        {
            const { ports } = door();
            const buyer = await person();
            const price = lookOf('dice.shiraz')!.price;

            expect(await refusal(ports.shop.order(buyer.id, 'dice.nowhere', undefined))).toEqual({ status: 404, code: 'shop-item' });

            for (const status of ['hidden', 'retired'])
            {
                await db.query('update shop_items set status = $1 where id = $2', [status, 'dice.shiraz']);

                expect(await refusal(ports.shop.order(buyer.id, 'dice.shiraz', undefined)), status).toEqual({ status: 404, code: 'shop-item' });
                expect((await ports.shop.state(buyer.id) as { items: { id: string }[] }).items.some((item) => item.id === 'dice.shiraz'), status).toBe(false);
            }

            await db.query(`update shop_items set status = 'on-sale', sale_price = $1, sale_until = now() + interval '1 hour' where id = 'dice.shiraz'`, [(price / 2n).toString()]);
            await db.query(`update shop_items set sale_price = $1, sale_until = now() - interval '1 minute' where id = 'pawns.shiraz'`, [(lookOf('pawns.shiraz')!.price / 2n).toString()]);

            const listed = (await ports.shop.state(buyer.id) as { items: { id: string; price: string; sale?: { price: string; until: string } }[] }).items;

            expect(listed.find((item) => item.id === 'dice.shiraz')).toMatchObject({ price: price.toString(), sale: { price: (price / 2n).toString() } });
            expect(listed.find((item) => item.id === 'pawns.shiraz'), 'a sale that ended').not.toHaveProperty('sale');
            expect(listed).toHaveLength(PRICES.length);
            expect((await ports.shop.order(buyer.id, 'dice.shiraz', undefined)).order.price).toBe((price / 2n).toString());
            expect((await ports.shop.order(buyer.id, 'pawns.shiraz', undefined)).order.price).toBe(lookOf('pawns.shiraz')!.price.toString());
        });

        it('says which collection is featured', async () =>
        {
            const { ports } = door();
            const buyer = await person();

            await db.query(`update shop_collections set featured_at = now() - interval '1 day' where id = 'gold'`);
            await db.query(`update shop_collections set featured_at = now() where id = 'neon'`);

            expect(await ports.shop.state(buyer.id)).toMatchObject({ featured: 'neon' });
        });

        it('never sells a look the recipient owns, and prices a bundle down for the looks of it they own', async () =>
        {
            const { ports } = door();
            const buyer = await person();
            const whole = await person();
            const bundle = bundleOf('bundle.glow')!;
            const held = bundle.looks.slice(0, 2);

            await own(buyer.id, 'pawns.neon', ...held);
            await own(whole.id, ...bundle.looks);

            const order = (await ports.shop.order(buyer.id, 'bundle.glow', undefined)).order;

            expect(await refusal(ports.shop.order(buyer.id, 'pawns.neon', undefined))).toEqual({ status: 409, code: 'shop-owned' });
            expect(order.price).toBe(bundlePriceFor(bundle.price, bundle.looks.map((id) => ({ price: lookOf(id)!.price, owned: held.includes(id) }))).toString());
            expect(BigInt(order.price)).toBeLessThan(bundle.price);
            expect(await refusal(ports.shop.order(whole.id, 'bundle.glow', undefined))).toEqual({ status: 409, code: 'shop-owned' });
        });

        it('is handed back to a buyer who asks again, and holds those looks against every other order until it is done', async () =>
        {
            const { ports } = door();
            const buyer = await person();
            const friend = await person();

            await befriend(buyer, friend);

            const first = await ports.shop.order(buyer.id, 'dice.gold', undefined);
            const again = await ports.shop.order(buyer.id, 'dice.gold', undefined);

            expect(again).toEqual(first);
            expect(await db.getRepository(ShopOrder).count()).toBe(1);
            expect(await refusal(ports.shop.order(friend.id, 'dice.gold', buyer.handle))).toEqual({ status: 409, code: 'shop-pending' });
            expect(await refusal(ports.shop.order(buyer.id, 'bundle.gold', undefined))).toEqual({ status: 409, code: 'shop-pending' });
            expect((await ports.shop.order(buyer.id, 'dice.neon', undefined)).order.id).not.toBe(first.order.id);

            await db.query(`update shop_orders set deadline = date_trunc('second', now() + interval '90 seconds') where id = $1`, [first.order.id]);

            expect(await refusal(ports.shop.order(buyer.id, 'dice.gold', undefined)), 'a quote too close to its end').toEqual({ status: 409, code: 'shop-pending' });
        });

        it('is written once when two friends buy one look for one person at the same moment', async () =>
        {
            const one = await person();
            const other = await person();
            const them = await person();

            await befriend(one, them);
            await befriend(other, them);

            const answers = await Promise.all([
                refusal(door().ports.shop.order(one.id, 'chips.gold', them.handle)),
                refusal(door().ports.shop.order(other.id, 'chips.gold', them.handle))
            ]);

            expect(answers.filter((answer) => answer === null)).toHaveLength(1);
            expect(answers.filter((answer) => answer !== null)).toEqual([{ status: 409, code: 'shop-pending' }]);
            expect(await db.getRepository(ShopOrder).countBy({ recipientId: them.id })).toBe(1);
        });

        it('is forgotten when the shop would not take it, and says why', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const short = { status: 409, code: 'shop-funds', details: { price: lookOf('dice.glow')!.price.toString() } };

            fake.state.balance = lookOf('dice.glow')!.price - 1n;

            expect(await refusal(ports.shop.order(buyer.id, 'dice.glow', undefined)), 'a wallet short of the price').toEqual(short);
            expect(fake.asked.filter((one) => one.startsWith('buy')), 'a purchase asked of the shop for a wallet that cannot pay it').toEqual([]);

            fake.state.balance = lookOf('dice.glow')!.price;
            fake.state.refuse = 'InsufficientFunds';

            expect(await refusal(ports.shop.order(buyer.id, 'dice.glow', undefined)), 'a node that refuses the call').toEqual(short);

            for (const paused of ['EnforcedPause', 'InvalidSignature'])
            {
                fake.state.refuse = paused;

                expect(await refusal(ports.shop.order(buyer.id, 'dice.glow', undefined)), paused).toEqual({ status: 409, code: 'shop-closed' });
            }

            fake.state.refuse = 'QuoteTooLong';

            expect(await refusal(ports.shop.order(buyer.id, 'dice.glow', undefined))).toEqual({ status: 409, code: 'shop-refused', details: { error: 'QuoteTooLong' } });

            fake.state.refuse = null;
            fake.state.away = true;

            expect(await refusal(ports.shop.order(buyer.id, 'dice.glow', undefined))).toMatchObject({ status: 503 });
            expect(await db.getRepository(ShopOrder).count()).toBe(0);
        });

        it('names whoever brought the buyer in once that invite counted, and nobody suspended', async () =>
        {
            const { ports, fake } = door();
            const inviter = await person();
            const buyer = await person();

            await db.getRepository(Referral).insert({ inviteeId: buyer.id, inviterId: inviter.id });
            await ports.shop.order(buyer.id, 'dice.glow', undefined);

            expect(fake.last().referrer, 'an invite that has not counted').toBe(zeroAddress);

            await db.getRepository(Referral).update({ inviteeId: buyer.id }, { countedAt: new Date() });
            await ports.shop.order(buyer.id, 'pawns.glow', undefined);

            expect(fake.last().referrer).toBe(getAddress(inviter.address!));
            expect((await orderRow((await ports.shop.orders(buyer.id, null)).orders[0].id)).referrerAddress).toBe(inviter.address!.toLowerCase());

            await db.getRepository(User).update({ id: inviter.id }, { isSuspended: true });
            await ports.shop.order(buyer.id, 'yard.glow', undefined);

            expect(fake.last().referrer).toBe(zeroAddress);
        });
    });

    describe('the wallet whose own looks are free', () =>
    {
        const FREE = getAddress(OWNER_WALLET);

        const freeBuyer = async (options: { minor?: boolean } = {}): Promise<Person> =>
        {
            const minor = options.minor ?? false;
            const user = await db.getRepository(User).save({ handle: 'owner', displayName: 'Owner', hue: 40, kind: 'wallet', isMinor: minor, allowStrangerMessages: !minor });

            await db.getRepository(Wallet).insert({ userId: user.id, address: FREE, attestation: 'wallet', lastUsedAt: new Date() });

            return { id: user.id, handle: user.handle, address: FREE };
        };

        it('is given every look it buys for itself at Buy, as grants, with no order and nothing asked of the chain', async () =>
        {
            const { ports, fake } = door();
            const owner = await freeBuyer();
            const bundle = BUNDLES.find((one) => one.id === 'bundle.storm')!;

            fake.state.away = true;

            expect(await ports.shop.state(owner.id).catch(() => null), 'the shop could not say what it sells while the chain was away').toMatchObject({ open: true, may: 'yes', free: true });
            expect(await ports.shop.purchase(owner.id, 'dice.shiraz', undefined)).toEqual({ given: true });
            expect(await ports.shop.purchase(owner.id, bundle.id, undefined)).toEqual({ given: true });
            expect(await ownedBy(owner.id)).toEqual(['dice.shiraz', ...bundle.looks].toSorted().map((item) => ({ item, via: 'grant', order: null, giver: null })));
            expect(await db.getRepository(ShopOrder).count(), 'a free look left an order behind').toBe(0);
            expect(fake.quotes, 'a quote was signed for a free look').toEqual([]);
            expect(fake.asked, 'the chain was asked about a free look').toEqual([]);
            expect(rung).toContainEqual([owner.id, 'shop']);
        });

        it('is given its looks though the shop is turned off, and told the shop gives them free', async () =>
        {
            const { ports, fake } = door(fakeShop(false));
            const owner = await freeBuyer();

            expect(await ports.shop.state(owner.id)).toMatchObject({ open: false, may: 'yes', free: true });
            expect(await ports.shop.purchase(owner.id, 'dice.shiraz', undefined)).toEqual({ given: true });
            expect(await ownedBy(owner.id)).toEqual([{ item: 'dice.shiraz', via: 'grant', order: null, giver: null }]);
            expect(fake.asked, 'the chain was asked about a free look').toEqual([]);
        });

        it('is refused what is not on sale, already its own or held by an order of its own, as anybody is', async () =>
        {
            const { ports } = door();
            const owner = await freeBuyer();

            expect(await refusal(ports.shop.purchase(owner.id, 'dice.nowhere', undefined))).toEqual({ status: 404, code: 'shop-item' });

            await db.query(`update shop_items set status = 'hidden' where id = 'dice.storm'`);

            expect(await refusal(ports.shop.purchase(owner.id, 'dice.storm', undefined))).toEqual({ status: 404, code: 'shop-item' });

            await ports.shop.purchase(owner.id, 'dice.shiraz', undefined);

            expect(await refusal(ports.shop.purchase(owner.id, 'dice.shiraz', undefined))).toEqual({ status: 409, code: 'shop-owned' });

            await ports.shop.order(owner.id, 'pawns.shiraz', undefined);

            expect(await refusal(ports.shop.purchase(owner.id, 'pawns.shiraz', undefined)), 'a look was given while an order for it could still be paid').toEqual({ status: 409, code: 'shop-pending' });
            expect(await refusal(ports.shop.purchase(owner.id, 'bundle.shiraz', undefined)), 'a bundle holding it was given while that order could still be paid').toEqual({ status: 409, code: 'shop-pending' });
            expect((await ownedBy(owner.id)).map((one) => one.item)).toEqual(['dice.shiraz']);
        });

        it('still pays for a gift, and gives nothing free to an account under 18 or where the shop is not open', async () =>
        {
            const { ports } = door();
            const owner = await freeBuyer();
            const friend = await person();

            await befriend(owner, friend);

            expect(await ports.shop.purchase(owner.id, 'back.gold', friend.handle)).toMatchObject({ order: { item: 'back.gold', for: friend.handle, state: 'quoted' } });
            expect(await ownedBy(friend.id), 'a gift from the free wallet arrived unpaid').toEqual([]);
            expect(await refusal(door(fakeShop(false)).ports.shop.purchase(owner.id, 'back.gold', friend.handle)), 'a gift was given where nothing can be paid').toEqual({ status: 404, code: 'shop-off' });

            await db.getRepository(User).delete({ id: owner.id });

            const minor = await freeBuyer({ minor: true });

            expect(await ports.shop.state(minor.id)).not.toHaveProperty('free');
            expect(await refusal(ports.shop.purchase(minor.id, 'dice.shiraz', undefined))).toEqual({ status: 409, code: 'shop-minor' });
            expect(await refusal(door(fakeShop(false)).ports.shop.purchase(minor.id, 'dice.shiraz', undefined))).toEqual({ status: 404, code: 'shop-off' });
            expect(await ownedBy(minor.id)).toEqual([]);
        });

        it('answers anybody else at Buy with an order to pay, and tells nobody else their looks are free', async () =>
        {
            const { ports } = door();
            const buyer = await person();

            expect(await ports.shop.state(buyer.id)).not.toHaveProperty('free');
            expect(await ports.shop.purchase(buyer.id, 'dice.shiraz', undefined)).toMatchObject({ order: { item: 'dice.shiraz', state: 'quoted' } });
            expect(await ownedBy(buyer.id)).toEqual([]);
        });
    });

    describe('a gift', () =>
    {
        it('goes to a friend, a friend under 18 included, and anybody else is answered in one sentence', async () =>
        {
            const { ports } = door();
            const buyer = await person();
            const friend = await person();
            const kid = await person({ minor: true });
            const stranger = await person();
            const gone = await person({ suspended: true });

            await befriend(buyer, friend);
            await befriend(buyer, kid);
            await befriend(buyer, gone);

            const gift = await ports.shop.order(buyer.id, 'back.glow', `@${ friend.handle }`);

            expect(gift.order).toMatchObject({ item: 'back.glow', for: friend.handle });
            expect((await orderRow(gift.order.id)).recipientId).toBe(friend.id);
            expect((await ports.shop.order(buyer.id, 'back.glow', kid.handle)).order.for).toBe(kid.handle);

            for (const who of [stranger.handle, gone.handle, 'nobody-holds-this', buyer.handle])
            {
                expect(await refusal(ports.shop.order(buyer.id, 'back.neon', who)), who).toEqual({ status: 404, code: 'shop-friend' });
            }
        });
    });

    describe('the transaction a wallet sent', () =>
    {
        it('is taken for the buyer\'s own open order, once in the whole shop, and changes nothing that is over', async () =>
        {
            const { ports } = door();
            const buyer = await person();
            const other = await person();
            const one = (await ports.shop.order(buyer.id, 'dice.glow', undefined)).order;
            const two = (await ports.shop.order(buyer.id, 'pawns.glow', undefined)).order;
            const sent = await ports.shop.sent(buyer.id, one.id, HASH.toUpperCase().replace('0X', '0x'));

            expect(sent).toMatchObject({ id: one.id, state: 'sent', hash: HASH });
            expect(await refusal(ports.shop.sent(buyer.id, two.id, HASH))).toEqual({ status: 409, code: 'shop-hash' });
            expect(await refusal(ports.shop.sent(other.id, two.id, `0x${ 'cd'.repeat(32) }`))).toEqual({ status: 404, code: 'shop-order' });
            expect(await refusal(ports.shop.sent(buyer.id, 'not-an-order', `0x${ 'cd'.repeat(32) }`))).toEqual({ status: 404, code: 'shop-order' });
            expect(await refusal(ports.shop.one(other.id, one.id))).toEqual({ status: 404, code: 'shop-order' });
            expect((await orderRow(two.id)).state).toBe('quoted');

            await db.query(`update shop_orders set state = 'expired' where id = $1`, [two.id]);

            expect((await ports.shop.sent(buyer.id, two.id, `0x${ 'ef'.repeat(32) }`)).state).toBe('expired');
        });
    });

    describe('the worker', () =>
    {
        it('delivers what the shop sold: a look, a gift with who gave it, and every look of a bundle the recipient lacked', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const friend = await person();

            await befriend(buyer, friend);
            await own(friend.id, 'felt.neon');

            const mine = (await ports.shop.order(buyer.id, 'dice.glow', undefined)).order;
            const mineQuote = fake.last();
            const gift = (await ports.shop.order(buyer.id, 'back.glow', friend.handle)).order;
            const giftQuote = fake.last();
            const bundle = (await ports.shop.order(friend.id, 'bundle.neon', undefined)).order;
            const bundleQuote = fake.last();

            for (const quote of [mineQuote, giftQuote, bundleQuote])
            {
                fake.sell(quote);
            }

            rung.length = 0;

            expect(await ports.jobs.sweepShop(10_000)).toEqual({ paid: 3, refunded: 0, failed: 0, expired: 0, faults: [] });
            expect(await ownedBy(buyer.id)).toEqual([{ item: 'dice.glow', via: 'purchase', order: mine.id, giver: null }]);
            expect(await ownedBy(friend.id)).toEqual([
                { item: 'back.glow', via: 'gift', order: gift.id, giver: buyer.id },
                ...bundleOf('bundle.neon')!.looks
                    .map((item) => (item === 'felt.neon' ? { item, via: 'grant', order: null, giver: null } : { item, via: 'purchase', order: bundle.id, giver: null }))
            ].sort((one, other) => (one.item < other.item ? -1 : 1)));

            for (const id of [mine.id, gift.id, bundle.id])
            {
                expect(await ports.shop.one((await orderRow(id)).buyerId, id)).toMatchObject({ state: 'paid', delivered: true });
            }

            expect(rung).toEqual(expect.arrayContaining([[buyer.id, 'shop'], [friend.id, 'shop']]));
            expect(await ports.jobs.sweepShop(10_000), 'a paid order asked about again').toEqual({ paid: 0, refunded: 0, failed: 0, expired: 0, faults: [] });
        });

        it('tells whoever a gift gave a look, once and in the name of the friend who sent it, and nobody else', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const friend = await person();
            const full = await person();

            await befriend(buyer, friend);
            await befriend(buyer, full);

            const gift = (await ports.shop.order(buyer.id, 'back.gold', friend.handle)).order;

            fake.sell(fake.last());
            await ports.shop.order(buyer.id, 'chips.gold', full.handle);
            await own(full.id, 'chips.gold');
            fake.sell(fake.last());
            await ports.shop.order(buyer.id, 'dice.gold', undefined);
            fake.sell(fake.last());

            const told = async () => (await db.getRepository(Notification).findBy({ kind: 'gift', userId: In([buyer.id, friend.id, full.id]) }))
                .map((row) => ({ to: row.userId, actor: row.actorId, ref: row.ref, key: row.dedupeKey, count: row.count }));

            expect((await ports.jobs.sweepShop(10_000)).paid).toBe(3);
            expect(await told()).toEqual([{ to: friend.id, actor: buyer.id, ref: { item: 'back.gold' }, key: `gift:${ gift.id }`, count: 1 }]);
            expect(rung).toEqual(expect.arrayContaining([[friend.id, 'notifications']]));
            expect(rung).not.toContainEqual([full.id, 'notifications']);
            expect(rung).not.toContainEqual([buyer.id, 'notifications']);

            await ports.jobs.sweepShop(10_000);

            expect(await told(), 'a sweep after the delivery').toHaveLength(1);
        });

        it('keeps a gift it delivered when the notice about it cannot be written', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const friend = await person();
            const said = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            await befriend(buyer, friend);

            const gift = (await ports.shop.order(buyer.id, 'felt.gold', friend.handle)).order;

            fake.sell(fake.last());
            await db.query(`create function shop_spec_no_bell() returns trigger language plpgsql as $$ begin raise exception 'the bell fell off'; end $$`);
            await db.query('create trigger shop_spec_no_bell before insert on notifications for each row execute function shop_spec_no_bell()');

            let swept;

            try
            {
                swept = await ports.jobs.sweepShop(10_000);
            }
            finally
            {
                await db.query('drop trigger shop_spec_no_bell on notifications');
                await db.query('drop function shop_spec_no_bell()');
            }

            const lines = said.mock.calls.map((call) => String(call[0]));

            said.mockRestore();

            expect(swept).toEqual({ paid: 1, refunded: 0, failed: 0, expired: 0, faults: [] });
            expect(await ownedBy(friend.id)).toEqual([{ item: 'felt.gold', via: 'gift', order: gift.id, giver: buyer.id }]);
            expect(lines.some((line) => line.startsWith('gift notice failed: the bell fell off'))).toBe(true);
        });

        it('gives nothing for a look the recipient came to own before it was paid, and says so', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const order = (await ports.shop.order(buyer.id, 'pawns.glow', undefined)).order;

            await own(buyer.id, 'pawns.glow');
            fake.sell(fake.last());

            expect((await ports.jobs.sweepShop(10_000)).paid).toBe(1);
            expect(await ports.shop.one(buyer.id, order.id)).toMatchObject({ state: 'paid', delivered: false });
            expect(await ownedBy(buyer.id)).toEqual([{ item: 'pawns.glow', via: 'grant', order: null, giver: null }]);
        });

        it('marks an order the shop sold and gave back as refunded, and gives nothing for it', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const order = (await ports.shop.order(buyer.id, 'dice.gold', undefined)).order;

            fake.sell(fake.last(), true);

            expect((await ports.jobs.sweepShop(10_000)).refunded).toBe(1);
            expect(await orderRow(order.id)).toMatchObject({ state: 'refunded', delivered: false });
            expect(await ownedBy(buyer.id)).toEqual([]);
        });

        it('gives nothing for a sale the shop holds under an order at another price or to another wallet, which needs a quote nobody here signed, and says so once', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const cheap = (await ports.shop.order(buyer.id, 'dice.gold', undefined)).order;

            fake.sell({ ...fake.last(), price: 1n });

            expect(await ports.jobs.sweepShop(10_000)).toEqual({ paid: 0, refunded: 0, failed: 1, expired: 0, faults: [{ order: cheap.id, error: `mismatch:${ cheap.id }` }] });
            expect(await orderRow(cheap.id)).toMatchObject({ state: 'failed', failure: 'mismatch', delivered: null });
            expect(await ownedBy(buyer.id)).toEqual([]);
            expect(await ports.jobs.sweepShop(10_000), 'a mismatch said again at every pass').toEqual({ paid: 0, refunded: 0, failed: 0, expired: 0, faults: [] });

            const elsewhere = (await ports.shop.order(buyer.id, 'pawns.gold', undefined)).order;

            fake.sell({ ...fake.last(), buyer: '0x00000000000000000000000000000000000000ad' });

            expect((await ports.jobs.sweepShop(10_000)).faults).toEqual([{ order: elsewhere.id, error: `mismatch:${ elsewhere.id }` }]);
            expect(await orderRow(elsewhere.id)).toMatchObject({ state: 'failed', failure: 'mismatch' });
            expect(await ownedBy(buyer.id)).toEqual([]);
        });

        it('reads a transaction the chain refused as failed in the shop\'s own word, and hands that order back to be paid again', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const paused = (await ports.shop.order(buyer.id, 'dice.glow', undefined)).order;
            const gas = (await ports.shop.order(buyer.id, 'pawns.glow', undefined)).order;
            const other: Hex = `0x${ 'cd'.repeat(32) }`;

            await ports.shop.sent(buyer.id, paused.id, HASH);
            await ports.shop.sent(buyer.id, gas.id, other);
            fake.mine(HASH, 'reverted');
            fake.mine(other, 'reverted');
            fake.state.refuse = 'EnforcedPause';

            const first = await ports.jobs.sweepShop(10_000);

            expect(first.failed).toBe(2);
            expect(await ports.shop.one(buyer.id, paused.id)).toMatchObject({ state: 'failed', failure: 'EnforcedPause', hash: HASH });

            fake.state.refuse = null;

            expect(await ports.shop.one(buyer.id, gas.id)).toMatchObject({ state: 'failed', failure: 'EnforcedPause' });

            const again = await ports.shop.order(buyer.id, 'dice.glow', undefined);

            expect(again.order).toMatchObject({ id: paused.id, state: 'quoted' });
            expect(Object.keys(again.order).filter((key) => key === 'failure' || key === 'hash')).toEqual([]);
        });

        it('says a payment the shop would take now was refused for its gas', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const order = (await ports.shop.order(buyer.id, 'dice.glow', undefined)).order;

            await ports.shop.sent(buyer.id, order.id, HASH);
            fake.mine(HASH, 'reverted');

            expect((await ports.jobs.sweepShop(10_000)).failed).toBe(1);
            expect(await ports.shop.one(buyer.id, order.id)).toMatchObject({ state: 'failed', failure: 'reverted' });
        });

        it('lets an order run out once its quote can no longer be paid, and stops asking about a failed one then', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const lapsed = (await ports.shop.order(buyer.id, 'dice.glow', undefined)).order;
            const fresh = (await ports.shop.order(buyer.id, 'pawns.glow', undefined)).order;
            const failed = (await ports.shop.order(buyer.id, 'yard.glow', undefined)).order;

            await db.query(`update shop_orders set deadline = date_trunc('second', now() - interval '4 minutes') where id = $1`, [lapsed.id]);

            expect((await ports.jobs.sweepShop(10_000)).expired, 'an order four minutes past its deadline').toBe(0);

            await db.query(`update shop_orders set deadline = date_trunc('second', now() - interval '6 minutes') where id = $1`, [lapsed.id]);
            await db.query(`update shop_orders set state = 'failed', failure = 'reverted', deadline = date_trunc('second', now() - interval '6 minutes') where id = $1`, [failed.id]);
            fake.asked.length = 0;

            expect((await ports.jobs.sweepShop(10_000)).expired).toBe(1);
            expect((await orderRow(lapsed.id)).state).toBe('expired');
            expect((await orderRow(fresh.id)).state).toBe('quoted');
            expect((await orderRow(failed.id)).state, 'a failed order is let be').toBe('failed');
            expect(fake.asked).not.toContain(`sale ${ orderIdOf(failed.id) }`);
            expect(rung).toContainEqual([buyer.id, 'shop']);
        });

        it('asks about an order nobody said they sent every half a minute, and about one that was sent every pass', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const unsent = (await ports.shop.order(buyer.id, 'dice.glow', undefined)).order;
            const sent = (await ports.shop.order(buyer.id, 'pawns.glow', undefined)).order;

            await ports.shop.sent(buyer.id, sent.id, HASH);
            fake.asked.length = 0;

            await ports.jobs.sweepShop(10_000);
            await ports.jobs.sweepShop(10_000);

            expect(fake.asked.filter((one) => one === `sale ${ orderIdOf(unsent.id) }`)).toHaveLength(1);
            expect(fake.asked.filter((one) => one === `sale ${ orderIdOf(sent.id) }`)).toHaveLength(2);
        });

        it('ends a pass when the chain cannot be reached, and changes nothing', async () =>
        {
            const { ports, fake } = door();
            const buyer = await person();
            const order = (await ports.shop.order(buyer.id, 'dice.glow', undefined)).order;

            await ports.shop.order(buyer.id, 'pawns.glow', undefined);
            fake.sell(fake.quotes[0].quote);
            fake.state.away = true;

            const swept = await ports.jobs.sweepShop(10_000);

            expect(swept).toMatchObject({ paid: 0, expired: 0 });
            expect(swept.faults).toHaveLength(1);
            expect((await orderRow(order.id)).state).toBe('quoted');
        });

        it('does nothing where the shop is not open', async () =>
        {
            const { ports } = door(fakeShop(false));

            expect(await ports.jobs.sweepShop(10_000)).toEqual({ paid: 0, refunded: 0, failed: 0, expired: 0, faults: [] });
        });
    });

    describe('the reader\'s wallet and what the shop owes them', () =>
    {
        it('reads the NURA in the wallet and the shop\'s debt to an inviter, and hands the wallet the claim', async () =>
        {
            const { ports, fake } = door();
            const reader = await person();
            const guest = await person({ wallet: false });

            fake.state.balance = 5n * NURA;
            fake.state.earned = { earnings: 3n * NURA, referralBps: 1500 };

            expect(await ports.shop.balance(reader.id)).toEqual({ address: reader.address, wallet: (5n * NURA).toString() });
            expect(await ports.shop.earnings(reader.id)).toEqual({ address: reader.address, earnings: (3n * NURA).toString(), share: 1500 });
            expect(await ports.shop.claim(reader.id)).toMatchObject({ from: reader.address, to: FAKE_SHOP, value: '0x0', chainId: 31337 });
            expect(fake.asked).toContain(`claim ${ reader.address }`);

            fake.state.claimRefuse = 'NothingToClaim';

            expect(await refusal(ports.shop.claim(reader.id))).toEqual({ status: 409, code: 'shop-nothing' });

            for (const call of [() => ports.shop.balance(guest.id), () => ports.shop.earnings(guest.id), () => ports.shop.claim(guest.id)])
            {
                expect(await refusal(call())).toEqual({ status: 409, code: 'shop-wallet' });
            }
        });
    });

    describe('the reader\'s orders', () =>
    {
        it('come newest first, fifty a page, and a cursor that is no cursor reads the first', async () =>
        {
            const { ports } = door();
            const buyer = await person();
            const looks = LOOKS.slice(0, 51);

            await db.getRepository(ShopOrder).insert(looks.map((look, index) => ({
                buyerId: buyer.id,
                recipientId: buyer.id,
                itemId: look.id,
                price: look.price.toString(),
                buyerAddress: buyer.address!.toLowerCase(),
                referrerAddress: null,
                deadline: new Date(Date.now() - 3_600_000),
                state: 'expired' as const,
                createdAt: new Date(Date.now() - (index + 1) * 1_000)
            })));

            const first = await ports.shop.orders(buyer.id, null);
            const second = await ports.shop.orders(buyer.id, first.cursor ?? null);

            expect(first.orders.map((order) => order.item)).toEqual(looks.slice(0, 50).map((look) => look.id));
            expect(second.orders.map((order) => order.item)).toEqual([looks[50].id]);
            expect(second.cursor).toBeUndefined();
            expect((await ports.shop.orders(buyer.id, 'not a cursor')).orders).toHaveLength(50);
        });
    });
});

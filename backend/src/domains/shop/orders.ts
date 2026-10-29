import { In, type DataSource, type EntityManager } from 'typeorm';
import { getAddress, toHex, zeroAddress, type Address, type Hex } from 'viem';

import { itemOf, orderIdOf, type Quote, type ShopAsked, type ShopCall, type ShopChain } from '../../chain/shop.ts';
import { Friendship } from '../../entities/friendship.entity.ts';
import { OwnedItem } from '../../entities/owned-item.entity.ts';
import { Referral } from '../../entities/referral.entity.ts';
import { ShopCollection } from '../../entities/shop-collection.entity.ts';
import { ShopItem } from '../../entities/shop-item.entity.ts';
import { ShopOrder } from '../../entities/shop-order.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { cursorOf, keyOf, keysetAfter, olderThan } from '../../lib/keyset.ts';
import type { ShopOrderView, ShopPaying, ShopPurchase, ShopState } from '../../schemas.ts';
import { OWNER_WALLET } from '../admin/roles.ts';
import { audited, AUDIT_PAGE, nothing, RECENT, type AuditAsk, type Finding } from '../reconcile/audit.ts';
import { orderVerdict, type OrderAfter, type Sold } from '../reconcile/verdicts.ts';
import { FEATURED_FIRST, SHOP_COLLECTIONS, bundleOf, bundlePriceFor, isItemId } from './catalogue.ts';
import type { OrderState, ShopItemStatus, ShopMay } from './policy.ts';
import { shopRefusal } from './service.ts';

/** How long a quote is good for: the shop takes it until then and never after. */
const QUOTE_LIFE = `interval '30 minutes'`;

/** An order asked for again is handed back only while it has this long left to be paid. */
const REUSE_LEAST_S = 120;

/** How long after its deadline an order the shop never sold is let go of: a block's clock can run ahead of this one. */
const LAPSE = `interval '5 minutes'`;

/** How often an order nobody said they sent is asked about: the wallet may have sent it after its tab closed. */
const UNSENT_EVERY_MS = 30_000;

const PAGE = 50;

/** The most orders one pass of the worker looks at. */
const SWEEP_MOST = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrderHooks
{
    /** Whose orders or looks changed: the buyer, and the friend a gift was for. */
    changed(userIds: readonly string[]): void;

    /** A gift has given its recipient a look they lacked; told once, after the delivery commits. */
    gifted(gift: { order: string; buyer: string; recipient: string; item: string }): Promise<void>;
}

export interface ShopSweep
{
    paid: number;
    refunded: number;
    failed: number;
    expired: number;
    faults: { order: string; error: string }[];
}

interface OrderRow
{
    id: string;
    buyer_id: string;
    recipient_id: string;
    recipient: string;
    item_id: string;
    price: string;
    buyer_address: string;
    referrer_address: string | null;
    deadline: Date;
    state: OrderState;
    tx_hash: string | null;
    failure: string | null;
    delivered: boolean | null;
    created_at: Date;
    paid_at: Date | null;
    left_s: number;
    lapsed: boolean;
    at_key: string;
}

interface AuditRow extends OrderRow
{
    buyer: string;
}

/** An order the shop worker is still moving: priced, handed in, or refused by the chain while it can still be paid. */
const IN_HAND = `(o.state in ('quoted', 'sent') or (o.state = 'failed' and o.deadline + ${ LAPSE } >= now()))`;

/** The looks an item stands for: a look itself, or every look of a bundle. */
const looksIn = (item: string): readonly string[] => bundleOf(item)?.looks ?? [item];

const overlaps = (one: string, other: string) => looksIn(one).some((look) => looksIn(other).includes(look));

const walletOf = (alias: string) =>
    `(select w.address from wallets w where w.user_id = ${ alias }.id order by w.last_used_at desc nulls last limit 1)`;

const orderQuery = (from: DataSource | EntityManager) => from.getRepository(ShopOrder)
    .createQueryBuilder('o')
    .innerJoin('users', 'r', 'r.id = o.recipient_id')
    .select('o.id', 'id')
    .addSelect('o.buyer_id', 'buyer_id')
    .addSelect('o.recipient_id', 'recipient_id')
    .addSelect('r.handle::text', 'recipient')
    .addSelect('o.item_id', 'item_id')
    .addSelect('o.price::text', 'price')
    .addSelect('o.buyer_address', 'buyer_address')
    .addSelect('o.referrer_address', 'referrer_address')
    .addSelect('o.deadline', 'deadline')
    .addSelect('o.state', 'state')
    .addSelect('o.tx_hash', 'tx_hash')
    .addSelect('o.failure', 'failure')
    .addSelect('o.delivered', 'delivered')
    .addSelect('o.created_at', 'created_at')
    .addSelect('o.paid_at', 'paid_at')
    .addSelect('greatest(0, extract(epoch from o.deadline - now()))::int', 'left_s')
    .addSelect(`o.deadline + ${ LAPSE } < now()`, 'lapsed')
    .addSelect(keyOf('o.created_at'), 'at_key');

const asOrder = (row: OrderRow): ShopOrderView => ({
    id: row.id,
    item: row.item_id,
    ...(row.recipient_id === row.buyer_id ? {} : { for: row.recipient }),
    price: row.price,
    state: row.state,
    deadline: new Date(row.deadline).toISOString(),
    ...(row.tx_hash === null ? {} : { hash: row.tx_hash }),
    ...(row.failure === null ? {} : { failure: row.failure }),
    ...(row.delivered === null ? {} : { delivered: row.delivered }),
    at: new Date(row.created_at).toISOString(),
    ...(row.paid_at === null ? {} : { paidAt: new Date(row.paid_at).toISOString() })
});

/** The quote an order is, rebuilt from its row the same way every time, so it is signed the same way. */
const quoteOf = (row: OrderRow): Quote => ({
    order: orderIdOf(row.id),
    buyer: getAddress(row.buyer_address),
    item: itemOf(row.item_id),
    price: BigInt(row.price),
    referrer: row.referrer_address === null ? zeroAddress : getAddress(row.referrer_address),
    deadline: BigInt(Math.floor(new Date(row.deadline).getTime() / 1000))
});

const wireOf = (from: Address, call: ShopCall) => ({
    from,
    to: call.to,
    data: call.data,
    value: toHex(call.value),
    chainId: call.chainId,
    ...(call.gasPrice === null ? {} : { gasPrice: toHex(call.gasPrice) })
});

const notOpen = () => shopRefusal('shop-off', 'The shop is not open here.');
const notSelling = () => shopRefusal('shop-closed', 'The shop is not selling right now.');
const noItem = () => shopRefusal('shop-item', 'Nothing by that name is for sale.');
const ownedAlready = () => shopRefusal('shop-owned', 'That look is already theirs.');
const pending = () => shopRefusal('shop-pending', 'An order for that look is already on its way.');
const noFriend = () => shopRefusal('shop-friend', 'You can give a look only to a friend.');
const noOrder = () => shopRefusal('shop-order', 'No order of yours by that name.');

const freeFor = (address: string | null) => address?.toLowerCase() === OWNER_WALLET;

/** What the shop's refusal of a purchase means to whoever asked for it. */
const refusalOf = (error: string, price: string) =>
{
    switch (error)
    {
        case 'InsufficientFunds':
            return shopRefusal('shop-funds', 'Your wallet does not hold enough NURA for this.', { price });
        case 'EnforcedPause':
        case 'InvalidSignature':
            return notSelling();
        case 'OrderSold':
            return pending();
        default:
            return shopRefusal('shop-refused', 'NuraChain would not take this payment.', { error });
    }
};

/**
 * Orders: a look or a bundle priced for a buyer and a recipient (the buyer, or a friend), signed
 * as a quote the buyer pays to `ArcadeShop`, and delivered when the shop says it is sold. This
 * server never holds NURA and never takes the browser's word that something was paid: the worker
 * asks the shop about each order by its id.
 */
export function createOrderService(db: DataSource, shop: ShopChain, hooks: OrderHooks)
{
    /** When each order nobody said they sent was last asked about, in this process. */
    const askedAt = new Map<string, number>();

    const buyerOf = async (me: string) =>
    {
        const row = await db.getRepository(User)
            .createQueryBuilder('u')
            .select('u.is_minor', 'is_minor')
            .addSelect(walletOf('u'), 'address')
            .where('u.id = :me', { me })
            .getRawOne<{ is_minor: boolean; address: string | null }>();
        const may: ShopMay = row === undefined || row.address === null ? 'shop-wallet' : row.is_minor ? 'shop-minor' : 'yes';

        return { may, address: row?.address === null || row?.address === undefined ? null : getAddress(row.address) };
    };

    const mustBuy = async (me: string) =>
    {
        if (!shop.configured)
        {
            throw notOpen();
        }

        return addressOf(await buyerOf(me));
    };

    const addressOf = (buyer: Awaited<ReturnType<typeof buyerOf>>) =>
    {
        if (buyer.may === 'shop-wallet' || buyer.address === null)
        {
            throw shopRefusal('shop-wallet', 'Buying a look needs a wallet account.');
        }

        if (buyer.may === 'shop-minor')
        {
            throw shopRefusal('shop-minor', 'Buying looks is for adults only.');
        }

        return buyer.address;
    };

    /** A friend of the buyer by handle. Nobody, somebody suspended and somebody who is not a friend are one answer. */
    const friendOf = async (me: string, handle: string) =>
    {
        const found = await db.getRepository(User)
            .createQueryBuilder('u')
            .innerJoin(Friendship, 'f', 'f.friend_id = u.id and f.user_id = :me', { me })
            .select('u.id', 'id')
            .where('u.handle = :handle', { handle: handle.trim().replace(/^@/, '') })
            .andWhere('u.is_suspended = false')
            .getRawOne<{ id: string }>();

        if (found === undefined)
        {
            throw noFriend();
        }

        return found.id;
    };

    /** The wallet of whoever brought the buyer in, once that invite counted, unless it is the buyer's own. */
    const referrerOf = async (runner: EntityManager, me: string, buyer: Address) =>
    {
        const found = await runner.getRepository(Referral)
            .createQueryBuilder('f')
            .innerJoin('users', 'i', 'i.id = f.inviter_id and i.is_suspended = false')
            .select(walletOf('i'), 'address')
            .where('f.invitee_id = :me', { me })
            .andWhere('f.counted_at is not null')
            .getRawOne<{ address: string | null }>();
        const address = found?.address ?? null;

        return address === null || address.toLowerCase() === buyer.toLowerCase() ? null : address.toLowerCase();
    };

    /** What `item` costs the recipient now: its price or its sale's, a bundle priced down for the looks of it they own. */
    const priceFor = async (runner: EntityManager, item: string, recipientId: string) =>
    {
        const bundle = bundleOf(item);
        const looks = looksIn(item);
        const rows = await runner.getRepository(ShopItem)
            .createQueryBuilder('s')
            .select('s.id', 'id')
            .addSelect('s.status', 'status')
            .addSelect('(case when s.sale_until > now() then s.sale_price else s.price end)::text', 'price')
            .where('s.id in (:...ids)', { ids: bundle === undefined ? [item] : [item, ...looks] })
            .getRawMany<{ id: string; status: ShopItemStatus; price: string }>();
        const byId = new Map(rows.map((row) => [row.id, row]));
        const asked = byId.get(item);

        if (asked === undefined || asked.status !== 'on-sale')
        {
            throw noItem();
        }

        const owned = new Set((await runner.getRepository(OwnedItem).find({ select: { itemId: true }, where: { userId: recipientId, itemId: In(looks) } })).map((one) => one.itemId));
        const price = bundle === undefined
            ? BigInt(asked.price)
            : bundlePriceFor(BigInt(asked.price), looks.map((look) => ({ price: BigInt(byId.get(look)?.price ?? '0'), owned: owned.has(look) })));

        if (looks.every((look) => owned.has(look)) || price <= 0n)
        {
            throw ownedAlready();
        }

        return price;
    };

    /**
     * The order a purchase pays: the one the buyer already holds for this look and this recipient
     * while it has time left, or a new one. One recipient's orders are written one at a time, and
     * none is written while another that could still be paid holds any of the same looks, so a look
     * is never sold twice to one person.
     */
    const place = async (me: string, buyer: Address, item: string, recipientId: string) => await db.transaction(async (tx) =>
    {
        // No repository can take an advisory lock.
        await tx.query(`select pg_advisory_xact_lock(hashtext('shop:recipient'), hashtext($1))`, [recipientId]);

        const open = await orderQuery(tx)
            .where('o.recipient_id = :recipientId', { recipientId })
            .andWhere(`(o.state in ('quoted', 'sent') or (o.state = 'failed' and o.deadline > now()))`)
            .getRawMany<OrderRow>();
        const again = open.find((one) => one.item_id === item && one.buyer_id === me);

        if (again !== undefined)
        {
            if (again.left_s < REUSE_LEAST_S)
            {
                throw pending();
            }

            if (again.state === 'failed')
            {
                await tx.getRepository(ShopOrder).update(again.id, { state: 'quoted', failure: null, txHash: null, sentAt: null });

                return { row: { ...again, state: 'quoted' as const, failure: null, tx_hash: null }, fresh: false };
            }

            return { row: again, fresh: false };
        }

        if (open.some((one) => overlaps(one.item_id, item)))
        {
            throw pending();
        }

        const price = await priceFor(tx, item, recipientId);
        const { identifiers } = await tx.getRepository(ShopOrder).insert({
            buyerId: me,
            recipientId,
            itemId: item,
            price: price.toString(),
            buyerAddress: buyer.toLowerCase(),
            referrerAddress: await referrerOf(tx, me, buyer),
            deadline: () => `date_trunc('second', now() + ${ QUOTE_LIFE })`,
            state: 'quoted'
        });
        const row = await orderQuery(tx).where('o.id = :id', { id: identifiers[0].id }).getRawOne<OrderRow>();

        return { row: row!, fresh: true };
    });

    const forget = (id: string) => db.getRepository(ShopOrder).delete({ id, state: 'quoted' });

    /**
     * A look given to the free buyer, or every look of a bundle they lack, under the lock their
     * orders are placed under; refused as a purchase is when it is not for sale, already theirs, or
     * held by an order of theirs that could still be paid.
     */
    const giveFree = async (me: string, item: string) =>
    {
        await db.transaction(async (tx) =>
        {
            // No repository can take an advisory lock.
            await tx.query(`select pg_advisory_xact_lock(hashtext('shop:recipient'), hashtext($1))`, [me]);

            const open = await orderQuery(tx)
                .where('o.recipient_id = :me', { me })
                .andWhere(`(o.state in ('quoted', 'sent') or (o.state = 'failed' and o.deadline > now()))`)
                .getRawMany<OrderRow>();

            if (open.some((one) => overlaps(one.item_id, item)))
            {
                throw pending();
            }

            await priceFor(tx, item, me);
            await tx.getRepository(OwnedItem)
                .createQueryBuilder()
                .insert()
                .values(looksIn(item).map((itemId) => ({ userId: me, itemId, via: 'grant' as const, orderId: null, giverId: null })))
                .orIgnore()
                .execute();
        });

        hooks.changed([me]);
    };

    const one = async (me: string, id: string) =>
    {
        const row = UUID.test(id)
            ? await orderQuery(db).where('o.id = :id and o.buyer_id = :me', { id, me }).getRawOne<OrderRow>()
            : undefined;

        if (row === undefined)
        {
            throw noOrder();
        }

        return asOrder(row);
    };

    /** Gives the recipient every look of a sold order they lack, or marks one the shop refunded, under the order's lock. */
    const deliver = async (row: OrderRow, refunded: boolean) =>
    {
        const done = await db.transaction(async (tx) =>
        {
            const order = await tx.getRepository(ShopOrder).findOne({ where: { id: row.id }, lock: { mode: 'pessimistic_write' } });

            if (order === null || order.state === 'paid' || order.state === 'refunded')
            {
                return null;
            }

            if (refunded)
            {
                await tx.getRepository(ShopOrder).update(order.id, { state: 'refunded', paidAt: () => 'now()', refundedAt: () => 'now()', delivered: false, failure: null });

                return { state: 'refunded' as const, gave: false };
            }

            const gift = order.buyerId !== order.recipientId;
            const added = await tx.getRepository(OwnedItem)
                .createQueryBuilder()
                .insert()
                .values(looksIn(order.itemId).map((itemId) => ({
                    userId: order.recipientId,
                    itemId,
                    via: gift ? 'gift' as const : 'purchase' as const,
                    orderId: order.id,
                    giverId: gift ? order.buyerId : null
                })))
                .orIgnore()
                .returning(['itemId'])
                .execute();

            const delivered = (added.raw as unknown[]).length > 0;

            await tx.getRepository(ShopOrder).update(order.id, { state: 'paid', paidAt: () => 'now()', delivered, failure: null });

            return { state: 'paid' as const, gave: delivered && gift };
        });

        if (done === null)
        {
            return null;
        }

        hooks.changed([...new Set([row.buyer_id, row.recipient_id])]);

        if (done.gave)
        {
            await hooks.gifted({ order: row.id, buyer: row.buyer_id, recipient: row.recipient_id, item: row.item_id });
        }

        return done.state;
    };

    const expire = async (row: OrderRow) =>
    {
        const { affected } = await db.getRepository(ShopOrder)
            .createQueryBuilder()
            .update()
            .set({ state: 'expired', failure: null })
            .where('id = :id', { id: row.id })
            .andWhere(`state in ('quoted', 'sent')`)
            .andWhere(`deadline + ${ LAPSE } < now()`)
            .execute();

        if (affected === 0)
        {
            return null;
        }

        hooks.changed([row.buyer_id]);

        return 'expired' as const;
    };

    /** The word the shop gives a payment for this order now; a transaction it would take now was refused for its gas. */
    const why = async (row: OrderRow) =>
    {
        try
        {
            const quote = quoteOf(row);
            const asked = await shop.buyCall(quote, await shop.sign(quote));

            return asked.ok ? 'reverted' : asked.refusal.error;
        }
        catch
        {
            return 'reverted';
        }
    };

    const fail = async (row: OrderRow) =>
    {
        const { affected } = await db.getRepository(ShopOrder)
            .createQueryBuilder()
            .update()
            .set({ state: 'failed', failure: (await why(row)).slice(0, 48) })
            .where('id = :id and tx_hash = :hash', { id: row.id, hash: row.tx_hash })
            .andWhere(`state = 'sent'`)
            .execute();

        if (affected === 0)
        {
            return null;
        }

        hooks.changed([row.buyer_id]);

        return 'failed' as const;
    };

    /**
     * An order the shop holds a sale of that is not the one quoted, to another wallet or at another
     * price: only a quote nobody here signed can make one, so nothing is delivered and the order is
     * left failed for a person, which the reconciliation then finds.
     */
    const mismatched = async (row: OrderRow) =>
    {
        const { affected } = await db.getRepository(ShopOrder)
            .createQueryBuilder()
            .update()
            .set({ state: 'failed', failure: 'mismatch' })
            .where('id = :id', { id: row.id })
            .andWhere(`state in ('quoted', 'sent')`)
            .execute();

        if (affected === 0)
        {
            return null;
        }

        hooks.changed([row.buyer_id]);

        return 'failed' as const;
    };

    /** One order asked of the shop: delivered once sold as it was quoted, failed when its transaction was refused, expired once it can never be paid. */
    const settle = async (row: OrderRow, tally: ShopSweep) =>
    {
        const sale = await shop.saleOf(orderIdOf(row.id));

        if (sale.buyer !== null)
        {
            if (sale.buyer.toLowerCase() === row.buyer_address && sale.price === BigInt(row.price))
            {
                return await deliver(row, sale.refunded);
            }

            const step = await mismatched(row);

            if (step !== null)
            {
                tally.faults.push({ order: row.id, error: `mismatch:${ row.id }` });
            }

            return step;
        }

        if (row.state === 'sent' && row.tx_hash !== null && await shop.mined(row.tx_hash as Hex) === 'reverted')
        {
            return await fail(row);
        }

        return row.lapsed && row.state !== 'failed' ? await expire(row) : null;
    };

    const auditQuery = () => orderQuery(db).innerJoin('users', 'b', 'b.id = o.buyer_id').addSelect('b.handle::text', 'buyer');

    /**
     * One order no worker is moving, against the sale the shop holds under its id. A sale the shop
     * holds for an order that ran out or failed here is delivered by the worker's own `deliver`; a
     * sale to anybody or at any price but the quote's is a quote this server never signed.
     */
    const compared = async (row: AuditRow) =>
    {
        if (row.state === 'quoted' || row.state === 'sent' || (row.state === 'failed' && !row.lapsed))
        {
            return null;
        }

        const sale = await shop.saleOf(orderIdOf(row.id));
        const quoted = sale.buyer?.toLowerCase() === row.buyer_address && sale.price === BigInt(row.price);
        const sold: Sold = sale.buyer === null ? 'unsold' : !quoted ? 'other' : sale.refunded ? 'refunded' : 'sold';
        const verdict = orderVerdict(row.state as OrderAfter, sold);
        const about = {
            item: row.item_id,
            amount: row.price,
            who: row.buyer,
            ...(row.recipient_id === row.buyer_id ? {} : { to: row.recipient }),
            ...(row.tx_hash === null ? {} : { tx: row.tx_hash })
        };

        if (verdict === 'agree')
        {
            return [];
        }

        if (sold === 'other')
        {
            return [{
                record: row.id,
                kind: 'order-sale' as const,
                db: { amount: row.price, address: row.buyer_address },
                chain: { amount: sale.price.toString(), address: sale.buyer?.toLowerCase() ?? '' },
                about
            }];
        }

        const finding: Finding = { record: row.id, kind: 'order-state', db: { state: row.state }, chain: { state: sold }, about };

        if (verdict !== 'put-right')
        {
            return [finding];
        }

        return await deliver(row, sold === 'refunded') === null ? [] : [{ ...finding, putRight: true as const }];
    };

    /** An order for a look or a bundle, for the buyer or a friend by handle, and the call their wallet sends to pay it. */
    const orderAs = async (me: string, buyer: Address, item: string, recipient: string | undefined): Promise<ShopPaying> =>
    {
        if (!isItemId(item))
        {
            throw noItem();
        }

        const recipientId = recipient === undefined ? me : await friendOf(me, recipient);
        const placed = await place(me, buyer, item, recipientId);
        const quote = quoteOf(placed.row);
        let asked: ShopAsked;

        try
        {
            // Asked of the wallet itself: not every node refuses a call that carries more than its sender holds.
            if (await shop.balanceOf(buyer) < quote.price)
            {
                throw refusalOf('InsufficientFunds', placed.row.price);
            }

            asked = await shop.buyCall(quote, await shop.sign(quote));
        }
        catch (error)
        {
            if (placed.fresh)
            {
                await forget(placed.row.id);
            }

            throw error;
        }

        if (!asked.ok)
        {
            if (placed.fresh)
            {
                await forget(placed.row.id);
            }

            throw refusalOf(asked.refusal.error, placed.row.price);
        }

        hooks.changed([me]);

        return { order: asOrder(placed.row), call: wireOf(buyer, asked.call) };
    };

    return {
        async state(me: string): Promise<ShopState>
        {
            const [items, featured, buyer] = await Promise.all([
                db.getRepository(ShopItem)
                    .createQueryBuilder('s')
                    .select('s.id', 'id')
                    .addSelect('s.price::text', 'price')
                    .addSelect('s.sale_price::text', 'sale_price')
                    .addSelect('s.sale_until', 'sale_until')
                    .addSelect('s.sale_until > now()', 'on_sale')
                    .where(`s.status = 'on-sale'`)
                    .orderBy('s.id')
                    .getRawMany<{ id: string; price: string; sale_price: string | null; sale_until: Date | null; on_sale: boolean | null }>(),
                db.getRepository(ShopCollection)
                    .createQueryBuilder('c')
                    .select('c.id', 'id')
                    .where('c.featured_at is not null')
                    .orderBy('c.featured_at', 'DESC')
                    .limit(1)
                    .getRawOne<{ id: string }>(),
                buyerOf(me)
            ]);

            const catalogue = {
                items: items.map((row) => ({
                    id: row.id,
                    price: row.price,
                    ...(row.on_sale === true && row.sale_price !== null && row.sale_until !== null
                        ? { sale: { price: row.sale_price, until: new Date(row.sale_until).toISOString() } }
                        : {})
                })),
                featured: SHOP_COLLECTIONS.find((collection) => collection === featured?.id) ?? FEATURED_FIRST,
                may: buyer.may,
                ...(buyer.may === 'yes' && freeFor(buyer.address) ? { free: true as const } : {})
            };

            return shop.configured ? { open: true as const, chainId: shop.chainId, ...catalogue } : { open: false as const, ...catalogue };
        },

        async balance(me: string)
        {
            const address = await mustBuy(me);

            return { address, wallet: (await shop.balanceOf(address)).toString() };
        },

        order: async (me: string, item: string, recipient: string | undefined) => await orderAs(me, await mustBuy(me), item, recipient),

        /** What Buy does: the free buyer's own look given at once, anybody else's purchase an order to pay. */
        async purchase(me: string, item: string, recipient: string | undefined): Promise<ShopPurchase>
        {
            const buyer = await buyerOf(me);

            if (recipient !== undefined || buyer.may !== 'yes' || !freeFor(buyer.address))
            {
                if (!shop.configured)
                {
                    throw notOpen();
                }

                return await orderAs(me, addressOf(buyer), item, recipient);
            }

            if (!isItemId(item))
            {
                throw noItem();
            }

            await giveFree(me, item);

            return { given: true };
        },

        async orders(me: string, cursor: string | null)
        {
            const after = keysetAfter(cursor);
            const query = orderQuery(db).where('o.buyer_id = :me', { me });

            if (after !== null)
            {
                query.andWhere(olderThan('o.created_at', 'o.id'), after);
            }

            const rows = await query.orderBy('o.created_at', 'DESC').addOrderBy('o.id', 'DESC').limit(PAGE + 1).getRawMany<OrderRow>();

            return { orders: rows.slice(0, PAGE).map(asOrder), ...cursorOf(rows, PAGE) };
        },

        one,

        /** The transaction the buyer's wallet sent for an order: it says what NuraChain did with it, and nothing is delivered for it. */
        async sent(me: string, id: string, hash: string)
        {
            if (!UUID.test(id))
            {
                throw noOrder();
            }

            try
            {
                await db.getRepository(ShopOrder)
                    .createQueryBuilder()
                    .update()
                    .set({ state: 'sent', txHash: hash.toLowerCase(), sentAt: () => 'now()', failure: null })
                    .where('id = :id and buyer_id = :me', { id, me })
                    .andWhere(`state in ('quoted', 'sent', 'failed')`)
                    .execute();
            }
            catch (error)
            {
                if ((error as { driverError?: { code?: string } }).driverError?.code === '23505')
                {
                    throw shopRefusal('shop-hash', 'That transaction is another order\'s.');
                }

                throw error;
            }

            const order = await one(me, id);

            hooks.changed([me]);

            return order;
        },

        async earnings(me: string)
        {
            if (!shop.configured)
            {
                throw notOpen();
            }

            const { address } = await buyerOf(me);

            if (address === null)
            {
                throw shopRefusal('shop-wallet', 'Earning from the shop needs a wallet account.');
            }

            const earned = await shop.earnedBy(address);

            return { address, earnings: earned.earnings.toString(), share: earned.referralBps };
        },

        async claim(me: string)
        {
            if (!shop.configured)
            {
                throw notOpen();
            }

            const { address } = await buyerOf(me);

            if (address === null)
            {
                throw shopRefusal('shop-wallet', 'Earning from the shop needs a wallet account.');
            }

            const asked = await shop.claimCall(address);

            if (!asked.ok)
            {
                throw asked.refusal.error === 'NothingToClaim'
                    ? shopRefusal('shop-nothing', 'There is nothing to claim yet.')
                    : shopRefusal('shop-refused', 'NuraChain would not take this claim.', { error: asked.refusal.error });
            }

            return wireOf(address, asked.call);
        },

        /** Every order no worker is moving, against what the shop holds: one paid whatever its age, any other made in the last week, and those with a disagreement open. */
        async audit({ ids, after, deadline }: AuditAsk)
        {
            if (!shop.configured)
            {
                return nothing();
            }

            const known = ids.filter((id) => UUID.test(id));
            const again = known.length === 0 ? [] : await auditQuery().where('o.id = any(:ids::uuid[])', { ids: known }).getRawMany<AuditRow>();
            const from = keysetAfter(after);
            const page = auditQuery()
                .where(`not ${ IN_HAND }`)
                .andWhere(`(o.state = 'paid' or o.created_at > now() - ${ RECENT })`);

            if (from !== null)
            {
                page.andWhere(olderThan('o.created_at', 'o.id'), from);
            }

            const rows = await page.orderBy('o.created_at', 'DESC').addOrderBy('o.id', 'DESC').limit(AUDIT_PAGE + 1).getRawMany<AuditRow>();

            return await audited({ again, page: rows, after }, deadline, compared);
        },

        /**
         * One pass over every order the shop could still sell, oldest first: each is asked of the
         * shop by its id. An order nobody said they sent is asked about every half a minute and
         * once its deadline has passed; one the buyer sent, every pass. A chain that cannot be
         * reached ends the pass, so the next one tries again.
         */
        async sweep(budgetMs: number)
        {
            const tally: ShopSweep = { paid: 0, refunded: 0, failed: 0, expired: 0, faults: [] };

            if (!shop.configured)
            {
                return tally;
            }

            const began = performance.now();
            const rows = await orderQuery(db)
                .where(`o.state in ('quoted', 'sent') or (o.state = 'failed' and o.deadline + ${ LAPSE } >= now())`)
                .orderBy('o.created_at', 'ASC')
                .limit(SWEEP_MOST)
                .getRawMany<OrderRow>();
            const watched = new Set(rows.map((row) => row.id));

            for (const id of askedAt.keys())
            {
                if (!watched.has(id))
                {
                    askedAt.delete(id);
                }
            }

            for (const row of rows)
            {
                if (performance.now() - began > budgetMs)
                {
                    break;
                }

                const now = Date.now();

                if (row.state === 'quoted' && !row.lapsed && now - (askedAt.get(row.id) ?? 0) < UNSENT_EVERY_MS)
                {
                    continue;
                }

                askedAt.set(row.id, now);

                try
                {
                    const step = await settle(row, tally);

                    if (step !== null)
                    {
                        tally[step] += 1;
                    }
                }
                catch (error)
                {
                    tally.faults.push({ order: row.id, error: error instanceof Error ? error.message : String(error) });

                    if ((error as { status?: number }).status === 503)
                    {
                        break;
                    }
                }
            }

            return tally;
        }
    };
}

export type OrderService = ReturnType<typeof createOrderService>;

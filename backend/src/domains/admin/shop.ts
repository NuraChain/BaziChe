import type { DataSource, EntityManager } from 'typeorm';

import { ShopCollection, ShopItem, ShopOrder, User } from '../../entities/index.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import type { AdminShop, AdminShopOrders } from '../../schemas.ts';
import { FEATURED_FIRST, LOOKS, SHOP_COLLECTIONS, bundleOf, lookOf, type ShopCollection as Collection } from '../shop/catalogue.ts';
import type { OrderState, ShopItemStatus } from '../shop/policy.ts';
import { SHOP_ORDERS_PAGE, type SaleHours } from './roles.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

/** Every look and bundle in the order the shop shows them: each collection's looks, then its bundle. */
const ORDERED = SHOP_COLLECTIONS.flatMap((collection) => [...LOOKS.filter((look) => look.collection === collection).map((look) => look.id), `bundle.${ collection }`]);

/** One change the staff make to a look or a bundle: its price, a sale for a time or the end of one (`false`), or its status. */
export interface ShopChange
{
    price?: string;
    sale?: { price: string; hours: SaleHours } | false;
    status?: ShopItemStatus;
}

export interface OrderFilters
{
    state?: OrderState;
    item?: string;
    person?: string;
    cursor?: string;
}

interface ItemRow
{
    id: string;
    price: string;
    sale_price: string | null;
    sale_until: Date | null;
    status: ShopItemStatus;
    sold: number;
}

interface HeldRow
{
    price: string;
    sale_price: string | null;
    running: boolean;
    status: ShopItemStatus;
}

interface OrderRow extends Keyed
{
    item_id: string;
    price: string;
    state: OrderState;
    created_at: Date;
    paid_at: Date | null;
    tx_hash: string | null;
    delivered: boolean | null;
    failure: string | null;
    buyer_handle: string;
    buyer_name: string;
    buyer_hue: number;
    buyer_avatar: string | null;
    gift: boolean;
    for_handle: string;
    for_name: string;
    for_hue: number;
    for_avatar: string | null;
}

const face = (handle: string, displayName: string, hue: number, avatar: string | null) => ({
    handle,
    displayName,
    hue,
    ...(avatar === null ? {} : { avatar })
});

const listedOf = (id: string) => (lookOf(id) ?? bundleOf(id))?.price.toString() ?? '0';

const below = (one: string, other: string) => BigInt(one) < BigInt(other);

/** Admin › Shop: the catalogue as the staff run it, each change to it written to the log, the featured collection, and the orders. */
export function createShopAdmin(db: DataSource)
{
    const featuredIn = async (manager: EntityManager) =>
    {
        const newest = await manager.getRepository(ShopCollection).createQueryBuilder('c')
            .select('c.id', 'id')
            .where('c.featured_at is not null')
            .orderBy('c.featured_at', 'DESC')
            .limit(1)
            .getRawOne<{ id: string }>();

        return SHOP_COLLECTIONS.find((one) => one === newest?.id) ?? FEATURED_FIRST;
    };

    /** A sale that has run out is no sale, so it is never shown and never stands in the way of a price. */
    const setSale = async (tx: EntityManager, id: string, sale: { price: string; hours: SaleHours } | null) =>
    {
        await tx.createQueryBuilder()
            .update(ShopItem)
            .set(sale === null
                ? { salePrice: null, saleUntil: null, updatedAt: () => 'now()' }
                : { salePrice: sale.price, saleUntil: () => `now() + cast(:hours as int) * interval '1 hour'`, updatedAt: () => 'now()' })
            .where('id = :id', { id, ...(sale === null ? {} : { hours: sale.hours }) })
            .execute();
    };

    return {
        async read(): Promise<AdminShop>
        {
            const rows = await db.getRepository(ShopItem).createQueryBuilder('i')
                .select('i.id', 'id')
                .addSelect('i.price::text', 'price')
                .addSelect('case when i.sale_until > now() then i.sale_price::text end', 'sale_price')
                .addSelect('case when i.sale_until > now() then i.sale_until end', 'sale_until')
                .addSelect('i.status', 'status')
                .addSelect(`(select count(*) from shop_orders o where o.item_id = i.id and o.state = 'paid')::int`, 'sold')
                .getRawMany<ItemRow>();
            const byId = new Map(rows.map((row) => [row.id, row]));

            return {
                featured: await featuredIn(db.manager),
                items: ORDERED.flatMap((id) =>
                {
                    const row = byId.get(id);

                    return row === undefined
                        ? []
                        : [{
                            id,
                            price: row.price,
                            listed: listedOf(id),
                            ...(row.sale_price === null || row.sale_until === null ? {} : { sale: { price: row.sale_price, until: row.sale_until.toISOString() } }),
                            status: row.status,
                            sold: row.sold
                        }];
                })
            };
        },

        /** One change to a look or a bundle under its row's lock, written to the log with the reason: `false` when it changes nothing, `null` for an id the shop does not hold. */
        async change(actor: Actor, id: string, change: ShopChange, reason: string)
        {
            if ([change.price, change.sale, change.status].filter((one) => one !== undefined).length !== 1)
            {
                throw staffRefusal('staff-shop-one', 'Change one thing at a time: the price, the sale or whether it is offered.');
            }

            return await db.transaction(async (tx) =>
            {
                const held = await tx.getRepository(ShopItem).createQueryBuilder('i')
                    .select('i.price::text', 'price')
                    .addSelect('i.sale_price::text', 'sale_price')
                    .addSelect('coalesce(i.sale_until > now(), false)', 'running')
                    .addSelect('i.status', 'status')
                    .where('i.id = :id', { id })
                    .setLock('pessimistic_write')
                    .getRawOne<HeldRow>();

                if (held === undefined)
                {
                    return null;
                }

                const running = held.running ? held.sale_price : null;
                const log = (details: Record<string, string>) => record(tx, actor, { kind: 'shop-item', reason, details: { item: id, ...details } });

                if (change.price !== undefined)
                {
                    if (change.price === held.price)
                    {
                        return false;
                    }

                    if (running !== null && !below(running, change.price))
                    {
                        throw staffRefusal('staff-shop-sale', 'A look on sale has to cost more than its sale. End the sale first.');
                    }

                    if (running === null && held.sale_price !== null)
                    {
                        await setSale(tx, id, null);
                    }

                    await tx.getRepository(ShopItem).update({ id }, { price: change.price, updatedAt: () => 'now()' });
                    await log({ field: 'price', from: held.price, to: change.price });

                    return true;
                }

                if (change.sale === false)
                {
                    if (running === null)
                    {
                        return false;
                    }

                    await setSale(tx, id, null);
                    await log({ field: 'sale', from: running });

                    return true;
                }

                if (change.sale !== undefined)
                {
                    if (!below(change.sale.price, held.price))
                    {
                        throw staffRefusal('staff-shop-sale', 'A sale has to cost less than the look.');
                    }

                    await setSale(tx, id, change.sale);
                    await log({ field: 'sale', ...(running === null ? {} : { from: running }), to: change.sale.price, hours: String(change.sale.hours) });

                    return true;
                }

                if (change.status === undefined || change.status === held.status)
                {
                    return false;
                }

                await tx.getRepository(ShopItem).update({ id }, { status: change.status, updatedAt: () => 'now()' });
                await log({ field: 'status', from: held.status, to: change.status });

                return true;
            });
        },

        /** The collection on top of the shop, chosen with a reason; every collection's row is locked, so two choices made at once go one after the other. */
        async feature(actor: Actor, collection: Collection, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                await tx.getRepository(ShopCollection).createQueryBuilder('c').setLock('pessimistic_write').orderBy('c.id').getMany();

                const from = await featuredIn(tx);

                if (from === collection)
                {
                    return false;
                }

                // A choice that waited for the lock began before the one it waited for, and its own now() is the earlier.
                await tx.createQueryBuilder()
                    .update(ShopCollection)
                    .set({ featuredAt: () => `greatest(now(), (select max(featured_at) from shop_collections) + interval '1 microsecond')` })
                    .where('id = :id', { id: collection })
                    .execute();
                await record(tx, actor, { kind: 'shop-feature', reason, details: { from, to: collection } });

                return true;
            });
        },

        /** The orders newest first, fifty a page by keyset over when each was placed, by state, look, and the person who paid or was given it. */
        async orders(filters: OrderFilters): Promise<AdminShopOrders>
        {
            const after = keysetAfter(filters.cursor);
            const query = db.getRepository(ShopOrder).createQueryBuilder('o')
                .innerJoin(User, 'b', 'b.id = o.buyer_id')
                .innerJoin(User, 'r', 'r.id = o.recipient_id')
                .select('o.id', 'id')
                .addSelect(keyOf('o.created_at'), 'at_key')
                .addSelect('o.item_id', 'item_id')
                .addSelect('o.price::text', 'price')
                .addSelect('o.state', 'state')
                .addSelect('o.created_at', 'created_at')
                .addSelect('o.paid_at', 'paid_at')
                .addSelect('o.tx_hash', 'tx_hash')
                .addSelect('o.delivered', 'delivered')
                .addSelect('o.failure', 'failure')
                .addSelect('b.handle', 'buyer_handle')
                .addSelect('b.display_name', 'buyer_name')
                .addSelect('b.hue', 'buyer_hue')
                .addSelect('b.avatar', 'buyer_avatar')
                .addSelect('o.recipient_id <> o.buyer_id', 'gift')
                .addSelect('r.handle', 'for_handle')
                .addSelect('r.display_name', 'for_name')
                .addSelect('r.hue', 'for_hue')
                .addSelect('r.avatar', 'for_avatar');

            if (filters.state !== undefined)
            {
                query.andWhere('o.state = :state', { state: filters.state });
            }

            if (filters.item !== undefined && filters.item !== '')
            {
                query.andWhere('o.item_id = :item', { item: filters.item });
            }

            if (filters.person !== undefined && filters.person.replace(/^@/, '') !== '')
            {
                query.andWhere('(b.handle = :person or r.handle = :person)', { person: filters.person.replace(/^@/, '') });
            }

            if (after !== null)
            {
                query.andWhere(olderThan('o.created_at', 'o.id'), after);
            }

            const rows = await query
                .orderBy('o.created_at', 'DESC')
                .addOrderBy('o.id', 'DESC')
                .limit(SHOP_ORDERS_PAGE + 1)
                .getRawMany<OrderRow>();

            return {
                rows: rows.slice(0, SHOP_ORDERS_PAGE).map((row) => ({
                    id: row.id,
                    item: row.item_id,
                    price: row.price,
                    state: row.state,
                    buyer: face(row.buyer_handle, row.buyer_name, row.buyer_hue, row.buyer_avatar),
                    ...(row.gift ? { for: face(row.for_handle, row.for_name, row.for_hue, row.for_avatar) } : {}),
                    at: row.created_at.toISOString(),
                    ...(row.paid_at === null ? {} : { paidAt: row.paid_at.toISOString() }),
                    ...(row.tx_hash === null ? {} : { hash: row.tx_hash }),
                    ...(row.delivered === null ? {} : { delivered: row.delivered }),
                    ...(row.failure === null ? {} : { failure: row.failure })
                })),
                ...cursorOf(rows, SHOP_ORDERS_PAGE)
            };
        }
    };
}

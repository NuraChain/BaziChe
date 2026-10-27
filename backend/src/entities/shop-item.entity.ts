import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

import type { ShopItemStatus } from '../domains/shop/policy.ts';

/**
 * What the shop asks for one look or bundle of `domains/shop/catalogue.ts`, and whether it sells
 * it. The catalogue names everything that exists; this row is the staff's: the seed writes a
 * price and a status once, and never again.
 */
@Check('shop_items_id_shape', `id ~ '^[a-z]+\\.[a-z]+$'`)
@Check('shop_items_price_positive', `price > 0`)
@Check('shop_items_sale_whole', `(sale_price is null) = (sale_until is null)`)
@Check('shop_items_sale_below', `sale_price is null or (sale_price > 0 and sale_price < price)`)
@Check('shop_items_status_known', `status in ('on-sale', 'hidden', 'retired')`)
@Entity('shop_items')
export class ShopItem
{
    @PrimaryColumn({ type: 'varchar', length: 40 })
    id!: string;

    /** Wei. */
    @Column({ type: 'numeric', precision: 40, scale: 0 })
    price!: string;

    @Column({ name: 'sale_price', type: 'numeric', precision: 40, scale: 0, nullable: true })
    salePrice!: string | null;

    @Column({ name: 'sale_until', type: 'timestamptz', nullable: true })
    saleUntil!: Date | null;

    @Column({ type: 'varchar', length: 16 })
    status!: ShopItemStatus;

    @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
    updatedAt!: Date;
}

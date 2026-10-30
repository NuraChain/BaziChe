import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ShopItem } from './shop-item.entity.ts';
import { ShopOrder } from './shop-order.entity.ts';
import { User } from './user.entity.ts';

import type { OwnedVia } from '../domains/shop/policy.ts';

/** A look somebody owns, for good. A bundle is never owned: its looks are. */
@Check('owned_items_look', `item_id not like 'bundle.%'`)
@Check('owned_items_via_known', `via in ('purchase', 'gift', 'grant', 'reward')`)
@Check('owned_items_giver_gives', `via = 'gift' or giver_id is null`)
@Entity('owned_items')
export class OwnedItem
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ name: 'item_id', type: 'varchar', length: 40 })
    itemId!: string;

    @Column({ type: 'varchar', length: 16 })
    via!: OwnedVia;

    @Column({ name: 'order_id', type: 'uuid', nullable: true })
    orderId!: string | null;

    @Column({ name: 'giver_id', type: 'uuid', nullable: true })
    giverId!: string | null;

    @CreateDateColumn({ name: 'acquired_at', type: 'timestamptz' })
    acquiredAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => ShopItem)
    @JoinColumn({ name: 'item_id', referencedColumnName: 'id' })
    item!: ShopItem;

    @ManyToOne(() => ShopOrder, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'order_id', referencedColumnName: 'id' })
    order!: ShopOrder | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'giver_id', referencedColumnName: 'id' })
    giver!: User | null;
}

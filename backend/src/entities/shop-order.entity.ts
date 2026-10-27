import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ShopItem } from './shop-item.entity.ts';
import { User } from './user.entity.ts';

import type { OrderState } from '../domains/shop/policy.ts';

/**
 * One order: a look or a bundle priced for one buyer and one recipient (the buyer, or a friend),
 * signed as a quote the buyer pays to `ArcadeShop`. Delivered when the contract says it is sold.
 */
@Check('shop_orders_state_known', `state in ('quoted', 'sent', 'paid', 'expired', 'failed', 'refunded')`)
@Check('shop_orders_price_positive', `price > 0`)
@Check('shop_orders_buyer_shape', `buyer_address ~ '^0x[0-9a-f]{40}$'`)
@Check('shop_orders_referrer_shape', `referrer_address is null or referrer_address ~ '^0x[0-9a-f]{40}$'`)
@Check('shop_orders_hash_shape', `tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'`)
@Check('shop_orders_sent_has_hash', `state <> 'sent' or tx_hash is not null`)
@Check('shop_orders_paid_when', `(state in ('paid', 'refunded')) = (paid_at is not null)`)
@Check('shop_orders_delivered_when', `(state in ('paid', 'refunded')) = (delivered is not null)`)
@Check('shop_orders_refunded_when', `(state = 'refunded') = (refunded_at is not null)`)
@Check('shop_orders_failure_when', `(state = 'failed') = (failure is not null)`)
@Index('shop_orders_open', ['recipientId', 'itemId'], { unique: true, where: `state in ('quoted', 'sent')` })
@Index('shop_orders_hash', ['txHash'], { unique: true, where: 'tx_hash is not null' })
@Index('shop_orders_pending', ['state', 'createdAt'], { where: `state in ('quoted', 'sent')` })
@Index('shop_orders_buyer', ['buyerId', 'createdAt'])
@Entity('shop_orders')
export class ShopOrder
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'buyer_id', type: 'uuid' })
    buyerId!: string;

    @Column({ name: 'recipient_id', type: 'uuid' })
    recipientId!: string;

    @Column({ name: 'item_id', type: 'varchar', length: 40 })
    itemId!: string;

    /** Wei, as quoted. */
    @Column({ type: 'numeric', precision: 40, scale: 0 })
    price!: string;

    /** The wallet the quote names, the only one that may pay it. */
    @Column({ name: 'buyer_address', type: 'varchar', length: 42 })
    buyerAddress!: string;

    @Column({ name: 'referrer_address', type: 'varchar', length: 42, nullable: true })
    referrerAddress!: string | null;

    @Column({ type: 'timestamptz' })
    deadline!: Date;

    @Column({ type: 'varchar', length: 16 })
    state!: OrderState;

    @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
    txHash!: string | null;

    /** The word the chain refused the transaction with. */
    @Column({ type: 'varchar', length: 48, nullable: true })
    failure!: string | null;

    /** Whether the sale gave the recipient anything: a look they already owned by then gives nothing. */
    @Column({ type: 'boolean', nullable: true })
    delivered!: boolean | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
    sentAt!: Date | null;

    @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
    paidAt!: Date | null;

    @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
    refundedAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'buyer_id', referencedColumnName: 'id' })
    buyer!: User;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'recipient_id', referencedColumnName: 'id' })
    recipient!: User;

    @ManyToOne(() => ShopItem)
    @JoinColumn({ name: 'item_id', referencedColumnName: 'id' })
    item!: ShopItem;
}

import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A collection of `domains/shop/catalogue.ts`, and when the staff last featured it: the newest is on top of the shop. */
@Entity('shop_collections')
export class ShopCollection
{
    @PrimaryColumn({ type: 'varchar', length: 16 })
    id!: string;

    @Column({ name: 'featured_at', type: 'timestamptz', nullable: true })
    featuredAt!: Date | null;
}

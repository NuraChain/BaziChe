import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * Somebody who read and accepted what a market is before their first position: that it is a pool
 * of the bettors' own stakes, what its fee is, when it refunds, and that winners wait out a dispute
 * window. Apart from the terms of paid play, which are about a stake at a table.
 */
@Entity('market_disclosures')
export class MarketDisclosure
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @CreateDateColumn({ name: 'accepted_at', type: 'timestamptz' })
    acceptedAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

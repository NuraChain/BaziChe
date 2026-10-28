import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Market } from './market.entity.ts';
import { User } from './user.entity.ts';

import type { PositionState } from '../domains/market/policy.ts';

/**
 * One position in a market: one bettor, one outcome, one stake, placed from the bettor's own wallet
 * with the ticket this server signed for it. The row's id is the ticket's, and the position is
 * believed once `ArcadeMarkets` holds it under that id.
 */
@Check('market_positions_state_known', `state in ('prepared', 'sent', 'confirmed', 'reverted', 'expired')`)
@Check('market_positions_amount_positive', `amount > 0`)
@Check('market_positions_outcome_range', `outcome >= 0 and outcome < 16`)
@Check('market_positions_address_shape', `address ~ '^0x[0-9a-f]{40}$'`)
@Check('market_positions_hash_shape', `tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'`)
@Check('market_positions_claim_shape', `claim_hash is null or claim_hash ~ '^0x[0-9a-f]{64}$'`)
@Check('market_positions_sent_has_hash', `state <> 'sent' or tx_hash is not null`)
@Check('market_positions_confirmed_when', `(state = 'confirmed') = (confirmed_at is not null)`)
@Check('market_positions_failure_when', `(state = 'reverted') = (failure is not null)`)
@Check('market_positions_claimed_confirmed', `claimed_at is null or state = 'confirmed'`)
@Check('market_positions_paid_claimed', `paid is null or claimed_at is not null`)
@Index('market_positions_hash', ['txHash'], { unique: true, where: 'tx_hash is not null' })
@Index('market_positions_pending', ['state', 'createdAt'], { where: `state in ('prepared', 'sent')` })
@Index('market_positions_of_market', ['marketId', 'state'])
@Index('market_positions_of_bettor', ['bettorId', 'createdAt'])
@Entity('market_positions')
export class MarketPosition
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'market_id', type: 'uuid' })
    marketId!: string;

    @Column({ name: 'bettor_id', type: 'uuid' })
    bettorId!: string;

    /** The wallet the ticket names, the only one that may place it. */
    @Column({ type: 'varchar', length: 42 })
    address!: string;

    @Column({ type: 'smallint' })
    outcome!: number;

    /** Wei. */
    @Column({ type: 'numeric', precision: 40, scale: 0 })
    amount!: string;

    /** The ticket's own deadline, never past its market's close. */
    @Column({ type: 'timestamptz' })
    deadline!: Date;

    @Column({ type: 'varchar', length: 16 })
    state!: PositionState;

    @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
    txHash!: string | null;

    /** The word the chain refused the placement with. */
    @Column({ type: 'varchar', length: 48, nullable: true })
    failure!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
    confirmedAt!: Date | null;

    /** When the contract said it was claimed. */
    @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
    claimedAt!: Date | null;

    /**
     * Wei: what the claim paid, read off its own receipt. None for a position claimed by a call this
     * server never saw: a winner's share depends on who claimed before it, so it is not worked out.
     */
    @Column({ type: 'numeric', precision: 40, scale: 0, nullable: true })
    paid!: string | null;

    @Column({ name: 'claim_hash', type: 'varchar', length: 66, nullable: true })
    claimHash!: string | null;

    @ManyToOne(() => Market, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'market_id', referencedColumnName: 'id' })
    market!: Market;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'bettor_id', referencedColumnName: 'id' })
    bettor!: User;
}

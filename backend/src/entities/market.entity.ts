import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Match } from './match.entity.ts';
import { Table } from './table.entity.ts';

import type { Choice, MarketState } from '../domains/market/policy.ts';

/**
 * A pari-mutuel market on one game: who wins it, its outcomes, and the terms `ArcadeMarkets` holds
 * it to, under this row's id. Its terms are the ones its tickets name by their hash, so every
 * column the hash covers is written once, when the game starts, and never changed.
 */
@Check('markets_state_known', `state in ('open', 'closing', 'settled', 'refunded', 'cancelled', 'expired', 'empty')`)
@Check('markets_outcomes_range', `outcomes between 2 and 16`)
@Check('markets_fee_range', `fee_bps between 0 and 500`)
@Check('markets_limits_positive', `max_stake > 0 and max_per_bettor > 0 and max_pool > 0`)
@Check('markets_minimums', `min_bettors >= 2 and min_outcomes between 2 and outcomes`)
@Check('markets_outcome_range', `outcome is null or (outcome >= 0 and outcome < outcomes)`)
@Check('markets_settled_has_outcome', `state not in ('settled', 'refunded') or outcome is not null`)
@Check('markets_claimable_when', `(state = 'settled') = (claimable_at is not null)`)
@Check('markets_hash_shape', `tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'`)
@Index('markets_one_a_match', ['matchId'], { unique: true })
@Index('markets_unresolved', ['state', 'closesAt'], { where: `state in ('open', 'closing')` })
@Entity('markets')
export class Market
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'match_id', type: 'uuid' })
    matchId!: string;

    @Column({ name: 'table_id', type: 'uuid' })
    tableId!: string;

    @Column({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'smallint' })
    outcomes!: number;

    /** What each outcome is, in its order: a seat, a side's seats, or a draw. */
    @Column({ type: 'jsonb' })
    choices!: Choice[];

    /** Whole seconds, as the contract reads it. */
    @Column({ name: 'closes_at', type: 'timestamptz' })
    closesAt!: Date;

    @Column({ name: 'fee_bps', type: 'smallint' })
    feeBps!: number;

    /** Wei. */
    @Column({ name: 'max_stake', type: 'numeric', precision: 40, scale: 0 })
    maxStake!: string;

    @Column({ name: 'max_per_bettor', type: 'numeric', precision: 40, scale: 0 })
    maxPerBettor!: string;

    @Column({ name: 'max_pool', type: 'numeric', precision: 40, scale: 0 })
    maxPool!: string;

    @Column({ name: 'min_bettors', type: 'smallint' })
    minBettors!: number;

    @Column({ name: 'min_outcomes', type: 'smallint' })
    minOutcomes!: number;

    @Column({ type: 'varchar', length: 16 })
    state!: MarketState;

    /** The outcome that happened, once the game is over; none for a market called off. */
    @Column({ type: 'smallint', nullable: true })
    outcome!: number | null;

    /** When its winners may claim, as the contract set it. */
    @Column({ name: 'claimable_at', type: 'timestamptz', nullable: true })
    claimableAt!: Date | null;

    /** The transaction that settles it or calls it off. */
    @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
    txHash!: string | null;

    /** The word the chain last refused that transaction with. */
    @Column({ type: 'varchar', length: 48, nullable: true })
    failure!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
    resolvedAt!: Date | null;

    @ManyToOne(() => Match, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'match_id', referencedColumnName: 'id' })
    match!: Match;

    @ManyToOne(() => Table, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table;
}

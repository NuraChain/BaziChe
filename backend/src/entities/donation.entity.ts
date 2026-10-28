import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Match } from './match.entity.ts';
import { User } from './user.entity.ts';

import type { DonationState } from '../domains/donate/policy.ts';

/**
 * One gift of NURA from somebody watching a game to a player of it, sent from the giver's own
 * wallet through `ArcadeTips` under this row's id, and confirmed when the contract holds it under
 * that giver and that id.
 */
@Check('donations_state_known', `state in ('prepared', 'sent', 'confirmed', 'reverted', 'expired', 'failed')`)
@Check('donations_amount_positive', `amount > 0`)
@Check('donations_not_oneself', `giver_id <> receiver_id`)
@Check('donations_giver_shape', `giver_address ~ '^0x[0-9a-f]{40}$'`)
@Check('donations_receiver_shape', `receiver_address ~ '^0x[0-9a-f]{40}$'`)
@Check('donations_hash_shape', `tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'`)
@Check('donations_sent_has_hash', `state <> 'sent' or tx_hash is not null`)
@Check('donations_confirmed_when', `(state = 'confirmed') = (confirmed_at is not null)`)
@Check('donations_failure_when', `(state in ('reverted', 'failed')) = (failure is not null)`)
@Index('donations_hash', ['txHash'], { unique: true, where: 'tx_hash is not null' })
@Index('donations_pending', ['state', 'createdAt'], { where: `state in ('prepared', 'sent')` })
@Index('donations_given', ['giverId', 'createdAt'])
@Index('donations_received', ['receiverId', 'createdAt'], { where: `state = 'confirmed'` })
@Entity('donations')
export class Donation
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'giver_id', type: 'uuid' })
    giverId!: string;

    @Column({ name: 'receiver_id', type: 'uuid' })
    receiverId!: string;

    /** The game the giver was watching when they gave. */
    @Column({ name: 'match_id', type: 'uuid' })
    matchId!: string;

    /** Wei. */
    @Column({ type: 'numeric', precision: 40, scale: 0 })
    amount!: string;

    /** The wallet the call is sent from, the one the contract records the gift under. */
    @Column({ name: 'giver_address', type: 'varchar', length: 42 })
    giverAddress!: string;

    @Column({ name: 'receiver_address', type: 'varchar', length: 42 })
    receiverAddress!: string;

    @Column({ type: 'timestamptz' })
    deadline!: Date;

    @Column({ type: 'varchar', length: 16 })
    state!: DonationState;

    @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
    txHash!: string | null;

    /** The word the chain refused the transaction with, or what it recorded in the gift's place. */
    @Column({ type: 'varchar', length: 48, nullable: true })
    failure!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
    sentAt!: Date | null;

    @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
    confirmedAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'giver_id', referencedColumnName: 'id' })
    giver!: User;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'receiver_id', referencedColumnName: 'id' })
    receiver!: User;

    @ManyToOne(() => Match, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'match_id', referencedColumnName: 'id' })
    match!: Match;
}

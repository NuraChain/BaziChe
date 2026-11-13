import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** One outbound NURA payout queued from the rewards wallet. */
@Check('reward_payouts_state_known', `state in ('queued', 'sent', 'mined', 'failed')`)
@Check('reward_payouts_amount_nonnegative', `amount >= 0`)
@Check('reward_payouts_wallet_shape', `wallet_address ~ '^0x[0-9a-fA-F]{40}$'`)
@Index('reward_payouts_user_open_once', ['userId'], { unique: true, where: `state in ('queued', 'sent')` })
@Entity('reward_payouts')
export class RewardPayout
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'wallet_address', type: 'varchar', length: 42 })
    walletAddress!: string;

    @Column({ type: 'numeric', precision: 40, scale: 0 })
    amount!: string;

    @Column({ type: 'varchar', length: 16 })
    state!: 'queued' | 'sent' | 'mined' | 'failed';

    @Column({ name: 'tx_hash', type: 'varchar', length: 132, nullable: true })
    txHash!: string | null;

    @Column({ name: 'raw_transaction', type: 'text', nullable: true })
    rawTransaction!: string | null;

    @Column({ name: 'tx_nonce', type: 'bigint', nullable: true })
    txNonce!: string | null;

    @Column({ type: 'smallint', default: 0 })
    attempts!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'queued_at', type: 'timestamptz', nullable: true })
    queuedAt!: Date | null;

    @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
    sentAt!: Date | null;

    @Column({ name: 'mined_at', type: 'timestamptz', nullable: true })
    minedAt!: Date | null;

    @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
    failedAt!: Date | null;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

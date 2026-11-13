import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** A ledger row for one NURA grant; it is clipped to cap and budget before commit. */
@Check('reward_grants_source_known', `source in ('checkin', 'bonus', 'daily', 'weekly', 'chest')`)
@Check('reward_grants_amount_nonnegative', `amount >= 0`)
@Check('reward_grants_wanted_nonnegative', `wanted >= 0`)
@Index('reward_grants_user_cycle_idx', ['userId', 'cycle'])
@Index('reward_grants_user_source_key_once', ['userId', 'source', 'sourceKey'], { unique: true })
@Entity('reward_grants')
export class RewardGrant
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'integer' })
    cycle!: number;

    @Column({ type: 'varchar', length: 16 })
    source!: 'checkin' | 'bonus' | 'daily' | 'weekly' | 'chest';

    @Column({ name: 'source_key', type: 'varchar', length: 128 })
    sourceKey!: string;

    @Column({ type: 'numeric', precision: 40, scale: 0 })
    amount!: string;

    @Column({ type: 'numeric', precision: 40, scale: 0 })
    wanted!: string;

    @Column({ name: 'item_id', type: 'varchar', length: 64, nullable: true })
    itemId!: string | null;

    @Column({ type: 'boolean', nullable: true })
    delivered!: boolean | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

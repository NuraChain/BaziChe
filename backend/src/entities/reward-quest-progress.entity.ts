import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** A quest's progress, whether it is done and whether it has been claimed already. */
@Check('reward_quest_progress_period_known', `period in ('daily', 'weekly')`)
@Check('reward_quest_progress_progress_range', `progress >= 0`)
@Check('reward_quest_progress_done_when', `(done_at is null) = (progress < target)`) 
@Index('reward_quest_progress_user_period_idx', ['userId', 'period'])
@Entity('reward_quest_progress')
export class RewardQuestProgress
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'varchar', length: 16 })
    period!: 'daily' | 'weekly';

    @PrimaryColumn({ name: 'period_key', type: 'varchar', length: 32 })
    periodKey!: string;

    @PrimaryColumn({ name: 'quest_id', type: 'varchar', length: 64 })
    questId!: string;

    @Column({ type: 'integer', default: 0 })
    progress!: number;

    @Column({ type: 'integer', default: 0 })
    target!: number;

    @Column({ name: 'done_at', type: 'timestamptz', nullable: true })
    doneAt!: Date | null;

    @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
    claimedAt!: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

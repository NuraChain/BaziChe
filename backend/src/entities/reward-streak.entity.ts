import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** The player's current streak, the last reward day they hit and the best so far in a cycle. */
@Check('reward_streaks_streak_range', `streak between 0 and 30`)
@Check('reward_streaks_last_day_range', `last_day between 0 and 30`)
@Check('reward_streaks_best_range', `best between 0 and 30`)
@Entity('reward_streaks')
export class RewardStreak
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'smallint', default: 0 })
    streak!: number;

    @Column({ name: 'last_day', type: 'smallint', default: 0 })
    lastDay!: number;

    @Column({ type: 'smallint', default: 0 })
    best!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

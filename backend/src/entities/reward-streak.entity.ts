import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * The player's streak: the ladder position the last check-in paid, how many reward days in a row
 * led to it, the absolute reward day it was on, and the longest run so far. A run passes 30 when the
 * ladder wraps, so only the position is bounded; the position is the run counted round the ladder.
 * No check ties the position to the run: a row from before `run` existed has a position and a run
 * of 0, and the start re-validates every check, so such a check would stop it on a populated table.
 */
@Check('reward_streaks_streak_range', `streak between 0 and 30`)
@Check('reward_streaks_last_day_range', `last_day >= 0`)
@Check('reward_streaks_best_range', `best >= run`)
@Index('reward_streaks_last_day_idx', ['lastDay', 'userId'])
@Entity('reward_streaks')
export class RewardStreak
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'smallint', default: 0 })
    streak!: number;

    @Column({ type: 'smallint', default: 0 })
    run!: number;

    @Column({ name: 'last_day', type: 'integer', default: 0 })
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

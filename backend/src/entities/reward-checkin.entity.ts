import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** One reward day the player already claimed: the day number, and the ladder position that was paid. */
@Check('reward_checkins_day_range', `day between 1 and 30`)
@Check('reward_checkins_position_range', `position between 1 and 30`)
@Index('reward_checkins_day_idx', ['day'])
@Entity('reward_checkins')
export class RewardCheckin
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'integer' })
    day!: number;

    @Column({ type: 'smallint' })
    position!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

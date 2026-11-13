import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** A same-day opponent count for the anti-win-trading rule. */
@Check('reward_quest_opponents_count_range', `count > 0`)
@Entity('reward_quest_opponents')
export class RewardQuestOpponent
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'integer' })
    day!: number;

    @PrimaryColumn({ name: 'opponent_id', type: 'uuid' })
    opponentId!: string;

    @Column({ type: 'smallint', default: 0 })
    count!: number;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'opponent_id', referencedColumnName: 'id' })
    opponent!: User;
}

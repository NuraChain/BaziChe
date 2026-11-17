import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * A game that has counted for a player's weekly different-games quest. Written only by a match
 * that counted for quests, so a match that did not count leaves the game free for one that does.
 */
@Entity('reward_quest_games')
export class RewardQuestGame
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ name: 'period_key', type: 'varchar', length: 32 })
    periodKey!: string;

    @PrimaryColumn({ type: 'varchar', length: 32 })
    game!: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

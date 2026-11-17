import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

import type { Skill } from '../domains/system/rules.ts';

/**
 * A seat the server plays: a `users` row only because chairs, match seats and moves all key on a
 * user id. It never holds a wallet or a session. Which accounts these are is known to the staff
 * holding `system` and to nobody else, so nothing public reads this table except to leave its rows out.
 */
@Check('system_players_skill_known', `skill in ('casual', 'intermediate', 'advanced', 'semi-pro')`)
@Check('system_players_style_range', `style between 0 and 999`)
@Entity('system_players')
export class SystemPlayer
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 16 })
    skill!: Skill;

    /** Seeds small differences in how it plays, so two at one table do not play alike. */
    @Column({ type: 'smallint' })
    style!: number;

    /** Never seated again once set. */
    @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
    retiredAt!: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

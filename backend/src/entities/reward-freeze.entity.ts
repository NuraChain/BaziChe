import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * A player whose rewards the staff froze, and why. A row of its own rather than a column on
 * `users`, the way a suspension is, so freezing touches no existing row and lifting it is a delete.
 */
@Check('reward_freezes_reason_length', `char_length(reason) between 3 and 500`)
@Entity('reward_freezes')
export class RewardFreeze
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'text' })
    reason!: string;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;
}

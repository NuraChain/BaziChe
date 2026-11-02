import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Group } from './group.entity.ts';
import { User } from './user.entity.ts';

/**
 * Somebody who may read a group and send it nothing, until `until` or until it is lifted.
 *
 * A row of its own and not a column of the membership, so leaving and coming back does not shed it.
 */
@Check('group_mutes_until_after', `until is null or until > created_at`)
@Entity('group_mutes')
export class GroupMute
{
    @PrimaryColumn({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'muted_by', type: 'uuid', nullable: true })
    mutedBy!: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    until!: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Group, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'muted_by', referencedColumnName: 'id' })
    mutedByUser!: User | null;
}

import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { GroupInvite } from './group-invite.entity.ts';
import { Group } from './group.entity.ts';
import { User } from './user.entity.ts';

/** Somebody waiting to be let into a group, one row a person a group, and the link that brought them. */
@Index('group_requests_queue', ['groupId', 'createdAt'])
@Entity('group_requests')
export class GroupRequest
{
    @PrimaryColumn({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'invite_id', type: 'uuid', nullable: true })
    inviteId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Group, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => GroupInvite, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'invite_id', referencedColumnName: 'id' })
    invite!: GroupInvite | null;
}

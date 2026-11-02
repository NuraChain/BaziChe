import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { GROUP_RIGHTS, GROUP_ROLES, type GroupRight, type GroupRole } from '../domains/group/roles.ts';
import { Group } from './group.entity.ts';
import { User } from './user.entity.ts';

export type { GroupRole };

const listed = (values: readonly string[]) => values.map((value) => `'${ value }'`).join(', ');

/**
 * One person's place in a group.
 *
 * The role lives here rather than as an `owner_id` column on the group, and the difference is a
 * partial unique index: `group_members_single_owner` over `(group_id) where role = 'owner'` makes
 * two owners unrepresentable. An `owner_id` column would make it merely unlikely, and "the group
 * has two owners now" is the kind of state nobody notices until one of them removes the other.
 *
 * An admin holds the rights the owner gave them and nobody else holds any, so the list is there
 * exactly when the role is admin. `role_since` is when the role above member was given, which is
 * how an heir is chosen among the staff when an owner leaves.
 */
@Check('group_members_role_known', `role in (${ listed(GROUP_ROLES) })`)
@Check('group_members_rights_admin', `(role = 'admin') = (rights is not null)`)
@Check('group_members_rights_known', `rights is null or rights <@ array[${ listed(GROUP_RIGHTS) }]::text[]`)
@Check('group_members_role_since', `(role = 'member') = (role_since is null)`)
@Index('group_members_single_owner', ['groupId'], { unique: true, where: `role = 'owner'` })
@Index('group_members_user', ['userId'])
@Entity('group_members')
export class GroupMember
{
    @PrimaryColumn({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 16, default: 'member' })
    role!: GroupRole;

    @Column({ type: 'text', array: true, nullable: true })
    rights!: GroupRight[] | null;

    @Column({ name: 'role_since', type: 'timestamptz', nullable: true })
    roleSince!: Date | null;

    @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
    joinedAt!: Date;

    @ManyToOne(() => Group, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { GROUP_EVENTS, GROUP_ROLES, type GroupEventKind, type GroupRole } from '../domains/group/roles.ts';
import { Group } from './group.entity.ts';
import { User } from './user.entity.ts';

const listed = (values: readonly string[]) => values.map((value) => `'${ value }'`).join(', ');

/**
 * One thing that happened to a group, written in the transaction that made it happen.
 *
 * The handles are written down as they were, beside ids that go to null when an account goes, so a
 * row still reads after a rename or a deletion. Nothing edits or deletes a row but the group's own end.
 */
@Check('group_events_kind_known', `kind in (${ listed(GROUP_EVENTS) })`)
@Check('group_events_actor_role_known', `actor_role is null or actor_role in (${ listed(GROUP_ROLES) })`)
@Check('group_events_actor_named', `actor_id is null or actor_handle is not null`)
@Check('group_events_person_named', `person_id is null or person_handle is not null`)
@Check('group_events_details_object', `jsonb_typeof(details) = 'object'`)
@Index('group_events_page', ['groupId', 'createdAt', 'id'])
@Entity('group_events')
export class GroupEvent
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @Column({ name: 'actor_id', type: 'uuid', nullable: true })
    actorId!: string | null;

    @Column({ name: 'actor_handle', type: 'text', nullable: true })
    actorHandle!: string | null;

    /** The role the actor held when they acted. */
    @Column({ name: 'actor_role', type: 'varchar', length: 16, nullable: true })
    actorRole!: GroupRole | null;

    @Column({ type: 'varchar', length: 16 })
    kind!: GroupEventKind;

    @Column({ name: 'person_id', type: 'uuid', nullable: true })
    personId!: string | null;

    @Column({ name: 'person_handle', type: 'text', nullable: true })
    personHandle!: string | null;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    details!: Record<string, unknown>;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Group, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'actor_id', referencedColumnName: 'id' })
    actor!: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'person_id', referencedColumnName: 'id' })
    person!: User | null;
}

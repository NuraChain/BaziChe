import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Group } from './group.entity.ts';
import { User } from './user.entity.ts';

/**
 * A link that brings people into a group.
 *
 * The token is sixteen random bytes, so it cannot be guessed, and it is the only thing the link
 * carries. A link past its end, used up or revoked is a row that answers as a link nobody made.
 */
@Check('group_invites_token_shape', `token ~ '^[A-Za-z0-9_-]{22}$'`)
@Check('group_invites_ends_after', `expires_at is null or expires_at > created_at`)
@Check('group_invites_most_positive', `max_uses is null or max_uses between 1 and 100000`)
@Check('group_invites_uses_bounded', `uses >= 0 and (max_uses is null or uses <= max_uses)`)
@Check('group_invites_revoked_after', `revoked_at is null or revoked_at >= created_at`)
@Index('group_invites_token', ['token'], { unique: true })
@Index('group_invites_group', ['groupId', 'createdAt'])
@Entity('group_invites')
export class GroupInvite
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @Column({ type: 'varchar', length: 22 })
    token!: string;

    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdBy!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
    expiresAt!: Date | null;

    @Column({ name: 'max_uses', type: 'int', nullable: true })
    maxUses!: number | null;

    @Column({ type: 'int', default: 0 })
    uses!: number;

    /** Whether somebody who comes in by it waits for an answer. */
    @Column({ type: 'boolean' })
    approval!: boolean;

    @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
    revokedAt!: Date | null;

    @ManyToOne(() => Group, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by', referencedColumnName: 'id' })
    creator!: User | null;
}

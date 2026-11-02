import { CreateDateColumn, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Group } from './group.entity.ts';
import { User } from './user.entity.ts';

/** Somebody kept out of a group: no join, no link, no request and no add while the row stands. */
@Entity('group_bans')
export class GroupBan
{
    @PrimaryColumn({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'banned_by', type: 'uuid', nullable: true })
    bannedBy!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Group, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'banned_by', referencedColumnName: 'id' })
    bannedByUser!: User | null;
}

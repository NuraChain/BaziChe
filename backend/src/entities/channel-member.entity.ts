import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import type { ChannelRole } from '../domains/channel/rules.ts';
import { Channel } from './channel.entity.ts';
import { User } from './user.entity.ts';

/**
 * One person's place in a channel: their role, and how far they have read.
 *
 * One owner, by a partial unique index, as a group has one: an `owner_id` on the channel would make
 * two owners merely unlikely. Admins are as many as the owner names.
 */
@Check('channel_members_role_known', `role in ('owner', 'admin', 'member')`)
@Index('channel_members_single_owner', ['channelId'], { unique: true, where: `role = 'owner'` })
@Index('channel_members_user', ['userId'])
@Entity('channel_members')
export class ChannelMember
{
    @PrimaryColumn({ name: 'channel_id', type: 'uuid' })
    channelId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 16, default: 'member' })
    role!: ChannelRole;

    @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
    joinedAt!: Date;

    /** The newest post this member has seen; what is after it is unread. */
    @Column({ name: 'last_read_at', type: 'timestamptz', default: () => 'now()' })
    lastReadAt!: Date;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channel_id', referencedColumnName: 'id' })
    channel!: Channel;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

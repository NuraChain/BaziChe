import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { CHANNEL_BIO_MOST, CHANNEL_NAME_LEAST, CHANNEL_NAME_MOST, type ChannelPrivacy } from '../domains/channel/rules.ts';
import { Avatar } from './avatar.entity.ts';
import { User } from './user.entity.ts';

/**
 * A channel: a broadcast its owner and admins post to and anybody may follow.
 *
 * Not a group, and not sealed: a group is a room whose every line is encrypted to its members'
 * devices under a key that turns over as they come and go, which a public, unbounded audience makes
 * meaningless. A channel's posts are rows this server reads, and the page says so.
 *
 * Its photo is an avatar, kept by its hash and held to every rule a person's picture is.
 */
@Check('channels_name_length', `length(btrim(name)) between ${ CHANNEL_NAME_LEAST } and ${ CHANNEL_NAME_MOST }`)
@Check('channels_bio_length', `length(bio) <= ${ CHANNEL_BIO_MOST }`)
@Check('channels_privacy_known', `privacy in ('public', 'private')`)
@Check('channels_slug_shape', `length(slug) between 2 and 48 and slug !~ '[[:space:][:cntrl:]]' and slug !~ '^-' and slug !~ '-$' and slug !~ '[/?#@!$&''()*+,;=:%<>"|{}^~._]' and strpos(slug, '[') = 0 and strpos(slug, ']') = 0 and strpos(slug, chr(92)) = 0`)
@Index('channels_slug', ['slug'], { unique: true })
@Index('channels_public', ['createdAt'], { where: `privacy = 'public'` })
@Entity('channels')
export class Channel
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /** The address, `/app/channels/<slug>`; `citext`, so a slug is one channel whatever its case. */
    @Column({ type: 'citext' })
    slug!: string;

    @Column({ type: 'text' })
    name!: string;

    @Column({ type: 'text', default: '' })
    bio!: string;

    /** The channel's picture, as the hash an avatar is kept under, or null for its initials. */
    @Column({ type: 'char', length: 64, nullable: true })
    photo!: string | null;

    @Column({ type: 'varchar', length: 16 })
    privacy!: ChannelPrivacy;

    /** Who made it: a fact about the past. Who owns it is a role on the membership, and moves. */
    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdBy!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Avatar, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'photo', referencedColumnName: 'hash' })
    picture!: Avatar | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by', referencedColumnName: 'id' })
    createdByUser!: User | null;
}

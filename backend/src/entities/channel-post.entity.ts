import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import type { SentFile } from '../domains/chat/files.ts';
import { CHANNEL_TEXT_MOST, type ChannelPostKind, type Poll } from '../domains/channel/rules.ts';
import { Channel } from './channel.entity.ts';
import { ChatFile } from './chat-file.entity.ts';
import { User } from './user.entity.ts';

/**
 * One post in a channel: words, a photo, a video or a file with its caption, or a poll.
 *
 * A file rides the chat's pipeline: its bytes are a `chat_files` row of ciphertext, and the key that
 * opens it is here in the clear (`file`), as readable as the post. `file_id` names it again as a
 * column, so the rules that decide who fetches a file and when it can go are asked of a column, as
 * they are of a message. CHECKs hold each kind to what it carries.
 */
@Check('channel_posts_kind_known', `kind in ('text', 'file', 'poll')`)
@Check('channel_posts_text_length', `length(text) <= ${ CHANNEL_TEXT_MOST }`)
@Check('channel_posts_text_said', `kind <> 'text' or length(btrim(text)) > 0`)
@Check('channel_posts_file_whole', `(kind = 'file') = (file_id is not null and file is not null)`)
@Check('channel_posts_poll_whole', `(kind = 'poll') = (poll is not null)`)
@Check('channel_posts_closed_poll', `closed_at is null or kind = 'poll'`)
@Index('channel_posts_page', ['channelId', 'createdAt', 'id'])
@Index('channel_posts_file', ['fileId'], { where: `file_id is not null` })
@Entity('channel_posts')
export class ChannelPost
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'channel_id', type: 'uuid' })
    channelId!: string;

    /** Who posted it; forgotten, not the post, when the account goes. */
    @Column({ name: 'author_id', type: 'uuid', nullable: true })
    authorId!: string | null;

    @Column({ type: 'varchar', length: 8 })
    kind!: ChannelPostKind;

    /** The words of a text post, or a file's caption. Empty for a poll. */
    @Column({ type: 'text', default: '' })
    text!: string;

    @Column({ name: 'file_id', type: 'uuid', nullable: true })
    fileId!: string | null;

    /** What a reader is told of the file before fetching it, its key among it. */
    @Column({ type: 'jsonb', nullable: true })
    file!: SentFile | null;

    @Column({ type: 'jsonb', nullable: true })
    poll!: Poll | null;

    /** When its poster closed a poll; no vote is taken or changed after. */
    @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
    closedAt!: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channel_id', referencedColumnName: 'id' })
    channel!: Channel;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'author_id', referencedColumnName: 'id' })
    author!: User | null;

    @ManyToOne(() => ChatFile, { nullable: true })
    @JoinColumn({ name: 'file_id', referencedColumnName: 'id' })
    sent!: ChatFile | null;
}

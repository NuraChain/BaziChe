import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { FILE_SEALED_LEAST, FILE_SEALED_MOST } from '../domains/chat/files.ts';
import { User } from './user.entity.ts';

/**
 * A photo, a video or a file sent in the chat, as the ciphertext its sender's browser made. The key
 * that opens it, its name, its type and its size are sealed inside the message that names it, so
 * nothing here can tell which of the three it is.
 *
 * The id is the browser's, chosen before it encrypted and bound into the file's AAD, so a retried
 * upload is the same file. A file goes with the last live message that names it
 * (`messages.file_id`), and an upload no message names an hour after it came. A table of its own
 * beside `voice_notes`, because its bounds are not a voice message's; the rules that decide who
 * fetches it and when it goes are the same and spelled once (`chat/service.ts`).
 */
@Check('chat_files_bytes_bounded', `octet_length(bytes) between ${ FILE_SEALED_LEAST } and ${ FILE_SEALED_MOST }`)
@Check('chat_files_size_is_length', 'size = octet_length(bytes)')
@Index('chat_files_uploader', ['uploaderId', 'createdAt'])
@Entity('chat_files')
export class ChatFile
{
    @PrimaryColumn({ type: 'uuid' })
    id!: string;

    @Column({ name: 'uploader_id', type: 'uuid', nullable: true })
    uploaderId!: string | null;

    @Column({ type: 'bytea' })
    bytes!: Buffer;

    /** The length of `bytes`, kept beside it so a day's uploads are summed without reading them. */
    @Column({ type: 'int' })
    size!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'uploader_id', referencedColumnName: 'id' })
    uploader!: User | null;
}

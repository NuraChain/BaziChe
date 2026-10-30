import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { VOICE_FILE_LEAST, VOICE_FILE_MOST } from '../domains/chat/voice.ts';
import { User } from './user.entity.ts';

/**
 * A voice message's audio, as the ciphertext its sender's browser made. The key that opens it is
 * sealed inside the message that names it, so nothing here can play it.
 *
 * The id is the browser's, chosen before it encrypted and bound into the file's AAD, so a retried
 * upload is the same file. A file goes with the last live message that names it
 * (`messages.voice_id`), and an upload no message names an hour after it came.
 */
@Check('voice_notes_bytes_bounded', `octet_length(bytes) between ${ VOICE_FILE_LEAST } and ${ VOICE_FILE_MOST }`)
@Check('voice_notes_size_is_length', 'size = octet_length(bytes)')
@Index('voice_notes_uploader', ['uploaderId', 'createdAt'])
@Entity('voice_notes')
export class VoiceNote
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

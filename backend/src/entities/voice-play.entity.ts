import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Message } from './message.entity.ts';
import { User } from './user.entity.ts';

/**
 * Somebody has played a voice message. A reader who has not is shown a dot beside its duration, and
 * so is its sender until somebody else has, as Telegram does.
 */
@Entity('voice_plays')
export class VoicePlay
{
    @PrimaryColumn({ name: 'message_id', type: 'uuid' })
    messageId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @CreateDateColumn({ name: 'played_at', type: 'timestamptz' })
    playedAt!: Date;

    @ManyToOne(() => Message, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'message_id', referencedColumnName: 'id' })
    message!: Message;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

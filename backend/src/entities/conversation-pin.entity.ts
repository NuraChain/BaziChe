import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Conversation } from './conversation.entity.ts';
import { Message } from './message.entity.ts';
import { User } from './user.entity.ts';

/**
 * A message pinned at the head of its conversation, for everybody in it.
 *
 * The message is named in the clear, as a reaction's target is; its words are opened by each reader.
 * A message that goes takes its pin with it.
 */
@Index('conversation_pins_newest', ['conversationId', 'createdAt'])
@Entity('conversation_pins')
export class ConversationPin
{
    @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
    conversationId!: string;

    @PrimaryColumn({ name: 'message_id', type: 'uuid' })
    messageId!: string;

    @Column({ name: 'pinned_by', type: 'uuid', nullable: true })
    pinnedBy!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversation_id', referencedColumnName: 'id' })
    conversation!: Conversation;

    @ManyToOne(() => Message, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'message_id', referencedColumnName: 'id' })
    message!: Message;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'pinned_by', referencedColumnName: 'id' })
    pinner!: User | null;
}

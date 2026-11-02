import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import type { CallEnding, CallKind, CallState } from '../domains/call/rules.ts';
import { Conversation } from './conversation.entity.ts';
import { User } from './user.entity.ts';

/**
 * A call in a conversation: between the two people of a direct one, or a group's voice chat
 * (MS-D28, MS-D30). One is open in a room at a time, so a second ring finds the first; it rings
 * until it is answered or ends, is live once answered, and ends with how it ended, every change a
 * conditional update from the state it expects so nothing happens twice.
 */
@Check('calls_kind_known', `kind in ('direct', 'group')`)
@Check('calls_state_known', `state in ('ringing', 'live', 'ended')`)
@Check('calls_ending_known', `ending is null or ending in ('answered', 'missed', 'declined', 'busy', 'cancelled', 'failed')`)
@Check('calls_ended_whole', `(state = 'ended') = (ended_at is not null) and (state = 'ended') = (ending is not null)`)
@Check('calls_ringing_unanswered', `state <> 'ringing' or answered_at is null`)
@Check('calls_live_answered', `state <> 'live' or answered_at is not null`)
@Check('calls_answered_ending', `ending is null or (ending = 'answered') = (answered_at is not null) or ending = 'failed'`)
@Check('calls_answered_after', `answered_at is null or answered_at >= created_at`)
@Check('calls_ended_after', `ended_at is null or ended_at >= coalesce(answered_at, created_at)`)
@Index('calls_open_room', ['conversationId'], { unique: true, where: `state <> 'ended'` })
@Entity('calls')
export class Call
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'conversation_id', type: 'uuid' })
    conversationId!: string;

    @Column({ type: 'varchar', length: 8 })
    kind!: CallKind;

    @Column({ name: 'started_by', type: 'uuid', nullable: true })
    startedBy!: string | null;

    @Column({ type: 'varchar', length: 8 })
    state!: CallState;

    @Column({ type: 'varchar', length: 12, nullable: true })
    ending!: CallEnding | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
    answeredAt!: Date | null;

    @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
    endedAt!: Date | null;

    @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversation_id', referencedColumnName: 'id' })
    conversation!: Conversation;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'started_by', referencedColumnName: 'id' })
    starter!: User | null;
}

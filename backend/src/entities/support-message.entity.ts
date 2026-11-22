import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { SupportTicket } from './support-ticket.entity.ts';

@Entity('support_messages')
@Index('support_messages_request', ['ticketId', 'requestId'], { unique: true })
export class SupportMessage
{
    @PrimaryColumn({ name: 'ticket_id', type: 'uuid' })
    ticketId!: string;

    @ManyToOne(() => SupportTicket, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'ticket_id' })
    ticket!: SupportTicket;

    @PrimaryColumn({ type: 'integer' })
    sequence!: number;

    @Column({ name: 'request_id', type: 'uuid' })
    requestId!: string;

    @Column({ type: 'boolean' })
    staff!: boolean;

    @Column({ type: 'text' })
    body!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}

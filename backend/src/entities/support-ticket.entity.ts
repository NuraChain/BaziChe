import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from './user.entity.ts';

import { SUPPORT_STATES, type SupportStatus } from '../domains/support/rules.ts';

@Entity('support_tickets')
@Index('support_tickets_owner', ['ownerId', 'updatedAt'])
@Index('support_tickets_queue', ['status', 'updatedAt'])
export class SupportTicket
{
    @PrimaryColumn({ type: 'uuid' })
    id!: string;

    @Column({ name: 'owner_id', type: 'uuid' })
    ownerId!: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'owner_id' })
    owner!: User;

    @Column({ type: 'varchar', length: 120 })
    subject!: string;

    @Column({ type: 'enum', enum: SUPPORT_STATES, default: 'open' })
    status!: SupportStatus;

    @Column({ type: 'integer', default: 1 })
    count!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;
}

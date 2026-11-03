import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Call } from './call.entity.ts';
import { User } from './user.entity.ts';

/**
 * Somebody in a call: when they came and when they went, and what the call's staff decided about
 * them, which a dropped socket and a reload must not shed (MS-D33): held (not carried until let
 * speak), a raised hand, and removed (gone, and not let back into that call). One row a person a
 * call, so coming back clears `left_at` on the row they had. A person is in one call at a time.
 *
 * `left_at` says they are out of the call's room, which a dropped socket says as well as a hang
 * up; `gone_at` says they left a group's voice chat on purpose, or were taken out of it, so a page
 * that lost its socket comes back to a call its reader is still in, and one they left stays left.
 * A row is kept when they go, so what was decided about them holds if they come back.
 */
@Check('call_participants_left_after', `left_at is null or left_at >= joined_at`)
@Check('call_participants_gone_out', `gone_at is null or left_at is not null`)
@Check('call_participants_removed_gone', `removed_at is null or gone_at is not null`)
@Index('call_participants_one_live', ['userId'], { unique: true, where: 'left_at is null' })
@Entity('call_participants')
export class CallParticipant
{
    @PrimaryColumn({ name: 'call_id', type: 'uuid' })
    callId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'joined_at', type: 'timestamptz' })
    joinedAt!: Date;

    @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
    leftAt!: Date | null;

    @Column({ type: 'boolean' })
    held!: boolean;

    @Column({ name: 'hand_at', type: 'timestamptz', nullable: true })
    handAt!: Date | null;

    @Column({ name: 'gone_at', type: 'timestamptz', nullable: true })
    goneAt!: Date | null;

    @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
    removedAt!: Date | null;

    @ManyToOne(() => Call, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'call_id', referencedColumnName: 'id' })
    call!: Call;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

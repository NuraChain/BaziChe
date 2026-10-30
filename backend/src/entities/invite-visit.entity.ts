import { Check, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { InviteCode } from './invite-code.entity.ts';

/**
 * A device that opened an invite link, once a day. Nothing about the device is kept but a token it
 * made up and keeps itself: no address, no agent, nothing a visit could be traced back by.
 */
@Check('invite_visits_visitor_shape', `visitor ~ '^[A-Za-z0-9_-]{22}$'`)
@Entity('invite_visits')
export class InviteVisit
{
    @PrimaryColumn({ type: 'varchar', length: 8 })
    code!: string;

    @PrimaryColumn({ type: 'varchar', length: 22 })
    visitor!: string;

    @PrimaryColumn({ type: 'date' })
    day!: string;

    @ManyToOne(() => InviteCode, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'code', referencedColumnName: 'code' })
    invite!: InviteCode;
}

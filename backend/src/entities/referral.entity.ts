import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { InviteCampaign } from './invite-campaign.entity.ts';
import { InviteCode } from './invite-code.entity.ts';
import { User } from './user.entity.ts';

import type { InviteFlag } from '../domains/invite/policy.ts';

@Check('referrals_not_self', `invitee_id <> inviter_id`)
@Check('referrals_flags_counted', `counted_at is not null or flags is null`)
@Check('referrals_flags_known', `flags is null or flags <@ array['quick', 'ring', 'many']::varchar[]`)
@Index('referrals_inviter', ['inviterId'])
@Index('referrals_campaign', ['campaignId'], { where: 'campaign_id is not null' })
@Entity('referrals')
export class Referral
{
    @PrimaryColumn({ name: 'invitee_id', type: 'uuid' })
    inviteeId!: string;

    @Column({ name: 'inviter_id', type: 'uuid', nullable: true })
    inviterId!: string | null;

    /** The code the invitee's link carried. */
    @Column({ type: 'varchar', length: 8, nullable: true })
    code!: string | null;

    /** The campaign active when the invitee's account was made, whose rewards their invite may earn. */
    @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
    campaignId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    /** When the invitee finished a first game the inviter did not play in: only then does the invite count. */
    @Column({ name: 'counted_at', type: 'timestamptz', nullable: true })
    countedAt!: Date | null;

    /** What made the counted invite wait for a person, written when it counted; none before. */
    @Column({ type: 'varchar', length: 8, array: true, nullable: true })
    flags!: InviteFlag[] | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'invitee_id', referencedColumnName: 'id' })
    invitee!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'inviter_id', referencedColumnName: 'id' })
    inviter!: User | null;

    @ManyToOne(() => InviteCode, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'code', referencedColumnName: 'code' })
    invite!: InviteCode | null;

    @ManyToOne(() => InviteCampaign, { nullable: true })
    @JoinColumn({ name: 'campaign_id', referencedColumnName: 'id' })
    campaign!: InviteCampaign | null;
}

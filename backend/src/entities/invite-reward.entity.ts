import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { InviteCampaign } from './invite-campaign.entity.ts';
import { ShopItem } from './shop-item.entity.ts';
import { User } from './user.entity.ts';

import type { RewardKind, RewardState } from '../domains/invite/policy.ts';

/**
 * A look a campaign gives somebody for an invite that counted, or for a milestone of them. The
 * unique indexes are what make it given once: a second count, a retry or two finishes at once find
 * the row there and write nothing.
 */
@Check('invite_rewards_kind_known', `kind in ('inviter', 'invitee', 'milestone')`)
@Check('invite_rewards_state_known', `state in ('review', 'given', 'refused', 'taken')`)
@Check('invite_rewards_milestone_when', `(kind = 'milestone') = (milestone is not null)`)
@Check('invite_rewards_milestone_positive', `milestone is null or milestone > 0`)
@Check('invite_rewards_milestone_nobody', `kind <> 'milestone' or invitee_id is null`)
@Check('invite_rewards_look', `item_id not like 'bundle.%'`)
@Check('invite_rewards_decided_when', `(state = 'review') = (decided_at is null)`)
@Check('invite_rewards_delivered_when', `(state in ('given', 'taken')) = (delivered is not null)`)
@Check('invite_rewards_reason_shape', `reason is null or char_length(reason) between 3 and 500`)
@Index('invite_rewards_once', ['campaignId', 'inviteeId', 'kind'], { unique: true, where: `kind <> 'milestone'` })
@Index('invite_rewards_milestone_once', ['campaignId', 'userId', 'milestone'], { unique: true, where: `kind = 'milestone'` })
@Index('invite_rewards_waiting', ['createdAt'], { where: `state = 'review'` })
@Index('invite_rewards_of', ['userId', 'createdAt'])
@Entity('invite_rewards')
export class InviteReward
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'campaign_id', type: 'uuid' })
    campaignId!: string;

    /** Who the look is for. */
    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    /** The friend whose invite counted; none for a milestone. */
    @Column({ name: 'invitee_id', type: 'uuid', nullable: true })
    inviteeId!: string | null;

    @Column({ type: 'varchar', length: 16 })
    kind!: RewardKind;

    /** The number of friends a milestone is reached at. */
    @Column({ type: 'integer', nullable: true })
    milestone!: number | null;

    @Column({ name: 'item_id', type: 'varchar', length: 40 })
    itemId!: string;

    @Column({ type: 'varchar', length: 16 })
    state!: RewardState;

    /** Given: whether the look was theirs only now, or owned already and so nothing was given. */
    @Column({ type: 'boolean', nullable: true })
    delivered!: boolean | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
    decidedAt!: Date | null;

    /** The member of the staff who decided it; none when it was given at once. */
    @Column({ name: 'decided_by', type: 'uuid', nullable: true })
    decidedBy!: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    reason!: string | null;

    @ManyToOne(() => InviteCampaign)
    @JoinColumn({ name: 'campaign_id', referencedColumnName: 'id' })
    campaign!: InviteCampaign;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'invitee_id', referencedColumnName: 'id' })
    invitee!: User | null;

    @ManyToOne(() => ShopItem)
    @JoinColumn({ name: 'item_id', referencedColumnName: 'id' })
    item!: ShopItem;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'decided_by', referencedColumnName: 'id' })
    decider!: User | null;
}

import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ShopItem } from './shop-item.entity.ts';
import { User } from './user.entity.ts';

import type { CampaignState, Milestone } from '../domains/invite/policy.ts';

/**
 * What inviting friends gives while it runs, as the staff set it. Nothing is given without one, at
 * most one is active, and an invite belongs to the campaign that was active when its account was
 * made, so two campaigns never both reward one friend.
 */
@Check('invite_campaigns_state_known', `state in ('draft', 'active', 'paused', 'ended')`)
@Check('invite_campaigns_name_shape', `char_length(name) between 3 and 80`)
@Check('invite_campaigns_inviter_look', `inviter_item is null or inviter_item not like 'bundle.%'`)
@Check('invite_campaigns_invitee_look', `invitee_item is null or invitee_item not like 'bundle.%'`)
@Check('invite_campaigns_milestones_list', `jsonb_typeof(milestones) = 'array'`)
@Check('invite_campaigns_most_positive', `most is null or most > 0`)
@Check('invite_campaigns_window', `starts_at is null or ends_at is null or ends_at > starts_at`)
@Index('invite_campaigns_one_active', ['state'], { unique: true, where: `state = 'active'` })
@Entity('invite_campaigns')
export class InviteCampaign
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', length: 80 })
    name!: string;

    @Column({ type: 'varchar', length: 16 })
    state!: CampaignState;

    /** The look whoever invited is given when a friend's invite counts; none gives them nothing. */
    @Column({ name: 'inviter_item', type: 'varchar', length: 40, nullable: true })
    inviterItem!: string | null;

    /** The look the friend invited is given when their invite counts. */
    @Column({ name: 'invitee_item', type: 'varchar', length: 40, nullable: true })
    inviteeItem!: string | null;

    @Column({ type: 'jsonb' })
    milestones!: Milestone[];

    /** The most rewards one person can be given by it; none is no limit. */
    @Column({ type: 'integer', nullable: true })
    most!: number | null;

    /** Whether every reward waits for the staff, not only a flagged one. */
    @Column({ type: 'boolean' })
    review!: boolean;

    @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
    startsAt!: Date | null;

    @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
    endsAt!: Date | null;

    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdBy!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => ShopItem, { nullable: true })
    @JoinColumn({ name: 'inviter_item', referencedColumnName: 'id' })
    inviterLook!: ShopItem | null;

    @ManyToOne(() => ShopItem, { nullable: true })
    @JoinColumn({ name: 'invitee_item', referencedColumnName: 'id' })
    inviteeLook!: ShopItem | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by', referencedColumnName: 'id' })
    creator!: User | null;
}

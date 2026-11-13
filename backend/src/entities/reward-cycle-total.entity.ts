import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

/** The running cycle total for the global NURA budget lock. */
@Check('reward_cycle_totals_granted_nonnegative', `granted >= 0`)
@Entity('reward_cycle_totals')
export class RewardCycleTotal
{
    @PrimaryColumn({ type: 'integer' })
    cycle!: number;

    @Column({ type: 'numeric', precision: 40, scale: 0, default: 0 })
    granted!: string;
}

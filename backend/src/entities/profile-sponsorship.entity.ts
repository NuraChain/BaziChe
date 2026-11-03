import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * How many writes to an account's Nura Profile the server paid the gas for on one day (UTC): what
 * holds the limit for each account and the one for everybody together (`domains/profile/sponsor.ts`).
 */
@Check('profile_sponsorships_count_positive', `count > 0`)
@Index('profile_sponsorships_day', ['day'])
@Entity('profile_sponsorships')
export class ProfileSponsorship
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'date' })
    day!: string;

    @Column({ type: 'int' })
    count!: number;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

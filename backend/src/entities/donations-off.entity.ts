import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * Somebody who takes no donations. Everybody else does, so the default writes nothing: a row of
 * its own rather than a column on `users`, which a database that already holds people could not
 * be given without a default materialised into every row.
 */
@Entity('donations_off')
export class DonationsOff
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

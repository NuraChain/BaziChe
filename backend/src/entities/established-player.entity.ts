import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * A player an invite may count through: their account a week old, and games finished with somebody
 * already established or on the staff. Fresh wallets that only ever play each other never become one,
 * which is what keeps a farm of them from counting each other in.
 */
@Entity('established_players')
export class EstablishedPlayer
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @CreateDateColumn({ type: 'timestamptz' })
    since!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

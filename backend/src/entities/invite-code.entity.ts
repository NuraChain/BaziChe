import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * The code a person's invite link carries. One is live at a time: a new one retires the last, and a
 * link that carries a retired code brings nobody in.
 */
@Check('invite_codes_shape', `code ~ '^[2-9A-HJKMNP-Z]{8}$'`)
@Check('invite_codes_retired_after', `retired_at is null or retired_at >= created_at`)
@Index('invite_codes_live', ['userId'], { unique: true, where: 'retired_at is null' })
@Entity('invite_codes')
export class InviteCode
{
    @PrimaryColumn({ type: 'varchar', length: 8 })
    code!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
    retiredAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}

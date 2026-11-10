import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * One value for the whole site, by name: set by the staff, or made by the server for itself, as
 * its push keys are. The names are a closed set, so a typo in code is a refused write rather than
 * a second setting nobody reads.
 */
@Check('settings_key_known', `key in ('usd-rate', 'push-keys')`)
@Check('settings_value_length', `char_length(value) between 1 and 400`)
@Entity('settings')
export class Setting
{
    @PrimaryColumn({ type: 'varchar', length: 48 })
    key!: string;

    @Column({ type: 'text' })
    value!: string;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;
}

import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * A season: forty-five days the staff start by hand, with a board of its own.
 *
 * Starting one pulls every rating halfway back to where everybody begins, and the season's board
 * ranks the XP earned inside its window, so somebody new can top it. Nothing ends it early and
 * nothing starts the next: once `ends_at` passes there is no season until the staff start one.
 *
 * The id IS the season's number, which is why it counts up by one rather than being a uuid.
 */
@Check('seasons_name_length', `char_length(name) <= 60`)
@Check('seasons_ends_after', `ends_at > started_at`)
@Entity('seasons')
export class Season
{
    @PrimaryGeneratedColumn('increment')
    id!: number;

    @Column({ type: 'varchar', length: 60, default: '' })
    name!: string;

    @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
    startedAt!: Date;

    @Column({ name: 'ends_at', type: 'timestamptz' })
    endsAt!: Date;

    /** How many ratings the start pulled back toward the middle, as it was done. */
    @Column({ name: 'ratings_reset', type: 'integer', default: 0 })
    ratingsReset!: number;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;
}

import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tournament } from './tournament.entity.ts';
import { User } from './user.entity.ts';

@Index('tournament_entries_person', ['tournamentId', 'userId'], { unique: true })
@Index('tournament_entries_spot', ['tournamentId', 'spot'], { unique: true })
@Index('tournament_entries_seed', ['tournamentId', 'seed'], { unique: true, where: `seed is not null` })
@Index('tournament_entries_user', ['userId'])
@Entity('tournament_entries')
export class TournamentEntry
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'tournament_id', type: 'uuid' })
    tournamentId!: string;

    /** `SET NULL` rather than CASCADE: an account deleted mid-tournament must not take its place in the bracket with it. */
    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId!: string | null;

    /** The place the person confirmed, from 1, the lowest one free when they joined. */
    @Column({ type: 'smallint' })
    spot!: number;

    /** Drawn at random when the tournament starts. */
    @Column({ type: 'smallint', nullable: true })
    seed!: number | null;

    @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
    joinedAt!: Date;

    @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tournament_id', referencedColumnName: 'id' })
    tournament!: Tournament;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User | null;
}

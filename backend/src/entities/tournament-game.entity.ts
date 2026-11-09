import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Match } from './match.entity.ts';
import { Table } from './table.entity.ts';
import { Tournament } from './tournament.entity.ts';
import type { Decided } from '../domains/tournament/engine/game.ts';

@Check('tournament_games_how_known', `how is null or how in ('played', 'bye', 'seed', 'draw', 'void')`)
@Index('tournament_games_place', ['tournamentId', 'stage', 'round', 'slot'], { unique: true })
@Index('tournament_games_match', ['matchId'])
@Entity('tournament_games')
export class TournamentGame
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'tournament_id', type: 'uuid' })
    tournamentId!: string;

    @Column({ type: 'varchar', length: 16 })
    stage!: string;

    @Column({ type: 'smallint' })
    round!: number;

    @Column({ type: 'smallint' })
    slot!: number;

    @Column({ type: 'smallint' })
    phase!: number;

    @Column({ name: 'seed_a', type: 'smallint', nullable: true })
    seedA!: number | null;

    @Column({ name: 'seed_b', type: 'smallint', nullable: true })
    seedB!: number | null;

    @Column({ name: 'score_a', type: 'smallint', default: 0 })
    scoreA!: number;

    @Column({ name: 'score_b', type: 'smallint', default: 0 })
    scoreB!: number;

    @Column({ name: 'winner_seed', type: 'smallint', nullable: true })
    winnerSeed!: number | null;

    @Column({ type: 'varchar', length: 8, nullable: true })
    how!: Decided | null;

    @Column({ type: 'smallint', default: 1 })
    attempt!: number;

    @Column({ type: 'boolean', default: false })
    dealt!: boolean;

    /** Where the winner and the loser go next, as `stage:round:slot/side`. */
    @Column({ name: 'win_to', type: 'varchar', length: 32, nullable: true })
    winTo!: string | null;

    @Column({ name: 'lose_to', type: 'varchar', length: 32, nullable: true })
    loseTo!: string | null;

    /** The table of the latest game of the series; the next game is a new table, and this moves to it. */
    @Column({ name: 'table_id', type: 'uuid', nullable: true })
    tableId!: string | null;

    @Column({ name: 'match_id', type: 'uuid', nullable: true })
    matchId!: string | null;

    @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tournament_id', referencedColumnName: 'id' })
    tournament!: Tournament;

    @ManyToOne(() => Table, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table | null;

    @ManyToOne(() => Match, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'match_id', referencedColumnName: 'id' })
    match!: Match | null;
}

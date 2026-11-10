import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Game } from './game.entity.ts';
import { User } from './user.entity.ts';

export type TournamentStatus = 'open' | 'running' | 'finished' | 'cancelled';

@Check('tournaments_status_known', `status in ('open', 'running', 'finished', 'cancelled')`)
@Check('tournaments_format_known', `format in ('single', 'double', 'round-robin', 'swiss', 'groups')`)
@Check('tournaments_size_known', `size in (4, 8, 16, 32, 64, 128)`)
@Check('tournaments_best_of_known', `best_of in (1, 3, 5)`)
@Index('tournaments_code', ['code'], { unique: true })
@Index('tournaments_active', ['status', 'startsAt'], { where: `status in ('open', 'running')` })
@Index('tournaments_creator', ['creatorId'])
@Entity('tournaments')
export class Tournament
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /** What the link carries. `citext`, claimed by INSERT against the unique index, as a table's is. */
    @Column({ type: 'citext' })
    code!: string;

    @Column({ type: 'varchar', length: 60 })
    name!: string;

    @Column({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'varchar', length: 16 })
    format!: string;

    @Column({ type: 'smallint' })
    size!: number;

    @Column({ name: 'best_of', type: 'smallint', default: 1 })
    bestOf!: number;

    /** Set when it starts, from how many actually came; a Swiss plays this many. */
    @Column({ type: 'smallint', default: 0 })
    rounds!: number;

    /** Set when it starts: the field the games were drawn for. */
    @Column({ type: 'smallint', default: 0 })
    entrants!: number;

    /** Whether it shows in the list. Either way anybody holding the link can see it and join. */
    @Column({ type: 'boolean' })
    listed!: boolean;

    @Column({ type: 'varchar', length: 16, default: 'open' })
    status!: TournamentStatus;

    @Column({ name: 'starts_at', type: 'timestamptz' })
    startsAt!: Date;

    /** When the games waiting to be played are dealt; null while none are waiting. */
    @Column({ name: 'next_round_at', type: 'timestamptz', nullable: true })
    nextRoundAt!: Date | null;

    @Column({ name: 'creator_id', type: 'uuid', nullable: true })
    creatorId!: string | null;

    @Column({ name: 'winner_id', type: 'uuid', nullable: true })
    winnerId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
    startedAt!: Date | null;

    @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
    finishedAt!: Date | null;

    @ManyToOne(() => Game)
    @JoinColumn({ name: 'game', referencedColumnName: 'id' })
    gameRef!: Game;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'creator_id', referencedColumnName: 'id' })
    creator!: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'winner_id', referencedColumnName: 'id' })
    winner!: User | null;
}

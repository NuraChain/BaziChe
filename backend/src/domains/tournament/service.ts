import { randomInt } from 'node:crypto';

import { HttpError, NotFoundError } from '@azerothjs/http';
import { In, type DataSource, type EntityManager } from 'typeorm';

import { Game } from '../../entities/game.entity.ts';
import { GameRule } from '../../entities/game-rule.entity.ts';
import { Match } from '../../entities/match.entity.ts';
import { Table } from '../../entities/table.entity.ts';
import { TableSeat } from '../../entities/table-seat.entity.ts';
import { TournamentEntry } from '../../entities/tournament-entry.entity.ts';
import { TournamentGame } from '../../entities/tournament-game.entity.ts';
import { Tournament, type TournamentStatus } from '../../entities/tournament.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { lockTable } from '../table/service.ts';
import { BEST_OF, FORMATS, MIN_ENTRANTS, type FormatId } from './engine/formats.ts';
import { READY_MS } from './ready.ts';
import { applyResult, dueGames, forfeitAbsent, shuffledSeeds, undecided, walkover, withoutAbsent, type Game as EngineGame, type Link, type Rules, type Side } from './engine/game.ts';

export const TOURNAMENT_REFUSALS = {
    'tournament-closed': 409,
    'tournament-full': 409,
    'tournament-entered': 409,
    'tournament-entries-max': 409,
    'tournament-created-max': 409,
    'tournament-time': 422,
    'tournament-format': 422,
    'tournament-game': 422
} as const;

type TournamentRefusal = keyof typeof TOURNAMENT_REFUSALS;

const refusal = (word: TournamentRefusal, message: string) => new HttpError(TOURNAMENT_REFUSALS[word], message, { code: word });

const UNIQUE_VIOLATION = '23505';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const CODE_LENGTH = 7;

const CODE_ATTEMPTS = 5;

/** A tournament's own links, as long as it is running, and how many of them one person can run. */
const CREATED_MAX = 3;

const ENTERED_MAX = 10;

const SOONEST_MS = 5 * 60_000;

const LATEST_MS = 14 * 24 * 60 * 60_000;

/** Time to reach the table: a first round is announced, then dealt, and so is every round after it. */
const START_BREAK_MS = 120_000;

const ROUND_BREAK_MS = 60_000;

const SWEEP_MAX = 500;

const LIST_MAX = 60;

const ACTIVE: TournamentStatus[] = ['open', 'running'];

const GAME_COLUMNS = ['stage', 'round', 'slot', 'phase', 'seed_a', 'seed_b', 'score_a', 'score_b', 'winner_seed', 'how', 'attempt', 'dealt', 'win_to', 'lose_to', 'table_id', 'match_id'];

const codeOf = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const linkFrom = (link: Link | null) => link === null ? null : `${ link.key }/${ link.side }`;

const linkOf = (text: string | null): Link | null =>
{
    if (text === null)
    {
        return null;
    }

    const [key, side] = text.split('/');

    return { key, side: side as Side };
};

const toEngine = (row: TournamentGame): EngineGame => ({
    key: `${ row.stage }:${ row.round }:${ row.slot }`,
    stage: row.stage,
    round: row.round,
    slot: row.slot,
    phase: row.phase,
    a: row.seedA,
    b: row.seedB,
    scoreA: row.scoreA,
    scoreB: row.scoreB,
    winner: row.winnerSeed,
    how: row.how,
    attempt: row.attempt,
    dealt: row.dealt,
    winTo: linkOf(row.winTo),
    loseTo: linkOf(row.loseTo)
});

const fromEngine = (game: EngineGame) => ({
    stage: game.stage,
    round: game.round,
    slot: game.slot,
    phase: game.phase,
    seedA: game.a,
    seedB: game.b,
    scoreA: game.scoreA,
    scoreB: game.scoreB,
    winnerSeed: game.winner,
    how: game.how,
    attempt: game.attempt,
    dealt: game.dealt,
    winTo: linkFrom(game.winTo),
    loseTo: linkFrom(game.loseTo)
});

const rulesOf = (tournament: Tournament): Rules => ({ entrants: tournament.entrants, bestOf: tournament.bestOf, rounds: tournament.rounds });

const formatOf = (tournament: Tournament) => FORMATS[tournament.format as FormatId];

/** The formats whose places come off a table of points, where somebody taken out could still be on top. */
const RANKED: readonly string[] = ['round-robin', 'swiss'];

/** Who is still in it, seed by seed: nobody for an account that is gone or a player the staff took out. */
const seatsOf = (entries: readonly TournamentEntry[]) => new Map(entries
    .filter((entry) => entry.seed !== null)
    .map((entry) => [entry.seed as number, entry.removedAt === null ? entry.userId : null]));

const absentOf = (seats: ReadonlyMap<number, string | null>) => new Set([...seats].filter(([, userId]) => userId === null).map(([seed]) => seed));

const placesOf = (tournament: Tournament, games: readonly EngineGame[], absent: ReadonlySet<number>) =>
{
    const rows = formatOf(tournament).standings(games, rulesOf(tournament));

    return RANKED.includes(tournament.format) ? withoutAbsent(rows, absent) : rows;
};

const stillIn = (entries: readonly TournamentEntry[]) => entries
    .filter((entry) => entry.removedAt === null)
    .map((entry) => entry.userId)
    .filter((userId) => userId !== null);

/** A game whose match was dealt, once both its players said they were ready. */
export interface Dealt
{
    tableId: string;
    matchId: string;
    players: string[];
}

/** A table whose chairs changed for its players: opened to wait for them, or closed when the wait ran out. */
export interface Rung
{
    tableId: string;
    players: string[];
}

export interface Notice
{
    kind: 'tournament-start' | 'tournament-game' | 'tournament-cancelled' | 'tournament-over';
    userIds: string[];
    tableId?: string;
}

/** What happened to a tournament, for whoever rings the doorbells once it is written. */
export interface Advanced
{
    id: string;
    code: string;
    game: string;
    entrants: string[];
    changed: boolean;
    dealt: Dealt[];
    rung: Rung[];
    notices: Notice[];
}

export interface TournamentCollaborators
{
    /** Opens a two-chair table with both players already ready, and answers its id. */
    seat(tx: EntityManager, tournamentId: string, game: string, players: readonly [string, string]): Promise<string>;

    /** Deals at a table in the caller's transaction, and answers the match. */
    deal(tx: EntityManager, tableId: string): Promise<string | null>;
}

export interface TournamentCreate
{
    name: string;
    game: string;
    format: FormatId;
    size: number;
    bestOf: number;
    listed: boolean;
    startsAt: string;
}

interface SummaryRow
{
    id: string;
    code: string;
    name: string;
    game: string;
    format: string;
    size: number;
    best_of: number;
    listed: boolean;
    featured: boolean;
    status: TournamentStatus;
    starts_at: Date;
    created_at: Date;
    started_at: Date | null;
    finished_at: Date | null;
    entered: number;
    creator: string | null;
    champion: string | null;
    spot: number | null;
}

export function createTournamentService(db: DataSource, helpers: TournamentCollaborators)
{
    const summaries = (me: string) => db.getRepository(Tournament).createQueryBuilder('k')
        .select('k.id', 'id')
        .addSelect('k.code::text', 'code')
        .addSelect('k.name', 'name')
        .addSelect('k.game', 'game')
        .addSelect('k.format', 'format')
        .addSelect('k.size', 'size')
        .addSelect('k.best_of', 'best_of')
        .addSelect('k.listed', 'listed')
        .addSelect('k.featured_at is not null', 'featured')
        .addSelect('k.status', 'status')
        .addSelect('k.starts_at', 'starts_at')
        .addSelect('k.created_at', 'created_at')
        .addSelect('k.started_at', 'started_at')
        .addSelect('k.finished_at', 'finished_at')
        .addSelect('(select count(*)::int from tournament_entries e where e.tournament_id = k.id)', 'entered')
        .addSelect('(select u.handle::text from users u where u.id = k.creator_id)', 'creator')
        .addSelect('(select u.handle::text from users u where u.id = k.winner_id)', 'champion')
        .addSelect('(select e.spot from tournament_entries e where e.tournament_id = k.id and e.user_id = :me)', 'spot')
        .setParameter('me', me);

    const entrantIds = async (tx: EntityManager, tournament: Tournament) =>
        stillIn(await tx.getRepository(TournamentEntry).find({ select: { userId: true, removedAt: true }, where: { tournamentId: tournament.id } }));

    /**
     * Closes the tables of games nobody plays any more while they still wait for their players:
     * decided without them (a walkover, a player taken out) or no longer wanted (the tournament
     * called off). A game already dealt is left to finish at its own table, as it always was.
     */
    const closeWaiting = async (tx: EntityManager, tableIds: readonly string[]) =>
    {
        if (tableIds.length === 0)
        {
            return [];
        }

        const closed: { id: string }[] = await tx.query(
            `update tables set status = 'closed', closed_at = now()
              where id = any($1::uuid[]) and status <> 'closed'
                and not exists (select 1 from matches m where m.table_id = tables.id)
              returning id`,
            [tableIds]
        );
        const ids = closed.map((one) => one.id);
        const chairs = ids.length === 0 ? [] : await tx.getRepository(TableSeat).find({ select: { tableId: true, userId: true }, where: { tableId: In(ids) } });

        return ids.map((tableId) => ({ tableId, players: chairs.filter((chair) => chair.tableId === tableId && chair.userId !== null).map((chair) => chair.userId as string) }));
    };

    const cancelled = async (tx: EntityManager, tournament: Tournament): Promise<Advanced> =>
    {
        await tx.getRepository(Tournament).update({ id: tournament.id }, { status: 'cancelled', finishedAt: () => 'now()', nextRoundAt: null });

        const waiting = await tx.getRepository(TournamentGame).find({ select: { tableId: true, matchId: true }, where: { tournamentId: tournament.id } });
        const rung = await closeWaiting(tx, waiting.filter((one) => one.tableId !== null && one.matchId === null).map((one) => one.tableId as string));

        const entrants = await entrantIds(tx, tournament);

        return { id: tournament.id, code: tournament.code, game: tournament.game, entrants, changed: true, dealt: [], rung, notices: [{ kind: 'tournament-cancelled', userIds: entrants }] };
    };

    const begin = async (tx: EntityManager, tournament: Tournament): Promise<Advanced> =>
    {
        const entries = await tx.getRepository(TournamentEntry).find({ where: { tournamentId: tournament.id }, order: { spot: 'ASC' } });

        if (entries.length < MIN_ENTRANTS)
        {
            return cancelled(tx, tournament);
        }

        const seeds = shuffledSeeds(entries.length, randomInt);
        const engine = formatOf(tournament);
        const rules: Rules = { entrants: entries.length, bestOf: tournament.bestOf, rounds: engine.roundsFor(entries.length) };
        const games = engine.advance(engine.start(rules), rules);

        await tx.getRepository(TournamentEntry).save(entries.map((entry, index) => ({ ...entry, seed: seeds[index] })));
        await tx.getRepository(TournamentGame).insert(games.map((game) => ({ ...fromEngine(game), tournamentId: tournament.id })));
        await tx.getRepository(Tournament).update(
            { id: tournament.id },
            { status: 'running', startedAt: () => 'now()', entrants: rules.entrants, rounds: rules.rounds, nextRoundAt: () => `now() + make_interval(secs => ${ START_BREAK_MS / 1000 })` }
        );

        const entrants = entries.map((entry) => entry.userId).filter((userId) => userId !== null);

        return { id: tournament.id, code: tournament.code, game: tournament.game, entrants, changed: true, dealt: [], rung: [], notices: [{ kind: 'tournament-start', userIds: entrants }] };
    };

    /** Writes back only what the engine changed, so a pass with nothing to do writes nothing. */
    const persist = async (tx: EntityManager, tournamentId: string, rows: readonly TournamentGame[], games: readonly EngineGame[]) =>
    {
        const held = new Map(rows.map((row) => [toEngine(row).key, row]));
        const added = games.filter((game) => !held.has(game.key)).map((game) => ({ ...fromEngine(game), tournamentId }));
        let changed = false;

        for (const game of games)
        {
            const row = held.get(game.key);
            const wanted = fromEngine(game);

            if (row !== undefined && Object.entries(wanted).some(([field, value]) => row[field as keyof typeof wanted] !== value))
            {
                await tx.getRepository(TournamentGame).update({ id: row.id }, wanted);
                changed = true;
            }
        }

        if (added.length > 0)
        {
            await tx.getRepository(TournamentGame).insert(added);
            changed = true;
        }

        return changed;
    };

    const finish = async (tx: EntityManager, tournament: Tournament, games: readonly EngineGame[], seats: ReadonlyMap<number, string | null>) =>
    {
        const champion = placesOf(tournament, games, absentOf(seats)).find((row) => row.place === 1);

        await tx.getRepository(Tournament).update(
            { id: tournament.id },
            { status: 'finished', finishedAt: () => 'now()', nextRoundAt: null, winnerId: champion === undefined ? null : seats.get(champion.seed) ?? null }
        );
    };

    /**
     * Opens a table for every game that is due and seats its two players, who then have `READY_MS`
     * to say they are ready (`settleWaiting`): a game dealt the moment the table opened was lost on
     * the clock by whoever had not yet got there.
     */
    const dealRound = async (tx: EntityManager, tournament: Tournament, games: readonly EngineGame[], rows: readonly TournamentGame[], seats: ReadonlyMap<number, string | null>) =>
    {
        const opened: Rung[] = [];
        const held = new Map(rows.map((row) => [toEngine(row).key, row]));
        const next = new Map(games.map((game) => [game.key, game]));

        for (const game of dueGames(games))
        {
            const one = seats.get(game.a as number) ?? null;
            const other = seats.get(game.b as number) ?? null;

            if (one === null || other === null)
            {
                next.set(game.key, walkover(game, one === null ? game.b as number : game.a as number));
                continue;
            }

            const tableId = await helpers.seat(tx, tournament.id, tournament.game, [one, other]);

            next.set(game.key, { ...game, dealt: true });
            opened.push({ tableId, players: [one, other] });

            const row = held.get(game.key);

            if (row !== undefined)
            {
                // The match of an earlier attempt goes: this one's is dealt once both are ready.
                await tx.getRepository(TournamentGame).update({ id: row.id }, { tableId, matchId: null });
                row.tableId = tableId;
                row.matchId = null;
            }
        }

        return { opened, games: [...next.values()] };
    };

    /**
     * Every game whose table waits for its players: dealt the moment both are ready, and once
     * `READY_MS` has gone by, won by whoever was, or, if nobody was, a game with no winner, which
     * the format's own rule settles (once more, then the better seed in a knockout). A chair left
     * empty is a player not ready.
     */
    const settleWaiting = async (tx: EntityManager, tournament: Tournament, rows: TournamentGame[], games: EngineGame[]) =>
    {
        const dealt: Dealt[] = [];
        const lapsed: string[] = [];
        const waiting = rows.flatMap((row, index) => games[index].dealt && games[index].how === null && row.tableId !== null && row.matchId === null
            ? [{ row, index, tableId: row.tableId }]
            : []);
        const tableIds = waiting.map((one) => one.tableId);
        const tables = tableIds.length === 0 ? [] : await tx.getRepository(Table).find({ select: { id: true, status: true, createdAt: true }, where: { id: In(tableIds) } });
        const seated = tableIds.length === 0 ? [] : await tx.getRepository(TableSeat).find({ select: { tableId: true, seat: true, userId: true, ready: true }, where: { tableId: In(tableIds) } });

        for (const { row, index, tableId } of waiting)
        {
            const game = games[index];
            const table = tables.find((one) => one.id === tableId);
            const chairs = seated.filter((chair) => chair.tableId === tableId);
            const readyAt = (seat: number) => chairs.some((chair) => chair.seat === seat && chair.userId !== null && chair.ready);
            const aReady = readyAt(0);
            const bReady = readyAt(1);
            const open = table !== undefined && table.status !== 'closed';

            if (open && aReady && bReady)
            {
                const matchId = await helpers.deal(tx, tableId);

                if (matchId === null)
                {
                    throw new Error(`a tournament table would not deal: ${ tableId }`);
                }

                await tx.getRepository(TournamentGame).update({ id: row.id }, { matchId });
                row.matchId = matchId;
                dealt.push({ tableId, matchId, players: chairs.map((chair) => chair.userId).filter((userId) => userId !== null) });
                continue;
            }

            if (open && table.createdAt.getTime() + READY_MS > Date.now())
            {
                continue;
            }

            games[index] = aReady !== bReady
                ? walkover(game, (aReady ? game.a : game.b) as number)
                : applyResult(game, null, tournament.bestOf);
            lapsed.push(tableId);
        }

        return { dealt, lapsed };
    };

    /**
     * Brings one tournament as far forward as the world allows.
     *
     * Everything automatic goes through here, under the tournament's own lock, and it can run any
     * number of times: what it does is read off the rows. A finished game only nudges it, because
     * the nudge is a courtesy and can be lost; the sweep calling this is what keeps a bracket moving.
     */
    const advance = (tournamentId: string): Promise<Advanced | null> => db.transaction(async (tx) =>
    {
        await lockTable(tx, tournamentId);

        const tournament = await tx.getRepository(Tournament).findOne({ where: { id: tournamentId } });

        if (tournament === null || !ACTIVE.includes(tournament.status))
        {
            return null;
        }

        if (tournament.status === 'open')
        {
            const entered = await tx.getRepository(TournamentEntry).countBy({ tournamentId });

            return entered >= tournament.size || tournament.startsAt.getTime() <= Date.now() ? begin(tx, tournament) : null;
        }

        const rows = await tx.getRepository(TournamentGame).find({ where: { tournamentId } });
        const entries = await tx.getRepository(TournamentEntry).find({ where: { tournamentId } });
        const seats = seatsOf(entries);
        const entrants = stillIn(entries);
        const engine = formatOf(tournament);
        const rules = rulesOf(tournament);
        const matchIds = rows.filter((row) => row.dealt && row.how === null && row.matchId !== null).map((row) => row.matchId as string);
        const ended = matchIds.length === 0 ? [] : await tx.getRepository(Match).find({ select: { id: true, finishedAt: true, outcome: true, winnerSeat: true }, where: { id: In(matchIds) } });
        const results = new Map(ended.filter((match) => match.finishedAt !== null).map((match) => [match.id, match]));

        let games = forfeitAbsent(rows.map(toEngine), absentOf(seats)).map((game, index) =>
        {
            const result = rows[index].matchId === null ? undefined : results.get(rows[index].matchId as string);

            if (!game.dealt || game.how !== null || result === undefined)
            {
                return game;
            }

            const side: Side | null = result.outcome === 'won' && result.winnerSeat !== null ? (result.winnerSeat === 0 ? 'a' : 'b') : null;

            return applyResult(game, side, tournament.bestOf);
        });

        const waited = await settleWaiting(tx, tournament, rows, games);
        const dealt: Dealt[] = waited.dealt;
        let changed = waited.dealt.length > 0 || waited.lapsed.length > 0;

        // A waiting game decided without its table, a walkover for somebody taken out, closes it too.
        const unplayed = rows
            .filter((one, index) => one.tableId !== null && one.matchId === null && (games[index].how !== null || !games[index].dealt))
            .map((one) => one.tableId as string);
        const rung = await closeWaiting(tx, [...new Set([...waited.lapsed, ...unplayed])]);

        let opened: Rung[] = [];

        changed = changed || rung.length > 0;
        games = engine.advance(games, rules);

        if (undecided(games).length > 0 && dueGames(games).length > 0)
        {
            const gameOn = await tx.getRepository(Game).existsBy({ id: tournament.game, status: 'available' });

            if (tournament.nextRoundAt === null)
            {
                await tx.getRepository(Tournament).update({ id: tournamentId }, { nextRoundAt: () => `now() + make_interval(secs => ${ ROUND_BREAK_MS / 1000 })` });
                changed = true;
            }
            else if (gameOn && tournament.nextRoundAt.getTime() <= Date.now())
            {
                const round = await dealRound(tx, tournament, games, rows, seats);

                opened = round.opened;
                rung.push(...round.opened);
                games = engine.advance(round.games, rules);
                changed = true;
                await tx.getRepository(Tournament).update({ id: tournamentId }, { nextRoundAt: null });
            }
        }

        changed = await persist(tx, tournamentId, rows, games) || changed;

        const notices: Notice[] = opened.map((one) => ({ kind: 'tournament-game', userIds: one.players, tableId: one.tableId }));

        if (undecided(games).length === 0)
        {
            await finish(tx, tournament, games, seats);
            notices.push({ kind: 'tournament-over', userIds: entrants });
            changed = true;
        }

        return { id: tournament.id, code: tournament.code, game: tournament.game, entrants, changed, dealt, rung, notices };
    });

    const entryLock = async (tx: EntityManager, code: string) =>
    {
        const found = await tx.getRepository(Tournament).findOne({ select: { id: true }, where: { code } });

        if (found === null)
        {
            throw new NotFoundError('No tournament there.');
        }

        await lockTable(tx, found.id);

        return await tx.getRepository(Tournament).findOneOrFail({ where: { id: found.id } });
    };

    const detailOf = async (me: string, code: string) =>
    {
        const summary = await summaries(me).where('k.code = :code', { code }).getRawOne<SummaryRow>();

        if (summary === undefined)
        {
            return null;
        }

        const tournament = await db.getRepository(Tournament).findOneOrFail({ where: { id: summary.id } });
        const entrants = await db.getRepository(TournamentEntry).createQueryBuilder('e')
            .leftJoin(User, 'u', 'u.id = e.user_id')
            .select('e.spot', 'spot')
            .addSelect('e.seed', 'seed')
            .addSelect('e.user_id', 'user_id')
            .addSelect('u.handle::text', 'who')
            .addSelect('e.removed_at is not null', 'removed')
            .where('e.tournament_id = :id', { id: summary.id })
            .orderBy('e.spot', 'ASC')
            .getRawMany<{ spot: number; seed: number | null; user_id: string | null; who: string | null; removed: boolean }>();
        const rows = await db.getRepository(TournamentGame).createQueryBuilder('g')
            .leftJoin(Table, 't', 't.id = g.table_id')
            .leftJoin(Match, 'm', 'm.id = g.match_id')
            .select(GAME_COLUMNS.map((column) => `g.${ column } as ${ column }`))
            .addSelect('t.status', 'table_status')
            .addSelect('m.finished_at', 'match_finished_at')
            .where('g.tournament_id = :id', { id: summary.id })
            .getRawMany<{
                stage: string; round: number; slot: number; phase: number; seed_a: number | null; seed_b: number | null; score_a: number; score_b: number;
                winner_seed: number | null; how: EngineGame['how']; attempt: number; dealt: boolean; win_to: string | null; lose_to: string | null; table_id: string | null; match_id: string | null;
                table_status: string | null; match_finished_at: Date | null;
            }>();

        const whoSeed = new Map(entrants.filter((entry) => entry.seed !== null).map((entry) => [entry.seed as number, entry]));
        const handleOf = (seed: number | null) => seed === null ? undefined : whoSeed.get(seed)?.who ?? undefined;
        const mine = entrants.find((entry) => entry.user_id === me);
        const engineGames = rows.map((row): EngineGame => ({
            key: `${ row.stage }:${ row.round }:${ row.slot }`,
            stage: row.stage,
            round: row.round,
            slot: row.slot,
            phase: row.phase,
            a: row.seed_a,
            b: row.seed_b,
            scoreA: row.score_a,
            scoreB: row.score_b,
            winner: row.winner_seed,
            how: row.how,
            attempt: row.attempt,
            dealt: row.dealt,
            winTo: linkOf(row.win_to),
            loseTo: linkOf(row.lose_to)
        }));

        const live = (row: typeof rows[number]) => row.match_id !== null && row.dealt && row.how === null && row.match_finished_at === null;
        const myGame = mine?.seed === null || mine === undefined || mine.removed
            ? undefined
            : rows.find((row) => live(row) && (row.seed_a === mine.seed || row.seed_b === mine.seed))?.table_id ?? undefined;

        const rules = rulesOf(tournament);
        const format = formatOf(tournament);
        const named = (row: { seed: number; place: number | null; played: number; wins: number; losses: number; draws: number; points: number; diff: number }) => ({
            seed: row.seed,
            ...(handleOf(row.seed) === undefined ? {} : { who: handleOf(row.seed) as string }),
            ...(row.place === null ? {} : { place: row.place }),
            played: row.played,
            wins: row.wins,
            losses: row.losses,
            draws: row.draws,
            points: row.points,
            diff: row.diff
        });
        const started = rows.length > 0;
        const absent = new Set(entrants.filter((entry) => entry.seed !== null && (entry.removed || entry.user_id === null)).map((entry) => entry.seed as number));
        const standings = started ? placesOf(tournament, engineGames, absent) : [];
        const placeOf = new Map(standings.map((row) => [row.seed, row.place]));

        return {
            ...asSummary(summary),
            id: summary.id,
            rounds: tournament.rounds,
            ...(tournament.nextRoundAt === null ? {} : { nextRoundAt: tournament.nextRoundAt.toISOString() }),
            entrants: entrants.map((entry) => ({
                spot: entry.spot,
                ...(entry.who === null ? {} : { who: entry.who }),
                ...(entry.seed === null ? {} : { seed: entry.seed }),
                ...(entry.seed === null || placeOf.get(entry.seed) == null ? {} : { place: placeOf.get(entry.seed) as number }),
                ...(entry.removed ? { removed: true } : {})
            })),
            games: rows.map((row) => ({
                stage: row.stage,
                round: row.round,
                slot: row.slot,
                phase: row.phase,
                ...(row.seed_a === null ? {} : { aSeed: row.seed_a }),
                ...(row.seed_b === null ? {} : { bSeed: row.seed_b }),
                ...(handleOf(row.seed_a) === undefined ? {} : { a: handleOf(row.seed_a) as string }),
                ...(handleOf(row.seed_b) === undefined ? {} : { b: handleOf(row.seed_b) as string }),
                scoreA: row.score_a,
                scoreB: row.score_b,
                ...(row.winner_seed === null ? {} : { winner: row.winner_seed === row.seed_a ? 'a' as const : 'b' as const }),
                ...(row.how === null ? {} : { how: row.how }),
                attempt: row.attempt,
                live: live(row),
                ...(row.table_id === null || row.table_status === 'closed' ? {} : { tableId: row.table_id })
            })),
            standings: standings.map(named),
            tables: started ? format.tables(engineGames, rules).map((table) => ({
                ...(table.group === null ? {} : { group: table.group }),
                qualify: table.qualify,
                rows: (RANKED.includes(tournament.format) ? withoutAbsent(table.rows, absent) : table.rows).map(named)
            })) : [],
            can: (tournament.status === 'open'
                ? (mine !== undefined ? 'leave' : summary.entered >= tournament.size ? 'none' : 'join')
                : 'none') as 'join' | 'leave' | 'none',
            mayCancel: tournament.status === 'open' && tournament.creatorId === me,
            ...(myGame === undefined ? {} : { myGame })
        };
    };

    return {
        advance,

        /** The tournaments that may have something to do: running, or open and full or due. */
        async sweep()
        {
            const rows = await db.getRepository(Tournament).createQueryBuilder('k')
                .select('k.id', 'id')
                .where(`k.status = 'running'
                        or (k.status = 'open' and (k.starts_at <= now()
                            or (select count(*) from tournament_entries e where e.tournament_id = k.id) >= k.size))`)
                .orderBy('k.starts_at', 'ASC')
                .limit(SWEEP_MAX)
                .getRawMany<{ id: string }>();

            return rows.map((row) => row.id);
        },

        /** The tournament a table waiting for its players belongs to, so a Ready need not wait for the sweep. */
        async ofTable(tableId: string)
        {
            return (await db.getRepository(TournamentGame).findOne({ select: { tournamentId: true }, where: { tableId } }))?.tournamentId ?? null;
        },

        /** The tournament a finished match belongs to, if any, so its bracket need not wait for the sweep. */
        async ofMatch(matchId: string)
        {
            return (await db.getRepository(TournamentGame).findOne({ select: { tournamentId: true }, where: { matchId } }))?.tournamentId ?? null;
        },

        async list(me: string, filter: { status?: 'open' | 'running' | 'finished' | 'mine'; game?: string })
        {
            const query = summaries(me).where('((k.listed and not k.hidden) or k.creator_id = :me or exists (select 1 from tournament_entries e where e.tournament_id = k.id and e.user_id = :me))');

            if (filter.status === 'mine')
            {
                query.andWhere('(k.creator_id = :me or exists (select 1 from tournament_entries e where e.tournament_id = k.id and e.user_id = :me))');
            }
            else if (filter.status !== undefined)
            {
                query.andWhere('k.status = :status', { status: filter.status });
            }
            else
            {
                query.andWhere(`k.status <> 'cancelled'`);
            }

            if (filter.game !== undefined)
            {
                query.andWhere('k.game = :game', { game: filter.game });
            }

            const rows = await query
                .orderBy(`case when k.featured_at is not null and k.status in ('open', 'running') then 0 else 1 end`, 'ASC')
                .addOrderBy('k.featured_at', 'DESC', 'NULLS LAST')
                .addOrderBy(`case k.status when 'running' then 0 when 'open' then 1 else 2 end`, 'ASC')
                .addOrderBy('k.starts_at', filter.status === 'finished' ? 'DESC' : 'ASC')
                .limit(LIST_MAX)
                .getRawMany<SummaryRow>();

            return rows.map(asSummary);
        },

        detail: detailOf,

        async create(me: string, input: TournamentCreate)
        {
            const engine = FORMATS[input.format];

            if (!engine.sizes.includes(input.size) || !(BEST_OF as readonly number[]).includes(input.bestOf))
            {
                throw refusal('tournament-format', 'That format does not run at that size.');
            }

            const startsAt = new Date(input.startsAt);
            const ahead = startsAt.getTime() - Date.now();

            if (Number.isNaN(ahead) || ahead < SOONEST_MS || ahead > LATEST_MS)
            {
                throw refusal('tournament-time', 'Pick a start between five minutes and two weeks from now.');
            }

            const rule = await db.getRepository(GameRule).createQueryBuilder('r')
                .innerJoin(Game, 'g', `g.id = r.game_id and g.status = 'available'`)
                .where('r.game_id = :game', { game: input.game })
                .getOne();

            if (rule === null || !rule.seats.includes(2) || !rule.modes.includes('live'))
            {
                throw refusal('tournament-game', 'That game cannot be played in a tournament.');
            }

            for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1)
            {
                const code = codeOf();

                try
                {
                    await db.transaction(async (tx) =>
                    {
                        await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`tournament-creator:${ me }`]);

                        const running = await tx.getRepository(Tournament).countBy({ creatorId: me, status: In(ACTIVE) });

                        if (running >= CREATED_MAX)
                        {
                            throw refusal('tournament-created-max', `You can run ${ CREATED_MAX } tournaments at once.`);
                        }

                        const inserted = await tx.getRepository(Tournament).insert({
                            code,
                            name: input.name,
                            game: input.game,
                            format: input.format,
                            size: input.size,
                            bestOf: input.bestOf,
                            listed: input.listed,
                            startsAt,
                            creatorId: me
                        });

                        await tx.getRepository(TournamentEntry).insert({ tournamentId: inserted.identifiers[0].id as string, userId: me, spot: 1 });
                    });

                    return await detailOf(me, code);
                }
                catch (error)
                {
                    if ((error as { code?: string }).code !== UNIQUE_VIOLATION)
                    {
                        throw error;
                    }
                }
            }

            throw refusal('tournament-closed', 'Could not open a tournament just now. Try again.');
        },

        async join(me: string, code: string)
        {
            const full = await db.transaction(async (tx) =>
            {
                const tournament = await entryLock(tx, code);

                if (tournament.status !== 'open' || tournament.startsAt.getTime() <= Date.now())
                {
                    throw refusal('tournament-closed', 'That tournament is not taking entries.');
                }

                const entries = await tx.getRepository(TournamentEntry).find({ select: { spot: true, userId: true }, where: { tournamentId: tournament.id } });

                if (entries.some((entry) => entry.userId === me))
                {
                    throw refusal('tournament-entered', 'You already have a place.');
                }

                if (entries.length >= tournament.size)
                {
                    throw refusal('tournament-full', 'Every place has been taken.');
                }

                const entered = await tx.getRepository(TournamentEntry).createQueryBuilder('e')
                    .innerJoin(Tournament, 'k', `k.id = e.tournament_id and k.status in ('open', 'running')`)
                    .where('e.user_id = :me and e.removed_at is null', { me })
                    .getCount();

                if (entered >= ENTERED_MAX)
                {
                    throw refusal('tournament-entries-max', `You can be in ${ ENTERED_MAX } tournaments at once.`);
                }

                const taken = new Set(entries.map((entry) => entry.spot));
                let spot = 1;

                while (taken.has(spot))
                {
                    spot += 1;
                }

                await tx.getRepository(TournamentEntry).insert({ tournamentId: tournament.id, userId: me, spot });

                return entries.length + 1 >= tournament.size ? tournament.id : null;
            });

            return { started: full === null ? null : await advance(full), view: await detailOf(me, code) };
        },

        async leave(me: string, code: string)
        {
            await db.transaction(async (tx) =>
            {
                const tournament = await entryLock(tx, code);

                if (tournament.status !== 'open')
                {
                    throw refusal('tournament-closed', 'That tournament has already started.');
                }

                await tx.getRepository(TournamentEntry).delete({ tournamentId: tournament.id, userId: me });
            });

            return await detailOf(me, code);
        },

        async cancel(me: string, code: string)
        {
            const done = await db.transaction(async (tx) =>
            {
                const tournament = await entryLock(tx, code);

                if (tournament.creatorId !== me)
                {
                    throw new NotFoundError('No tournament there.');
                }

                if (tournament.status !== 'open')
                {
                    throw refusal('tournament-closed', 'That tournament has already started.');
                }

                return await cancelled(tx, tournament);
            });

            return { done, view: await detailOf(me, code) };
        },

        /**
         * What the staff do to a tournament. Each runs in the caller's transaction, under the
         * tournament's own lock, so the staff log is written with the change or not at all.
         */
        staff: {
            lock: entryLock,

            halt: (tx: EntityManager, tournament: Tournament) => cancelled(tx, tournament),

            /** Starts an open one at once, with whoever has a place; 'few' if that is not enough. */
            async startNow(tx: EntityManager, tournament: Tournament)
            {
                if (await tx.getRepository(TournamentEntry).countBy({ tournamentId: tournament.id }) < MIN_ENTRANTS)
                {
                    return 'few' as const;
                }

                await tx.getRepository(Tournament).update({ id: tournament.id }, { startsAt: () => 'now()' });

                return await begin(tx, tournament);
            },

            async moveStart(tx: EntityManager, tournament: Tournament, startsAt: Date)
            {
                await tx.getRepository(Tournament).update({ id: tournament.id }, { startsAt });
            },

            async feature(tx: EntityManager, tournament: Tournament, on: boolean)
            {
                await tx.getRepository(Tournament).update({ id: tournament.id }, on ? { featuredAt: () => 'now()' } : { featuredAt: null });
            },

            async hide(tx: EntityManager, tournament: Tournament, hidden: boolean)
            {
                await tx.getRepository(Tournament).update({ id: tournament.id }, { hidden });
            },

            /**
             * Takes somebody out. Before the draw their place is simply freed. After it the row stays
             * and the game they are in is lost by walkover here, before anything reads its table, so
             * no result that lands after can be applied to it; answers that game's match so the caller
             * can end it, and null when there was none.
             */
            async remove(tx: EntityManager, tournament: Tournament, userId: string)
            {
                const entry = await tx.getRepository(TournamentEntry).findOne({ where: { tournamentId: tournament.id, userId } });

                if (entry === null || entry.removedAt !== null)
                {
                    return 'none' as const;
                }

                if (tournament.status === 'open' || entry.seed === null)
                {
                    await tx.getRepository(TournamentEntry).delete({ id: entry.id });

                    return { match: null };
                }

                await tx.getRepository(TournamentEntry).update({ id: entry.id }, { removedAt: () => 'now()' });

                const rows = await tx.getRepository(TournamentGame).find({ where: { tournamentId: tournament.id } });
                const before = rows.map(toEngine);
                const after = forfeitAbsent(before, new Set([entry.seed]));
                const forfeited = rows.find((row, index) => before[index].how === null && after[index].how !== null && row.matchId !== null);

                await persist(tx, tournament.id, rows, after);

                return { match: forfeited?.matchId ?? null };
            },

            async list(filter: { search?: string; status?: TournamentStatus }, limit: number)
            {
                const query = db.getRepository(Tournament).createQueryBuilder('k')
                    .select('k.code::text', 'code')
                    .addSelect('k.name', 'name')
                    .addSelect('k.game', 'game')
                    .addSelect('k.format', 'format')
                    .addSelect('k.status', 'status')
                    .addSelect('k.size', 'size')
                    .addSelect('k.listed', 'listed')
                    .addSelect('k.hidden', 'hidden')
                    .addSelect('k.featured_at is not null', 'featured')
                    .addSelect('k.starts_at', 'starts_at')
                    .addSelect('(select count(*)::int from tournament_entries e where e.tournament_id = k.id and e.removed_at is null)', 'entered')
                    .addSelect('(select count(*)::int from tournament_games g join matches m on m.id = g.match_id where g.tournament_id = k.id and g.how is null and g.dealt and m.finished_at is null)', 'live')
                    .addSelect('(select u.handle::text from users u where u.id = k.creator_id)', 'creator');

                const search = (filter.search ?? '').trim();

                if (search !== '')
                {
                    query.andWhere(`(k.name ilike :pattern escape '\\' or k.code::text ilike :pattern escape '\\')`, { pattern: `%${ search.replace(/[\\%_]/g, (one) => `\\${ one }`) }%` });
                }

                if (filter.status !== undefined)
                {
                    query.andWhere('k.status = :status', { status: filter.status });
                }

                const rows = await query
                    .orderBy(`case k.status when 'running' then 0 when 'open' then 1 else 2 end`, 'ASC')
                    .addOrderBy('k.starts_at', 'DESC')
                    .limit(limit)
                    .getRawMany<{ code: string; name: string; game: string; format: string; status: TournamentStatus; size: number; listed: boolean; hidden: boolean; featured: boolean; starts_at: Date; entered: number; live: number; creator: string | null }>();

                return rows.map((row) => ({
                    code: row.code,
                    name: row.name,
                    game: row.game,
                    format: row.format,
                    status: row.status,
                    size: row.size,
                    listed: row.listed,
                    hidden: row.hidden,
                    featured: row.featured,
                    entered: row.entered,
                    live: row.live,
                    startsAt: row.starts_at.toISOString(),
                    ...(row.creator === null ? {} : { creator: row.creator })
                }));
            },

            /** The page a reader sees, and the one fact about it only the staff see. */
            async view(me: string, code: string)
            {
                const tournament = await detailOf(me, code);

                if (tournament === null)
                {
                    return null;
                }

                const { hidden } = await db.getRepository(Tournament).findOneOrFail({ select: { hidden: true }, where: { id: tournament.id } });

                return { tournament, hidden };
            }
        }
    };
}

const asSummary = (row: SummaryRow) => ({
    code: row.code,
    name: row.name,
    game: row.game,
    format: row.format as FormatId,
    size: row.size,
    bestOf: row.best_of,
    listed: row.listed,
    featured: row.featured,
    status: row.status,
    entered: row.entered,
    startsAt: row.starts_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at.toISOString() }),
    ...(row.creator === null ? {} : { creator: row.creator }),
    ...(row.champion === null ? {} : { champion: row.champion }),
    ...(row.spot === null ? {} : { spot: row.spot })
});

export type TournamentService = ReturnType<typeof createTournamentService>;

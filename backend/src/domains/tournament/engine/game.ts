/**
 * One game of a tournament, whatever the format, and everything every format does to it. A seed is
 * a whole number from 1, and 1 is the best. No database and no clock lives under `engine/`, so a
 * format can be played out against every field size in a spec.
 */

export type Decided = 'played' | 'bye' | 'seed' | 'draw' | 'void';

export type Side = 'a' | 'b';

export interface Link
{
    key: string;
    side: Side;
}

export interface Rules
{
    entrants: number;
    bestOf: number;

    /** How many rounds a Swiss plays; the other formats work theirs out. */
    rounds: number;
}

export interface Game
{
    key: string;
    stage: string;
    round: number;
    slot: number;

    /** Games are dealt phase by phase, each one only once every earlier phase is decided. */
    phase: number;

    a: number | null;
    b: number | null;
    scoreA: number;
    scoreB: number;
    winner: number | null;
    how: Decided | null;

    /** Which game of the series is being played, counting ones with no winner. */
    attempt: number;
    dealt: boolean;

    winTo: Link | null;
    loseTo: Link | null;
}

export interface Standing
{
    seed: number;

    /** Null while there is still something for this seed to play for. */
    place: number | null;
    played: number;
    wins: number;
    losses: number;
    draws: number;
    points: number;
    diff: number;
}

export interface StandingsTable
{
    /** Which group, or null for a table of the whole field. */
    group: number | null;
    rows: Standing[];

    /** How many from the top of this table go through. */
    qualify: number;
}

/** What every format has to be able to say. A new format is a new one of these and nothing else. */
export interface Format
{
    id: string;
    sizes: readonly number[];
    roundsFor(entrants: number): number;
    start(rules: Rules): Game[];

    /** Plays out everything that follows from the results so far, adding any games they call for. */
    advance(games: readonly Game[], rules: Rules): Game[];
    standings(games: readonly Game[], rules: Rules): Standing[];
    tables(games: readonly Game[], rules: Rules): StandingsTable[];
}

export const keyOf = (stage: string, round: number, slot: number) => `${ stage }:${ round }:${ slot }`;

export const blankGame = (stage: string, round: number, slot: number, a: number | null = null, b: number | null = null): Game => ({
    key: keyOf(stage, round, slot),
    stage,
    round,
    slot,
    phase: round,
    a,
    b,
    scoreA: 0,
    scoreB: 0,
    winner: null,
    how: null,
    attempt: 1,
    dealt: false,
    winTo: null,
    loseTo: null
});

/** A game in which a draw is a result, rather than something that must be broken. */
export const isLeague = (game: Pick<Game, 'stage'>) => game.stage === 'league' || /^group\d+$/.test(game.stage);

const inOrder = (one: Game, other: Game) => one.phase - other.phase || one.key.localeCompare(other.key);

const feedersOf = (games: readonly Game[]) =>
{
    const feeders = new Map<string, Game[]>();

    for (const game of games)
    {
        for (const link of [game.winTo, game.loseTo])
        {
            if (link !== null)
            {
                feeders.set(link.key, [...feeders.get(link.key) ?? [], game]);
            }
        }
    }

    return feeders;
};

/** Numbers the games by the longest chain of games each one waits for. */
export const withPhases = (games: readonly Game[]) =>
{
    const next = games.map((game) => ({ ...game, phase: 1 }));
    const feeders = feedersOf(next);
    const byKey = new Map(next.map((game) => [game.key, game]));

    for (let pass = 0; pass <= next.length; pass += 1)
    {
        for (const game of next)
        {
            for (const feeder of feeders.get(game.key) ?? [])
            {
                game.phase = Math.max(game.phase, (byKey.get(feeder.key) as Game).phase + 1);
            }
        }
    }

    return next;
};

const loserOf = (game: Game) => game.winner === game.a ? game.b : game.a;

/**
 * Carries every decided game's players on and decides what has nobody left to wait for.
 *
 * A game whose feeders are all decided but which got only one player is a bye, and one that got
 * none is void. That is what lets a double elimination's losers' bracket work with byes in the
 * winners' bracket: a bye sends no loser down, and the slot it would have filled simply stays empty.
 */
export const settle = (games: readonly Game[]) =>
{
    const next = games.map((game) => ({ ...game })).sort(inOrder);
    const byKey = new Map(next.map((game) => [game.key, game]));
    const feeders = feedersOf(next);

    for (const game of next)
    {
        const waiting = (feeders.get(game.key) ?? []).some((feeder) => feeder.how === null);

        if (game.how === null && !waiting)
        {
            if (game.a === null && game.b === null)
            {
                game.how = 'void';
            }
            else if (game.a === null || game.b === null)
            {
                game.winner = game.a ?? game.b;
                game.how = 'bye';
            }
        }

        if (game.how === null || game.winner === null)
        {
            continue;
        }

        const place = (link: Link | null, seed: number | null) =>
        {
            const target = link === null ? undefined : byKey.get(link.key);

            if (target !== undefined && link !== null && seed !== null)
            {
                target[link.side] = seed;
            }
        };

        place(game.winTo, game.winner);

        if (game.how !== 'bye')
        {
            place(game.loseTo, loserOf(game));
        }
    }

    return next;
};

export const undecided = (games: readonly Game[]) => games.filter((game) => game.how === null);

export const allDecided = (games: readonly Game[]) => undecided(games).length === 0;

/** The phase being played, or null once there is nothing left to decide. */
export const currentPhase = (games: readonly Game[]) =>
{
    const open = undecided(games).map((game) => game.phase);

    return open.length === 0 ? null : Math.min(...open);
};

/** The games of the current phase with two players and no table yet. */
export const dueGames = (games: readonly Game[]) =>
{
    const phase = currentPhase(games);

    return undecided(games).filter((game) => game.phase === phase && !game.dealt && game.a !== null && game.b !== null);
};

/**
 * One finished table's effect on its game.
 *
 * A series goes to whoever reaches a majority. A game with no winner does not count towards it, so
 * a knockout gets one attempt more than its length and then the better seed goes through: nothing
 * can go round for ever. A league simply plays its length and may end level.
 */
export const applyResult = (game: Game, side: Side | null, bestOf: number): Game =>
{
    const scored = {
        ...game,
        scoreA: game.scoreA + (side === 'a' ? 1 : 0),
        scoreB: game.scoreB + (side === 'b' ? 1 : 0)
    };
    const needed = Math.ceil(bestOf / 2);
    const finish = (winner: number | null, how: Decided) => ({ ...scored, winner, how });

    if (scored.scoreA >= needed)
    {
        return finish(scored.a, 'played');
    }

    if (scored.scoreB >= needed)
    {
        return finish(scored.b, 'played');
    }

    if (scored.attempt < (isLeague(game) ? bestOf : bestOf + 1))
    {
        return { ...scored, attempt: scored.attempt + 1, dealt: false };
    }

    if (scored.scoreA !== scored.scoreB)
    {
        return finish(scored.scoreA > scored.scoreB ? scored.a : scored.b, 'played');
    }

    return isLeague(game)
        ? finish(null, 'draw')
        : finish(Math.min(scored.a as number, scored.b as number), 'seed');
};

/** A game one side could not turn up to, because their account is gone or the staff took them out. */
export const walkover = (game: Game, winner: number): Game => ({ ...game, winner, how: 'seed', dealt: false });

/**
 * Settles every game already dealt to somebody who is no longer in it, before any table's result is
 * read: a result that lands first would otherwise be replayed or decided by seed. Games not yet dealt
 * are left to the deal, which walks over an empty seat the same way.
 */
export const forfeitAbsent = (games: readonly Game[], absent: ReadonlySet<number>) => games.map((game) =>
{
    if (!game.dealt || game.how !== null || game.a === null || game.b === null || (!absent.has(game.a) && !absent.has(game.b)))
    {
        return game;
    }

    return walkover(game, absent.has(game.a) ? game.b : game.a);
});

/**
 * A league's table with those taken out moved to the bottom and given no place, so somebody removed
 * late cannot finish first on the points they had. A knockout needs none of this: walked over, they
 * are out like anybody who lost.
 */
export const withoutAbsent = (rows: readonly Standing[], absent: ReadonlySet<number>): Standing[] =>
{
    if (absent.size === 0)
    {
        return [...rows];
    }

    const kept = rows.filter((row) => !absent.has(row.seed));
    const placed = kept.every((row) => row.place !== null);

    return [
        ...kept.map((row, index) => ({ ...row, place: placed ? index + 1 : null })),
        ...rows.filter((row) => absent.has(row.seed)).map((row) => ({ ...row, place: null }))
    ];
};

/** The seeds 1 to `count` in a random order, from a source of whole numbers below the one it is given. */
export const shuffledSeeds = (count: number, below: (limit: number) => number) =>
{
    const seeds = Array.from({ length: count }, (_, index) => index + 1);

    for (let index = seeds.length - 1; index > 0; index -= 1)
    {
        const other = below(index + 1);

        [seeds[index], seeds[other]] = [seeds[other], seeds[index]];
    }

    return seeds;
};

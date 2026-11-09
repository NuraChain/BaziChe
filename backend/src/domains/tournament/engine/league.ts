import { allDecided, blankGame, settle, type Format, type Game, type Rules, type Standing } from './game.ts';

export const WIN_POINTS = 3;

export const DRAW_POINTS = 1;

export type TieBreak = 'head-to-head' | 'buchholz';

/** Everybody plays everybody, by the circle method: one seat fixed and the rest rotating past it. */
export const roundRobinGames = (stage: string, seeds: readonly number[]) =>
{
    const players: (number | null)[] = seeds.length % 2 === 0 ? [...seeds] : [...seeds, null];
    const rounds = players.length - 1;
    const games: Game[] = [];

    for (let round = 0; round < rounds; round += 1)
    {
        for (let index = 0; index < players.length / 2; index += 1)
        {
            const one = players[index];
            const other = players[players.length - 1 - index];

            if (one !== null && other !== null)
            {
                games.push(round % 2 === 0
                    ? blankGame(stage, round + 1, index, one, other)
                    : blankGame(stage, round + 1, index, other, one));
            }
        }

        players.splice(1, 0, players.pop() as number | null);
    }

    return games;
};

const pairKey = (one: number, other: number) => `${ Math.min(one, other) }-${ Math.max(one, other) }`;

const tally = (games: readonly Game[], seeds: readonly number[]) =>
{
    const rows = new Map<number, Standing>(seeds.map((seed) => [seed, { seed, place: null, played: 0, wins: 0, losses: 0, draws: 0, points: 0, diff: 0 }]));

    for (const game of games)
    {
        if (game.how === 'bye' && game.winner !== null)
        {
            const row = rows.get(game.winner);

            if (row !== undefined)
            {
                row.wins += 1;
                row.points += WIN_POINTS;
            }
        }

        if (game.how === null || game.how === 'bye' || game.how === 'void' || game.a === null || game.b === null)
        {
            continue;
        }

        const a = rows.get(game.a);
        const b = rows.get(game.b);

        if (a === undefined || b === undefined)
        {
            continue;
        }

        a.played += 1;
        b.played += 1;
        a.diff += game.scoreA - game.scoreB;
        b.diff += game.scoreB - game.scoreA;

        if (game.winner === null)
        {
            a.draws += 1;
            b.draws += 1;
            a.points += DRAW_POINTS;
            b.points += DRAW_POINTS;
        }
        else
        {
            const [winner, loser] = game.winner === game.a ? [a, b] : [b, a];

            winner.wins += 1;
            winner.points += WIN_POINTS;
            loser.losses += 1;
        }
    }

    return rows;
};

/**
 * Orders a league by points, and breaks a tie the same way every time.
 *
 * Head-to-head is a table of only the games among those tied; Buchholz is the sum of everybody's
 * opponents' points, which suits a Swiss, where the tied players often never met. The seed is the
 * last word so an order can never depend on what a sort happened to do.
 */
export const rankLeague = (games: readonly Game[], seeds: readonly number[], tieBreak: TieBreak): Standing[] =>
{
    const rows = tally(games, seeds);
    const buchholz = new Map(seeds.map((seed) => [seed, 0]));

    for (const game of games)
    {
        if (game.how !== null && game.how !== 'bye' && game.how !== 'void' && game.a !== null && game.b !== null)
        {
            buchholz.set(game.a, (buchholz.get(game.a) ?? 0) + (rows.get(game.b)?.points ?? 0));
            buchholz.set(game.b, (buchholz.get(game.b) ?? 0) + (rows.get(game.a)?.points ?? 0));
        }
    }

    const sorted = [...rows.values()].sort((one, other) => other.points - one.points);
    const ordered: Standing[] = [];

    for (let start = 0; start < sorted.length;)
    {
        let end = start;

        while (end < sorted.length && sorted[end].points === sorted[start].points)
        {
            end += 1;
        }

        const tied = sorted.slice(start, end);
        const among = new Set(tied.map((row) => row.seed));
        const mini = tally(games.filter((game) => game.a !== null && game.b !== null && among.has(game.a) && among.has(game.b)), tied.map((row) => row.seed));
        const firstBreak = (row: Standing) => tieBreak === 'buchholz' ? buchholz.get(row.seed) ?? 0 : mini.get(row.seed)?.points ?? 0;

        ordered.push(...tied.sort((one, other) =>
            firstBreak(other) - firstBreak(one)
            || other.diff - one.diff
            || other.wins - one.wins
            || one.seed - other.seed));

        start = end;
    }

    const over = allDecided(games);

    return ordered.map((row, index) => ({ ...row, place: over ? index + 1 : null }));
};

const everySeed = (rules: Rules) => Array.from({ length: rules.entrants }, (_, index) => index + 1);

/** Pairs a ranked list so nobody meets anybody twice, nearest first, going back when it runs out of road. */
const pairWithoutRepeats = (ranked: readonly number[], met: ReadonlySet<string>): [number, number][] | null =>
{
    if (ranked.length === 0)
    {
        return [];
    }

    const [first, ...rest] = ranked;

    for (const candidate of rest)
    {
        if (met.has(pairKey(first, candidate)))
        {
            continue;
        }

        const others = pairWithoutRepeats(rest.filter((seed) => seed !== candidate), met);

        if (others !== null)
        {
            return [[first, candidate], ...others];
        }
    }

    return null;
};

/** The next round of a Swiss: the lowest-ranked without one sits out, and the rest play their nearest equal. */
export const swissRound = (games: readonly Game[], seeds: readonly number[], round: number) =>
{
    const ranked = rankLeague(games, seeds, 'buchholz').map((row) => row.seed);
    const hadBye = new Set(games.filter((game) => game.how === 'bye').map((game) => game.winner));
    const met = new Set(games.filter((game) => game.a !== null && game.b !== null).map((game) => pairKey(game.a as number, game.b as number)));
    const next: Game[] = [];
    let playing = ranked;

    if (ranked.length % 2 === 1)
    {
        const bye = [...ranked].reverse().find((seed) => !hadBye.has(seed)) ?? ranked[ranked.length - 1];

        playing = ranked.filter((seed) => seed !== bye);
        next.push(blankGame('league', round, playing.length / 2, bye));
    }

    const pairs = pairWithoutRepeats(playing, met)
        ?? Array.from({ length: playing.length / 2 }, (_, index): [number, number] => [playing[index * 2], playing[index * 2 + 1]]);

    pairs.forEach(([one, other], slot) => next.push(blankGame('league', round, slot, one, other)));

    return next;
};

export const roundRobin: Format = {
    id: 'round-robin',
    sizes: [4, 8],
    roundsFor: (entrants) => entrants % 2 === 0 ? entrants - 1 : entrants,
    start: (rules) => settle(roundRobinGames('league', everySeed(rules))),
    advance: (games) => settle(games),
    standings: (games, rules) => rankLeague(games, everySeed(rules), 'head-to-head'),
    tables: (games, rules) => [{ group: null, rows: rankLeague(games, everySeed(rules), 'head-to-head'), qualify: 1 }]
};

export const swiss: Format = {
    id: 'swiss',
    sizes: [8, 16, 32],
    roundsFor: (entrants) => Math.ceil(Math.log2(entrants)),
    start: (rules) => settle(swissRound([], everySeed(rules), 1)),

    advance(games, rules)
    {
        const next = settle(games);
        const last = Math.max(...next.map((game) => game.round));

        return allDecided(next) && last < rules.rounds
            ? settle([...next, ...swissRound(next, everySeed(rules), last + 1)])
            : next;
    },

    standings: (games, rules) =>
    {
        const done = allDecided(games) && Math.max(...games.map((game) => game.round)) >= rules.rounds;

        return rankLeague(games, everySeed(rules), 'buchholz').map((row, index) => ({ ...row, place: done ? index + 1 : null }));
    },

    tables: (games, rules) => [{ group: null, rows: swiss.standings(games, rules), qualify: 1 }]
};

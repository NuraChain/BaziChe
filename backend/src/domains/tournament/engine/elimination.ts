import { allDecided, blankGame, keyOf, settle, withPhases, type Format, type Game, type Link, type Rules, type Side, type Standing } from './game.ts';

export const bracketSizeFor = (entrants: number) =>
{
    let size = 2;

    while (size < entrants)
    {
        size *= 2;
    }

    return size;
};

const roundsIn = (size: number) => Math.round(Math.log2(size));

/** Seeds in bracket order: the best two can only meet in the final, and any byes go to the best. */
export const seedOrder = (size: number) =>
{
    let order = [1];

    while (order.length < size)
    {
        const total = order.length * 2 + 1;

        order = order.flatMap((seed) => [seed, total - seed]);
    }

    return order;
};

const sideOf = (slot: number): Side => slot % 2 === 0 ? 'a' : 'b';

/** A knockout tree, with `seedAt` turning a position in the draw into who is really there. */
export const knockoutTree = (stage: string, entrants: number, seedAt: (seed: number) => number = (seed) => seed) =>
{
    const size = bracketSizeFor(entrants);
    const rounds = roundsIn(size);
    const order = seedOrder(size);
    const games: Game[] = [];

    for (let round = 1; round <= rounds; round += 1)
    {
        for (let slot = 0; slot < size / 2 ** round; slot += 1)
        {
            const at = (seed: number) => round === 1 && seed <= entrants ? seedAt(seed) : null;
            const game = blankGame(stage, round, slot, at(order[slot * 2]), at(order[slot * 2 + 1]));

            game.winTo = round < rounds ? { key: keyOf(stage, round + 1, Math.floor(slot / 2)), side: sideOf(slot) } : null;
            games.push(game);
        }
    }

    return games;
};

const GRAND_FINAL = keyOf('final', 1, 0);

const RESET = keyOf('final', 2, 0);

/**
 * The winners' tree, the losers' tree beside it and the grand final.
 *
 * The losers' bracket alternates: an odd round pairs its own survivors, and an even round sets
 * those survivors against whoever just dropped from the winners' bracket. Every other round the
 * droppers come in reversed, so two players who already met are kept apart for as long as possible.
 */
const doubleTree = (entrants: number) =>
{
    const winners = knockoutTree('winners', entrants);
    const size = bracketSizeFor(entrants);
    const rounds = roundsIn(size);
    const losersRounds = 2 * (rounds - 1);
    const losers: Game[] = [];

    for (let round = 1; round <= losersRounds; round += 1)
    {
        const count = size / 2 ** (Math.floor((round + 1) / 2) + 1);

        for (let slot = 0; slot < count; slot += 1)
        {
            const game = blankGame('losers', round, slot);
            let onward: Link;

            if (round === losersRounds)
            {
                onward = { key: GRAND_FINAL, side: 'b' };
            }
            else if (round % 2 === 1)
            {
                onward = { key: keyOf('losers', round + 1, slot), side: 'b' };
            }
            else
            {
                onward = { key: keyOf('losers', round + 1, Math.floor(slot / 2)), side: sideOf(slot) };
            }

            game.winTo = onward;
            losers.push(game);
        }
    }

    for (const game of winners)
    {
        if (game.round === rounds)
        {
            game.winTo = { key: GRAND_FINAL, side: 'a' };
        }

        if (rounds === 1)
        {
            game.loseTo = { key: GRAND_FINAL, side: 'b' };
        }
        else if (game.round === 1)
        {
            game.loseTo = { key: keyOf('losers', 1, Math.floor(game.slot / 2)), side: sideOf(game.slot) };
        }
        else
        {
            const count = size / 2 ** game.round;

            game.loseTo = { key: keyOf('losers', 2 * (game.round - 1), game.round % 2 === 0 ? count - 1 - game.slot : game.slot), side: 'a' };
        }
    }

    return [...winners, ...losers, blankGame('final', 1, 0)];
};

/** Only the loser of a game with nowhere to drop to is out, and a grand final that forced a reset put nobody out. */
const knockedOut = (game: Game) =>
    game.how !== null && game.how !== 'bye' && game.how !== 'void' && game.a !== null && game.b !== null
    && game.loseTo === null
    && !(game.key === GRAND_FINAL && game.winner === game.b);

/**
 * Where everybody stands in a knockout, read off the games and nothing else.
 *
 * Whoever went out in a later phase places higher, and everybody who went out in the same phase
 * shares a place, so a semi-final's two losers are both third.
 */
export const knockoutRows = (games: readonly Game[], seeds: readonly number[]) =>
{
    const out = new Map<number, number>();
    const rows = new Map<number, Standing>(seeds.map((seed) => [seed, { seed, place: null, played: 0, wins: 0, losses: 0, draws: 0, points: 0, diff: 0 }]));

    for (const game of games)
    {
        if (game.how === null || game.how === 'bye' || game.how === 'void' || game.a === null || game.b === null)
        {
            continue;
        }

        const winner = rows.get(game.winner as number) as Standing;
        const loser = rows.get(game.winner === game.a ? game.b : game.a) as Standing;

        winner.played += 1;
        winner.wins += 1;
        loser.played += 1;
        loser.losses += 1;

        const margin = Math.abs(game.scoreA - game.scoreB);

        winner.diff += margin;
        loser.diff -= margin;

        if (knockedOut(game))
        {
            out.set(loser.seed, Math.max(out.get(loser.seed) ?? 0, game.phase));
        }
    }

    const over = allDecided(games);

    for (const row of rows.values())
    {
        const phase = out.get(row.seed);

        if (phase !== undefined)
        {
            row.place = 2 + [...out.values()].filter((other) => other > phase).length;
        }
        else if (over)
        {
            row.place = 1;
        }
    }

    return [...rows.values()].sort((one, other) => (one.place ?? 0) - (other.place ?? 0) || one.seed - other.seed);
};

const everySeed = (rules: Rules) => Array.from({ length: rules.entrants }, (_, index) => index + 1);

export const singleElimination: Format = {
    id: 'single',
    sizes: [4, 8, 16, 32],
    roundsFor: (entrants) => roundsIn(bracketSizeFor(entrants)),
    start: (rules) => withPhases(knockoutTree('main', rules.entrants)),
    advance: (games) => settle(games),
    standings: (games, rules) => knockoutRows(games, everySeed(rules)),
    tables: () => []
};

export const doubleElimination: Format = {
    id: 'double',
    sizes: [4, 8, 16, 32],
    roundsFor: (entrants) => roundsIn(bracketSizeFor(entrants)),
    start: (rules) => withPhases(doubleTree(rules.entrants)),

    advance(games)
    {
        const next = settle(games);
        const final = next.find((game) => game.key === GRAND_FINAL);

        if (final !== undefined && final.how !== null && final.winner === final.b && !next.some((game) => game.key === RESET))
        {
            next.push({ ...blankGame('final', 2, 0, final.a, final.b), phase: final.phase + 1 });
        }

        return next;
    },

    standings: (games, rules) => knockoutRows(games, everySeed(rules)),
    tables: () => []
};

import { ENTRY, FINISHED, HOME_RUN, RING, RING_STEPS, YARD, isSafeRing, ringIndex } from '../../match/ludo/board.ts';
import type { LudoPlayer, LudoState } from '../../match/ludo/state.ts';

/**
 * What a ludo position is worth to one side, in squares.
 *
 * A token is worth the squares it has walked plus a bonus for being out of the yard (that is what a
 * six buys), a little for the safety of the home stretch and more for being home. Against that
 * stands the chance it is hit before its owner moves again, from the real dice: every opponent
 * token behind it within one, two or three rolls (a legal six rolls again, a third six passes).
 * The same chance read for the other
 * side's tokens is the threat this side poses. A capture needs no term of its own: the victim's
 * walked squares simply go back to nothing, which is why it is worth more the further it had come.
 *
 * In the endgame, once all of a player's tokens are within reach of home, squares stop being the
 * right count - a token one short of home needs exactly a one - so the expert reading adds the
 * turns the exact rolls are expected to waste, from a table worked out once over every such case.
 */

export interface Terms
{
    /** The chance each token is hit, and the threat posed to theirs. */
    danger: boolean;

    /** The safety of the home stretch. */
    stretch: boolean;

    /** The exact-roll endgame count. */
    race: boolean;

    weights: Weights;
}

/** What each thing is worth, in squares, and how the others are weighed against this side. */
export interface Weights
{
    /** Out of the yard: worth a few squares on its own, since it takes a six. */
    out: number;

    /** A token in the home stretch, where nothing can hit it. */
    stretch: number;

    /** A token home. */
    home: number;

    /** How much the leader among the others counts against the mean of them, with more than one. */
    leader: number;

    /** The chance of being hit, and of hitting theirs, as a share of what the token has walked. */
    fear: number;
    threat: number;
}

export const WEIGHTS: Weights = Object.freeze({ out: 15, stretch: 3, home: 8, leader: 0.5, fear: 1, threat: 1 });

/** Small leanings from a player's style, each near 1. */
export interface Taste
{
    /** How much the chance of being hit worries it. */
    risk: number;

    /** How much it likes standing where it threatens theirs. */
    threat: number;

    /** How much it likes having a token out of the yard. */
    out: number;
}

export const PLAIN_TASTE: Taste = Object.freeze({ risk: 1, threat: 1, out: 1 });

export const WIN = 100_000;

/** Squares a turn is worth on average: 3.5 a roll, and a six rolls again. */
const SQUARES_PER_TURN = 4.2;

/** A token at most this far from home counts in the endgame table. */
export const RACE_REACH = 12;

/** The highest distance a hit can come from: six, six and five. */
const FARTHEST = 17;

/**
 * The chance a player hits a token at one of the distances in `reach` (bit d for d squares behind)
 * with one turn's rolls: one to five land, a six either lands or rolls again with every token where
 * it was or the one that moved six squares closer, and a third six passes.
 */
export function hitChance(reach: number, sixes = 0): number
{
    if (reach === 0)
    {
        return 0;
    }

    let chance = 0;

    for (let roll = 1; roll <= 5; roll += 1)
    {
        if ((reach & (1 << roll)) !== 0)
        {
            chance += 1 / 6;
        }
    }

    if (sixes < 2)
    {
        chance += (reach & (1 << 6)) !== 0 ? 1 / 6 : hitChance((reach | (reach >>> 6)) & ~1, sixes + 1) / 6;
    }

    return chance;
}

/** Number of tokens on each ring square. */
function crowdOf(state: LudoState)
{
    const crowd = new Int8Array(RING);

    state.players.forEach((player) =>
    {
        for (const at of player.pieces)
        {
            if (at >= 0 && at < RING_STEPS)
            {
                crowd[ringIndex(player.colour, at)] += 1;
            }
        }
    });

    return crowd;
}

export interface Board
{
    state: LudoState;
    crowd: Int8Array;
}

export function boardOf(state: LudoState): Board
{
    return { state, crowd: crowdOf(state) };
}

/** The chance `target`'s token at `at` is hit before its owner moves again. */
export function dangerOf(board: Board, target: LudoPlayer, at: number): number
{
    if (at < 0 || at >= RING_STEPS)
    {
        return 0;
    }

    const square = ringIndex(target.colour, at);
    if (isSafeRing(square) || board.crowd[square] >= 2)
    {
        return 0;
    }

    let survives = 1;

    for (const attacker of board.state.players)
    {
        if (attacker.out || attacker.side === target.side)
        {
            continue;
        }

        const entry = ENTRY[attacker.colour];
        const canEnter = attacker.pieces.includes(YARD) && board.crowd[entry] === 0;
        let reach = 0;

        for (const from of attacker.pieces)
        {
            if (from < 0 || from >= RING_STEPS)
            {
                continue;
            }

            const distance = (square - ringIndex(attacker.colour, from) + RING) % RING;

            if (distance >= 1 && distance <= FARTHEST && from + distance < RING_STEPS)
            {
                reach |= 1 << distance;
            }
        }

        const beyond = (square - entry + RING) % RING;

        if (canEnter && beyond >= 1 && beyond + 6 <= FARTHEST)
        {
            reach |= 1 << (beyond + 6);
        }

        survives *= 1 - hitChance(reach);
    }

    return 1 - survives;
}

/**
 * Expected turns to bring home tokens this far from home (0 is home), each at most `RACE_REACH`,
 * playing every roll the best way and with a six rolling again. Indexed by the sorted distances.
 */
const RACE: Float64Array = (() =>
{
    const span = RACE_REACH + 1;
    const table = new Float64Array(span ** 4);
    const keyOf = (rest: readonly number[]) => [...rest].sort((a, b) => b - a).reduce((key, one) => key * span + one, 0);
    const all: number[][] = [];

    for (let a = 0; a < span; a += 1)
    {
        for (let b = 0; b <= a; b += 1)
        {
            for (let c = 0; c <= b; c += 1)
            {
                for (let d = 0; d <= c; d += 1)
                {
                    all.push([a, b, c, d]);
                }
            }
        }
    }

    all.sort((one, other) => one.reduce((sum, x) => sum + x, 0) - other.reduce((sum, x) => sum + x, 0));

    for (const rest of all)
    {
        if (rest[0] === 0)
        {
            continue;
        }

        let fixed = 0;
        let stuck = 0;

        for (let roll = 1; roll <= 6; roll += 1)
        {
            let best = Infinity;

            rest.forEach((left, token) =>
            {
                const landing = left - roll;

                if (landing >= 0 && (landing === 0 || landing > HOME_RUN || !rest.includes(landing)))
                {
                    const next = [...rest];

                    next[token] = landing;
                    const turns = table[keyOf(next)];
                    best = Math.min(best, turns + (roll === 6 && turns > 0 ? 0 : 1));
                }
            });

            if (best === Infinity)
            {
                stuck += 1;
                fixed += 1 / 6;
            }
            else
            {
                fixed += best / 6;
            }
        }

        table[keyOf(rest)] = fixed / (1 - stuck / 6);
    }

    return table;
})();

/** Expected turns to bring every token home, from the endgame table; null when one is still too far. */
export function raceTurns(pieces: readonly number[]): number | null
{
    const span = RACE_REACH + 1;
    const left = pieces.map((at) => (at === YARD ? Infinity : FINISHED - at));

    if (left.some((one) => one > RACE_REACH))
    {
        return null;
    }

    return RACE[[...left].sort((a, b) => b - a).reduce((key, one) => key * span + one, 0)];
}

/** One player's tokens, read from its own point of view; `fear` weighs the chance of being hit. */
function playerWorth(board: Board, player: LudoPlayer, terms: Terms, taste: Taste, fear: number)
{
    let worth = 0;
    let remaining = 0;

    for (const at of player.pieces)
    {
        if (at === YARD)
        {
            continue;
        }

        const stake = terms.weights.out * taste.out + at;

        remaining += FINISHED - at;
        worth += stake + (at === FINISHED ? terms.weights.home : 0);

        if (terms.stretch && at >= RING_STEPS)
        {
            worth += terms.weights.stretch;
        }

        if (terms.danger && fear > 0)
        {
            worth -= fear * dangerOf(board, player, at) * stake;
        }
    }

    if (terms.race)
    {
        const turns = raceTurns(player.pieces);

        // Only what the exact rolls waste beyond the plain count of squares.
        if (turns !== null)
        {
            worth -= Math.max(0, turns * SQUARES_PER_TURN - remaining);
        }
    }

    return worth;
}

/** What the position is worth to `side`, in squares: its own tokens against the others'. */
export function worthOf(state: LudoState, side: number, terms: Terms, taste: Taste): number
{
    if (state.winner !== null)
    {
        return state.winner === side ? WIN : -WIN;
    }

    const board = boardOf(state);
    const others = new Map<number, number>();
    let own = 0;

    for (const player of state.players)
    {
        if (player.side === side)
        {
            own += playerWorth(board, player, terms, taste, taste.risk * terms.weights.fear);
        }
        else if (!player.out)
        {
            others.set(player.side, (others.get(player.side) ?? 0) + playerWorth(board, player, terms, taste, taste.threat * terms.weights.threat));
        }
    }

    if (others.size === 0)
    {
        return own;
    }

    const values = [...others.values()];
    const mean = values.reduce((sum, one) => sum + one, 0) / values.length;
    const leader = Math.max(...values);

    return own - (values.length === 1 ? leader : terms.weights.leader * leader + (1 - terms.weights.leader) * mean);
}

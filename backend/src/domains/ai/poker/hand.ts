import { CATEGORIES } from '../../match/poker/evaluator.ts';

/**
 * Hand strength for a search that evaluates thousands of hands a decision.
 *
 * `scoreOf` gives exactly the score the rules' `evaluate` gives (the same category and the same
 * five ranks in base 13; `tests/ai-poker.spec.ts` holds the two equal over random hands), counted
 * from rank and suit tallies instead of trying all 21 five-card choices, which makes it about
 * twenty times faster. Who wins a pot is still decided by the rules alone.
 */

const BASE = 13;

const ACE = 12;

const FIVE = 3;

/** A score's category index: `CATEGORIES[score / 13^5]`. */
export const CATEGORY_UNIT = BASE ** 5;

const WHEEL = (1 << ACE) | 0b1111;

export const rankOfCard = (card: number) => card % BASE;

export const suitOfCard = (card: number) => Math.floor(card / BASE);

function scored(category: number, a = 0, b = 0, c = 0, d = 0, e = 0)
{
    return ((((category * BASE + a) * BASE + b) * BASE + c) * BASE + d) * BASE + e;
}

/** The high rank of the best straight in a 13-bit rank mask, or -1. */
export function straightIn(mask: number)
{
    for (let high = ACE; high >= 4; high -= 1)
    {
        if (((mask >> (high - 4)) & 0b11111) === 0b11111)
        {
            return high;
        }
    }

    return (mask & WHEEL) === WHEEL ? FIVE : -1;
}

/** The highest ranks set in a mask, best first, skipping the ones given. */
function topRanks(mask: number, wanted: number, skip = -1, skipToo = -1)
{
    const out: number[] = [];

    for (let rank = ACE; rank >= 0 && out.length < wanted; rank -= 1)
    {
        if ((mask & (1 << rank)) !== 0 && rank !== skip && rank !== skipToo)
        {
            out.push(rank);
        }
    }

    return out;
}

/** The rules' score for the best five of these cards (five to seven of them). */
export function scoreOf(cards: readonly number[])
{
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const suits = [0, 0, 0, 0];
    const masks = [0, 0, 0, 0];
    let all = 0;

    for (const card of cards)
    {
        const rank = card % BASE;
        const suit = (card - rank) / BASE;

        counts[rank] += 1;
        suits[suit] += 1;
        masks[suit] |= 1 << rank;
        all |= 1 << rank;
    }

    let flush = -1;

    for (let suit = 0; suit < 4; suit += 1)
    {
        if (suits[suit] >= 5)
        {
            flush = suit;
        }
    }

    if (flush >= 0)
    {
        const high = straightIn(masks[flush]);

        if (high >= 0)
        {
            return scored(8, high);
        }
    }

    let quad = -1;
    let trip = -1;
    let tripToo = -1;
    let pair = -1;
    let pairToo = -1;

    for (let rank = ACE; rank >= 0; rank -= 1)
    {
        const count = counts[rank];

        if (count === 4 && quad < 0)
        {
            quad = rank;
        }
        else if (count === 3)
        {
            if (trip < 0)
            {
                trip = rank;
            }
            else if (tripToo < 0)
            {
                tripToo = rank;
            }
        }
        else if (count === 2)
        {
            if (pair < 0)
            {
                pair = rank;
            }
            else if (pairToo < 0)
            {
                pairToo = rank;
            }
        }
    }

    if (quad >= 0)
    {
        return scored(7, quad, topRanks(all, 1, quad)[0] ?? 0);
    }

    if (trip >= 0 && (tripToo >= 0 || pair >= 0))
    {
        return scored(6, trip, Math.max(tripToo, pair));
    }

    if (flush >= 0)
    {
        const [a, b, c, d, e] = topRanks(masks[flush], 5);

        return scored(5, a, b, c, d, e);
    }

    const straight = straightIn(all);

    if (straight >= 0)
    {
        return scored(4, straight);
    }

    if (trip >= 0)
    {
        const [a, b] = topRanks(all, 2, trip);

        return scored(3, trip, a, b);
    }

    if (pair >= 0 && pairToo >= 0)
    {
        return scored(2, pair, pairToo, topRanks(all, 1, pair, pairToo)[0] ?? 0);
    }

    if (pair >= 0)
    {
        const [a, b, c] = topRanks(all, 3, pair);

        return scored(1, pair, a, b, c);
    }

    const [a, b, c, d, e] = topRanks(all, 5);

    return scored(0, a, b, c, d, e);
}

export const categoryOf = (score: number) => Math.floor(score / CATEGORY_UNIT);

export const categoryName = (score: number) => CATEGORIES[categoryOf(score)];

/** What a holding is on a board, as a reader of the betting thinks of it. */
export type Made = 'strong' | 'pair' | 'draw' | 'air';

export interface Holding
{
    made: Made;

    /** A pair as good as the top card on the board, or better. */
    top: boolean;

    /** A flush draw or an open-ended straight draw, with cards to come. */
    draw: boolean;
}

/** The category the board alone shows by its pairs (five cards are scored in full). */
function boardCategory(board: readonly number[])
{
    if (board.length >= 5)
    {
        return categoryOf(scoreOf(board));
    }

    const counts = new Map<number, number>();

    for (const card of board)
    {
        counts.set(card % BASE, (counts.get(card % BASE) ?? 0) + 1);
    }

    const shape = [...counts.values()].sort((a, b) => b - a);

    if (shape[0] === 4)
    {
        return 7;
    }

    if (shape[0] === 3)
    {
        return 3;
    }

    return shape[0] === 2 ? (shape[1] === 2 ? 2 : 1) : 0;
}

function drawOf(hole: readonly number[], board: readonly number[])
{
    if (board.length >= 5)
    {
        return false;
    }

    const cards = [...hole, ...board];

    for (let suit = 0; suit < 4; suit += 1)
    {
        const count = cards.filter((card) => suitOfCard(card) === suit).length;

        if (count === 4 && hole.some((card) => suitOfCard(card) === suit))
        {
            return true;
        }
    }

    let mask = 0;
    let mine = 0;

    for (const card of cards)
    {
        mask |= 1 << rankOfCard(card);
    }

    for (const card of hole)
    {
        mine |= 1 << rankOfCard(card);
    }

    // Four in a row with both ends open: 2-3-4-5 up to 10-J-Q-K (J-Q-K-A and A-2-3-4 have one end).
    for (let low = 0; low <= 8; low += 1)
    {
        const run = 0b1111 << low;

        if ((mask & run) === run && (mine & run) !== 0)
        {
            return true;
        }
    }

    return false;
}

/** How a reader of the betting would class two hole cards on a board of three to five cards. */
export function holdingOf(hole: readonly number[], board: readonly number[], score = scoreOf([...hole, ...board])): Holding
{
    const category = categoryOf(score);
    const shown = boardCategory(board);
    const draw = drawOf(hole, board);
    const high = Math.max(...board.map(rankOfCard));

    if (category > shown && (category >= 3 || (category === 2 && shown === 0)))
    {
        return { made: 'strong', top: true, draw };
    }

    if (category > shown)
    {
        const paired = hole.map(rankOfCard).filter((rank) => board.some((card) => rankOfCard(card) === rank) || hole.filter((other) => rankOfCard(other) === rank).length === 2);
        const top = paired.length > 0 && Math.max(...paired) >= high;

        return { made: 'pair', top, draw };
    }

    return { made: draw ? 'draw' : 'air', top: false, draw };
}

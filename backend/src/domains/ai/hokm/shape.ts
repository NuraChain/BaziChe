import { deckFor } from '../../match/hokm/cards.ts';
import { trickCount } from '../../match/hokm/scoring.ts';
import { playOf, type Habits } from './policy.ts';
import { playout, type Work } from './search.ts';
import { SIZE, countOf, masksOf, rankAt, suitAt, type Table } from './table.ts';

/**
 * The decisions before the first card: naming trump, and at two seats which cards go face down and
 * which drawn cards are kept. They are judged by what a card is worth under the trump and by the
 * suit shape the hand is building towards.
 */

const ACE = 12;
const KING = 11;
const QUEEN = 10;
const JACK = 9;
const TEN = 8;

/** High-card points: what an honour is worth whatever the trump. */
function honourOf(rank: number)
{
    switch (rank)
    {
        case ACE: return 4;
        case KING: return 3;
        case QUEEN: return 2;
        case JACK: return 1;
        case TEN: return 0.5;
        default: return 0;
    }
}

export interface Taste
{
    /** Weight of a card of length in the trump suit against an honour in it. */
    length: number;
}

/**
 * How good `suit` is as trump for these cards. A beginner counts the suit; a better player weighs
 * length against honours, counts the side aces it keeps, and values a short side suit it can ruff -
 * which matters more to the Hâkem, who leads the first trick.
 */
export function trumpScore(hand: readonly number[], suit: number, full: boolean, taste: Taste)
{
    const masks = masksOf(hand);
    const length = countOf(masks[suit]);
    const honours = hand.filter((card) => suitAt(card) === suit).reduce((sum, card) => sum + honourOf(rankAt(card)), 0);

    if (!full)
    {
        return length * 10 + honours;
    }

    const shortSides = [0, 1, 2, 3].filter((side) => side !== suit && countOf(masks[side]) <= 1).length;
    const sideAces = [0, 1, 2, 3].filter((side) => side !== suit && (masks[side] & (1 << ACE)) !== 0).length;

    return length * taste.length + honours + (length >= 2 ? shortSides * 0.8 : 0) + sideAces * 0.5;
}

export function trumpByRule(hand: readonly number[], full: boolean, taste: Taste)
{
    const scores = [0, 1, 2, 3].map((suit) => trumpScore(hand, suit, full, taste));

    return scores.indexOf(Math.max(...scores));
}

/**
 * Trump by playing it: for each suit, the hand is dealt out over sampled deals of the cards not yet
 * seen and played by the policy at every seat, the Hâkem leading. The rule's score breaks near-ties.
 */
export function trumpByPlay(table: Table, hand: readonly number[], seat: number, habits: Habits, taste: Taste, samples: number, random: () => number, stop: () => boolean, work: Work)
{
    const size = trickCount(table.seats);
    const seen = new Set(hand);
    const rest = deckFor(table.seats).filter((card) => !seen.has(card));
    const totals = [0, 0, 0, 0];
    let done = 0;

    while (done < samples && !(done > 0 && stop()))
    {
        const order = [...rest];

        for (let at = order.length - 1; at > 0; at -= 1)
        {
            const other = Math.floor(random() * (at + 1));

            [order[at], order[other]] = [order[other], order[at]];
        }

        const hands: number[][] = [];
        let next = 0;

        for (let at = 0; at < table.seats; at += 1)
        {
            const want = at === seat ? size - hand.length : size;

            hands.push(at === seat ? [...hand, ...order.slice(next, next + want)] : order.slice(next, next + want));
            next += want;
        }

        for (let suit = 0; suit < 4; suit += 1)
        {
            const start: Table = { ...table, trump: suit, trick: [], tricks: table.tricks.map(() => 0), lead: seat };
            const first = playOf(start, hands[seat], seat, habits);

            totals[suit] += playout(start, { hands }, seat, first, habits, work);
        }

        done += 1;
        work.samples += 1;
    }

    const scores = totals.map((total, suit) => (done === 0 ? 0 : total / done) + 0.02 * trumpScore(hand, suit, true, taste));

    return scores.indexOf(Math.max(...scores));
}

/** What a card adds to a hand being built at two seats, by its rank under the trump and the shape around it. */
export function addsTo(masks: readonly number[], card: number, trump: number, full: boolean)
{
    const suit = suitAt(card);
    const rank = rankAt(card);

    if (suit === trump)
    {
        return 2.5 + rank * 0.25 + (full ? countOf(masks[trump]) * 0.15 : 0);
    }

    let worth = honourOf(rank) + rank * 0.03;

    if (!full)
    {
        return worth;
    }

    const held = masks[suit];

    // An honour is worth more beside the ones above it, and a small card guards a lone honour.
    if (rank === KING && (held & (1 << ACE)) !== 0)
    {
        worth += 1.2;
    }

    if (rank === QUEEN && (held & (1 << ACE)) !== 0 && (held & (1 << KING)) !== 0)
    {
        worth += 1;
    }

    if (rank < JACK && countOf(held) === 1 && (held & ((1 << KING) | (1 << QUEEN))) !== 0)
    {
        worth += 0.6;
    }

    // A long side suit runs into the opponents' trumps.
    if (countOf(held) >= 5)
    {
        worth -= 0.3;
    }

    return worth;
}

/** The cards a two-seat player puts face down: the subset whose remainder is worth the most. */
export function discardOf(hand: readonly number[], count: number, trump: number, full: boolean): number[]
{
    let best: number[] = [];
    let bestScore = -Infinity;

    const keepScore = (kept: readonly number[]) =>
    {
        const masks = masksOf(kept);
        let score = 0;

        for (const card of kept)
        {
            const others = masksOf(kept.filter((other) => other !== card));

            score += addsTo(others, card, trump, full);
        }

        if (full && masks[trump] !== 0)
        {
            score += [0, 1, 2, 3].filter((suit) => suit !== trump && masks[suit] === 0).length * 0.3;
        }

        return score;
    };

    const visit = (from: number, picked: number[]) =>
    {
        if (picked.length === count)
        {
            const kept = hand.filter((card) => !picked.includes(card));
            const score = keepScore(kept);

            if (score > bestScore)
            {
                bestScore = score;
                best = [...picked];
            }

            return;
        }

        for (let at = from; at < hand.length; at += 1)
        {
            visit(at + 1, [...picked, hand[at]]);
        }
    };

    visit(0, []);

    return best.sort((a, b) => a - b);
}

/**
 * Keep the card offered, or take the unseen one under it. A card offered is kept when it adds more
 * than an unseen card would on average - the unseen one is any card this seat has not seen.
 */
export function keepScore(hand: readonly number[], offer: number, dead: readonly number[], trump: number, full: boolean)
{
    const masks = masksOf(hand);
    const known = new Set([...hand, offer, ...dead]);
    const unseen: number[] = [];

    for (let card = 0; card < SIZE * 4; card += 1)
    {
        if (!known.has(card))
        {
            unseen.push(card);
        }
    }

    const average = unseen.reduce((sum, card) => sum + addsTo(masks, card, trump, full), 0) / Math.max(1, unseen.length);

    return addsTo(masks, offer, trump, full) - average;
}

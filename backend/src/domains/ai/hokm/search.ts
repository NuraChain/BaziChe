import { duelResult, tripleResult, winningTricks } from '../../match/hokm/scoring.ts';
import { playOf, type Habits } from './policy.ts';
import { SIZE, bitOf, countOf, rankAt, sideAt, suitAt, winnerIn, type Seen, type Table } from './table.ts';

/**
 * Playing a card out over deals that could be the real one.
 *
 * A deal is drawn for the cards this seat cannot see, consistent with everything it has seen - the
 * voids every player has shown, the cards played, the cards in its own hand, and at two seats the
 * cards gone face down - and then each candidate card is played and the rest of the hand follows the
 * rule policy at every seat. The same deals serve every candidate, so the comparison is between cards
 * and not between deals. Every draw comes from the ask's random: the same seed, the same deals.
 */

export interface Deal
{
    /** Every seat's hand; this seat's own is its real one. */
    hands: number[][];
}

/** Hand points per trick of margin: a smoother signal than the hand's result alone, which most deals share. */
const TRICK = 0.4;

/** How much likelier a two-seat player is to hold an unseen trump, or an unseen queen or better, than to have let it go. */
const KEPT_TRUMP = 12;
const KEPT_HIGH = 10;

export interface Work
{
    samples: number;
    nodes: number;
}

/** The value of a finished hand to `seat`'s side: points won or lost, a hand that ends the match counted fully, and a little for the trick margin. */
export function handValue(table: Table, seat: number, side: number, points: number)
{
    const mine = sideAt(seat, table.seats);
    const owed = Math.max(1, table.target - table.points[side]);
    const gain = Math.min(points, owed) + (points >= owed ? 1 : 0);
    let ours = 0;
    let theirs = 0;

    table.tricks.forEach((count, at) =>
    {
        if (sideAt(at, table.seats) === mine)
        {
            ours += count;
        }
        else
        {
            theirs = table.seats === 4 ? theirs + count : Math.max(theirs, count);
        }
    });

    return (side === mine ? gain : -gain) + TRICK * (ours - theirs);
}

/** The hand's result once a trick is taken, or null while it plays on: the engine's own rules. */
function resultOf(table: Table): { side: number; points: number } | null
{
    const tricks = table.tricks;

    if (table.seats === 3)
    {
        const played = tricks[0] + tricks[1] + tricks[2];

        // Neither a sweep nor an unbeatable lead exists before seven tricks are gone.
        return played < 7 ? null : tripleResult(tricks, table.hakem, played);
    }

    const sides = table.seats === 4 ? [tricks[0] + tricks[2], tricks[1] + tricks[3]] : [tricks[0], tricks[1]];
    const needed = winningTricks(table.seats);

    return sides[0] < needed && sides[1] < needed ? null : duelResult(sides, sideAt(table.hakem, table.seats), needed);
}

const copyTable = (table: Table): Table => ({
    ...table,
    trick: [...table.trick],
    tricks: [...table.tricks],
    gone: [...table.gone],
    voids: [...table.voids],
    led: [...table.led]
});

/** Plays `card` for `seat` on a table, updating what everybody has seen. Returns the trick winner when it completes. */
export function playCard(table: Table, hands: number[][], seat: number, card: number): number | null
{
    const hand = hands[seat];

    hand.splice(hand.indexOf(card), 1);
    table.gone[suitAt(card)] |= 1 << rankAt(card);

    if (table.trick.length === 0)
    {
        table.led[seat] |= bitOf(suitAt(card));
    }
    else if (suitAt(card) !== suitAt(table.trick[0]))
    {
        table.voids[seat] |= bitOf(suitAt(table.trick[0]));
    }

    table.trick.push(card);

    if (table.trick.length < table.seats)
    {
        return null;
    }

    const taker = (table.lead + winnerIn(table.trick, table.trump)) % table.seats;

    table.tricks[taker] += 1;
    table.trick = [];
    table.lead = taker;

    return taker;
}

/**
 * The rest of a hand from `table`, `seat` playing `first` and then everybody by the policy, as a
 * value to `seat`. `nodes` counts the cards played.
 */
export function playout(start: Table, deal: Deal, seat: number, first: number, habits: Habits, work: Work): number
{
    const table = copyTable(start);
    const hands = deal.hands.map((hand) => [...hand]);
    let turn = seat;
    let card = first;

    for (;;)
    {
        work.nodes += 1;

        const taker = playCard(table, hands, turn, card);

        if (taker === null)
        {
            turn = (turn + 1) % table.seats;
        }
        else
        {
            const result = resultOf(table);

            if (result !== null)
            {
                return handValue(table, seat, result.side, result.points);
            }

            turn = taker;
        }

        if (hands[turn].length === 0)
        {
            // Only a deal that does not add up runs out of cards: score it by the tricks alone.
            return handValue(table, seat, sideAt(seat, table.seats), 0);
        }

        card = playOf(table, hands[turn], turn, habits);
    }
}

/**
 * One deal of the unseen cards consistent with what `seen` knows: no seat gets a suit it has shown
 * a void in, every seat gets exactly as many cards as it holds, and the rest (at two seats, the
 * cards gone face down) go nowhere. With `inferred`, the soft reading of plays is respected too, and
 * with `lean` a Hâkem is a little likelier to hold the trump suit it named. Null when no deal is found.
 */
export function dealOf(seen: Seen, random: () => number, inferred: boolean, lean = inferred): Deal | null
{
    const table = seen.table;
    const mine = new Set(seen.hand);
    const pool: number[] = [];

    for (let card = 0; card < SIZE * 4; card += 1)
    {
        if ((table.gone[suitAt(card)] & (1 << rankAt(card))) === 0 && !mine.has(card))
        {
            pool.push(card);
        }
    }

    const need = seen.held.map((count, at) => (at === seen.seat ? 0 : count));
    const spare = pool.length - need.reduce((total, count) => total + count, 0);

    if (spare < 0)
    {
        return null;
    }

    // Per card, the seats that may hold it: firmly (no shown void), and by the softer reading of plays.
    const firm = new Int8Array(SIZE * 4);
    const soft = new Int8Array(SIZE * 4);

    for (const card of pool)
    {
        for (let seat = 0; seat < table.seats; seat += 1)
        {
            if (need[seat] > 0 && (table.voids[seat] & bitOf(suitAt(card))) === 0)
            {
                firm[card] |= 1 << seat;

                if ((seen.unlikely[seat][suitAt(card)] & (1 << rankAt(card))) === 0)
                {
                    soft[card] |= 1 << seat;
                }
            }
        }
    }

    const tries: [Int8Array, boolean, number][] = inferred ? [[soft, lean, SOFT_TRIES], [firm, false, FIRM_TRIES]] : [[firm, false, FIRM_TRIES]];

    for (const [allowed, leaning, count] of tries)
    {
        for (let attempt = 0; attempt < count; attempt += 1)
        {
            const hands = tryDeal(table, pool, allowed, need, spare, random, leaning);

            if (hands !== null)
            {
                hands[seen.seat] = [...seen.hand];

                return { hands };
            }
        }
    }

    return null;
}

/** A soft reading that will not deal is given up quickly: it was only ever a guess. */
const SOFT_TRIES = 4;
const FIRM_TRIES = 12;

function tryDeal(table: Table, pool: readonly number[], allowed: Int8Array, need: readonly number[], spare: number, random: () => number, lean: boolean): number[][] | null
{
    const seats = table.seats;
    const order = [...pool];

    for (let at = order.length - 1; at > 0; at -= 1)
    {
        const other = Math.floor(random() * (at + 1));

        [order[at], order[other]] = [order[other], order[at]];
    }

    // The most constrained cards first, so a short suit is not dealt into a corner.
    const freedom = (card: number) => countOf(allowed[card]) + (spare > 0 ? 1 : 0);

    order.sort((a, b) => freedom(a) - freedom(b));

    const left = [...need];
    const weights = [0, 0, 0, 0];
    let rest = spare;
    const hands: number[][] = Array.from({ length: seats }, () => []);

    for (const card of order)
    {
        let total = rest;

        for (let seat = 0; seat < seats; seat += 1)
        {
            const fits = left[seat] > 0 && (allowed[card] & (1 << seat)) !== 0;
            const leaning = (lean && seat === table.hakem && suitAt(card) === table.trump ? 1.6 : 1) * (seats === 2 ? keptOf(card, table.trump) : 1);

            weights[seat] = fits ? left[seat] * leaning : 0;
            total += weights[seat];
        }

        if (total === 0)
        {
            return null;
        }

        let pick = random() * total;
        let chosen = -1;

        for (let seat = 0; seat < seats && chosen < 0; seat += 1)
        {
            pick -= weights[seat];
            chosen = pick < 0 && weights[seat] > 0 ? seat : -1;
        }

        if (chosen < 0)
        {
            if (rest === 0)
            {
                return null;
            }

            rest -= 1;
            continue;
        }

        hands[chosen].push(card);
        left[chosen] -= 1;
    }

    return left.every((count) => count === 0) ? hands : null;
}

/**
 * At two seats a hand is drawn by choice: a player keeps the trumps and the high cards it is
 * offered and lets the small ones go face down, so the unseen cards it holds are likelier to be
 * those than the ones gone face down. Uniform deals would hand it a weaker hand than it has.
 */
function keptOf(card: number, trump: number)
{
    if (suitAt(card) === trump)
    {
        return KEPT_TRUMP;
    }

    return rankAt(card) >= 10 ? KEPT_HIGH : 1;
}

export interface Limits
{
    samples: number;
    nodes: number;
    inferred: boolean;

    /** Deals the trump suit a little more often to the Hâkem who named it. */
    lean: boolean;

    /** Standard errors by which a card must beat the policy's own card, deal for deal, to be played instead. */
    proof: number;
}

/**
 * How much better each candidate is than the policy's own card (`usual`), judged deal for deal over
 * sampled deals and taken at its lower confidence bound: a card the playouts cannot show to be
 * better scores at most zero, so a few deals never talk a player out of a sound card by luck. As
 * far as the limits (and, as a last resort, the clock) allow. Null when not one deal could be drawn.
 */
export function weigh(seen: Seen, candidates: readonly number[], usual: number, habits: Habits, limits: Limits, random: () => number, stop: () => boolean, work: Work): number[] | null
{
    const table = seen.table;
    const mine = new Set(seen.hand);

    // Touching cards are one card: with every rank between them held or played, either takes the same tricks.
    const standsFor = candidates.map((card) =>
    {
        let low = card;

        while (rankAt(low) > 0 && (mine.has(low - 1) || (table.gone[suitAt(low)] & (1 << rankAt(low - 1))) !== 0))
        {
            low -= 1;

            if (candidates.includes(low))
            {
                return candidates.indexOf(low);
            }
        }

        return candidates.indexOf(card);
    });

    const base = standsFor[usual];
    const live = candidates.map((_, at) => standsFor[at] === at && at !== base);
    const sums = candidates.map(() => 0);
    const squares = candidates.map(() => 0);
    const counts = candidates.map(() => 0);
    let done = 0;

    while (done < limits.samples && work.nodes < limits.nodes && live.some(Boolean) && !(done > 0 && stop()))
    {
        const deal = dealOf(seen, random, limits.inferred, limits.lean);

        if (deal === null)
        {
            break;
        }

        const reference = playout(table, deal, seen.seat, candidates[base], habits, work);

        candidates.forEach((card, at) =>
        {
            if (live[at])
            {
                const gain = playout(table, deal, seen.seat, card, habits, work) - reference;

                sums[at] += gain;
                squares[at] += gain * gain;
                counts[at] += 1;
            }
        });

        done += 1;
        work.samples += 1;

        // A card already clearly worse than the usual one stops being played out, so the deals go to the close ones.
        if (done % PRUNE_EVERY === 0)
        {
            candidates.forEach((_, at) =>
            {
                live[at] = live[at] && boundOf(sums[at], squares[at], counts[at], -1) > -PRUNE_BELOW;
            });
        }
    }

    if (done === 0)
    {
        return null;
    }

    return candidates.map((_, at) => (standsFor[at] === base ? 0 : boundOf(sums[standsFor[at]], squares[standsFor[at]], counts[standsFor[at]], limits.proof)));
}

/** The mean gain less `proof` standard errors (or plus, for a negative `proof`). */
function boundOf(sum: number, square: number, count: number, proof: number)
{
    if (count === 0)
    {
        return -Infinity;
    }

    const mean = sum / count;
    const spread = count > 1 ? Math.sqrt(Math.max(0, square / count - mean * mean) / (count - 1)) : Infinity;

    return mean - proof * spread;
}

const PRUNE_EVERY = 4;

/** Hand points: a card whose gain over the usual one is surely below this is not coming back. */
const PRUNE_BELOW = 0.3;

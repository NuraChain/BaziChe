import { FULL, above, beats, bitOf, countOf, legalOf, masksOf, partnerOf, rankAt, sideAt, suitAt, winnerIn, type Table } from './table.ts';

/**
 * How a hokm player plays a card by rule of thumb: cash what is sure, draw trumps when the side is
 * long in them, lead to a partner's void or a partner's suit, win as cheaply as is safe, leave a
 * partner's winning trick alone, and throw what is worth least.
 *
 * It is the whole of a casual player, the card play of an intermediate one, and the policy every
 * seat follows inside the stronger players' playouts. What it may read is the table it is given: a
 * casual player is handed one that remembers nothing beyond the trick in front of it.
 */

export interface Habits
{
    /** Overtakes a partner whose card will be beaten, plays second hand low, and fears a ruff it has seen coming. */
    finesse: boolean;

    /** Trumps held before drawing the opponents' trumps. */
    draw: number;

    /** Eagerness to cash a sure winner rather than lead low. */
    cash: number;

    /** Preference for throwing from a short suit, to ruff it later. */
    shed: number;
}

/** A score per card; the caller takes the best, or one among the near-best. */
export interface Scored
{
    cards: number[];
    scores: number[];
}

const worthOf = (card: number, trump: number) => rankAt(card) + (suitAt(card) === trump ? 13 : 0);

/** Cards of `suit` neither played nor in this hand: what the other seats may still hold. */
const outOf = (table: Table, mine: readonly number[], suit: number) => FULL & ~table.gone[suit] & ~mine[suit];

/** Whether any of `later` could still beat `card`, judged from what is out and who has shown a void. */
function threatened(table: Table, mine: readonly number[], card: number, led: number, later: readonly number[])
{
    const suit = suitAt(card);
    const trump = table.trump;

    for (const seat of later)
    {
        const voids = table.voids[seat];

        if ((voids & bitOf(led)) === 0)
        {
            if (suit === led && (outOf(table, mine, led) & above(rankAt(card))) !== 0)
            {
                return true;
            }

            continue;
        }

        if ((voids & bitOf(trump)) !== 0)
        {
            continue;
        }

        const trumps = outOf(table, mine, trump);

        if (suit !== trump ? trumps !== 0 : (trumps & above(rankAt(card))) !== 0)
        {
            return true;
        }
    }

    return false;
}

/** What it costs to give `card` away: low cards of short side suits first, winners and trumps last. */
function costOf(table: Table, mine: readonly number[], card: number, led: number, habits: Habits)
{
    const suit = suitAt(card);
    const rank = rankAt(card);
    const trump = table.trump;
    let cost = rank;

    if (suit === trump)
    {
        cost += 20;
    }

    if ((outOf(table, mine, suit) & above(rank)) === 0 && rank > 0)
    {
        cost += 12;
    }

    if (suit !== led)
    {
        const length = countOf(mine[suit]);

        if (suit !== trump && mine[trump] !== 0)
        {
            cost += length * habits.shed;
        }

        // Throwing the small card that guards a king leaves the king bare.
        const king = 11;

        if (length === 2 && rank < king && (mine[suit] & (1 << king)) !== 0 && (outOf(table, mine, suit) & (1 << 12)) !== 0)
        {
            cost += 5;
        }
    }

    return cost;
}

function cheapest(cards: readonly number[], trump: number)
{
    return cards.reduce((low, card) => (worthOf(card, trump) < worthOf(low, trump) ? card : low), cards[0]);
}

function highest(cards: readonly number[], trump: number)
{
    return cards.reduce((high, card) => (worthOf(card, trump) > worthOf(high, trump) ? card : high), cards[0]);
}

/** One score per legal card for the seat to play. Higher is better. */
export function scoreCards(table: Table, hand: readonly number[], seat: number, habits: Habits): Scored
{
    const cards = legalOf(hand, table.trick);
    const mine = masksOf(hand);

    return { cards, scores: table.trick.length === 0 ? leadScores(table, mine, cards, seat, habits) : followScores(table, mine, cards, seat, habits) };
}

/** Tricks the other side holds, against none, before a seat plays to deny the kot rather than to save cards. */
const KOT_ALARM = 3;

/** Whether the seat's side has no trick yet while the other side is well on its way to a kot. */
function kotThreat(table: Table, seat: number)
{
    const side = sideAt(seat, table.seats);
    let ours = 0;
    let theirs = 0;

    // At four seats the other side is a team and its tricks add up; at three, a kot is one player's.
    table.tricks.forEach((count, at) =>
    {
        if (sideAt(at, table.seats) === side)
        {
            ours += count;
        }
        else
        {
            theirs = table.seats === 4 ? theirs + count : Math.max(theirs, count);
        }
    });

    return ours === 0 && theirs >= KOT_ALARM;
}

function leadScores(table: Table, mine: readonly number[], cards: readonly number[], seat: number, habits: Habits)
{
    const trump = table.trump;
    const partner = partnerOf(seat, table.seats);
    const trumpsOut = outOf(table, mine, trump);
    const held = countOf(mine[trump]);

    // Suits an opponent has shown it can trump, and whether any opponent may still hold a trump.
    let ruffable = 0;
    let theyMayTrump = false;

    for (let at = 0; at < table.seats; at += 1)
    {
        if (at !== seat && at !== partner && (table.voids[at] & bitOf(trump)) === 0 && trumpsOut !== 0)
        {
            theyMayTrump = true;
            ruffable |= table.voids[at];
        }
    }

    const topTrump = mine[trump] !== 0 && (trumpsOut & above(31 - Math.clz32(mine[trump]))) === 0;
    // Measured: drawing trumps pays between partners, and loses at two and three seats, where every
    // trump led is one of the hand's own few ruffs spent one for one.
    const drawing = table.seats === 4 && theyMayTrump && (held >= habits.draw || (topTrump && held * 2 >= countOf(trumpsOut) + 1 && held >= 3));
    const deny = kotThreat(table, seat);
    const partnerRuffs = partner >= 0 && (table.voids[partner] & bitOf(trump)) === 0 ? table.voids[partner] : 0;
    const partnerLeads = partner >= 0 ? table.led[partner] & ~table.voids[partner] : 0;
    const scores: number[] = [];

    for (const card of cards)
    {
        const suit = suitAt(card);
        const rank = rankAt(card);
        const out = outOf(table, mine, suit);
        const master = (out & above(rank)) === 0;
        const lowest = (mine[suit] & -mine[suit]) === 1 << rank;
        const risk = (ruffable & bitOf(suit)) !== 0;
        let score: number;

        if (suit === trump)
        {
            score = drawing ? (master ? 90 : (lowest ? 62 : 0)) : (master && !theyMayTrump ? 50 + rank * 0.01 : 4 - rank * 0.1);
        }
        else if (master && out !== 0)
        {
            score = habits.finesse && risk ? 18 : 80 + habits.cash + (deny ? 15 : 0) + rank * 0.01;
        }
        else if (master)
        {
            // Nobody else holds the suit: a sure trick only if nobody can trump it either.
            score = theyMayTrump ? 10 : 70 + habits.cash;
        }
        else if (!lowest)
        {
            score = -rank;
        }
        else
        {
            score = 30 - rank * 0.8 + countOf(mine[suit]) * 0.5;

            if (risk)
            {
                score -= 25;
            }
            else if ((partnerRuffs & bitOf(suit)) !== 0)
            {
                score = 75;
            }
            else if ((partnerLeads & bitOf(suit)) !== 0)
            {
                score += 25;
            }
        }

        scores.push(score);
    }

    return scores;
}

function followScores(table: Table, mine: readonly number[], cards: readonly number[], seat: number, habits: Habits)
{
    const trump = table.trump;
    const trick = table.trick;
    const led = suitAt(trick[0]);
    const best = winnerIn(trick, trump);
    const winningSeat = (table.lead + best) % table.seats;
    const winning = trick[best];
    const partner = partnerOf(seat, table.seats);
    const later: number[] = [];

    for (let at = trick.length + 1; at < table.seats; at += 1)
    {
        later.push((table.lead + at) % table.seats);
    }

    const opponents = later.filter((at) => at !== partner);
    const dump = () => cards.map((card) => -costOf(table, mine, card, led, habits));
    const take = (chosen: number) => cards.map((card) => (card === chosen ? 100 : -costOf(table, mine, card, led, habits)));

    if (winningSeat === partner)
    {
        if (opponents.length === 0 || !threatened(table, mine, winning, led, opponents) || !habits.finesse)
        {
            return dump();
        }

        const safe = cards.filter((card) => beats(card, winning, trump) && !threatened(table, mine, card, led, opponents));

        return safe.length > 0 ? take(cheapest(safe, trump)) : dump();
    }

    const winners = cards.filter((card) => beats(card, winning, trump));

    if (winners.length === 0)
    {
        return dump();
    }

    const safe = winners.filter((card) => !threatened(table, mine, card, led, opponents));

    if (safe.length > 0)
    {
        // Every safe winner scores by how little it spends, so near-equal ones stay near.
        return cards.map((card) => (safe.includes(card) ? 100 - worthOf(card, trump) * 0.5 : -costOf(table, mine, card, led, habits)));
    }

    const deny = kotThreat(table, seat);

    if (habits.finesse && later.includes(partner) && !deny && suitAt(cheapest(winners, trump)) === led)
    {
        return dump();
    }

    return take(deny ? highest(winners, trump) : cheapest(winners, trump));
}

/** The best card by the scores, the lowest card number among equals. */
export function bestOf(scored: Scored)
{
    let best = 0;

    for (let at = 1; at < scored.cards.length; at += 1)
    {
        if (scored.scores[at] > scored.scores[best] || (scored.scores[at] === scored.scores[best] && scored.cards[at] < scored.cards[best]))
        {
            best = at;
        }
    }

    return scored.cards[best];
}

/** The card the policy plays, with no choice among near-equals: what every seat does inside a playout. */
export function playOf(table: Table, hand: readonly number[], seat: number, habits: Habits)
{
    if (table.trick.length > 0)
    {
        // A forced card needs no thought: the only card of the suit led.
        const led = suitAt(table.trick[0]);
        let only = -1;
        let count = 0;

        for (const card of hand)
        {
            if (suitAt(card) === led)
            {
                only = card;
                count += 1;
            }
        }

        if (count === 1)
        {
            return only;
        }
    }

    return hand.length === 1 ? hand[0] : bestOf(scoreCards(table, hand, seat, habits));
}

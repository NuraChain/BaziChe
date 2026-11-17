import { rankOfCard, suitOfCard } from './hand.ts';

/**
 * Two hole cards before the flop: how good they are, which hands make up a range, and how wide a
 * player opens or moves all in by position and stack.
 *
 * A hand's worth is its share against one random hand, from a fitted curve (pairs climb from 50% for
 * deuces to 85% for aces; unpaired hands from their high card, their kicker, suitedness and how
 * connected they are). Only the order matters for ranges: every one of the 1326 starting hands is
 * ranked by it once, and a range is a slice of that order, "the best 15%".
 */

/** Share against one random hand of X-2 offsuit, by the high card's rank (3 up to the ace). */
const DEUCE_WITH = [0, 0.29, 0.31, 0.33, 0.34, 0.35, 0.37, 0.39, 0.42, 0.455, 0.48, 0.506, 0.55];

export function worthOf(a: number, b: number)
{
    const high = Math.max(rankOfCard(a), rankOfCard(b));
    const low = Math.min(rankOfCard(a), rankOfCard(b));

    if (high === low)
    {
        return 0.5 + 0.0292 * high;
    }

    const gap = high - low;
    const suited = suitOfCard(a) === suitOfCard(b) ? 0.032 : 0;
    const connected = gap === 1 ? 0.01 : gap === 2 ? 0.005 : 0;

    return DEUCE_WITH[high] + (0.0085 + 0.0005 * (12 - high)) * low + suited + connected;
}

export const COMBOS = 1326;

/** Every starting hand as `[low card, high card]`, best first. */
export const ORDER: readonly (readonly [number, number])[] = (() =>
{
    const all: [number, number][] = [];

    for (let a = 0; a < 52; a += 1)
    {
        for (let b = a + 1; b < 52; b += 1)
        {
            all.push([a, b]);
        }
    }

    return all
        .map((pair) => ({ pair, worth: worthOf(pair[0], pair[1]) }))
        .sort((x, y) => y.worth - x.worth || x.pair[0] - y.pair[0] || x.pair[1] - y.pair[1])
        .map((one) => Object.freeze(one.pair) as readonly [number, number]);
})();

/** Where a hand stands among all starting hands: 0 is aces, 1 the worst; equal hands share the middle of their run. */
export const placeOf: (a: number, b: number) => number = (() =>
{
    const places = new Map<number, number>();
    let at = 0;

    while (at < ORDER.length)
    {
        const worth = worthOf(ORDER[at][0], ORDER[at][1]);
        let end = at;

        while (end < ORDER.length && worthOf(ORDER[end][0], ORDER[end][1]) === worth)
        {
            end += 1;
        }

        const place = (at + end) / 2 / COMBOS;

        for (let one = at; one < end; one += 1)
        {
            places.set(ORDER[one][0] * 52 + ORDER[one][1], place);
        }

        at = end;
    }

    return (a, b) => places.get(Math.min(a, b) * 52 + Math.max(a, b)) ?? 1;
})();

/** A range as a slice of `ORDER`: from the best `low` share to the best `high` share. */
export interface Range
{
    low: number;
    high: number;
}

export const ANY: Range = { low: 0, high: 1 };

/** Opening raise share by how many players are still to act behind (the big blind included). */
const OPENS = [0, 0.5, 0.42, 0.28, 0.21, 0.17, 0.14, 0.12, 0.11, 0.1];

/** All-in share at ten big blinds by how many are still to act behind; it widens as the stack shrinks. */
const PUSHES = [0, 0.58, 0.33, 0.24, 0.19, 0.15, 0.13, 0.11, 0.1, 0.09];

const at = (table: readonly number[], behind: number) => table[Math.max(1, Math.min(table.length - 1, behind))];

/** The share a regular opens with, `behind` players still to act; heads-up the button opens most hands. */
export function openShare(behind: number, headsUp: boolean)
{
    return headsUp ? 0.75 : at(OPENS, behind);
}

/** The share a regular moves all in with first, at `depth` big blinds and `behind` players to act. */
export function pushShare(behind: number, depth: number)
{
    return Math.min(1, at(PUSHES, behind) * Math.pow(10 / Math.max(1, depth), 0.9));
}

/** A pocket pair or a suited connector: hands that win big pots when deep, not by high cards. */
export function speculative(a: number, b: number)
{
    const gap = Math.abs(rankOfCard(a) - rankOfCard(b));

    return gap === 0 || (suitOfCard(a) === suitOfCard(b) && gap <= 2);
}

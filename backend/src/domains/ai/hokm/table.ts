import { SUITS } from '../../match/cards/cards.ts';
import { deckFor } from '../../match/hokm/cards.ts';
import type { HokmEvent } from '../../match/hokm/state.ts';
import type { MatchBoard } from '../../../schemas.ts';
import type { Hidden } from '../agent.ts';

/**
 * What a hokm seat knows, read from its own board and its own log and nothing else.
 *
 * Cards are counted by suit as 13-bit masks (bit = rank), so "is anything higher still out" is one
 * AND rather than a walk over the deck; the search asks it tens of thousands of times a decision.
 */

export type HokmBoard = Extract<MatchBoard, { kind: 'hokm' }>;

export const SIZE = 13;
export const FULL = (1 << SIZE) - 1;

export const suitAt = (card: number) => Math.floor(card / SIZE);
export const rankAt = (card: number) => card % SIZE;
export const bitOf = (suit: number) => 1 << suit;

/** Ranks above `rank` in a suit mask. */
export const above = (rank: number) => FULL & ~((2 << rank) - 1);

export function countOf(mask: number)
{
    let left = mask;
    let count = 0;

    while (left !== 0)
    {
        left &= left - 1;
        count += 1;
    }

    return count;
}

/** The public table, as every seat sees it, plus nothing private: the search keeps one of these per playout. */
export interface Table
{
    seats: number;
    trump: number;
    hakem: number;
    lead: number;
    trick: number[];

    /** Tricks taken this hand, per seat. */
    tricks: number[];

    /** Per suit: ranks played, out of the deck, or seen going face down. */
    gone: number[];

    /** Per seat: suits it has shown it does not hold. */
    voids: number[];

    /** Per seat: suits it has led this hand. */
    led: number[];

    /** Match points per side, and the points that win the match. */
    points: number[];
    target: number;
}

/** One seat's knowledge: the public table, its own hand, how many cards everyone holds, and what their plays suggest. */
export interface Seen
{
    table: Table;
    seat: number;
    hand: number[];
    held: number[];

    /**
     * Per seat, per suit: ranks it has played as if it did not hold them (followed with a card that
     * could not win when it had a lower one, or let an opponent's trick go when it could have
     * trumped). A guess about a sensible player, never a fact, so the search may drop it.
     */
    unlikely: number[][];
}

export const partnerOf = (seat: number, seats: number) => (seats === 4 ? (seat + 2) % 4 : -1);

export const sideAt = (seat: number, seats: number) => (seats === 4 ? seat % 2 : seat);

export function masksOf(cards: readonly number[]): number[]
{
    const masks = [0, 0, 0, 0];

    for (const card of cards)
    {
        masks[suitAt(card)] |= 1 << rankAt(card);
    }

    return masks;
}

/** Whether `card` beats `best` in a trick: the same rule as the engine's `trickWinner`. */
export function beats(card: number, best: number, trump: number)
{
    const suit = suitAt(card);
    const bestSuit = suitAt(best);

    if (suit === bestSuit)
    {
        return rankAt(card) > rankAt(best);
    }

    return suit === trump;
}

/** The index of the card winning a trick so far. */
export function winnerIn(trick: readonly number[], trump: number)
{
    let best = 0;

    for (let at = 1; at < trick.length; at += 1)
    {
        if (beats(trick[at], trick[best], trump))
        {
            best = at;
        }
    }

    return best;
}

export function legalOf(hand: readonly number[], trick: readonly number[]): number[]
{
    if (trick.length === 0)
    {
        return [...hand];
    }

    const led = suitAt(trick[0]);
    const following = hand.filter((card) => suitAt(card) === led);

    return following.length > 0 ? following : [...hand];
}

/** The events of the hand being played: everything after the last deal the log holds. */
function handEvents(log: Hidden['log']): HokmEvent[]
{
    const events: HokmEvent[] = [];

    for (const entry of log)
    {
        if (entry.log.kind === 'hokm')
        {
            for (const move of entry.log.moves as unknown as HokmEvent[])
            {
                events.push(move);
            }
        }
    }

    let from = 0;

    events.forEach((event, at) =>
    {
        from = event.e === 'deal' ? at + 1 : from;
    });

    return events.slice(from);
}

interface Played
{
    seat: number;
    card: number;
}

/** What each play in one trick says about its player, given who led and what was winning when it came. */
function readTrick(plays: readonly Played[], table: Table, unlikely: number[][])
{
    if (plays.length === 0)
    {
        return;
    }

    const led = suitAt(plays[0].card);
    const trump = table.trump;

    table.led[plays[0].seat] |= bitOf(led);

    let best = 0;

    for (let at = 1; at < plays.length; at += 1)
    {
        const { seat, card } = plays[at];
        const suit = suitAt(card);
        const winning = plays[best];
        const partnerWins = partnerOf(seat, table.seats) === winning.seat;

        if (suit !== led)
        {
            table.voids[seat] |= bitOf(led);

            if (suit !== trump && trump >= 0 && !partnerWins)
            {
                unlikely[seat][trump] |= suitAt(winning.card) === trump ? above(rankAt(winning.card)) : FULL;
            }
        }
        else if (!beats(card, winning.card, trump))
        {
            unlikely[seat][led] |= (1 << rankAt(card)) - 1;
        }

        if (beats(card, winning.card, trump))
        {
            best = at;
        }
    }
}

/** A seat's knowledge from its board and its log. */
export function seenOf(input: Hidden<HokmBoard>, seat: number): Seen
{
    const view = input.view;
    const seats = view.seats.length;
    const trump = view.trump === undefined ? -1 : SUITS.indexOf(view.trump);
    const gone = [0, 0, 0, 0];
    const deck = new Set(deckFor(seats));

    for (let card = 0; card < SIZE * 4; card += 1)
    {
        if (!deck.has(card))
        {
            gone[suitAt(card)] |= 1 << rankAt(card);
        }
    }

    const table: Table = {
        seats,
        trump,
        hakem: view.hakem,
        lead: view.lead,
        trick: [...view.trick],
        tricks: view.seats.map((one) => one.tricks),
        gone,
        voids: view.seats.map(() => 0),
        led: view.seats.map(() => 0),
        points: [...view.points],
        target: view.target
    };

    const unlikely = view.seats.map(() => [0, 0, 0, 0]);
    const groups: Played[][] = [];
    let open: Played[] = [];
    let partial = true;

    for (const event of handEvents(input.log))
    {
        if (event.e === 'deal')
        {
            partial = false;
        }

        if (event.e === 'card')
        {
            open.push({ seat: event.seat, card: event.card });
            gone[suitAt(event.card)] |= 1 << rankAt(event.card);
        }

        if (event.e === 'trick')
        {
            groups.push(open);
            open = [];
        }
    }

    // A log cut short starts mid-trick: that first trick's leader is unknown, so it says nothing.
    const first = groups.length > 0 && groups[0].length < seats && partial ? 1 : 0;

    groups.slice(first).forEach((group) => readTrick(group, table, unlikely));

    if (groups.length === 0 && view.took !== undefined)
    {
        readTrick(view.took.cards.map((card, at) => ({ seat: (view.took!.lead + at) % seats, card })), table, unlikely);
    }

    for (const card of [...(view.took?.cards ?? []), ...view.trick, ...(view.glimpse === undefined ? [] : [view.glimpse])])
    {
        gone[suitAt(card)] |= 1 << rankAt(card);
    }

    readTrick(view.trick.map((card, at) => ({ seat: (view.lead + at) % seats, card })), table, unlikely);

    return { table, seat, hand: [...view.hand], held: view.seats.map((one) => one.held), unlikely };
}

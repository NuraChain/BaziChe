import { RANKS, SUITS, rankOf, suitOf, type Suit } from '../../match/cards/cards.ts';
import { trickWinner } from '../../match/hokm/cards.ts';
import type { MatchBoard, MatchPlay } from '../../../schemas.ts';
import type { Agent, Ask, Hidden } from '../agent.ts';

/**
 * The baseline, from the seat's own board alone: trump is the strongest suit held, the cards put
 * away and the draws follow card worth, and a trick is won as cheaply as it can be, left to a
 * partner already winning it, or thrown low. Replaced by a real strategy later, under the same
 * export.
 */

type HokmBoard = Extract<MatchBoard, { kind: 'hokm' }>;

const TEN = RANKS.indexOf('10');

const worthOf = (card: number, trump: Suit | null) => rankOf(card) + (suitOf(card) === trump ? RANKS.length : 0);

const lowest = (cards: readonly number[], trump: Suit | null) =>
    cards.reduce((low, card) => (worthOf(card, trump) < worthOf(low, trump) || (worthOf(card, trump) === worthOf(low, trump) && card < low) ? card : low), cards[0]);

function trumpOf(hand: readonly number[]): Suit
{
    const strength = (suit: Suit) => hand.filter((card) => suitOf(card) === suit).reduce((sum, card) => sum + 10 + rankOf(card), 0);

    return SUITS.reduce((best, suit) => (strength(suit) > strength(best) ? suit : best), SUITS[0]);
}

/** The card to play from `plays`, the legal ones. */
function cardOf(view: HokmBoard, seat: number): number
{
    const trump = view.trump ?? null;
    const plays = view.plays;
    const seats = view.seats.length;

    if (view.trick.length === 0)
    {
        const aces = plays.filter((card) => rankOf(card) === RANKS.length - 1 && suitOf(card) !== trump);

        if (aces.length > 0)
        {
            return aces[0];
        }

        const plain = plays.filter((card) => suitOf(card) !== trump);

        return lowest(plain.length > 0 ? plain : plays, trump);
    }

    const winning = (view.lead + trickWinner(view.trick, (trump ?? suitOf(view.trick[0])) as Suit)) % seats;
    const partner = seats === 4 ? (seat + 2) % 4 : -1;

    if (winning === partner)
    {
        return lowest(plays, trump);
    }

    const beats = plays.filter((card) =>
    {
        const after = [...view.trick, card];

        return trickWinner(after, (trump ?? suitOf(view.trick[0])) as Suit) === after.length - 1;
    });

    return lowest(beats.length > 0 ? beats : plays, trump);
}

function decide(ask: Ask<Hidden<HokmBoard>>): MatchPlay | null
{
    const view = ask.input.view;
    const trump = view.trump ?? null;

    if (view.phase === 'trump')
    {
        return view.hakem === ask.seat && view.hand.length > 0 ? { kind: 'hokm', verb: 'trump', suit: trumpOf(view.hand) } : null;
    }

    if (view.turn !== ask.seat)
    {
        return null;
    }

    if (view.phase === 'discard')
    {
        const count = view.discard ?? 0;

        if (count < 2 || view.hand.length < count)
        {
            return null;
        }

        const away = [...view.hand].sort((a, b) => worthOf(a, trump) - worthOf(b, trump) || a - b).slice(0, count).sort((a, b) => a - b);

        return { kind: 'hokm', verb: 'discard', cards: away };
    }

    if (view.phase === 'draw')
    {
        if (view.offer === undefined)
        {
            return null;
        }

        const keep = suitOf(view.offer) === trump || rankOf(view.offer) >= TEN;

        return { kind: 'hokm', verb: keep ? 'keep' : 'reject' };
    }

    return view.plays.length === 0 ? null : { kind: 'hokm', verb: 'card', card: cardOf(view, ask.seat) };
}

export const hokmAgent: Agent<Hidden<HokmBoard>> = {
    id: 'hokm',
    version: 1,
    decide
};

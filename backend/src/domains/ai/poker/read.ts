import type { MatchBoard } from '../../../schemas.ts';
import type { Hidden } from '../agent.ts';

/**
 * What a seat can know at the table: the board composed for it and its own log. Nothing here can see
 * another seat's hole cards; the log never carries them before a showdown.
 */

export type PokerBoard = Extract<MatchBoard, { kind: 'poker' }>;

type Move = Extract<Hidden<PokerBoard>['log'][number]['log'], { kind: 'poker' }>['moves'][number];

type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface Act
{
    seat: number;
    verb: 'fold' | 'check' | 'call' | 'raise' | 'allin';
    street: Street;

    /** For a raise or an all-in, the bet it makes the seat's whole bet this street. */
    amount: number;

    /** It put in more than the bet to match: a bet or a raise. */
    aggressive: boolean;

    /** After the flop, there was a bet to answer. */
    facing: boolean;
}

/** How one seat has played this match, from the hands it was dealt. */
export interface Habit
{
    hands: number;

    /** Hands it put chips in before the flop of its own will. */
    entered: number;

    /** Hands it raised before the flop. */
    raised: number;

    /** Bets and raises after the flop, and calls after the flop. */
    pushed: number;
    called: number;

    /** Bets after the flop it had to answer, and how many of them it folded to. */
    faced: number;
    folded: number;
}

export interface Reading
{
    /** This hand's own betting so far, or null when the log no longer reaches back to its deal. */
    acts: Act[] | null;
    sb: number;
    bb: number;
    habits: Habit[];
}

const empty = (): Habit => ({ hands: 0, entered: 0, raised: 0, pushed: 0, called: 0, faced: 0, folded: 0 });

const VERBS = new Set(['fold', 'check', 'call', 'raise', 'allin']);

/** The seat that would post the small blind and the big blind after this button, among the seats still in. */
function blindsFrom(view: PokerBoard)
{
    const count = view.seats.length;
    const next = (from: number) =>
    {
        for (let step = 1; step <= count; step += 1)
        {
            const seat = (from + step) % count;

            if (!view.seats[seat].out)
            {
                return seat;
            }
        }

        return from;
    };

    const alive = view.seats.filter((seat) => !seat.out).length;
    const sb = alive === 2 ? view.button : next(view.button);

    return { sb, bb: next(sb) };
}

export function readOf(input: Hidden<PokerBoard>): Reading
{
    const view = input.view;
    const habits = view.seats.map(empty);
    let hand: { number: number; blinds: { seat: number; amount: number }[]; acts: Act[]; big: number } | null = null;
    let street: Street = 'preflop';
    let level = 0;

    const close = (dealt: readonly number[]) =>
    {
        if (hand === null)
        {
            return;
        }

        for (const seat of dealt)
        {
            const habit = habits[seat];

            if (habit === undefined)
            {
                continue;
            }

            const own = hand.acts.filter((act) => act.seat === seat);

            habit.hands += 1;
            habit.entered += own.some((act) => act.street === 'preflop' && act.verb !== 'fold' && act.verb !== 'check') ? 1 : 0;
            habit.raised += own.some((act) => act.street === 'preflop' && act.aggressive) ? 1 : 0;
            habit.pushed += own.filter((act) => act.street !== 'preflop' && act.aggressive).length;
            habit.called += own.filter((act) => act.street !== 'preflop' && act.verb === 'call').length;
            habit.faced += own.filter((act) => act.facing).length;
            habit.folded += own.filter((act) => act.facing && act.verb === 'fold').length;
        }
    };

    for (const entry of input.log)
    {
        if (entry.log.kind !== 'poker')
        {
            continue;
        }

        for (const move of entry.log.moves as Move[])
        {
            if (move.e === 'deal')
            {
                hand = { number: move.hand ?? 0, blinds: [], acts: [], big: move.big ?? 0 };
                street = 'preflop';
                level = 0;
            }
            else if (hand === null)
            {
                continue;
            }
            else if (move.e === 'blind')
            {
                hand.blinds.push({ seat: move.seat ?? -1, amount: move.amount ?? 0 });
                level = Math.max(level, move.amount ?? 0);
            }
            else if (move.e === 'board')
            {
                street = move.street ?? street;
                level = 0;
            }
            else if (move.e === 'end')
            {
                close(move.dealt ?? []);
            }
            else if (VERBS.has(move.e) && move.seat !== undefined)
            {
                const amount = move.amount ?? 0;
                const aggressive = (move.e === 'raise' || move.e === 'allin') && amount > level;
                const facing = street !== 'preflop' && level > 0;

                if (aggressive)
                {
                    level = amount;
                }

                hand.acts.push({ seat: move.seat, verb: move.e as Act['verb'], street, amount, aggressive, facing });
            }
        }
    }

    const fallback = blindsFrom(view);

    if (hand === null || hand.number !== view.hand)
    {
        return { acts: null, ...fallback, habits };
    }

    // The first blind posted is the small one; a small blind on a seat that went out is not posted.
    const posted = hand.blinds.filter((blind) => blind.seat >= 0);
    const bb = posted.length >= 2 ? posted[1].seat : posted.length === 1 && posted[0].amount >= hand.big ? posted[0].seat : fallback.bb;
    const sb = posted.length >= 2 ? posted[0].seat : fallback.sb;

    return { acts: hand.acts, sb, bb, habits };
}

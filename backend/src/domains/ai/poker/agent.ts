import { rankOf, suitOf } from '../../match/cards/cards.ts';
import { CATEGORIES, evaluate } from '../../match/poker/evaluator.ts';
import type { MatchBoard, MatchPlay } from '../../../schemas.ts';
import type { Agent, Ask, Hidden } from '../agent.ts';

/**
 * The baseline, from the seat's own board alone: a rough strength for the two hole cards before the
 * flop and the made hand after it, weighed against the price of calling. It raises an amount the
 * board says is legal, goes all in short-stacked with a strong hand, and otherwise checks, calls or
 * folds. Replaced by a real strategy later, under the same export.
 */

type PokerBoard = Extract<MatchBoard, { kind: 'poker' }>;

const ACE = 12;

/** By made-hand category, high card first. */
const MADE = [0.25, 0.55, 0.72, 0.8, 0.85, 0.88, 0.93, 0.97, 0.99];

/** How many big blinds or fewer is short enough to move all in with a strong hand. */
const SHORT = 10;

function strengthOf(view: PokerBoard)
{
    const [a, b] = view.hole;

    if (view.board.length < 3)
    {
        const high = Math.max(rankOf(a), rankOf(b));
        const low = Math.min(rankOf(a), rankOf(b));

        if (high === low)
        {
            return 0.5 + high / 24;
        }

        const suited = suitOf(a) === suitOf(b) ? 0.05 : 0;
        const connected = high - low <= 2 ? 0.04 : 0;
        const ace = high === ACE ? 0.08 : 0;

        return Math.min(0.85, (high + low) / 40 + suited + connected + ace);
    }

    return MADE[CATEGORIES.indexOf(evaluate([...view.hole, ...view.board]).category)] ?? 0.25;
}

function decide(ask: Ask<Hidden<PokerBoard>>): MatchPlay | null
{
    const view = ask.input.view;

    if (view.turn !== ask.seat || view.winner !== undefined || view.hole.length < 2)
    {
        return null;
    }

    const mine = view.seats[ask.seat];
    const owe = view.toCall ?? 0;
    const raising = view.minRaiseTo !== undefined && view.maxRaiseTo !== undefined;
    const bold = 0.9 + (ask.style / 999) * 0.2;
    const strength = strengthOf(view) * bold;
    const odds = owe / Math.max(1, view.pot + owe);
    const short = mine.stack <= view.blinds.big * SHORT;

    if (raising && short && strength >= 0.62)
    {
        return { kind: 'poker', verb: 'allin' };
    }

    if (raising && strength >= (owe === 0 ? 0.6 : 0.75))
    {
        const low = view.minRaiseTo as number;
        const high = view.maxRaiseTo as number;
        const wanted = low + Math.floor(view.pot * (0.3 + ask.random() * 0.4));
        const amount = Math.min(high, Math.max(low, wanted));

        return amount >= high ? { kind: 'poker', verb: 'allin' } : { kind: 'poker', verb: 'raise', amount };
    }

    if (owe === 0)
    {
        return { kind: 'poker', verb: 'check' };
    }

    return strength >= odds + 0.15 ? { kind: 'poker', verb: 'call' } : { kind: 'poker', verb: 'fold' };
}

export const pokerAgent: Agent<Hidden<PokerBoard>> = {
    id: 'poker',
    version: 1,
    decide
};

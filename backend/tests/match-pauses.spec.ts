import { describe, expect, it } from 'vitest';

import type { BackgammonEvent } from '../src/domains/match/backgammon/state.ts';
import type { Draws } from '../src/domains/match/engine.ts';
import { backgammonEngine } from '../src/domains/match/engines/backgammon.ts';
import { chessEngine } from '../src/domains/match/engines/chess.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import type { HokmEvent } from '../src/domains/match/hokm/state.ts';
import { PAUSES } from '../src/domains/match/pauses.ts';
import type { PokerEvent } from '../src/domains/match/poker/state.ts';

const SHOWN: PokerEvent[] = [
    { e: 'call', seat: 1, amount: 40 },
    { e: 'show', seat: 0, cards: [0, 1], category: 'pair' },
    { e: 'show', seat: 1, cards: [2, 3], category: 'high-card' },
    { e: 'pot', amount: 160, winners: [0] },
    { e: 'end', hand: 3, dealt: [0, 1] },
    { e: 'deal', hand: 4, button: 1, small: 10, big: 20 },
    { e: 'blind', seat: 1, amount: 10 },
    { e: 'blind', seat: 0, amount: 20 }
];

/** The last face of every die: a deal no test needs to know, the same each time. */
const draws: Draws = { die: (sides: number) => sides - 1 };

describe('what a table holds of what an action ended, given back to whoever plays next', () =>
{
    it('poker: the hands shown down and the pot on its winner, or the pot alone for a hand won by folds', () =>
    {
        expect(pokerEngine.pause?.(SHOWN)).toBe(PAUSES.showdown + PAUSES.pot);
        expect(pokerEngine.pause?.(SHOWN.filter((one) => one.e !== 'show'))).toBe(PAUSES.pot);
        expect(pokerEngine.pause?.([{ e: 'raise', seat: 0, amount: 60 }] satisfies PokerEvent[])).toBe(0);
    });

    it('poker: a real hand that one fold ends is held for its pot', () =>
    {
        const opened = pokerEngine.create([0, 1], draws, { target: 0, cube: false, blinds: 'low', variant: 'standard' });
        const seat = pokerEngine.turnOf(opened.state)!;
        const applied = pokerEngine.apply(opened.state, pokerEngine.parse({ kind: 'poker', verb: 'fold' }, seat)!, draws);

        expect(applied.ok).toBe(true);
        expect(applied.ok && pokerEngine.pause?.(applied.events)).toBe(PAUSES.pot);
    });

    it('hokm: a trick taken, and a hand\'s result beside the last trick of the hand', () =>
    {
        expect(hokmEngine.pause?.([{ e: 'card', seat: 2, card: 40 }, { e: 'trick', seat: 1 }] satisfies HokmEvent[])).toBe(PAUSES.trick);
        expect(hokmEngine.pause?.([{ e: 'card', seat: 2, card: 40 }, { e: 'trick', seat: 1 }, { e: 'hand', side: 1, seats: [1, 3], points: 1, kot: false }, { e: 'deal', hakem: 1 }] satisfies HokmEvent[]))
            .toBe(PAUSES.trick + PAUSES.hand);
        expect(hokmEngine.pause?.([{ e: 'card', seat: 2, card: 40 }] satisfies HokmEvent[])).toBe(0);
    });

    it('backgammon: a game inside the match, before the next one opens', () =>
    {
        expect(backgammonEngine.pause?.([{ e: 'move', seat: 0, from: 3, to: 25, die: 3, hit: false }, { e: 'game', seat: 0, how: 'single', points: 1, cube: 1 }, { e: 'opening', seat: 1, dice: [5, 2] }] satisfies BackgammonEvent[]))
            .toBe(PAUSES.game);
        expect(backgammonEngine.pause?.([{ e: 'move', seat: 0, from: 3, to: 7, die: 4, hit: true }] satisfies BackgammonEvent[])).toBe(0);
    });

    it('holds nothing at Ludo or chess, whose game ends with the match', () =>
    {
        expect(ludoEngine.pause).toBeUndefined();
        expect(chessEngine.pause).toBeUndefined();
    });
});

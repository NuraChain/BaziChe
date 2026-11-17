import type { MatchPlay } from '../../../schemas.ts';
import type { Agent, Ask, Hidden } from '../agent.ts';
import type { PokerBoard } from './read.ts';
import { think } from './think.ts';

/**
 * The poker agent. It sees only its own seat's board and log: its two cards, the board, the stacks
 * and bets, and every action and showdown this match. By skill it plays a chart, or weighs fold,
 * call and raise on its share of the pot over sampled deals against the ranges the betting shows
 * (`think.ts`). Every raise it makes lies between the board's own least raise and its all-in.
 */
export const pokerAgent: Agent<Hidden<PokerBoard>> = {
    id: 'poker',
    version: 2,
    decide: (ask: Ask<Hidden<PokerBoard>>): MatchPlay | null => think(ask).play
};

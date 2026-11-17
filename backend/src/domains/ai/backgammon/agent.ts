import type { BackgammonState } from '../../match/backgammon/state.ts';
import type { Agent, Ask } from '../agent.ts';
import { choose } from './search.ts';

/**
 * Backgammon: whole-turn moves read by the position each leaves, a look over the dice by skill,
 * and the cube from match-winning chances. The roll-off and the roll are answered at once.
 */
export const backgammonAgent: Agent<BackgammonState> = {
    id: 'backgammon',
    version: 2,
    decide: (ask: Ask<BackgammonState>) => choose(ask).play
};

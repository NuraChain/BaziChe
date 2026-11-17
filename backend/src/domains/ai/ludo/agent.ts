import type { LudoState } from '../../match/ludo/state.ts';
import type { Agent, Ask } from '../agent.ts';
import { choose } from './search.ts';

/**
 * Ludo: each token it may move read by what the move leaves - progress, captures, the chance of
 * being hit and the threat posed - with a look over the dice by skill. The roll is answered at once.
 */
export const ludoAgent: Agent<LudoState> = {
    id: 'ludo',
    version: 2,
    decide: (ask: Ask<LudoState>) => choose(ask).play
};

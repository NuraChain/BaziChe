import type { MatchPlay } from '../../../schemas.ts';
import type { Agent, Ask, Hidden } from '../agent.ts';
import type { HokmBoard } from './table.ts';
import { think } from './think.ts';

/**
 * The hokm agent. It sees only its own seat's board and log, counts what has been played and who
 * has shown a void, and by skill plays by rule, plays the ending out, or plays every card out over
 * deals that could be the real one (`think.ts`). Every card it plays is one of the board's `plays`.
 */
export const hokmAgent: Agent<Hidden<HokmBoard>> = {
    id: 'hokm',
    version: 2,
    decide: (ask: Ask<Hidden<HokmBoard>>): MatchPlay | null => think(ask).play
};

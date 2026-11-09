import { doubleElimination, singleElimination } from './elimination.ts';
import type { Format } from './game.ts';
import { groupsAndPlayoffs } from './groups.ts';
import { roundRobin, swiss } from './league.ts';

export const FORMAT_IDS = ['single', 'double', 'round-robin', 'swiss', 'groups'] as const;

export type FormatId = typeof FORMAT_IDS[number];

export const FORMATS: Record<FormatId, Format> = {
    'single': singleElimination,
    'double': doubleElimination,
    'round-robin': roundRobin,
    'swiss': swiss,
    'groups': groupsAndPlayoffs
};

export const BEST_OF = [1, 3, 5] as const;

/** Fewer than this at the start time and there is no tournament to run. */
export const MIN_ENTRANTS = 4;

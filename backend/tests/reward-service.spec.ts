import { describe, expect, it } from 'vitest';

import { periodKeysInClaimWindow } from '../src/domains/reward/service.ts';
import { REWARD_REFUSALS } from '../src/domains/reward/refusals.ts';

describe('reward service', () =>
{
    it('refuses with 409s, and has a word of its own for a player with no wallet', () =>
    {
        expect(REWARD_REFUSALS['not-established']).toBe(409);
        expect(REWARD_REFUSALS['reward-no-wallet']).toBe(409);
        expect(REWARD_REFUSALS['reward-wallet']).toBe(409);
    });

    it('lists every word once with its status: switched off answers as missing, a freeze as a conflict', () =>
    {
        expect(REWARD_REFUSALS).toEqual({
            'not-established': 409,
            'reward-off': 404,
            'reward-wallet': 409,
            'reward-no-wallet': 409,
            'reward-minor': 409,
            'reward-suspended': 409,
            'reward-frozen': 409,
            'reward-claimed': 409,
            'reward-budget': 409,
            'reward-cap': 409
        });

        for (const word of Object.keys(REWARD_REFUSALS))
        {
            expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
    });

    it('keeps daily claims available through seven days, but not after that window', () =>
    {
        expect(periodKeysInClaimWindow('daily', 1050)).toEqual(['1043', '1044', '1045', '1046', '1047', '1048', '1049', '1050']);
    });

    it('keeps the previous weekly quest key only while it falls within the seven-day window', () =>
    {
        // Day 1050 is cycle 34's day 30, which has no week; 1051 opens cycle 35's first.
        expect(periodKeysInClaimWindow('weekly', 1049)).toEqual(['cycle:34:week:4']);
        expect(periodKeysInClaimWindow('weekly', 1050)).toEqual(['cycle:34:week:4']);
        expect(periodKeysInClaimWindow('weekly', 1051)).toEqual(['cycle:34:week:4', 'cycle:35:week:1']);
        expect(periodKeysInClaimWindow('weekly', 1058)).toEqual(['cycle:35:week:1', 'cycle:35:week:2']);
    });
});

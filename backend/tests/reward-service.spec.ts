import { describe, expect, it } from 'vitest';

import { periodKeysInClaimWindow, rewardForDay } from '../src/domains/reward/service.ts';
import { REWARD_REFUSALS } from '../src/domains/reward/refusals.ts';

describe('reward service', () =>
{
    it('pays the ladder and the day-30 bonus with the right look windows', () =>
    {
        expect(rewardForDay(1, true)).toMatchObject({ amount: 1000 });
        expect(rewardForDay(1, true)).not.toHaveProperty('look');
        expect(rewardForDay(7, true)).toMatchObject({ amount: 3000, look: 'weekly' });
        expect(rewardForDay(14, true)).toMatchObject({ amount: 4000, look: 'weekly' });
        expect(rewardForDay(21, true)).toMatchObject({ amount: 5000, look: 'weekly' });
        expect(rewardForDay(28, true)).toMatchObject({ amount: 3000, look: 'weekly' });
        expect(rewardForDay(30, true)).toMatchObject({ amount: 0, look: 'exclusive', bonus: 20000 });
    });

    it('refuses non-established players only on the NURA grant', () =>
    {
        expect(REWARD_REFUSALS['not-established']).toBe(409);
        expect(rewardForDay(7, false)).toMatchObject({ amount: 0, look: 'weekly' });
    });

    it('keeps daily claims available through seven days, but not after that window', () =>
    {
        expect(periodKeysInClaimWindow('daily', 20)).toEqual(['13', '14', '15', '16', '17', '18', '19', '20']);
    });

    it('keeps the previous weekly quest key only while it falls within the seven-day window', () =>
    {
        expect(periodKeysInClaimWindow('weekly', 29)).toEqual(['cycle:0:week:4']);
        expect(periodKeysInClaimWindow('weekly', 30)).toEqual(['cycle:0:week:4']);
        expect(periodKeysInClaimWindow('weekly', 31)).toEqual(['cycle:0:week:4', 'cycle:1:week:1']);
    });
});

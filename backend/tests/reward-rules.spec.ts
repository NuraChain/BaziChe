import { describe, expect, it } from 'vitest';

import { REWARD_CAP, REWARD_CYCLE_BUDGET, REWARD_DEFAULTS, REWARD_DAY_START_UTC_MINUTES, REWARD_LADDER, budgetOpen, clip, cycleOf, nextStreak, rewardDayOf } from '../src/domains/reward/rules.ts';

describe('reward rules', () =>
{
    it('sums the defaults to the reward cap', () =>
    {
        expect(Object.values(REWARD_DEFAULTS).reduce((sum, amount) => sum + amount, 0)).toBe(REWARD_CAP);
        expect(REWARD_DEFAULTS.checkin + REWARD_DEFAULTS.bonus + REWARD_DEFAULTS.daily + REWARD_DEFAULTS.weekly).toBe(REWARD_CAP);
    });

    it('keeps the ladder at 50,000 over 30 days', () =>
    {
        expect(REWARD_LADDER).toHaveLength(30);
        expect(REWARD_LADDER.reduce((sum, one) => sum + one, 0)).toBe(50_000);
    });

    it('starts the reward day at 20:30 UTC and not before', () =>
    {
        expect(REWARD_DAY_START_UTC_MINUTES).toBe(20 * 60 + 30);
        expect(rewardDayOf(new Date(Date.UTC(2024, 0, 1, 20, 29, 0)))).toBe(0);
        expect(rewardDayOf(new Date(Date.UTC(2024, 0, 1, 20, 30, 0)))).toBe(1);
        expect(rewardDayOf(new Date(Date.UTC(2024, 0, 2, 20, 29, 0)))).toBe(1);
        expect(rewardDayOf(new Date(Date.UTC(2024, 0, 2, 20, 30, 0)))).toBe(2);
    });

    it('wraps and resets streaks as the day rule says', () =>
    {
        expect(nextStreak(1, 1, 1)).toBe(1);
        expect(nextStreak(1, 2, 1)).toBe(2);
        expect(nextStreak(30, 30, 30)).toBe(30);
        expect(nextStreak(30, 1, 30)).toBe(1);
        expect(nextStreak(24, 25, 24)).toBe(25);
        expect(nextStreak(5, 7, 5)).toBe(1);
    });

    it('never lets a grant pass the cap or the cycle budget', () =>
    {
        expect(clip(120_000, 100_000, 200_000)).toBe(80_000);
        expect(clip(200_000, 100_000, 200_000)).toBe(0);
        expect(budgetOpen(REWARD_CYCLE_BUDGET, 1)).toBeLessThanOrEqual(REWARD_CYCLE_BUDGET);
        expect(budgetOpen(REWARD_CYCLE_BUDGET, 30)).toBe(REWARD_CYCLE_BUDGET);
        expect(cycleOf(1)).toEqual({ cycle: 0, day: 1, week: 1 });
        expect(cycleOf(30)).toEqual({ cycle: 0, day: 30, week: null });
        expect(cycleOf(31)).toEqual({ cycle: 1, day: 1, week: 1 });
    });
});

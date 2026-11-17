import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { createRewardService } from '../src/domains/reward/service.ts';
import { rewardDayOf } from '../src/domains/reward/rules.ts';

const counting =
{
    innerJoin() { return counting; },
    where() { return counting; },
    andWhere() { return counting; },
    async getCount() { return 0; }
};

const db = { getRepository: () => ({ createQueryBuilder: () => counting }) } as unknown as DataSource;

describe('reward activity', () =>
{
    it('reports bronze with zero activity', async () =>
    {
        const activity = await createRewardService(db).activity('u-1');

        expect(activity.today).toBe(rewardDayOf(new Date()));
        expect(activity.matchesPlayed).toBe(0);
        expect(activity.daily).toEqual({ done: 0, claimed: 0 });
        expect(activity.weekly).toEqual({ done: 0, claimed: 0 });
        expect(activity.activityScore).toBe(0);
        expect(activity.activityLevel).toBe('bronze');
        expect(activity.firstMatchOfDay).toBe(false);
    });
});

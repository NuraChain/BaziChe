import { describe, expect, it } from 'vitest';

import { createRewardService } from '../src/domains/reward/service.ts';
import { cycleOf, rewardDayOf } from '../src/domains/reward/rules.ts';
import { questsFor } from '../src/domains/reward/quests.ts';

const USER = 'u-1';
const TODAY = rewardDayOf(new Date());
const TODAY_CYCLE = cycleOf(TODAY);

type ProgressRow = {
    userId: string;
    period: 'daily' | 'weekly';
    periodKey: string;
    questId: string;
    doneAt: Date | null;
    claimedAt: Date | null;
};

interface Capture
{
    updates: Array<{ claimedAt: Date }>;
}

function buildService(rows: ProgressRow[], capture: Capture)
{
    const qbProgress =
    {
        setLock() { return qbProgress; },
        where() { return qbProgress; },
        andWhere() { return qbProgress; },
        orderBy() { return qbProgress; },
        addOrderBy() { return qbProgress; },
        async getMany()
        {
            return rows.filter((r) => r.doneAt !== null && r.claimedAt === null);
        },
        async getCount()
        {
            return 0;
        }
    };

    const insertTail3 = { async execute() { return {}; } };
    const insertTail2 = { orIgnore() { return insertTail3; }, async execute() { return {}; } };
    const insertTail = { values() { return insertTail2; }, async execute() { return {}; } };

    const qbGrantSum =
    {
        select() { return qbGrantSum; },
        where() { return qbGrantSum; },
        andWhere() { return qbGrantSum; },
        async getRawOne()
        {
            return { total: '0' };
        },
        insert()
        {
            return {
                into() { return insertTail; }
            };
        }
    };

    const db =
    {
        transaction: async (fn: (tx: typeof db) => Promise<unknown>) => await fn(db),
        getRepository: (entity: any) =>
        {
            const name = entity?.name ?? '';

            if (name === 'RewardQuestProgress')
            {
                return {
                    createQueryBuilder: () => qbProgress,
                    async update(_criteria: any, values: { claimedAt: Date })
                    {
                        let touched = 0;
                        for (const r of rows)
                        {
                            if (r.claimedAt === null && r.doneAt !== null)
                            {
                                r.claimedAt = values.claimedAt;
                                touched += 1;
                            }
                        }
                        capture.updates.push(values);
                        return { raw: [], affected: touched };
                    }
                };
            }

            if (name === 'RewardGrant')
            {
                return {
                    createQueryBuilder: () => qbGrantSum,
                    async insert()
                    {
                        return {
                            orIgnore: () => ({
                                async execute()
                                {
                                    return {};
                                }
                            })
                        };
                    },
                    async exists(_where: { userId: string; source: string; sourceKey: string })
                    {
                        return false;
                    }
                };
            }

            if (name === 'EstablishedPlayer')
            {
                return {
                    async exists()
                    {
                        return true;
                    }
                };
            }

            if (name === 'Setting')
            {
                return {
                    async findOne()
                    {
                        return { value: JSON.stringify({ pool: ['look.a', 'look.b'] }) };
                    }
                };
            }

            if (name === 'ShopItem')
            {
                return {
                    async find(_where: any)
                    {
                        return [{ id: 'look.a' }, { id: 'look.b' }];
                    }
                };
            }

            if (name === 'MatchPlayer')
            {
                return {
                    createQueryBuilder: () =>
                    ({
                        innerJoin() { return this; },
                        where() { return this; },
                        andWhere() { return this; },
                        async getCount() { return 0; }
                    })
                };
            }

            return {};
        }
    };

    const reward = createRewardService(db, null as any, { mined: () => undefined });

    return { reward, rows, capture };
}

describe('reward claim-all', () =>
{
    it('claims every done-but-unclaimed quest exactly once and marks them claimed', async () =>
    {
        const daily = questsFor(TODAY_CYCLE.cycle, TODAY_CYCLE.day, 'daily');
        const rows: ProgressRow[] = daily.map((quest) => ({
            userId: USER, period: 'daily' as const, periodKey: String(TODAY), questId: quest.id, doneAt: new Date(), claimedAt: null
        }));
        const capture = { updates: [] };
        const { reward, rows: held } = buildService(rows, capture);

        const result = await reward.claimAll(USER);

        expect(result.total).toBe(3000);
        expect(result.claimed.map((c) => c.id).sort()).toEqual(daily.map((q) => q.id).sort());
        expect(held.filter((r) => r.claimedAt !== null).map((r) => r.questId).sort()).toEqual(daily.map((q) => q.id).sort());
        expect(capture.updates.length).toBeGreaterThan(0);
    });

    it('is idempotent: a second claim-all returns nothing when nothing is claimable', async () =>
    {
        const daily = questsFor(TODAY_CYCLE.cycle, TODAY_CYCLE.day, 'daily');
        const rows: ProgressRow[] = daily.map((quest) => ({
            userId: USER, period: 'daily' as const, periodKey: String(TODAY), questId: quest.id, doneAt: new Date(), claimedAt: null
        }));
        const capture = { updates: [] };
        const { reward, rows: held } = buildService(rows, capture);

        await reward.claimAll(USER);
        const second = await reward.claimAll(USER);

        expect(second.claimed).toEqual([]);
        expect(second.total).toBe(0);
        expect(held.every((r) => r.claimedAt !== null)).toBe(true);
    });
});

describe('reward activity', () =>
{
    it('reports bronze with zero activity', async () =>
    {
        const capture = { updates: [] };
        const { reward } = buildService([], capture);

        const activity = await reward.activity(USER);

        expect(activity.today).toBe(TODAY);
        expect(activity.matchesPlayed).toBe(0);
        expect(activity.daily).toEqual({ done: 0, claimed: 0 });
        expect(activity.weekly).toEqual({ done: 0, claimed: 0 });
        expect(activity.activityScore).toBe(0);
        expect(activity.activityLevel).toBe('bronze');
        expect(activity.firstMatchOfDay).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';

import {
    REWARD_AMOUNTS,
    REWARD_BUDGET_MOST,
    REWARD_CAP,
    REWARD_CYCLE_BUDGET,
    REWARD_DAY_START_UTC_MINUTES,
    REWARD_DEFAULTS,
    REWARD_LADDER,
    amountsOf,
    budgetNuraOf,
    budgetOf,
    budgetOpen,
    clip,
    configText,
    cycleOf,
    eligibilityOf,
    questClaimGate,
    grantAward,
    ladderView,
    mostPerCycle,
    nextStreak,
    pickLook,
    planCheckIn,
    rewardConfigOf,
    rewardDayOf,
    rewardForDay,
    weiOf,
    type StreakRow
} from '../src/domains/reward/rules.ts';

// 2026-11-16, around when this was written: the reward day is in the thousands, never 1-30.
const TODAY = rewardDayOf(new Date(Date.UTC(2026, 10, 16, 12, 0, 0)));

/** Checks in on each of `days` in turn, from `row`, and answers each plan and the row it leaves. */
const checkInOn = (days: readonly number[], row: StreakRow | null = null) =>
{
    const plans = [];
    let held = row;

    for (const day of days)
    {
        const plan = planCheckIn(held, day, REWARD_AMOUNTS);

        if (plan.claimable)
        {
            held = { streak: plan.position, run: plan.run, lastDay: day, best: plan.best };
        }

        plans.push(plan);
    }

    return { plans, row: held };
};

const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);

describe('reward rules', () =>
{
    it('sums the defaults to exactly the reward cap', () =>
    {
        expect(REWARD_DEFAULTS).toEqual({ checkin: 50_000, bonus: 20_000, daily: 90_000, weekly: 40_000 });
        expect(Object.values(REWARD_DEFAULTS).reduce((sum, amount) => sum + amount, 0)).toBe(REWARD_CAP);
        expect(REWARD_CAP).toBe(200_000);
        expect(REWARD_AMOUNTS).toEqual({ ladder: REWARD_LADDER, daily: 1_000, weekly: 3_000, chest: 1_000, bonus: 20_000 });
        expect(mostPerCycle(REWARD_AMOUNTS)).toBe(REWARD_CAP);
    });

    it('keeps the ladder at 50,000 over any 30 consecutive days, wrapping or not', () =>
    {
        expect(REWARD_LADDER).toHaveLength(30);

        for (let start = 0; start < 30; start += 1)
        {
            expect(range(start, 30).reduce((sum, index) => sum + REWARD_LADDER[index % 30], 0)).toBe(50_000);
        }
    });

    it('starts the reward day at 20:30 UTC and not before', () =>
    {
        expect(REWARD_DAY_START_UTC_MINUTES).toBe(20 * 60 + 30);
        expect(rewardDayOf(new Date(Date.UTC(2024, 0, 1, 20, 29, 0)))).toBe(0);
        expect(rewardDayOf(new Date(Date.UTC(2024, 0, 1, 20, 30, 0)))).toBe(1);
        expect(rewardDayOf(new Date(Date.UTC(2026, 10, 16, 20, 29, 0)))).toBe(TODAY);
        expect(rewardDayOf(new Date(Date.UTC(2026, 10, 16, 20, 30, 0)))).toBe(TODAY + 1);
        expect(TODAY).toBe(1050);
    });

    it('counts cycles from the epoch, 30 days each, with the boundary after day 1050', () =>
    {
        expect(cycleOf(1050)).toEqual({ cycle: 34, day: 30, week: null });
        expect(cycleOf(1051)).toEqual({ cycle: 35, day: 1, week: 1 });
        expect(cycleOf(1078)).toEqual({ cycle: 35, day: 28, week: 4 });
    });

    it('steps the ladder position on consecutive absolute days, wraps 30 to 1, and resets after a gap', () =>
    {
        expect(nextStreak(1049, 1049, 4)).toBe(4);
        expect(nextStreak(1049, 1050, 4)).toBe(5);
        expect(nextStreak(1049, 1050, 30)).toBe(1);
        expect(nextStreak(1048, 1050, 12)).toBe(1);
        expect(nextStreak(0, TODAY, 0)).toBe(1);

        // The old special case: a last day of 30 followed by day 1 is not consecutive on absolute days.
        expect(nextStreak(30, 1, 30)).toBe(1);
        expect(nextStreak(1050, 1051, 29)).toBe(30);
    });

    it('pays a day by its ladder position, never by the absolute or cycle day', () =>
    {
        // Day 1057 is cycle day 7, but a first check-in is position 1.
        const [first] = checkInOn([1057]).plans;

        expect(first).toMatchObject({ claimable: true, position: 1, pay: { amount: 1000, bonus: 0 } });
        expect(first.claimable && first.pay.look).toBeUndefined();
    });

    it('carries a streak across a cycle boundary', () =>
    {
        const { plans, row } = checkInOn(range(1047, 7));

        expect(plans.map((plan) => plan.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(plans.at(-1)).toMatchObject({ pay: { amount: 3000, look: 'weekly' } });
        expect(row).toEqual({ streak: 7, run: 7, lastDay: 1053, best: 7 });
    });

    it('wraps past position 30: the bonus and exclusive look on 30, then position 1 again with the run going on', () =>
    {
        const { plans, row } = checkInOn(range(1040, 32));
        const positions = plans.map((plan) => plan.position);

        expect(positions.slice(0, 30)).toEqual(range(1, 30));
        expect(positions.slice(30)).toEqual([1, 2]);
        expect(plans[29]).toMatchObject({ position: 30, pay: { amount: 0, bonus: 20_000, look: 'exclusive' } });
        expect(plans[30]).toMatchObject({ position: 1, pay: { amount: 1000, bonus: 0 } });
        expect(plans.flatMap((plan) => plan.claimable ? [plan.pay.amount] : []).slice(0, 30).reduce((sum, one) => sum + one, 0)).toBe(50_000);
        expect(row).toEqual({ streak: 2, run: 32, lastDay: 1071, best: 32 });
    });

    it('gives a pool look on positions 7, 14, 21 and 28 only', () =>
    {
        expect(range(1, 30).filter((position) => rewardForDay(position, REWARD_AMOUNTS).look === 'weekly')).toEqual([7, 14, 21, 28]);
        expect(range(1, 30).filter((position) => rewardForDay(position, REWARD_AMOUNTS).look === 'exclusive')).toEqual([30]);
        expect(range(1, 30).filter((position) => rewardForDay(position, REWARD_AMOUNTS).bonus > 0)).toEqual([30]);
    });

    it('resets after a missed day but keeps the best run, and never claims the same day twice', () =>
    {
        const row: StreakRow = { streak: 12, run: 42, lastDay: 1048, best: 42 };

        expect(planCheckIn(row, 1050, REWARD_AMOUNTS)).toMatchObject({ claimable: true, position: 1, run: 1, best: 42 });
        expect(planCheckIn({ ...row, lastDay: 1050 }, 1050, REWARD_AMOUNTS)).toEqual({ claimable: false, position: 12 });
        expect(planCheckIn({ ...row, lastDay: 1051 }, 1050, REWARD_AMOUNTS)).toEqual({ claimable: false, position: 12 });
    });

    it('draws the ladder from the live streak', () =>
    {
        expect(ladderView(null, 1050)).toEqual({ streak: 0, position: 1, claimable: true, claimed: 0 });
        expect(ladderView({ streak: 5, run: 5, lastDay: 1049, best: 5 }, 1050)).toEqual({ streak: 5, position: 6, claimable: true, claimed: 5 });
        expect(ladderView({ streak: 6, run: 6, lastDay: 1050, best: 6 }, 1050)).toEqual({ streak: 6, position: 6, claimable: false, claimed: 6 });
        expect(ladderView({ streak: 9, run: 9, lastDay: 1047, best: 9 }, 1050)).toEqual({ streak: 0, position: 1, claimable: true, claimed: 0 });
        expect(ladderView({ streak: 30, run: 30, lastDay: 1049, best: 30 }, 1050)).toEqual({ streak: 30, position: 1, claimable: true, claimed: 0 });
    });

    it('clips to a limit and never below 0', () =>
    {
        expect(clip(120n, 100n, 200n)).toBe(80n);
        expect(clip(200n, 100n, 200n)).toBe(0n);
        expect(clip(250n, 100n, 200n)).toBe(0n);
        expect(clip(0n, -5n, 200n)).toBe(0n);
    });

    it('opens the budget day by day, and all of it by day 30 and never more', () =>
    {
        const budget = weiOf(REWARD_CYCLE_BUDGET);

        expect(budgetOpen(budget, 0)).toBe(0n);
        expect(budgetOpen(budget, 1)).toBe(budget / 30n);
        expect(budgetOpen(budget, 15)).toBe(budget / 2n);
        expect(budgetOpen(budget, 30)).toBe(budget);
        expect(budgetOpen(budget, 31)).toBe(budget);
    });

    describe('a grant', () =>
    {
        const base = { cap: weiOf(REWARD_CAP), budget: weiOf(REWARD_CYCLE_BUDGET), cycleDay: 30, playerGranted: 0n, cycleGranted: 0n };

        it('pays what it wants when cap and budget allow', () =>
        {
            expect(grantAward({ ...base, wanted: weiOf(1000) })).toEqual({ amount: weiOf(1000) });
            expect(grantAward({ ...base, wanted: 0n })).toEqual({ amount: 0n });
        });

        it('is clipped to the player cap', () =>
        {
            expect(grantAward({ ...base, wanted: weiOf(3000), playerGranted: weiOf(198_000) })).toEqual({ amount: weiOf(2000), clipped: 'reward-cap' });
            expect(grantAward({ ...base, wanted: weiOf(3000), playerGranted: weiOf(200_000) })).toEqual({ amount: 0n, clipped: 'reward-cap' });
        });

        it('is clipped to the budget opened so far', () =>
        {
            const opened = budgetOpen(base.budget, 1);

            expect(grantAward({ ...base, cycleDay: 1, wanted: weiOf(1000), cycleGranted: opened - weiOf(400) })).toEqual({ amount: weiOf(400), clipped: 'reward-budget' });
            expect(grantAward({ ...base, cycleDay: 1, wanted: weiOf(1000), cycleGranted: opened + weiOf(5) })).toEqual({ amount: 0n, clipped: 'reward-budget' });
        });

        it('takes the smaller of the two, naming the one that clipped', () =>
        {
            const opened = budgetOpen(base.budget, 2);

            expect(grantAward({ ...base, cycleDay: 2, wanted: weiOf(5000), playerGranted: weiOf(199_000), cycleGranted: opened - weiOf(3000) })).toEqual({ amount: weiOf(1000), clipped: 'reward-cap' });
            expect(grantAward({ ...base, cycleDay: 2, wanted: weiOf(5000), playerGranted: weiOf(196_000), cycleGranted: opened - weiOf(3000) })).toEqual({ amount: weiOf(3000), clipped: 'reward-budget' });
        });
    });

    it('decides who may earn NURA in one place', () =>
    {
        const fine = { established: true, wallet: '0x' + '1'.repeat(40), minor: false, suspended: false, frozen: false };

        expect(eligibilityOf(fine)).toBeUndefined();
        expect(eligibilityOf({ ...fine, established: false })).toBe('not-established');
        expect(eligibilityOf({ ...fine, wallet: null })).toBe('reward-no-wallet');
        expect(eligibilityOf({ ...fine, minor: true })).toBe('reward-minor');
        expect(eligibilityOf({ ...fine, suspended: true })).toBe('reward-suspended');
        expect(eligibilityOf({ ...fine, frozen: true })).toBe('reward-frozen');
        expect(eligibilityOf({ ...fine, suspended: true, frozen: true })).toBe('reward-suspended');
        expect(eligibilityOf({ ...fine, frozen: true, minor: true, established: false, wallet: null })).toBe('reward-frozen');
    });

    it('refuses a frozen player\'s quest claim whole and lets anyone else rule 7 refuses claim at 0 NURA', () =>
    {
        const fine = { established: true, wallet: '0x' + '1'.repeat(40), minor: false, suspended: false, frozen: false };

        expect(questClaimGate(fine)).toEqual({});
        expect(questClaimGate({ ...fine, established: false })).toEqual({ withheld: 'not-established' });
        expect(questClaimGate({ ...fine, wallet: null })).toEqual({ withheld: 'reward-no-wallet' });
        expect(questClaimGate({ ...fine, minor: true })).toEqual({ withheld: 'reward-minor' });
        expect(questClaimGate({ ...fine, suspended: true })).toEqual({ withheld: 'reward-suspended' });
        expect(questClaimGate({ ...fine, frozen: true })).toEqual({ refused: 'reward-frozen' });
        expect(questClaimGate({ ...fine, suspended: true, frozen: true })).toEqual({ refused: 'reward-frozen' });
        expect(questClaimGate(undefined)).toEqual({ withheld: 'not-established' });
    });

    it('reads the budget from its setting in whole NURA, falling back when it says nothing usable', () =>
    {
        expect(budgetOf(null)).toBe(weiOf(REWARD_CYCLE_BUDGET));
        expect(budgetOf('nonsense')).toBe(weiOf(REWARD_CYCLE_BUDGET));
        expect(budgetOf('1000000')).toBe(weiOf(1_000_000));
        expect(budgetNuraOf(' 0 ')).toBe(0);
        expect(budgetNuraOf(String(REWARD_BUDGET_MOST))).toBe(REWARD_BUDGET_MOST);
        expect(budgetNuraOf(String(REWARD_BUDGET_MOST + 1))).toBe(REWARD_CYCLE_BUDGET);
        expect(budgetNuraOf('-5')).toBe(REWARD_CYCLE_BUDGET);
    });

    describe('the reward config', () =>
    {
        const flat = (each: number) => Array.from({ length: 30 }, () => each);

        it('ships switched off, with the default amounts and no looks', () =>
        {
            for (const said of [null, '', '{oops', '[]', '7', JSON.stringify({ on: 'yes' }), JSON.stringify({ on: 1 })])
            {
                expect(rewardConfigOf(said), String(said)).toEqual({ on: false, amounts: REWARD_AMOUNTS, pool: [], exclusive: null });
            }
        });

        it('reads each part on its own: a bad part falls back alone', () =>
        {
            const config = rewardConfigOf(JSON.stringify({ on: true, amounts: { ladder: [1] }, pool: ['look.a', 'bundle.b', 7, 'look.a', ''], exclusive: 'look.x' }));

            expect(config).toEqual({ on: true, amounts: REWARD_AMOUNTS, pool: ['look.a'], exclusive: 'look.x' });
            expect(rewardConfigOf(JSON.stringify({ exclusive: 'bundle.x' })).exclusive).toBeNull();
        });

        it('reads back what it writes', () =>
        {
            const config = { on: true, amounts: { ladder: flat(100), bonus: 500, daily: 200, weekly: 300, chest: 50 }, pool: ['dice.gold', 'felt.jade'], exclusive: 'pieces.oni' };

            expect(rewardConfigOf(configText(config))).toEqual(config);
            expect(rewardConfigOf(configText(rewardConfigOf(null)))).toEqual(rewardConfigOf(null));
        });

        it('sums the most one player can be paid in a cycle from every source', () =>
        {
            // 30 x 100 + 500 + 3 x 200 x 30 + (3 x 300 + 50) x 4
            expect(mostPerCycle({ ladder: flat(100), bonus: 500, daily: 200, weekly: 300, chest: 50 })).toBe(3_000 + 500 + 18_000 + 3_800);
            expect(mostPerCycle({ ladder: flat(0), bonus: 0, daily: 0, weekly: 0, chest: 0 })).toBe(0);
        });

        it('takes a set of amounts only when it is whole NURA, a 30-day ladder and at most the cap a cycle', () =>
        {
            const good = { ladder: [...REWARD_LADDER], bonus: 20_000, daily: 1_000, weekly: 3_000, chest: 1_000 };

            expect(amountsOf(good)).toEqual(good);
            expect(amountsOf({ ...good, chest: 1_001 }), 'one NURA over the cap').toBeNull();
            expect(amountsOf({ ...good, bonus: 19_996, chest: 1_001 }), 'the same total moved: a chest is paid four times a cycle').toEqual({ ...good, bonus: 19_996, chest: 1_001 });
            expect(amountsOf({ ...good, ladder: good.ladder.slice(1) })).toBeNull();
            expect(amountsOf({ ...good, ladder: [...good.ladder, 0] })).toBeNull();
            expect(amountsOf({ ...good, daily: 1.5 })).toBeNull();
            expect(amountsOf({ ...good, daily: -1 })).toBeNull();
            expect(amountsOf({ ...good, weekly: '3000' })).toBeNull();
            expect(amountsOf({ ...good, ladder: [...good.ladder.slice(1), Number.NaN] })).toBeNull();
            expect(amountsOf({ ladder: good.ladder })).toBeNull();
            expect(amountsOf(null)).toBeNull();
        });

        it('ignores a stored set over the cap in favour of the defaults', () =>
        {
            const over = { ladder: flat(10_000), bonus: 0, daily: 0, weekly: 0, chest: 0 };

            expect(rewardConfigOf(JSON.stringify({ on: true, amounts: over })).amounts).toEqual(REWARD_AMOUNTS);
        });

        it('pays a day and a quest from the amounts it is given', () =>
        {
            const amounts = { ladder: flat(100), bonus: 500, daily: 200, weekly: 300, chest: 50 };

            expect(rewardForDay(7, amounts)).toEqual({ position: 7, amount: 100, bonus: 0, look: 'weekly' });
            expect(rewardForDay(30, amounts)).toEqual({ position: 30, amount: 100, bonus: 500, look: 'exclusive' });
            expect(planCheckIn(null, TODAY, amounts)).toMatchObject({ claimable: true, position: 1, pay: { amount: 100, bonus: 0 } });
        });
    });

    it('picks the same pool look for the same seed', () =>
    {
        const pool = ['look.a', 'look.b', 'look.c'];

        expect(pickLook([], 'u:1050')).toBeNull();
        expect(pickLook(pool, 'u:1050')).toBe(pickLook(pool, 'u:1050'));
        expect(pool).toContain(pickLook(pool, 'u:1050'));
    });
});

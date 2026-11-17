import { describe, expect, it } from 'vitest';

import { cycleSpan, dailyLog, dayStartOf, entryOf, questOf, type DayRow } from '../src/domains/admin/rewards.ts';
import { cycleOf, rewardDayOf, weiOf } from '../src/domains/reward/rules.ts';

const row = (day: number, nura: Partial<Record<'checkin' | 'bonus' | 'daily' | 'weekly' | 'chest' | 'paid', number>>, skins = 0, players = 1): DayRow =>
{
    const wei = (key: keyof typeof nura) => weiOf(nura[key] ?? 0).toString();
    const total = ['checkin', 'bonus', 'daily', 'weekly', 'chest'].reduce((sum, key) => sum + (nura[key as keyof typeof nura] ?? 0), 0);

    return {
        day,
        checkin: wei('checkin'),
        bonus: wei('bonus'),
        daily: wei('daily'),
        weekly: wei('weekly'),
        chest: wei('chest'),
        total: weiOf(total).toString(),
        skins,
        players,
        paid: wei('paid')
    };
};

const face = { handle: 'ada', display_name: 'Ada', hue: 120, avatar: null };

describe('admin rewards: days and cycles', () =>
{
    it('starts each reward day where rewardDayOf turns over', () =>
    {
        for (const day of [1, 2, 31, 1000])
        {
            expect(rewardDayOf(dayStartOf(day))).toBe(day);
            expect(rewardDayOf(dayStartOf(day) - 1)).toBe(day - 1);
        }
    });

    it('spans the days cycleOf books to the cycle', () =>
    {
        for (const cycle of [1, 27])
        {
            const { first, last } = cycleSpan(cycle);

            expect(last - first + 1).toBe(30);
            expect(cycleOf(first).cycle).toBe(cycle);
            expect(cycleOf(last).cycle).toBe(cycle);
            expect(cycleOf(first - 1).cycle).toBe(cycle - 1);
            expect(cycleOf(last + 1).cycle).toBe(cycle + 1);
        }
    });
});

describe('admin rewards: the daily log', () =>
{
    const cycle = 2;
    const { first } = cycleSpan(cycle);
    const budget = weiOf(3_000_000);

    it('lists every day of the cycle up to today, newest first, a quiet day as zeros', () =>
    {
        const log = dailyLog([row(first, { checkin: 50 })], cycle, budget, first + 2);

        expect(log.days.map((day) => day.day)).toEqual([first + 2, first + 1, first]);
        expect(log.days[1]).toMatchObject({ cycleDay: 2, total: 0, skins: 0, players: 0, paidOut: 0 });
    });

    it('lists all thirty days of a cycle that is over', () =>
    {
        expect(dailyLog([], cycle, budget, first + 500).days).toHaveLength(30);
    });

    it('sums each day by source to the ledger total, and runs the cycle total against the budget opened', () =>
    {
        const log = dailyLog([
            row(first, { checkin: 50, daily: 300, paid: 1_000 }, 0, 4),
            row(first + 1, { checkin: 75, bonus: 2_000, weekly: 1_500, chest: 5_000 }, 2, 3)
        ], cycle, budget, first + 1);
        const [second, firstDay] = log.days;

        expect(firstDay).toMatchObject({ total: 350, used: 350, open: 100_000, players: 4, paidOut: 1_000 });
        expect(second).toMatchObject({ total: 8_575, used: 8_925, open: 200_000, skins: 2 });

        for (const day of log.days)
        {
            const bySource = Object.values(day.granted).reduce((sum, nura) => sum + nura, 0);
            expect(bySource).toBe(day.total);
        }

        expect(log.budget).toBe(3_000_000);
    });

    it('floors each figure to whole NURA on its own, so a clipped fraction never moves the total', () =>
    {
        const fraction = (weiOf(10) + 5n * 10n ** 17n).toString();
        const [day] = dailyLog([{ ...row(first, {}), checkin: fraction, total: fraction }], cycle, budget, first).days;

        expect(day?.granted.checkin).toBe(10);
        expect(day?.total).toBe(10);
    });
});

describe('admin rewards: a day, line by line', () =>
{
    const at = new Date(dayStartOf(800) + 1_000);

    it('reads the quest from a daily or weekly key, and none from the other sources', () =>
    {
        expect(questOf('daily', 'day:800:win-chess')).toBe('win-chess');
        expect(questOf('weekly', 'cycle:26:week:3:play-5')).toBe('play-5');
        expect(questOf('checkin', 'day:800')).toBeUndefined();
        expect(questOf('chest', 'cycle:26:week:3')).toBeUndefined();
        expect(questOf('daily', 'day:800:')).toBeUndefined();
    });

    it('shows a grant in whole NURA with what it wanted before clipping, its quest and its look', () =>
    {
        expect(entryOf({
            ...face,
            kind: 'grant',
            id: 'g1',
            at,
            at_key: '1',
            source: 'daily',
            source_key: 'day:800:win-chess',
            amount: '0',
            wanted: weiOf(300).toString(),
            item_id: 'board-ember',
            delivered: true,
            state: null,
            tx_hash: null,
            attempts: null
        })).toEqual({
            kind: 'grant',
            id: 'g1',
            person: { handle: 'ada', displayName: 'Ada', hue: 120 },
            source: 'daily',
            quest: 'win-chess',
            amount: 0,
            wanted: 300,
            item: 'board-ember',
            delivered: true,
            at: at.toISOString()
        });
    });

    it('shows a payout in whole NURA with its transaction and state', () =>
    {
        expect(entryOf({
            ...face,
            avatar: 'a.png',
            kind: 'payout',
            id: 'p1',
            at,
            at_key: '1',
            source: null,
            source_key: null,
            amount: weiOf(4_200).toString(),
            wanted: null,
            item_id: null,
            delivered: null,
            state: 'failed',
            tx_hash: '0xabc',
            attempts: 5
        })).toEqual({
            kind: 'payout',
            id: 'p1',
            person: { handle: 'ada', displayName: 'Ada', hue: 120, avatar: 'a.png' },
            amount: 4_200,
            state: 'failed',
            hash: '0xabc',
            attempts: 5,
            at: at.toISOString()
        });
    });
});

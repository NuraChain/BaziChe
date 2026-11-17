import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import {
    createStreakReminder,
    REWARD_REMINDER_STREAK,
    reminderKey,
    reminderWindowOf,
    remindable,
    type ReminderFacts
} from '../src/domains/reward/reminder.ts';
import { rewardDayOf, type StreakRow } from '../src/domains/reward/rules.ts';

const at = (iso: string) => Date.parse(iso);

const TODAY = rewardDayOf(at('2026-11-16T12:00:00.000Z'));

const row = (patch: Partial<StreakRow> = {}): StreakRow => ({ streak: 5, run: 5, lastDay: TODAY - 1, best: 5, ...patch });

const facts = (patch: Partial<StreakRow> = {}, held: Partial<Omit<ReminderFacts, 'row'>> = {}): ReminderFacts =>
    ({ row: row(patch), frozen: false, suspended: false, ...held });

describe('when the streak reminder is sent', () =>
{
    it('opens at 20:00 of the reward day (16:30 UTC) and closes at 23:45 (20:15 UTC)', () =>
    {
        expect(reminderWindowOf(at('2026-11-16T16:29:59.999Z')).open).toBe(false);
        expect(reminderWindowOf(at('2026-11-16T16:30:00.000Z')).open).toBe(true);
        expect(reminderWindowOf(at('2026-11-16T20:14:59.999Z')).open).toBe(true);
        expect(reminderWindowOf(at('2026-11-16T20:15:00.000Z')).open).toBe(false);
        expect(reminderWindowOf(at('2026-11-16T20:30:00.000Z')).open).toBe(false);
    });

    it('belongs to the reward day it falls in, which ends at 20:30 UTC', () =>
    {
        expect(reminderWindowOf(at('2026-11-16T20:00:00.000Z')).day).toBe(rewardDayOf(at('2026-11-16T20:00:00.000Z')));
        expect(reminderWindowOf(at('2026-11-16T20:30:00.000Z')).day).toBe(reminderWindowOf(at('2026-11-16T20:00:00.000Z')).day + 1);
    });

    it('is one notification a reward day', () =>
    {
        expect(reminderKey(TODAY)).toBe(`reward-streak:${ TODAY }`);
        expect(reminderKey(TODAY)).not.toBe(reminderKey(TODAY + 1));
    });
});

describe('who the streak reminder is sent to', () =>
{
    it('a player who checked in yesterday with a live streak of 3 or more', () =>
    {
        expect(remindable(facts({ streak: REWARD_REMINDER_STREAK, run: REWARD_REMINDER_STREAK, best: REWARD_REMINDER_STREAK }), TODAY)).toBe(true);
        expect(remindable(facts({ streak: 30, run: 30, best: 30 }), TODAY)).toBe(true);
    });

    it('nobody whose streak is under 3', () =>
    {
        expect(remindable(facts({ streak: 2, run: 2, best: 9 }), TODAY)).toBe(false);
    });

    it('goes by the ladder streak the page shows, so a run that just wrapped past 30 is not told', () =>
    {
        expect(remindable(facts({ streak: 1, run: 31, best: 31 }), TODAY)).toBe(false);
        expect(remindable(facts({ streak: 3, run: 33, best: 33 }), TODAY)).toBe(true);
    });

    it('nobody who already checked in today', () =>
    {
        expect(remindable(facts({ lastDay: TODAY }), TODAY)).toBe(false);
    });

    it('nobody whose streak is already broken: a missed day has nothing left to keep', () =>
    {
        expect(remindable(facts({ lastDay: TODAY - 2 }), TODAY)).toBe(false);
    });

    it('nobody frozen or suspended', () =>
    {
        expect(remindable(facts({}, { frozen: true }), TODAY)).toBe(false);
        expect(remindable(facts({}, { suspended: true }), TODAY)).toBe(false);
    });
});

describe('the streak reminder sweep', () =>
{
    it('passes over a player who cannot be told, tells everyone after them, and counts the miss', async () =>
    {
        const EVENING = at('2026-11-16T17:00:00.000Z');
        const day = reminderWindowOf(EVENING).day;
        const players = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'];
        let after = '';
        const builder: Record<string, unknown> = {};
        for (const step of ['innerJoin', 'leftJoin', 'select', 'addSelect', 'where', 'orderBy', 'limit'])
        {
            builder[step] = () => builder;
        }
        builder.andWhere = (_sql: string, values: { after?: string }) =>
        {
            after = values.after ?? after;
            return builder;
        };
        builder.getRawMany = async () => players
            .filter((userId) => userId > after)
            .map((userId) => ({ userId, streak: 5, run: 5, lastDay: day - 1, best: 5, suspended: false, frozen: false }));
        const db = { getRepository: () => ({ createQueryBuilder: () => builder }) } as unknown as DataSource;
        const told: string[] = [];
        const reminder = createStreakReminder(db, {
            switchedOn: async () => true,
            tell: async (userId) =>
            {
                if (userId === players[1])
                {
                    throw new Error('notify failed');
                }
                told.push(userId);
                return true;
            }
        });

        expect(await reminder.sweep(60_000, EVENING)).toEqual({ told: 2, missed: 1 });
        expect(told).toEqual([players[0], players[2]]);
        expect(await reminder.sweep(60_000, EVENING)).toEqual({ told: 0, missed: 0 });
    });
});

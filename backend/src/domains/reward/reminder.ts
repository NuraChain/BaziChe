import type { DataSource } from 'typeorm';

import { RewardFreeze } from '../../entities/reward-freeze.entity.ts';
import { RewardStreak } from '../../entities/reward-streak.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { REWARD_DAY_MS, REWARD_EPOCH_MS, ladderView, rewardDayOf, type StreakRow } from './rules.ts';

/**
 * The reminder is sent from 20:00 to 23:45 of the reward day, which is Tehran's evening since the
 * day starts at Tehran's midnight. Earlier, most of the players it would reach check in that
 * evening anyway and it is only noise; later than 23:45, there is no time left to act on it.
 * Nearly four hours also lets a sweep that falls behind still reach everybody before the day ends.
 */
export const REWARD_REMINDER_FROM_MS = 20 * 60 * 60 * 1000;

export const REWARD_REMINDER_UNTIL_MS = (23 * 60 + 45) * 60 * 1000;

/** The live streak a missed day would cost before it is worth a reminder. */
export const REWARD_REMINDER_STREAK = 3;

/** Rows read in one statement: each one may be told, and telling is a few statements of its own. */
export const REWARD_REMINDER_BATCH = 200;

/** The reward day `now` falls in, and whether its reminder window is open. */
export const reminderWindowOf = (now: number) =>
{
    const into = ((now - REWARD_EPOCH_MS) % REWARD_DAY_MS + REWARD_DAY_MS) % REWARD_DAY_MS;

    return { day: rewardDayOf(now), open: into >= REWARD_REMINDER_FROM_MS && into < REWARD_REMINDER_UNTIL_MS };
};

export interface ReminderFacts
{
    row: StreakRow;
    frozen: boolean;
    suspended: boolean;
}

/** Whether a player is reminded on `today`: today's check-in still open, a live streak worth keeping, and nobody holding them back. */
export const remindable = (facts: ReminderFacts, today: number) =>
{
    const view = ladderView(facts.row, today);

    return view.claimable && view.streak >= REWARD_REMINDER_STREAK && !facts.frozen && !facts.suspended;
};

/** One notification a reward day at most, whatever retries or restarts send it again. */
export const reminderKey = (day: number) => `reward-streak:${ day }`;

const FIRST = '00000000-0000-0000-0000-000000000000';

export interface StreakReminderDeps
{
    switchedOn(): Promise<boolean>;

    /** Tells one player through the notify path (mutes respected); answers whether a notification was written. */
    tell(userId: string, dedupeKey: string): Promise<boolean>;
}

/**
 * Walks the players who checked in yesterday with a live streak, in user order, once a reward day.
 * Only yesterday's row can still be claimed today, so the set is fixed when the day starts: a walk
 * that reached the end has seen everybody, and the day asks nothing more of the database. A restart
 * walks it again, and the dedupe key turns every second notice into nothing.
 */
export function createStreakReminder(db: DataSource, deps: StreakReminderDeps)
{
    let walk = { day: 0, after: FIRST, done: false };

    const candidates = (yesterday: number, after: string) => db.getRepository(RewardStreak).createQueryBuilder('s')
        .innerJoin(User, 'u', 'u.id = s.user_id')
        .leftJoin(RewardFreeze, 'f', 'f.user_id = s.user_id')
        .select('s.user_id', 'userId')
        .addSelect('s.streak', 'streak')
        .addSelect('s.run', 'run')
        .addSelect('s.last_day', 'lastDay')
        .addSelect('s.best', 'best')
        .addSelect('u.is_suspended', 'suspended')
        .addSelect('f.user_id is not null', 'frozen')
        .where('s.last_day = :yesterday', { yesterday })
        .andWhere('s.user_id > :after', { after })
        .andWhere('s.streak >= :least', { least: REWARD_REMINDER_STREAK })
        .orderBy('s.user_id', 'ASC')
        .limit(REWARD_REMINDER_BATCH)
        .getRawMany<StreakRow & { userId: string; suspended: boolean; frozen: boolean }>();

    return {
        async sweep(forMs: number, now = Date.now())
        {
            const window = reminderWindowOf(now);

            if (walk.day !== window.day)
            {
                walk = { day: window.day, after: FIRST, done: false };
            }

            if (!window.open || walk.done || !await deps.switchedOn())
            {
                return { told: 0, missed: 0 };
            }

            const until = Date.now() + forMs;
            let told = 0;
            let missed = 0;

            while (!walk.done && Date.now() < until)
            {
                const rows = await candidates(window.day - 1, walk.after);

                for (const row of rows)
                {
                    // One player who cannot be told is passed over, or every later pass would stop at them
                    // and nobody after them would hear before the day ends.
                    try
                    {
                        if (remindable({ row, frozen: row.frozen, suspended: row.suspended }, window.day) && await deps.tell(row.userId, reminderKey(window.day)))
                        {
                            told += 1;
                        }
                    }
                    catch
                    {
                        missed += 1;
                    }

                    walk.after = row.userId;
                }

                walk.done = rows.length < REWARD_REMINDER_BATCH;
            }

            return { told, missed };
        }
    };
}

/**
 * Reward rules and constants. All of these are pure and deterministic so the server can use the
 * same numbers everywhere without consulting a browser or the local machine clock.
 */

export const REWARD_DAY_START_UTC_MINUTES = 20 * 60 + 30;
export const REWARD_CYCLE_DAYS = 30;
export const REWARD_CAP = 200_000;
export const REWARD_CYCLE_BUDGET = 25_000_000;

/**
 * The default reward amounts from the design doc; they sum to the hard cap and are owner-settable
 * through the admin settings, but the code defaults to these values.
 */
export const REWARD_DEFAULTS = {
    checkin: 50_000,
    bonus: 20_000,
    daily: 90_000,
    weekly: 40_000
} as const;

/** The 30-day reward ladder: a streak day can be worth 1,000 to 3,000 NURA plus a skin. */
export const REWARD_LADDER: number[] = [
    1000, 1000, 1000, 1000, 1000, 1000, 3000,
    1200, 1200, 1200, 1200, 1200, 1200, 4000,
    1500, 1500, 1500, 1500, 1500, 1500, 5000,
    1800, 1800, 1800, 1800, 1800, 1800, 3000,
    2000, 0
];

export const REWARD_DAY_MS = 24 * 60 * 60 * 1000;
export const REWARD_EPOCH_MS = Date.UTC(2024, 0, 1, 20, 30, 0);

/**
 * Returns the reward day number from a timestamp. The first reward day begins at 2024-01-01 20:30 UTC.
 * Times before that are day 0.
 */
export const rewardDayOf = (date: Date | number | string): number =>
{
    const time = date instanceof Date ? date.getTime() : new Date(date).getTime();

    if (!Number.isFinite(time))
    {
        return 0;
    }

    return Math.floor((time - REWARD_EPOCH_MS) / REWARD_DAY_MS) + 1;
};

/**
 * The reward cycle index and the day within a 30-day cycle. A cycle day 1-28 is in a quest week 1-4,
 * while 29-30 are daily-only days.
 */
export const cycleOf = (day: number): { cycle: number; day: number; week: number | null } =>
{
    const positive = Math.max(1, day);
    const cycle = Math.floor((positive - 1) / REWARD_CYCLE_DAYS);
    const dayInCycle = ((positive - 1) % REWARD_CYCLE_DAYS) + 1;
    const week = dayInCycle <= 28 ? Math.ceil(dayInCycle / 7) : null;

    return { cycle, day: dayInCycle, week };
};

/**
 * A claim is considered on the same day if the reward day number did not advance. For a next-day claim,
 * the streak steps up by one, wrapping after day 30 back to 1. Any gap resets it.
 */
export const nextStreak = (lastDay: number, today: number, streak: number): number =>
{
    if (today === lastDay)
    {
        return streak;
    }

    const consecutive = today === lastDay + 1 || (lastDay === REWARD_CYCLE_DAYS && today === 1);

    if (!consecutive)
    {
        return 1;
    }

    return streak >= REWARD_CYCLE_DAYS ? 1 : streak + 1;
};

/**
 * Clip a new grant so the player never exceeds the per-cycle NURA cap. A clipped-to-zero grant is still
 * recorded so the claim is not offered again.
 */
export const clip = (alreadyGranted: number, wanted: number, cap: number): number =>
{
    if (wanted <= 0)
    {
        return 0;
    }

    const remaining = Math.max(0, cap - alreadyGranted);
    return Math.min(wanted, remaining);
};

/**
 * By the end of cycle day d, at most budget * d / 30 may have been granted. This function returns the
 * current cumulative open limit at that point in the cycle.
 */
export const budgetOpen = (budget: number, cycleDay: number): number =>
{
    const day = Math.min(Math.max(0, cycleDay), REWARD_CYCLE_DAYS);
    return Math.floor((budget * day) / REWARD_CYCLE_DAYS);
};

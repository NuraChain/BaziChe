/**
 * Reward rules and constants. All of these are pure and deterministic so the server can use the
 * same numbers everywhere without consulting a browser or the local machine clock.
 */

import type { RewardRefusal } from './refusals.ts';

export const REWARD_DAY_START_UTC_MINUTES = 20 * 60 + 30;
export const REWARD_CYCLE_DAYS = 30;
export const REWARD_CAP = 200_000;
export const REWARD_CYCLE_BUDGET = 25_000_000;

export const WEI_PER_NURA = 10n ** 18n;

export const weiOf = (nura: number) => BigInt(nura) * WEI_PER_NURA;

export const nuraOf = (wei: string | bigint) => Number(BigInt(wei) / WEI_PER_NURA);

/** The 30-day reward ladder, by position: a streak day can be worth 1,000 to 5,000 NURA plus a skin. */
export const REWARD_LADDER: readonly number[] = [
    1000, 1000, 1000, 1000, 1000, 1000, 3000,
    1200, 1200, 1200, 1200, 1200, 1200, 4000,
    1500, 1500, 1500, 1500, 1500, 1500, 5000,
    1800, 1800, 1800, 1800, 1800, 1800, 3000,
    2000, 0
];

/** Everything a cycle pays, in whole NURA: the ladder by position, the 30-day bonus, one daily quest, one weekly quest and the weekly chest. */
export interface RewardAmounts
{
    ladder: readonly number[];
    bonus: number;
    daily: number;
    weekly: number;
    chest: number;
}

/** The amounts the owner has not changed. */
export const REWARD_AMOUNTS: RewardAmounts = {
    ladder: REWARD_LADDER,
    bonus: 20_000,
    daily: 1_000,
    weekly: 3_000,
    chest: 1_000
};

export const DAILY_QUESTS = 3;
export const WEEKLY_QUESTS = 3;
const QUEST_WEEKS = 4;

/** The ladder positions that give a look from the owner's pool, and the one that gives the cycle's exclusive look. */
const POOL_LOOK_POSITIONS: readonly number[] = [7, 14, 21, 28];
const EXCLUSIVE_LOOK_POSITION = REWARD_CYCLE_DAYS;

/**
 * What each source can pay one player in a cycle at most. The ladder wraps, so any 30 check-ins in
 * a row pay each position once: its sum is the most a cycle's check-ins pay, wrapping or not.
 */
export const perCycleOf = (amounts: RewardAmounts) => ({
    checkin: amounts.ladder.reduce((sum, one) => sum + one, 0),
    bonus: amounts.bonus,
    daily: DAILY_QUESTS * amounts.daily * REWARD_CYCLE_DAYS,
    weekly: (WEEKLY_QUESTS * amounts.weekly + amounts.chest) * QUEST_WEEKS
});

/** The most one player can be paid in a cycle with these amounts; a set above the cap is refused. */
export const mostPerCycle = (amounts: RewardAmounts) => Object.values(perCycleOf(amounts)).reduce((sum, one) => sum + one, 0);

/** What each source can pay one player in a cycle; together they are the cap. */
export const REWARD_DEFAULTS = perCycleOf(REWARD_AMOUNTS);

const wholeNura = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= REWARD_CAP;

/** A set of amounts the owner may write: a whole NURA for every one of them, a 30-day ladder, and at most the cap per cycle; anything else is none. */
export const amountsOf = (said: unknown): RewardAmounts | null =>
{
    if (typeof said !== 'object' || said === null)
    {
        return null;
    }

    const { ladder, bonus, daily, weekly, chest } = said as Record<string, unknown>;

    if (!Array.isArray(ladder) || ladder.length !== REWARD_CYCLE_DAYS || !ladder.every(wholeNura)
        || !wholeNura(bonus) || !wholeNura(daily) || !wholeNura(weekly) || !wholeNura(chest))
    {
        return null;
    }

    const amounts = { ladder: [...ladder], bonus, daily, weekly, chest };

    return mostPerCycle(amounts) <= REWARD_CAP ? amounts : null;
};

/** The most looks the pool may hold: the whole config then still fits its setting's 4,000 characters. */
export const REWARD_POOL_MOST = 40;

/** The `reward-config` setting as the server acts on it. */
export interface RewardConfig
{
    on: boolean;
    amounts: RewardAmounts;
    pool: string[];
    exclusive: string | null;
}

const isLook = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && !item.startsWith('bundle.');

/**
 * The `reward-config` setting, every part of it read on its own: switched off unless it says on,
 * the default amounts unless it holds a set the owner may write, and the looks that are looks. A
 * bundle is never owned, so it is never given.
 */
export const rewardConfigOf = (value: string | null): RewardConfig =>
{
    let config: unknown = null;

    try
    {
        config = value === null ? null : JSON.parse(value);
    }
    catch
    {
        config = null;
    }

    const said = typeof config === 'object' && config !== null ? config as Record<string, unknown> : {};

    return {
        on: said.on === true,
        amounts: amountsOf(said.amounts) ?? REWARD_AMOUNTS,
        pool: Array.isArray(said.pool) ? [...new Set(said.pool.filter(isLook))] : [],
        exclusive: isLook(said.exclusive) ? said.exclusive : null
    };
};

/** The setting's text for a config, in the one shape `rewardConfigOf` reads back. */
export const configText = (config: RewardConfig) => JSON.stringify({
    on: config.on,
    amounts: {
        ladder: [...config.amounts.ladder],
        bonus: config.amounts.bonus,
        daily: config.amounts.daily,
        weekly: config.amounts.weekly,
        chest: config.amounts.chest
    },
    pool: config.pool,
    exclusive: config.exclusive
});

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
 * The ladder position a check-in on `today` pays, from the absolute reward day of the last one and
 * the position it paid: the same day keeps it, the next day steps it (30 wraps to 1), a gap resets it.
 */
export const nextStreak = (lastDay: number, today: number, streak: number): number =>
{
    if (today === lastDay)
    {
        return streak;
    }

    if (today !== lastDay + 1)
    {
        return 1;
    }

    return streak >= REWARD_CYCLE_DAYS ? 1 : streak + 1;
};

interface DayPay
{
    position: number;
    amount: number;
    bonus: number;
    look?: 'weekly' | 'exclusive';
}

/** What a ladder position pays: its ladder amount, a pool look on the weekly skin days, the bonus and the exclusive look on 30. */
export const rewardForDay = (position: number, amounts: RewardAmounts): DayPay =>
{
    const look = position === EXCLUSIVE_LOOK_POSITION ? 'exclusive' : POOL_LOOK_POSITIONS.includes(position) ? 'weekly' : undefined;

    return {
        position,
        amount: amounts.ladder[position - 1] ?? 0,
        bonus: position === EXCLUSIVE_LOOK_POSITION ? amounts.bonus : 0,
        ...(look === undefined ? {} : { look })
    };
};

/** A player's `reward_streaks` row: ladder position, consecutive days, last absolute reward day, longest run. */
export interface StreakRow
{
    streak: number;
    run: number;
    lastDay: number;
    best: number;
}

type CheckInStep =
    | { claimable: false; position: number }
    | { claimable: true; position: number; run: number; best: number };

type CheckInPlan =
    | { claimable: false; position: number }
    | { claimable: true; position: number; run: number; best: number; pay: DayPay };

const stepOf = (row: StreakRow | null, today: number): CheckInStep =>
{
    const held = row ?? { streak: 0, run: 0, lastDay: 0, best: 0 };

    // A last day ahead of today is a clock that went back: claiming would rewrite the streak backwards.
    if (held.lastDay >= today)
    {
        return { claimable: false, position: held.streak };
    }

    const position = nextStreak(held.lastDay, today, held.streak);
    const run = today === held.lastDay + 1 ? held.run + 1 : 1;

    return { claimable: true, position, run, best: Math.max(held.best, run) };
};

/** What a check-in on `today` would write and pay, from the player's streak row (none before the first). */
export const planCheckIn = (row: StreakRow | null, today: number, amounts: RewardAmounts): CheckInPlan =>
{
    const step = stepOf(row, today);

    return step.claimable ? { ...step, pay: rewardForDay(step.position, amounts) } : step;
};

/**
 * The ladder as the page draws it today: the live streak (0 once a day was missed), the position
 * today pays or paid, and how many positions from 1 count as claimed. A streak that finished 30
 * yesterday starts a new lap, so nothing of it shows as claimed.
 */
export const ladderView = (row: StreakRow | null, today: number) =>
{
    const plan = stepOf(row, today);
    const alive = row !== null && (row.lastDay === today || row.lastDay === today - 1);

    return {
        streak: alive ? row.streak : 0,
        position: plan.position,
        claimable: plan.claimable,
        claimed: plan.claimable ? plan.position - 1 : plan.position
    };
};

/** How much of `wanted` fits under `limit` once `already` is spent; never below 0. */
export const clip = (already: bigint, wanted: bigint, limit: bigint): bigint =>
{
    if (wanted <= 0n)
    {
        return 0n;
    }

    const remaining = limit > already ? limit - already : 0n;

    return wanted < remaining ? wanted : remaining;
};

/**
 * By the end of cycle day d, at most budget * d / 30 may have been granted. This function returns the
 * current cumulative open limit at that point in the cycle, in the budget's unit.
 */
export const budgetOpen = (budget: bigint, cycleDay: number): bigint =>
{
    const day = Math.min(Math.max(0, Math.trunc(cycleDay)), REWARD_CYCLE_DAYS);

    return budget * BigInt(day) / BigInt(REWARD_CYCLE_DAYS);
};

interface GrantFacts
{
    wanted: bigint;
    playerGranted: bigint;
    cap: bigint;
    cycleGranted: bigint;
    budget: bigint;
    cycleDay: number;
}

/** What a grant may pay, all in wei: the least of what it wants, what the player's cap leaves and what the day's budget leaves. */
export const grantAward = (facts: GrantFacts): { amount: bigint; clipped?: 'reward-cap' | 'reward-budget' } =>
{
    const wanted = facts.wanted > 0n ? facts.wanted : 0n;
    const capLeft = clip(facts.playerGranted, wanted, facts.cap);
    const budgetLeft = clip(facts.cycleGranted, wanted, budgetOpen(facts.budget, facts.cycleDay));
    const amount = capLeft < budgetLeft ? capLeft : budgetLeft;

    if (amount === wanted)
    {
        return { amount };
    }

    return { amount, clipped: capLeft <= budgetLeft ? 'reward-cap' : 'reward-budget' };
};

export interface EligibilityFacts
{
    established: boolean;
    wallet: string | null;
    minor: boolean;
    suspended: boolean;
    frozen: boolean;
}

/** Rule 7, and the staff's freeze: why this player may not earn NURA, or nothing when they may. */
export const eligibilityOf = (facts: EligibilityFacts): RewardRefusal | undefined =>
{
    if (facts.suspended)
    {
        return 'reward-suspended';
    }

    if (facts.frozen)
    {
        return 'reward-frozen';
    }

    if (facts.minor)
    {
        return 'reward-minor';
    }

    if (!facts.established)
    {
        return 'not-established';
    }

    return facts.wallet === null ? 'reward-no-wallet' : undefined;
};

/**
 * What a quest claim does for this player. Frozen: refused whole, so the quest stays claimable once
 * thawed. Anyone else rule 7 refuses still claims, and with it the chest's look, at 0 NURA.
 */
export const questClaimGate = (facts: EligibilityFacts | undefined): { refused: RewardRefusal } | { withheld?: RewardRefusal } =>
{
    if (facts === undefined)
    {
        return { withheld: 'not-established' };
    }

    if (facts.frozen)
    {
        return { refused: 'reward-frozen' };
    }

    const withheld = eligibilityOf(facts);

    return withheld === undefined ? {} : { withheld };
};

/** The most whole NURA the `reward-budget` setting can say: twelve digits. */
export const REWARD_BUDGET_MOST = 999_999_999_999;

/** The `reward-budget` setting in whole NURA: digits; anything else is the default. */
export const budgetNuraOf = (value: string | null) =>
{
    const said = value?.trim() ?? '';

    return /^\d{1,12}$/.test(said) ? Number(said) : REWARD_CYCLE_BUDGET;
};

/** The `reward-budget` setting in wei. */
export const budgetOf = (value: string | null): bigint => weiOf(budgetNuraOf(value));

/** One look from the pool, the same for the same seed, so a retry gives what the first try would have. */
export const pickLook = (pool: readonly string[], seed: string): string | null =>
{
    if (pool.length === 0)
    {
        return null;
    }

    const hash = [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);

    return pool[hash % pool.length];
};

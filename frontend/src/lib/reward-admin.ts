import { mostPerCycle, perCycleOf, REWARD_CAP, REWARD_CYCLE_DAYS, type RewardAmounts } from '../../../backend/src/domains/reward/rules.ts';
import { wholeNuraOf } from './nura.ts';

/** The amounts form as the owner types it: every field stays text until the set is sent. */
export interface TypedAmounts
{
    ladder: readonly string[];
    bonus: string;
    daily: string;
    weekly: string;
    chest: string;
}

export type AmountField = 'bonus' | 'daily' | 'weekly' | 'chest';

export const AMOUNT_FIELDS: readonly AmountField[] = ['bonus', 'daily', 'weekly', 'chest'];

/** What the typed set comes to: the amounts when they may be sent, the most per cycle once every field reads, and which fields do not. */
export interface AmountsRead
{
    amounts: RewardAmounts | null;
    most: number | null;
    bySource: ReturnType<typeof perCycleOf> | null;
    over: boolean;

    /** `ladder.<position>` for a ladder day, or the field's own name. */
    bad: readonly string[];
}

export const typedAmounts = (amounts: RewardAmounts): TypedAmounts => ({
    ladder: amounts.ladder.map(String),
    bonus: String(amounts.bonus),
    daily: String(amounts.daily),
    weekly: String(amounts.weekly),
    chest: String(amounts.chest)
});

export function readAmounts(typed: TypedAmounts): AmountsRead
{
    const ladder = typed.ladder.map((one) => wholeNuraOf(one, REWARD_CAP));
    const fields = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, wholeNuraOf(typed[field], REWARD_CAP)])) as Record<AmountField, number | null>;
    const bad = [
        ...ladder.flatMap((one, at) => (one === null ? [`ladder.${ at + 1 }`] : [])),
        ...(ladder.length === REWARD_CYCLE_DAYS ? [] : ['ladder']),
        ...AMOUNT_FIELDS.filter((field) => fields[field] === null)
    ];

    if (bad.length > 0)
    {
        return { amounts: null, most: null, bySource: null, over: false, bad };
    }

    const amounts: RewardAmounts = {
        ladder: ladder as number[],
        bonus: fields.bonus as number,
        daily: fields.daily as number,
        weekly: fields.weekly as number,
        chest: fields.chest as number
    };
    const most = mostPerCycle(amounts);
    const over = most > REWARD_CAP;

    return { amounts: over ? null : amounts, most, bySource: perCycleOf(amounts), over, bad: [] };
}

export const sameAmounts = (one: RewardAmounts, other: RewardAmounts) =>
    one.ladder.length === other.ladder.length
    && one.ladder.every((amount, at) => amount === other.ladder[at])
    && AMOUNT_FIELDS.every((field) => one[field] === other[field]);

/** How much of `whole` is `part`, as a whole percent for a bar; nothing of nothing is none, something of nothing is all. */
export const shareOf = (part: number, whole: number) => (whole <= 0 ? (part > 0 ? 100 : 0) : Math.max(0, Math.min(100, Math.round((part / whole) * 100))));

/** The pool as the owner edits it: a look added once, at the end; one taken out wherever it was. */
export const poolWith = (pool: readonly string[], look: string) => (pool.includes(look) ? [...pool] : [...pool, look]);

export const poolWithout = (pool: readonly string[], look: string) => pool.filter((one) => one !== look);

export const samePool = (one: readonly string[], other: readonly string[]) => one.length === other.length && one.every((look, at) => look === other[at]);

export const MINUTE_MS = 60_000;

export const HOUR_MINUTES = 60;

export const DELAY_MINUTES = 5;

/** The longest delay kept as itself; a longer one is counted as this. */
export const DELAY_MOST_MS = 60_000;

/** Counts by key a minute at a time for an hour, and since the ring began. */
export function minuteCounts<K extends string>(now: () => number)
{
    const slots: ({ minute: number; counts: Map<K, number> } | undefined)[] = [];
    const totals = new Map<K, number>();

    return {
        add(key: K, by = 1)
        {
            const minute = Math.floor(now() / MINUTE_MS);
            const at = minute % HOUR_MINUTES;
            const slot = slots[at]?.minute === minute ? slots[at] : { minute, counts: new Map<K, number>() };

            slot.counts.set(key, (slot.counts.get(key) ?? 0) + by);
            slots[at] = slot;
            totals.set(key, (totals.get(key) ?? 0) + by);
        },

        /** Every count of the last `minutes`, this one included. */
        within(minutes: number)
        {
            const from = Math.floor(now() / MINUTE_MS) - minutes;
            const summed = new Map<K, number>();

            for (const slot of slots)
            {
                if (slot !== undefined && slot.minute > from)
                {
                    slot.counts.forEach((count, key) => summed.set(key, (summed.get(key) ?? 0) + count));
                }
            }

            return summed;
        },

        totals: () => new Map(totals)
    };
}

/** A delay as it is kept: to the millisecond under a second, to ten above, never past a minute. */
export const grainOf = (ms: number) =>
{
    const clamped = Math.min(DELAY_MOST_MS, Math.max(0, ms));

    return clamped < 1000 ? Math.round(clamped) : Math.round(clamped / 10) * 10;
};

/** The value at or under which `share` of the counted values fall, by nearest rank. */
export function nearestRank(counts: ReadonlyMap<number, number>, share: number)
{
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

    if (total === 0)
    {
        return 0;
    }

    const rank = Math.max(1, Math.ceil(share * total));
    let seen = 0;

    for (const value of [...counts.keys()].sort((a, b) => a - b))
    {
        seen += counts.get(value) ?? 0;

        if (seen >= rank)
        {
            return value;
        }
    }

    return 0;
}

export interface Delays
{
    frames: number;
    p50: number;
    p95: number;
    p99: number;
}

/** Delays in milliseconds, counted per grain a minute at a time for five minutes. */
export function delayWindow(now: () => number)
{
    const slots: ({ minute: number; counts: Map<number, number> } | undefined)[] = [];
    let count = 0;
    let sum = 0;

    return {
        add(ms: number)
        {
            const minute = Math.floor(now() / MINUTE_MS);
            const at = minute % DELAY_MINUTES;
            const slot = slots[at]?.minute === minute ? slots[at] : { minute, counts: new Map<number, number>() };
            const grain = grainOf(ms);

            slot.counts.set(grain, (slot.counts.get(grain) ?? 0) + 1);
            slots[at] = slot;
            count += 1;
            sum += Math.max(0, ms);
        },

        /** p50, p95 and p99 of the last five minutes, or null when no frame was handed out in them. */
        within(): Delays | null
        {
            const from = Math.floor(now() / MINUTE_MS) - DELAY_MINUTES;
            const merged = new Map<number, number>();

            for (const slot of slots)
            {
                if (slot !== undefined && slot.minute > from)
                {
                    slot.counts.forEach((seen, value) => merged.set(value, (merged.get(value) ?? 0) + seen));
                }
            }

            const frames = [...merged.values()].reduce((total, seen) => total + seen, 0);

            return frames === 0
                ? null
                : { frames, p50: nearestRank(merged, 0.5), p95: nearestRank(merged, 0.95), p99: nearestRank(merged, 0.99) };
        },

        /** Every delay since the window began: how many, and their sum in milliseconds. */
        totals: () => ({ count, sum })
    };
}

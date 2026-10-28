import { describe, expect, it } from 'vitest';

import { DELAY_MOST_MS, MINUTE_MS, delayWindow, grainOf, minuteCounts, nearestRank } from '../src/ops/rings.ts';

const clock = (start = 1_800_000_000_000) =>
{
    let at = start;

    return { now: () => at, pass: (ms: number) => (at += ms) };
};

describe('counts a minute at a time', () =>
{
    it('sums the minutes asked for, this one included, and keeps a total from the start', () =>
    {
        const time = clock();
        const counts = minuteCounts<'a' | 'b'>(time.now);

        counts.add('a');
        time.pass(MINUTE_MS);
        counts.add('a', 2);
        counts.add('b');
        time.pass(MINUTE_MS);
        counts.add('a', 4);

        expect(Object.fromEntries(counts.within(1))).toEqual({ a: 4 });
        expect(Object.fromEntries(counts.within(2))).toEqual({ a: 6, b: 1 });
        expect(Object.fromEntries(counts.within(60))).toEqual({ a: 7, b: 1 });
        expect(Object.fromEntries(counts.totals())).toEqual({ a: 7, b: 1 });
    });

    it('forgets a minute an hour old, and reuses its slot without carrying it', () =>
    {
        const time = clock();
        const counts = minuteCounts<'a'>(time.now);

        counts.add('a', 5);
        time.pass(60 * MINUTE_MS);
        counts.add('a');

        expect(Object.fromEntries(counts.within(60))).toEqual({ a: 1 });
        expect(Object.fromEntries(counts.totals())).toEqual({ a: 6 });
    });
});

describe('delays, to their grain', () =>
{
    it('keeps a delay under a second to the millisecond, one above to ten, and none past a minute', () =>
    {
        expect([0, 12.4, 999.4, 1004, 1006, 59_999, 120_000, -5].map(grainOf)).toEqual([0, 12, 999, 1000, 1010, 60_000, DELAY_MOST_MS, 0]);
    });

    it('answers the nearest rank: the smallest value at or under which the share falls', () =>
    {
        const counts = new Map([[10, 50], [20, 45], [300, 4], [2000, 1]]);

        expect([0.5, 0.95, 0.96, 0.99, 1].map((share) => nearestRank(counts, share))).toEqual([10, 20, 300, 300, 2000]);
        expect(nearestRank(new Map(), 0.5)).toBe(0);
        expect(nearestRank(new Map(Array.from({ length: 10 }, (_, at) => [at + 1, 1])), 0.95), 'a rank between two values is the higher').toBe(10);
    });

    it('reuses a minute\'s slot five minutes on without carrying what it held', () =>
    {
        const time = clock();
        const window = delayWindow(time.now);

        window.add(400);
        time.pass(5 * MINUTE_MS);
        window.add(20);

        expect(window.within()).toEqual({ frames: 1, p50: 20, p95: 20, p99: 20 });
    });

    it('answers p50, p95 and p99 of the last five minutes, and nothing once they have passed', () =>
    {
        const time = clock();
        const window = delayWindow(time.now);

        for (let at = 0; at < 100; at += 1)
        {
            window.add(at < 90 ? 10 : 1500);
        }

        expect(window.within()).toEqual({ frames: 100, p50: 10, p95: 1500, p99: 1500 });

        time.pass(4 * MINUTE_MS);
        window.add(20);

        expect(window.within()?.frames).toBe(101);

        time.pass(MINUTE_MS);

        expect(window.within(), 'the first minute has left the window').toEqual({ frames: 1, p50: 20, p95: 20, p99: 20 });

        time.pass(5 * MINUTE_MS);

        expect(window.within()).toBeNull();
        expect(window.totals()).toEqual({ count: 101, sum: 90 * 10 + 10 * 1500 + 20 });
    });
});

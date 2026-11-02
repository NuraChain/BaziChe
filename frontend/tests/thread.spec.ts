import { describe, expect, it } from 'vitest';

import type { Message } from '../src/data/chat.ts';
import { GROUP_GAP_MS, dayKindOf, seenKindOf, stampKindOf, threadRows } from '../src/lib/thread.ts';

const NOON = new Date(2026, 8, 23, 12, 0).getTime();

function line(id: string, from: string, at: number, kind: Message['kind'] = 'text')
{
    return { id, conversationId: 'c', from, kind, text: id, at } as Message;
}

describe('a thread in groups', () =>
{
    it('stacks one person’s run under one head and one tail, and starts again when somebody else speaks', () =>
    {
        const rows = threadRows([
            line('a', 'omid', NOON),
            line('b', 'omid', NOON + 1000),
            line('c', 'omid', NOON + 2000),
            line('d', 'dana', NOON + 3000)
        ]);

        expect(rows.map((row) => [row.first, row.last])).toEqual([[true, false], [false, false], [false, true], [true, true]]);
    });

    it('breaks a run that went quiet for longer than the gap', () =>
    {
        const rows = threadRows([line('a', 'omid', NOON), line('b', 'omid', NOON + GROUP_GAP_MS + 1)]);

        expect(rows.map((row) => row.first)).toEqual([true, true]);
    });

    it('never folds a line the server wrote into somebody’s run', () =>
    {
        const rows = threadRows([line('a', 'omid', NOON), line('b', 'omid', NOON + 10, 'system'), line('c', 'omid', NOON + 20)]);

        expect(rows.map((row) => row.first)).toEqual([true, true, true]);
    });

    it('folds a voice message into its sender’s run, as a line of words is', () =>
    {
        const rows = threadRows([line('a', 'omid', NOON), line('b', 'omid', NOON + 10, 'voice'), line('c', 'omid', NOON + 20)]);

        expect(rows.map((row) => [row.first, row.last])).toEqual([[true, false], [false, false], [false, true]]);
    });

    it('puts a day divider before the first line of every day, and nowhere else', () =>
    {
        const rows = threadRows([
            line('a', 'omid', NOON - 24 * 3600 * 1000),
            line('b', 'omid', NOON),
            line('c', 'omid', NOON + 60_000)
        ]);

        expect(rows.map((row) => row.day)).toEqual([true, true, false]);
        expect(rows[1].first).toBe(true);
    });

    it('names today and yesterday, and leaves anything older to the calendar', () =>
    {
        expect(dayKindOf(NOON - 3600 * 1000, NOON)).toBe('today');
        expect(dayKindOf(NOON - 24 * 3600 * 1000, NOON)).toBe('yesterday');
        expect(dayKindOf(NOON - 3 * 24 * 3600 * 1000, NOON)).toBe('older');
    });
});

describe('an album in the thread', () =>
{
    const item = (id: string, from: string, at: number, album: string, place: number, of: number) =>
        ({ ...line(id, from, at, 'file'), album: { id: album, at: place, of, holds: 'photo' } }) as Message;

    it('is one row, the row of its first item, holding every item in its place, inside its sender’s run', () =>
    {
        const rows = threadRows([
            line('a', 'omid', NOON),
            item('p1', 'omid', NOON + 1, 'A', 0, 3),
            item('p2', 'omid', NOON + 2, 'A', 1, 3),
            item('p3', 'omid', NOON + 3, 'A', 2, 3),
            line('b', 'omid', NOON + 4)
        ]);

        expect(rows.map((row) => row.message.id)).toEqual(['a', 'p1', 'b']);
        expect(rows[1].items.map((one) => one.id)).toEqual(['p1', 'p2', 'p3']);
        expect([rows[0].items, rows[2].items], 'a line alone holds none').toEqual([[], []]);
        expect(rows.map((row) => [row.first, row.last])).toEqual([[true, false], [false, false], [false, true]]);
    });

    it('puts its items in their places whatever order they came in, and leads with the first of them', () =>
    {
        const rows = threadRows([item('p2', 'omid', NOON, 'A', 1, 2), item('p1', 'omid', NOON + 1, 'A', 0, 2)]);

        expect(rows.map((row) => row.message.id)).toEqual(['p1']);
        expect(rows[0].items.map((one) => one.id)).toEqual(['p1', 'p2']);
    });

    it('draws an item alone whose album has no other item here', () =>
    {
        const rows = threadRows([item('p1', 'omid', NOON, 'A', 0, 3), line('x', 'omid', NOON + 1)]);

        expect(rows.map((row) => [row.message.id, row.items.length])).toEqual([['p1', 0], ['x', 0]]);
    });

    it('never folds two albums together, or one sender’s item into another’s album', () =>
    {
        const rows = threadRows([
            item('p1', 'omid', NOON, 'A', 0, 2),
            item('p2', 'omid', NOON + 1, 'A', 1, 2),
            item('q1', 'omid', NOON + 2, 'B', 0, 2),
            item('q2', 'omid', NOON + 3, 'B', 1, 2),
            item('r1', 'dana', NOON + 4, 'B', 0, 2)
        ]);

        expect(rows.map((row) => [row.message.id, row.items.map((one) => one.id)])).toEqual([['p1', ['p1', 'p2']], ['q1', ['q1', 'q2']], ['r1', []]]);
    });

    it('measures the day and the run after it from its last item', () =>
    {
        const late = new Date(2026, 8, 23, 23, 59, 59, 0).getTime();
        const rows = threadRows([item('p1', 'omid', late, 'A', 0, 2), item('p2', 'omid', late + 2000, 'A', 1, 2), line('n', 'omid', late + 2001)]);

        expect(rows.map((row) => row.day), 'the line after it is on the day its last item was').toEqual([true, false]);
        expect(rows.map((row) => [row.first, row.last]), 'and in the same run').toEqual([[true, false], [false, true]]);
    });
});

describe('when the list says a room was last spoken in', () =>
{
    const at = (month: number, day: number, hour: number, minute = 0, year = 2026) => new Date(year, month, day, hour, minute).getTime();

    it('says the time of a line from today, whatever hour it was', () =>
    {
        expect(stampKindOf(at(8, 23, 0, 1), NOON)).toBe('time');
        expect(stampKindOf(at(8, 23, 11, 59), NOON)).toBe('time');
        expect(stampKindOf(NOON + 5000, NOON), 'a clock a little behind the line is still today').toBe('time');
        expect(stampKindOf(at(8, 24, 0, 0) + 1000, at(8, 23, 23, 59)), 'and a line dated tomorrow by a clock behind it').toBe('time');
    });

    it('says the weekday of a line from the six days before today, from just before midnight', () =>
    {
        expect(stampKindOf(at(8, 22, 23, 59), NOON)).toBe('weekday');
        expect(stampKindOf(at(8, 17, 12), NOON)).toBe('weekday');
    });

    it('says the date of a line a week old or more, and its year once it is a year old', () =>
    {
        expect(stampKindOf(at(8, 16, 12), NOON), 'a week ago has today’s weekday, so it is a date').toBe('date');
        expect(stampKindOf(at(8, 24, 12, 0, 2025), NOON)).toBe('date');
        expect(stampKindOf(at(8, 23, 12, 0, 2025), NOON)).toBe('year');
    });
});

describe('when somebody was last seen', () =>
{
    const MINUTE = 60_000;

    it('was just now for under a minute, and for a clock that is behind', () =>
    {
        expect(seenKindOf(NOON - 30_000, NOON)).toBe('now');
        expect(seenKindOf(NOON - MINUTE + 1, NOON)).toBe('now');
        expect(seenKindOf(NOON + 20_000, NOON)).toBe('now');
    });

    it('is so many minutes ago for under an hour, across midnight too', () =>
    {
        expect(seenKindOf(NOON - MINUTE, NOON)).toBe('minutes');
        expect(seenKindOf(NOON - 59 * MINUTE, NOON)).toBe('minutes');

        const late = new Date(2026, 8, 24, 0, 30).getTime();

        expect(seenKindOf(late - 40 * MINUTE, late)).toBe('minutes');
    });

    it('is today or yesterday at a time from an hour on, and a date before that', () =>
    {
        expect(seenKindOf(NOON - 60 * MINUTE, NOON)).toBe('today');
        expect(seenKindOf(new Date(2026, 8, 23, 0, 5).getTime(), NOON)).toBe('today');
        expect(seenKindOf(new Date(2026, 8, 22, 23, 0).getTime(), NOON)).toBe('yesterday');
        expect(seenKindOf(new Date(2026, 8, 21, 23, 0).getTime(), NOON)).toBe('date');
        expect(seenKindOf(new Date(2025, 8, 23, 12, 0).getTime(), NOON)).toBe('year');
    });
});

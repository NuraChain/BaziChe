import type { Message } from '../data/chat.ts';

export const GROUP_GAP_MS = 5 * 60 * 1000;

export interface ThreadRow
{
    message: Message;

    /** The photos and videos of an album drawn as this one row, in their places; none for a line alone. */
    items: readonly Message[];
    first: boolean;
    last: boolean;
    day: boolean;
}

export type DayKind = 'today' | 'yesterday' | 'older';

function dayKey(at: number)
{
    const date = new Date(at);

    return `${ date.getFullYear() }-${ date.getMonth() }-${ date.getDate() }`;
}

/** A line somebody said, in words, in their voice or as a file; the server's own lines never join a run. */
const said = (message: Message) => message.kind === 'text' || message.kind === 'voice' || message.kind === 'file';

function joins(earlier: Message | undefined, later: Message | undefined)
{
    return earlier !== undefined
        && later !== undefined
        && said(earlier)
        && said(later)
        && earlier.from === later.from
        && later.at - earlier.at <= GROUP_GAP_MS
        && dayKey(earlier.at) === dayKey(later.at);
}

interface Folded
{
    message: Message;
    items: Message[];
}

/**
 * One sender's items of one album, side by side in the thread, are one row, the row of the first of
 * them (MS-D46): its caption, its reply and its reactions are the first item's. An item whose album
 * has no other item here is a line alone.
 */
function fold(messages: readonly Message[])
{
    const rows: Folded[] = [];

    for (const message of messages)
    {
        const held = rows.at(-1);
        const album = message.album?.id;

        if (album !== undefined && held !== undefined && held.message.album?.id === album && held.message.from === message.from)
        {
            held.items.push(message);
        }
        else
        {
            rows.push({ message, items: [message] });
        }
    }

    return rows.map((row): Folded =>
    {
        if (row.items.length < 2)
        {
            return { message: row.message, items: [] };
        }

        const items = [...row.items].sort((a, b) => (a.album?.at ?? 0) - (b.album?.at ?? 0));

        return { message: items[0], items };
    });
}

export function threadRows(messages: readonly Message[]): ThreadRow[]
{
    const rows = fold(messages);
    const at = (index: number): Folded | undefined => rows[index];
    const tail = (row: Folded) => row.items.at(-1) ?? row.message;

    return rows.map((row, index) =>
    {
        const before = at(index - 1);

        return {
            message: row.message,
            items: row.items,
            day: before === undefined || dayKey(tail(before).at) !== dayKey(row.message.at),
            first: !joins(before === undefined ? undefined : tail(before), row.message),
            last: !joins(tail(row), at(index + 1)?.message)
        };
    });
}

export function dayKindOf(at: number, now: number): DayKind
{
    if (dayKey(at) === dayKey(now))
    {
        return 'today';
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    return dayKey(at) === dayKey(yesterday.getTime()) ? 'yesterday' : 'older';
}

const MINUTE_MS = 60_000;

/** Whole days between the reader's day of `at` and of `now`: 0 is today and 1 yesterday, whatever the clocks changed by. */
function daysBack(at: number, now: number)
{
    const day = (stamp: number) =>
    {
        const date = new Date(stamp);

        return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (24 * 60 * MINUTE_MS);
    };

    return day(now) - day(at);
}

export type StampKind = 'time' | 'weekday' | 'date' | 'year';

/** How the list says when a room's last line was: its time today, its weekday this week, its date before that. */
export function stampKindOf(at: number, now: number): StampKind
{
    const back = daysBack(at, now);

    if (back <= 0)
    {
        return 'time';
    }

    if (back < 7)
    {
        return 'weekday';
    }

    return back < 365 ? 'date' : 'year';
}

export type SeenKind = 'now' | 'minutes' | 'today' | 'yesterday' | 'date' | 'year';

/** How "last seen" is said: just now, so many minutes ago, today or yesterday at a time, or a date. */
export function seenKindOf(at: number, now: number): SeenKind
{
    if (now - at < MINUTE_MS)
    {
        return 'now';
    }

    if (now - at < 60 * MINUTE_MS)
    {
        return 'minutes';
    }

    const back = daysBack(at, now);

    if (back <= 0)
    {
        return 'today';
    }

    if (back === 1)
    {
        return 'yesterday';
    }

    return back < 365 ? 'date' : 'year';
}

import { createStore, getOwner, onCleanup } from 'azerothjs';

import { SEE_MOST } from '../../../backend/src/realtime/frames.ts';
import type { PresenceEntry } from '../api.ts';
import { runtime } from '../lib/runtime.ts';
import { useRealtime } from './realtime.store.ts';

/** How long the people a page shows must stay put before the server is told who they are now. */
export const SEE_PAUSE_MS = 300;

export type PresenceState = 'online' | 'away' | 'offline';

export interface Presence
{
    state: PresenceState;
    since: number;
    known: boolean;
}

const UNKNOWN: Presence = { state: 'offline', since: 0, known: false };

export interface PresenceApi
{
    of(id: string): Presence;

    dot(id: string): PresenceState | null;

    /** Whether a snapshot of who is here is in hand: without one, nobody can be said to have gone. */
    ready(): boolean;

    isOnline(id: string): boolean;
    online(ids: readonly string[]): string[];
    refresh(): void;
    reset(): void;
}

export const usePresence = createStore((): PresenceApi =>
{
    const live = useRealtime();

    let from: PresenceEntry[] | null = null;
    let index: Map<string, Presence> | null = null;

    const current = (): Map<string, Presence> | null =>
    {
        const people = live.presence();
        if (people === null)
        {
            from = null;
            index = null;
            return null;
        }
        if (people !== from)
        {
            from = people;
            index = new Map(people.map((entry) =>
                [entry.who, { state: entry.state, since: entry.since, known: true }]));
        }
        return index;
    };

    /**
     * Whom the page shows, counted by the reads that draw them. A read inside a render or a
     * derived holds its person until that runs again or goes (`onCleanup`), so the server is told
     * about the people on screen and nobody else; a read in a handler holds nobody. They are kept
     * in the order they were first shown, and the newest are told when there are more than a frame
     * may name. A read from before a reset lets go of nothing after it.
     */
    const shown = new Map<string, number>();
    let said = '';
    let cancel: (() => void) | null = null;
    let era = 0;

    const tell = () =>
    {
        cancel = null;

        for (const [id, count] of [...shown])
        {
            if (count <= 0)
            {
                shown.delete(id);
            }
        }

        const who = [...shown.keys()].slice(-SEE_MOST);
        const key = [...who].sort().join(' ');

        if (key !== said)
        {
            said = key;
            live.see(who);
        }
    };

    const changed = () =>
    {
        cancel ??= runtime().clock.after(SEE_PAUSE_MS, tell);
    };

    const hold = (id: string) =>
    {
        if (getOwner() === null)
        {
            return;
        }

        const at = era;
        const count = shown.get(id) ?? 0;

        shown.set(id, count + 1);

        if (count <= 0)
        {
            changed();
        }

        onCleanup(() =>
        {
            if (at !== era)
            {
                return;
            }

            const left = (shown.get(id) ?? 1) - 1;

            shown.set(id, left);

            if (left <= 0)
            {
                changed();
            }
        });
    };

    const of = (id: string) =>
    {
        hold(id);

        return current()?.get(id) ?? UNKNOWN;
    };

    const up = (id: string) => of(id).state === 'online';

    return {
        of,
        dot: (id) => (of(id).known ? of(id).state : null),
        ready: () => live.presence() !== null,
        isOnline: up,
        online: (ids) => ids.filter(up),
        refresh: () => live.sync(),

        reset()
        {
            from = null;
            index = null;
            shown.clear();
            said = '';
            cancel?.();
            cancel = null;
            era += 1;
        }
    };
});

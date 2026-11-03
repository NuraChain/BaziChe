import { createSignal, createStore, type Getter } from 'azerothjs';

import { client, type CallHistory } from '../api.ts';
import type { Reading } from '../lib/reading.ts';
import { usePeople } from './people.store.ts';
import { useRealtime } from './realtime.store.ts';

/** A call the reader took part in that has ended, as the Calls tab lists it. */
export type CallRecord = CallHistory['calls'][number];

export interface CallHistoryApi
{
    /** The reader's calls that ended, newest first: every page read since the first was last read. */
    calls: Getter<CallRecord[]>;

    /** Where the first page stands. Once it has answered it stays read, a later read that fails said beside it. */
    reading: Getter<Reading>;
    failure: Getter<unknown>;

    /** Whether older calls are still to be read, and whether a page of them is being read. */
    hasMore: Getter<boolean>;
    paging: Getter<boolean>;

    /** The last older page was refused; Show more is the retry. */
    moreFailure: Getter<unknown>;

    /**
     * Reads the first page for as long as the answer is not called, and reads it again whenever the
     * reader's calls change (the `me` scope's `calls`, and every scope at once when the socket comes
     * back), dropping the older pages read before it. Once nothing shows the list it is let go of,
     * so the next account signed in on the page is never shown the last one's calls.
     */
    open(): () => void;

    more(): Promise<void>;
    refresh(): void;
    reset(): void;
}

/**
 * The Calls tab's list (MS-D39). Nothing here is guessed: a call is listed once the server has it
 * as ended, and a read that fails keeps what was on screen and says it failed, never that there
 * were no calls.
 */
export const useCallHistory = createStore((): CallHistoryApi =>
{
    const people = usePeople();
    const [calls, setCalls] = createSignal<CallRecord[]>([]);
    const [answered, setAnswered] = createSignal(false);
    const [failure, setFailure] = createSignal<unknown>(null);
    const [cursor, setCursor] = createSignal<string | null>(null);
    const [paging, setPaging] = createSignal(false);
    const [moreFailure, setMoreFailure] = createSignal<unknown>(null);

    let asked = 0;
    let shown = 0;

    const named = (page: readonly CallRecord[]) =>
    {
        void people.want(page.flatMap((one) => (one.with === undefined ? [] : [one.with])));
    };

    const read = async () =>
    {
        asked += 1;

        const mine = asked;

        try
        {
            const page = await client.calls.history({ query: {} });

            if (mine === asked)
            {
                setCalls(page.calls);
                setCursor(page.cursor ?? null);
                setAnswered(true);
                setFailure(null);
                setMoreFailure(null);
                setPaging(false);
                named(page.calls);
            }
        }
        catch (error)
        {
            if (mine === asked)
            {
                setFailure(() => error);
            }
        }
    };

    const more = async () =>
    {
        const after = cursor();

        if (paging() || after === null)
        {
            return;
        }

        const mine = asked;

        setPaging(true);

        try
        {
            const page = await client.calls.history({ query: { cursor: after } });

            if (mine === asked)
            {
                setCalls((held) => [...held, ...page.calls.filter((one) => !held.some((kept) => kept.id === one.id))]);
                setCursor(page.cursor ?? null);
                setMoreFailure(null);
                named(page.calls);
            }
        }
        catch (error)
        {
            if (mine === asked)
            {
                setMoreFailure(() => error);
            }
        }
        finally
        {
            if (mine === asked)
            {
                setPaging(false);
            }
        }
    };

    const reset = () =>
    {
        asked += 1;
        setCalls([]);
        setCursor(null);
        setAnswered(false);
        setFailure(null);
        setPaging(false);
        setMoreFailure(null);
    };

    return {
        calls,
        reading: () => (answered() ? 'read' : (failure() === null ? 'reading' : 'failed')),
        failure,
        hasMore: () => cursor() !== null,
        paging,
        moreFailure,

        open()
        {
            let held = true;

            shown += 1;

            const off = useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'calls'))
                {
                    void read();
                }
            });

            void read();

            return () =>
            {
                if (!held)
                {
                    return;
                }

                held = false;
                off();
                shown -= 1;

                if (shown === 0)
                {
                    reset();
                }
            };
        },

        more,
        refresh: () => void read(),
        reset
    };
});

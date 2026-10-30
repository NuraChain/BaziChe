import { createSignal, createStore, type Getter } from 'azerothjs';

import { ApiError, client } from '../api.ts';
import type { InvitedPeople, InviteSummary } from '../api.ts';

export type InvitedPerson = InvitedPeople['people'][number];

/** What a press of "Make a new code" came to. */
export type Renewal = 'renewed' | 'soon' | 'failed';

export interface InvitesApi
{
    /** The reader's code, its link and what came of it, or null before the first answer. */
    summary: Getter<InviteSummary | null>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;

    /** The friends they invited, newest first, as many pages as have been read. */
    people: Getter<InvitedPerson[]>;
    peopleLoading: Getter<boolean>;

    /** The last page was refused; the button that asks for more is the retry. */
    peopleFailed: Getter<boolean>;
    hasMore: Getter<boolean>;

    renewing: Getter<boolean>;

    /** Reads the summary and the first page; the page that shows them opens and closes it. */
    open(): void;
    close(): void;
    more(): Promise<void>;

    /** A new code, at most once a day. A second press while one is out is answered with the first. */
    renew(): Promise<Renewal>;

    refresh(): void;
    reset(): void;
}

/**
 * The reader's own invite link and the people it brought in.
 *
 * Nothing here is guessed: a new code is drawn by the server, and the people are whoever the
 * server says joined. A read that fails keeps what was on screen and says it failed, never that
 * nobody joined.
 */
export const useInvites = createStore((): InvitesApi =>
{
    const [summary, setSummary] = createSignal<InviteSummary | null>(null);
    const [loading, setLoading] = createSignal(false);
    const [failed, setFailed] = createSignal(false);
    const [people, setPeople] = createSignal<InvitedPerson[]>([]);
    const [cursor, setCursor] = createSignal<string | null>(null);
    const [exhausted, setExhausted] = createSignal(false);
    const [reading, setReading] = createSignal(false);
    const [peopleFailed, setPeopleFailed] = createSignal(false);
    const [renewing, setRenewing] = createSignal(false);

    let asked = 0;
    let paged = 0;
    let renewal: Promise<Renewal> | null = null;

    const read = async () =>
    {
        asked += 1;

        const mine = asked;

        setLoading(true);

        try
        {
            const answer = await client.invites.summary();

            if (mine === asked)
            {
                setSummary(answer);
                setFailed(false);
            }
        }
        catch
        {
            if (mine === asked)
            {
                setFailed(true);
            }
        }
        finally
        {
            if (mine === asked)
            {
                setLoading(false);
            }
        }
    };

    const startOver = () =>
    {
        paged += 1;
        setPeople([]);
        setCursor(null);
        setExhausted(false);
        setReading(false);
        setPeopleFailed(false);
    };

    const more = async () =>
    {
        if (reading() || exhausted())
        {
            return;
        }

        const mine = paged;

        setReading(true);

        try
        {
            const page = await client.invites.people({ query: { cursor: cursor() ?? undefined } });

            if (mine === paged)
            {
                setPeople((held) => [...held, ...page.people]);
                setCursor(page.cursor ?? null);
                setExhausted(page.cursor === undefined);
                setPeopleFailed(false);
            }
        }
        catch
        {
            if (mine === paged)
            {
                setPeopleFailed(true);
            }
        }
        finally
        {
            if (mine === paged)
            {
                setReading(false);
            }
        }
    };

    const refresh = () =>
    {
        void read();
        startOver();
        void more();
    };

    return {
        summary,
        loading,
        failed,
        people,
        peopleLoading: reading,
        peopleFailed,
        hasMore: () => !exhausted(),
        renewing,
        more,
        refresh,

        open: refresh,

        close()
        {
            asked += 1;
            startOver();
            setSummary(null);
            setLoading(false);
            setFailed(false);
        },

        renew()
        {
            renewal ??= (async (): Promise<Renewal> =>
            {
                setRenewing(true);

                try
                {
                    const answer = await client.invites.renew();

                    asked += 1;
                    setSummary(answer);
                    setLoading(false);
                    setFailed(false);
                    return 'renewed';
                }
                catch (error)
                {
                    if (error instanceof ApiError && error.code === 'invite-code-soon')
                    {
                        void read();
                        return 'soon';
                    }

                    return 'failed';
                }
                finally
                {
                    setRenewing(false);
                    renewal = null;
                }
            })();

            return renewal;
        },

        reset()
        {
            asked += 1;
            renewal = null;
            startOver();
            setSummary(null);
            setLoading(false);
            setFailed(false);
            setRenewing(false);
        }
    };
});

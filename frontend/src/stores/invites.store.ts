import { createSignal, createStore, type Getter } from 'azerothjs';

import { ApiError, client } from '../api.ts';
import type { InviteBoard, InvitedPeople, InviteSummary } from '../api.ts';
import { whyFailed } from '../lib/failure.ts';
import type { MessageKey } from '../locales/en.ts';
import { usePeople } from './people.store.ts';

export type InvitedPerson = InvitedPeople['people'][number];

export interface InvitesApi
{
    /** The reader's code, its link and what came of it, or null before the first answer. */
    summary: Getter<InviteSummary | null>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;
    failure: Getter<unknown>;

    /** The friends they invited, newest first, as many pages as have been read. */
    people: Getter<InvitedPerson[]>;
    peopleLoading: Getter<boolean>;

    /** The last page was refused; the button that asks for more is the retry. */
    peopleFailed: Getter<boolean>;
    peopleFailure: Getter<unknown>;
    hasMore: Getter<boolean>;

    renewing: Getter<boolean>;

    /** The top inviters, or null before the first answer; a read that fails keeps what was on screen. */
    board: Getter<InviteBoard | null>;
    boardFailed: Getter<boolean>;
    boardFailure: Getter<unknown>;

    /** Reads the top inviters; the tab that shows them asks, each time it is opened. */
    readBoard(): void;

    /** Reads the summary and the first page; the page that shows them opens and closes it. */
    open(): void;
    close(): void;
    more(): Promise<void>;

    /**
     * A new code, at most once a day: null once it is made, and otherwise what to say. A second press
     * while one is out is answered with the first.
     */
    renew(): Promise<MessageKey | null>;

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
    const known = usePeople();
    const [summary, setSummary] = createSignal<InviteSummary | null>(null);
    const [loading, setLoading] = createSignal(false);
    const [failure, setFailure] = createSignal<unknown>(null);
    const [people, setPeople] = createSignal<InvitedPerson[]>([]);
    const [cursor, setCursor] = createSignal<string | null>(null);
    const [exhausted, setExhausted] = createSignal(false);
    const [reading, setReading] = createSignal(false);
    const [peopleFailure, setPeopleFailure] = createSignal<unknown>(null);
    const [renewing, setRenewing] = createSignal(false);
    const [board, setBoard] = createSignal<InviteBoard | null>(null);
    const [boardFailure, setBoardFailure] = createSignal<unknown>(null);

    let asked = 0;
    let paged = 0;
    let renewal: Promise<MessageKey | null> | null = null;
    let boarded = 0;

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
                setFailure(null);
            }
        }
        catch (error)
        {
            if (mine === asked)
            {
                setFailure(() => error);
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

    const readBoard = async () =>
    {
        boarded += 1;

        const mine = boarded;

        try
        {
            const answer = await client.invites.board();

            if (mine === boarded)
            {
                setBoard(answer);
                setBoardFailure(null);
                void known.want(answer.rows.map((row) => row.person.handle));
            }
        }
        catch (error)
        {
            if (mine === boarded)
            {
                setBoardFailure(() => error);
            }
        }
    };

    const letBoardGo = () =>
    {
        boarded += 1;
        setBoard(null);
        setBoardFailure(null);
    };

    const startOver = () =>
    {
        paged += 1;
        setPeople([]);
        setCursor(null);
        setExhausted(false);
        setReading(false);
        setPeopleFailure(null);
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
                setPeopleFailure(null);
                void known.want(page.people.map((one) => one.person.handle));
            }
        }
        catch (error)
        {
            if (mine === paged)
            {
                setPeopleFailure(() => error);
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
        failed: () => failure() !== null,
        failure,
        people,
        peopleLoading: reading,
        peopleFailed: () => peopleFailure() !== null,
        peopleFailure,
        hasMore: () => !exhausted(),
        renewing,
        board,
        boardFailed: () => boardFailure() !== null,
        boardFailure,
        more,
        refresh,

        readBoard: () => void readBoard(),

        open: refresh,

        close()
        {
            asked += 1;
            startOver();
            letBoardGo();
            setSummary(null);
            setLoading(false);
            setFailure(null);
        },

        renew()
        {
            renewal ??= (async (): Promise<MessageKey | null> =>
            {
                setRenewing(true);

                try
                {
                    const answer = await client.invites.renew();

                    asked += 1;
                    setSummary(answer);
                    setLoading(false);
                    setFailure(null);
                    return null;
                }
                catch (error)
                {
                    if (error instanceof ApiError && error.code === 'invite-code-soon')
                    {
                        void read();
                        return 'invite.page.soon';
                    }

                    return whyFailed(error);
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
            letBoardGo();
            setSummary(null);
            setLoading(false);
            setFailure(null);
            setRenewing(false);
        }
    };
});

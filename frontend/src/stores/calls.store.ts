import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type CallView, type CallsState } from '../api.ts';
import { CALL_REFUSALS, type CallRefusal } from '../../../backend/src/domains/call/refusals.ts';
import { CALL_ROOM } from '../../../backend/src/domains/call/rules.ts';
import { attempt } from '../lib/attempt.ts';
import { createGuesses } from '../lib/guess.ts';
import { joinVoice } from '../lib/join-voice.ts';
import { runtime } from '../lib/runtime.ts';
import type { MessageKey } from '../locales/en.ts';
import { useAccount } from './account.store.ts';
import { usePeople } from './people.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useVoice } from './voice.store.ts';

/** How long a call that ended goes on saying how it ended, on a page that was showing it. */
export const ENDED_SHOWN_MS = 4000;

/** Which call this tab is in, kept for the tab alone and through a reload, which comes back to it. */
const HERE_KEY = 'nura.call.here';

export const callRoomOf = (callId: string) => `${ CALL_ROOM }${ callId }`;

export function whyCall(error: unknown): MessageKey
{
    const code = error instanceof ApiError ? error.code : '';

    return Object.hasOwn(CALL_REFUSALS, code) ? `call.refused.${ code as CallRefusal }` : 'common.actionFailed';
}

export interface CallsApi
{
    /**
     * The call this page shows: the one open (ringing for the reader, rung by them, or live), else
     * one that ended a moment ago while this page was showing it.
     */
    current: Getter<CallView | null>;

    /** Whether this tab is the one in the call's room; another device or tab may hold the call. */
    here: Getter<boolean>;

    ring(room: string): Promise<boolean>;
    accept(callId: string): Promise<boolean>;
    decline(callId: string): Promise<boolean>;
    hangUp(callId: string): Promise<boolean>;
    dismiss(callId: string): void;
    refresh(): Promise<void>;
    start(): () => void;
    reset(): void;
}

const keptHere = () =>
{
    try
    {
        return window.sessionStorage.getItem(HERE_KEY);
    }
    catch
    {
        return null;
    }
};

const keepHere = (callId: string | null) =>
{
    try
    {
        if (callId === null)
        {
            window.sessionStorage.removeItem(HERE_KEY);
        }
        else
        {
            window.sessionStorage.setItem(HERE_KEY, callId);
        }
    }
    catch
    {
        // Nothing kept: a reload in the middle of a call is a call this tab is not in, which the call waits out.
    }
};

export const useCalls = createStore((): CallsApi =>
{
    const account = useAccount();
    const people = usePeople();
    const voice = useVoice();

    const who = () => account.user()?.id ?? null;

    const guesses = createGuesses<CallView[]>();

    const [readFor, setReadFor] = createSignal<string | null>(null);
    const [hereId, setHereId] = createSignal<string | null>(keptHere());
    const [shown, setShown] = createSignal<ReadonlySet<string>>(new Set());
    const [gone, setGone] = createSignal<ReadonlySet<string>>(new Set());

    let asked = 0;
    let running = false;
    let joined: string | null = null;
    let unhold: (() => void) | null = null;
    let unshow: (() => void) | null = null;
    let inFlight: Promise<void> = Promise.resolve();

    const placeHere = (callId: string | null) =>
    {
        setHereId(callId);
        keepHere(callId);
    };

    /**
     * This tab's part in the call's room, after every read. The tab that rang or answered goes in
     * once the call is live and out once it is not. A tab whose room was let go of while the call
     * goes on was taken out of it by another tab of the account, or by the server, and does not
     * come back by itself.
     */
    const follow = (calls: readonly CallView[]) =>
    {
        const mine = untrack(hereId);

        if (mine === null)
        {
            return;
        }

        const call = calls.find((one) => one.id === mine);
        const room = callRoomOf(mine);
        const inRoom = untrack(voice.table) === room;

        if (call === undefined || call.state === 'ended')
        {
            if (inRoom)
            {
                voice.leave();
            }

            joined = null;
            placeHere(null);
            return;
        }

        if (call.state !== 'live')
        {
            return;
        }

        if (joined === mine && !inRoom && !untrack(voice.joining))
        {
            joined = null;
            placeHere(null);
            return;
        }

        if (!inRoom && !untrack(voice.joining))
        {
            joined = mine;
            void joinVoice(room).catch(() => undefined);
        }
    };

    /** Keeps the socket while a call rings or is live, and lets go of an ending once it has been said. */
    const keep = (calls: readonly CallView[]) =>
    {
        const open = running && calls.some((one) => one.state !== 'ended');
        const next = open ? useRealtime().hold() : null;

        unhold?.();
        unhold = next;

        const ended = calls.filter((one) => one.state === 'ended' && untrack(shown).has(one.id) && !untrack(gone).has(one.id));

        unshow?.();
        unshow = ended.length === 0 ? null : runtime().clock.after(ENDED_SHOWN_MS, () =>
        {
            unshow = null;
            setGone(new Set([...untrack(gone), ...ended.map((one) => one.id)]));
        });
    };

    const took = (answer: CallsState, me: string) =>
    {
        setReadFor(me);

        const open = answer.calls.filter((one) => one.state !== 'ended').map((one) => one.id);

        if (open.some((id) => !untrack(shown).has(id)))
        {
            setShown(new Set([...untrack(shown), ...open]));
        }

        void people.want(answer.calls.flatMap((one) => (one.person === undefined ? [] : [one.person])));
        follow(answer.calls);
        keep(answer.calls);
    };

    const read = createResource(who, async (me) =>
    {
        const turn = asked += 1;
        const answer = await client.calls.state();

        if (turn === asked)
        {
            took(answer, me);
        }

        return answer;
    }, { name: 'calls.state' });

    const revalidate = () =>
    {
        inFlight = inFlight.catch(() => undefined).then(() => read.refetch());

        return inFlight;
    };

    const listed = () => guesses.over(readFor() !== null && readFor() === who() ? read.data()?.calls ?? [] : []);

    const current = () =>
    {
        const calls = listed();
        const open = calls.find((one) => one.state !== 'ended');

        return open ?? calls.find((one) => one.state === 'ended' && shown().has(one.id) && !gone().has(one.id)) ?? null;
    };

    const changed = (callId: string, change: Partial<CallView>) => (calls: CallView[]) =>
        calls.map((one) => (one.id === callId ? { ...one, ...change } : one));

    const act = (work: () => Promise<unknown>, guess: (calls: CallView[]) => CallView[]) =>
        attempt(guesses.during(guess, work, revalidate), undefined, whyCall);

    return {
        current,

        here: () => hereId() !== null,

        async ring(room)
        {
            try
            {
                const call = await client.calls.ring({ input: { room } });

                setShown(new Set([...untrack(shown), call.id]));

                if (call.state !== 'ended')
                {
                    placeHere(call.id);
                }

                await revalidate().catch(() => undefined);

                return true;
            }
            catch (error)
            {
                return await attempt(Promise.reject(error), undefined, whyCall);
            }
        },

        async accept(callId)
        {
            const before = untrack(hereId);

            placeHere(callId);

            const went = await act(() => client.calls.accept({ params: { id: callId } }), changed(callId, { state: 'live' }));

            if (!went && untrack(hereId) === callId)
            {
                placeHere(before);
            }

            return went;
        },

        decline: (callId) => act(() => client.calls.decline({ params: { id: callId } }), changed(callId, { state: 'ended', ending: 'declined' })),

        async hangUp(callId)
        {
            const call = untrack(listed).find((one) => one.id === callId);
            const ending = call?.state === 'live' ? 'answered' : (call?.out === true ? 'cancelled' : 'declined');

            if (untrack(hereId) === callId && untrack(voice.table) === callRoomOf(callId))
            {
                voice.leave();
            }

            return await act(() => client.calls.hangUp({ params: { id: callId } }), changed(callId, { state: 'ended', ending }));
        },

        dismiss(callId)
        {
            setGone(new Set([...untrack(gone), callId]));
        },

        refresh: revalidate,

        start()
        {
            const off = useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'calls'))
                {
                    void revalidate().catch(() => undefined);
                }
            });

            running = true;
            keep(untrack(listed));

            return () =>
            {
                off();
                running = false;
                keep([]);
            };
        },

        reset()
        {
            running = false;
            keep([]);
            asked += 1;
            joined = null;
            guesses.clear();
            setShown(new Set());
            setGone(new Set());
            setHereId(null);
            keepHere(null);
            inFlight = Promise.resolve();
            setReadFor(null);
            void read.refetch();
        }
    };
});

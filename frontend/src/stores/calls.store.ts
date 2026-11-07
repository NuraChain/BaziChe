import { createMemo, createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type CallView, type CallsState, type VoiceChatState } from '../api.ts';
import { CALL_REFUSALS, type CallRefusal } from '../../../backend/src/domains/call/refusals.ts';
import { CALL_ROOM } from '../../../backend/src/domains/call/rules.ts';
import { outranks } from '../../../backend/src/domains/group/roles.ts';
import { attempt } from '../lib/attempt.ts';
import { createGuesses } from '../lib/guess.ts';
import { joinVoice } from '../lib/join-voice.ts';
import { forgetPrimedVoice, primeVoice } from '../lib/primed-voice.ts';
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

/** Somebody in a group's voice chat, as the reader's view of it names them. */
export type VoicePerson = NonNullable<CallView['people']>[number];

/** The voice chat running in a group's room, as its head draws it. */
export type RoomCall = NonNullable<VoiceChatState['call']>;

export interface CallsApi
{
    /**
     * The call this page shows: the one open (ringing for the reader, rung by them, or live), else
     * one that ended a moment ago while this page was showing it.
     */
    current: Getter<CallView | null>;

    /** Whether this tab is the one in the call's room; another device or tab may hold the call. */
    here: Getter<boolean>;

    /** Whether a bar across the top of the page shows the live call, so the card need not. */
    barred: Getter<boolean>;

    /** Says a bar shows the live call, for as long as the answer is not called. */
    bar(): () => void;

    /** The voice chat running in the room being watched; none while none runs, or before it was read. */
    roomCall: Getter<RoomCall | null>;

    /** Watches one room's voice chat for as long as the answer is not called, read again whenever it changes. */
    watchRoom(room: string): () => void;

    ring(room: string): Promise<boolean>;

    /** Comes into a group's voice chat that runs in `room`. */
    join(callId: string, room: string): Promise<boolean>;
    accept(callId: string): Promise<boolean>;
    decline(callId: string): Promise<boolean>;
    hangUp(callId: string): Promise<boolean>;

    /** Ends a group's voice chat for everybody in it; its room is left once the server has ended it. */
    end(callId: string): Promise<boolean>;

    /** Puts the reader's hand up or down in a group's voice chat. */
    hand(callId: string, up: boolean): Promise<boolean>;

    /** Holds somebody in a group's voice chat, or lets them speak. */
    hold(callId: string, who: string, held: boolean): Promise<boolean>;

    /** Holds everybody in a group's voice chat ranked below the reader. */
    holdAll(callId: string): Promise<boolean>;

    /** Takes somebody out of a group's voice chat for good. */
    remove(callId: string, who: string): Promise<boolean>;
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
    const [bars, setBars] = createSignal(0);
    const [watches, setWatches] = createSignal<readonly { room: string }[]>([]);

    /** The room of the newest watch still held: a head drawn again takes its room up before the last one lets go of it. */
    const watched = createMemo(() => watches().at(-1)?.room ?? null);

    let asked = 0;
    let running = false;
    let joined: string | null = null;
    let unhold: (() => void) | null = null;
    let unshow: (() => void) | null = null;
    let inFlight: Promise<void> = Promise.resolve();

    /**
     * Now on the server's clock, which a call's times are written in: `toLocal` takes the clocks'
     * difference away, so adding back what it took gives it.
     */
    const serverNow = () =>
    {
        const local = runtime().clock.now();

        return local + (local - useRealtime().toLocal(local));
    };

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

        void people.want(answer.calls.flatMap((one) => [...(one.person === undefined ? [] : [one.person]), ...(one.people ?? []).map((person) => person.who)]));
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

    /** A room's voice chat with the room it was read for, so an answer about another room is never drawn. */
    const roomRead = createResource(watched, async (room) =>
    {
        const call = (await client.calls.room({ params: { room } })).call ?? null;

        void people.want(call?.faces ?? []);

        return { room, call };
    }, { name: 'calls.room' });

    const roomCall = () =>
    {
        const found = roomRead.data();

        return found !== undefined && found.room === watched() ? found.call : null;
    };

    const rereadRoom = () =>
    {
        if (untrack(watched) !== null)
        {
            void roomRead.refetch();
        }
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

    /** A voice chat's people as the guess of a press leaves them. */
    const among = (callId: string, change: (people: VoicePerson[], mine: VoicePerson | undefined) => VoicePerson[]) => (calls: CallView[]) =>
        calls.map((one) => (one.id === callId && one.people !== undefined
            ? { ...one, people: change(one.people, one.people.find((person) => person.who === who())) }
            : one));

    return {
        current,

        roomCall,

        watchRoom(room)
        {
            const watch = { room };

            setWatches((all) => [...all, watch]);

            const off = useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'call' && (id === undefined || id === room) && untrack(watched) === room)
                {
                    void roomRead.refetch();
                }
            });

            return () =>
            {
                off();
                setWatches((all) => all.filter((one) => one !== watch));
            };
        },

        here: () => hereId() !== null,

        barred: () => bars() > 0,

        bar()
        {
            let held = true;

            setBars((count) => count + 1);

            return () =>
            {
                if (held)
                {
                    held = false;
                    setBars((count) => Math.max(0, count - 1));
                }
            };
        },

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

        async join(callId, room)
        {
            // The voice is joined once the server says so; the microphone is asked for now, inside the press (`primed-voice.ts`).
            primeVoice();

            const before = untrack(hereId);
            const at = new Date(serverNow()).toISOString();
            const arriving: CallView = { id: callId, room, kind: 'group', state: 'live', out: false, rung: false, at, answeredAt: at, people: [] };

            placeHere(callId);

            const went = await act(
                () => client.calls.join({ params: { id: callId } }),
                (calls) => (calls.some((one) => one.id === callId) ? calls : [arriving, ...calls])
            );

            if (!went && untrack(hereId) === callId)
            {
                placeHere(before);
            }

            if (!went)
            {
                forgetPrimedVoice();
            }

            rereadRoom();

            return went;
        },

        async accept(callId)
        {
            primeVoice();

            const before = untrack(hereId);

            placeHere(callId);

            const went = await act(() => client.calls.accept({ params: { id: callId } }), changed(callId, { state: 'live' }));

            if (!went && untrack(hereId) === callId)
            {
                placeHere(before);
            }

            if (!went)
            {
                forgetPrimedVoice();
            }

            return went;
        },

        decline: (callId) =>
        {
            forgetPrimedVoice();

            return act(() => client.calls.decline({ params: { id: callId } }), changed(callId, { state: 'ended', ending: 'declined' }));
        },

        async hangUp(callId)
        {
            forgetPrimedVoice();

            const call = untrack(listed).find((one) => one.id === callId);
            const ending = call?.state === 'live' ? 'answered' : (call?.out === true ? 'cancelled' : 'declined');

            if (untrack(hereId) === callId && untrack(voice.table) === callRoomOf(callId))
            {
                voice.leave();
            }

            if (call?.kind === 'group')
            {
                const went = await act(() => client.calls.hangUp({ params: { id: callId } }), (calls) => calls.filter((one) => one.id !== callId));

                rereadRoom();

                return went;
            }

            const ended = ending === 'answered' ? { endedAt: new Date(serverNow()).toISOString() } : {};

            return await act(() => client.calls.hangUp({ params: { id: callId } }), changed(callId, { state: 'ended', ending, ...ended }));
        },

        async end(callId)
        {
            const went = await act(
                () => client.calls.end({ params: { id: callId } }),
                changed(callId, { state: 'ended', ending: 'answered', endedAt: new Date(serverNow()).toISOString() })
            );

            rereadRoom();

            return went;
        },

        hand: (callId, up) => act(
            () => client.calls.hand({ params: { id: callId }, input: { up } }),
            among(callId, (people) => people.map((one) => (one.who === who() ? { ...one, hand: up } : one)))
        ),

        hold: (callId, handle, held) => act(
            () => client.calls.hold({ params: { id: callId }, input: { id: handle, held } }),
            among(callId, (people) => people.map((one) => (one.who === handle ? { ...one, held, hand: held && one.hand } : one)))
        ),

        holdAll: (callId) => act(
            () => client.calls.holdAll({ params: { id: callId } }),
            among(callId, (people, mine) => people.map((one) => (outranks(mine?.role ?? null, one.role ?? null) ? { ...one, held: true } : one)))
        ),

        remove: (callId, handle) => act(
            () => client.calls.remove({ params: { id: callId }, input: { id: handle } }),
            among(callId, (people) => people.filter((one) => one.who !== handle))
        ),

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
            setWatches([]);
            inFlight = Promise.resolve();
            setReadFor(null);
            void read.refetch();
        }
    };
});

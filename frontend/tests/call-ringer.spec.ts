import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@azerothjs/testing';

import type { CallView } from '../src/api.ts';
import { begin } from '../src/components/call/call.ts';
import { RINGER_KEPT_MS, ringOf, startRinger } from '../src/components/call/ringer.ts';
import '../src/icons/all.ts';
import '../src/locales/app-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { ENDED_SHOWN_MS, useCalls } from '../src/stores/calls.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useVoice } from '../src/stores/voice.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

/** Every ringer the engine was asked for, and what each is doing. */
const ringers = vi.hoisted(() => ({ made: [] as { ringing: string | null; ends: number; disposed: boolean }[] }));

vi.mock('../src/game/sound.ts', () => ({
    createRinger: () =>
    {
        const one = { ringing: null as string | null, ends: 0, disposed: false };

        ringers.made.push(one);

        return {
            ring: (cue: string) =>
            {
                one.ringing = cue;
            },
            quiet: () =>
            {
                one.ringing = null;
            },
            end: () =>
            {
                one.ends += 1;
            },
            dispose: () =>
            {
                one.disposed = true;
                one.ringing = null;
            }
        };
    }
}));

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 24; turn += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
};

const call = (more: Partial<CallView> = {}): CallView => ({
    id: 'call-9',
    room: 'c-reza',
    kind: 'direct',
    state: 'ringing',
    out: false,
    person: 'reza.t',
    rung: true,
    remainingMs: 45_000,
    at: new Date(0).toISOString(),
    ...more
});

/** The ringer the engine holds now, or none. */
const held = () => ringers.made.filter((one) => !one.disposed);

const sounding = () => held()[0]?.ringing ?? null;

const ends = () => ringers.made.reduce((sum, one) => sum + one.ends, 0);

/** The voice store's room, stood in for: a join puts this tab in the room it was asked for. */
const inRoom = () =>
{
    const voice = useVoice();
    let room: string | null = null;

    vi.spyOn(voice, 'table').mockImplementation(() => room);
    vi.spyOn(voice, 'joining').mockImplementation(() => false);
    vi.spyOn(voice, 'join').mockImplementation(async (asked) =>
    {
        room = asked;
    });
    vi.spyOn(voice, 'leave').mockImplementation(() =>
    {
        room = null;
    });
};

/** Holds every call verb at the server's door until the returned function lets it through. */
const atTheDoor = () =>
{
    let open: () => void = () => undefined;

    server.phoneHeld = new Promise<void>((resolve) =>
    {
        open = resolve;
    });

    return () =>
    {
        server.phoneHeld = null;
        open();
    };
};

let stops: (() => void)[] = [];

const running = () =>
{
    stops.push(useCalls().start(), startRinger());
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(4_000_000);
    setRuntime({ clock, seed: 29 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    usePeople().reset();
    useCalls().reset();
    useSettings().update({ sound: true });
    ringers.made.length = 0;
    stops = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    inRoom();
});

afterEach(() =>
{
    stops.forEach((stop) => stop());
    vi.restoreAllMocks();
    useCalls().reset();
    useRealtime().reset();
    cleanup();
});

describe('what a call says while it rings', () =>
{
    it('is the ring wherever it rings for the reader, the ringback where they rang once it rings there too, and nothing else', () =>
    {
        expect(ringOf(null, false)).toBeNull();
        expect(ringOf(call(), false)).toBe('ring');
        expect(ringOf(call(), true)).toBe('ring');
        expect(ringOf(call({ out: true }), true)).toBe('ringback');
        expect(ringOf(call({ out: true, rung: false }), true), 'before a page of theirs has it').toBeNull();
        expect(ringOf(call({ out: true }), false), 'another device of whoever rang').toBeNull();
        expect(ringOf(call({ state: 'live' }), true)).toBeNull();
        expect(ringOf(call({ state: 'ended', ending: 'missed' }), false)).toBeNull();
    });
});

describe('the ringer', () =>
{
    it('rings a call that rings for the reader until it stops, and says nothing of an end this page was not in', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        expect(sounding()).toBe('ring');

        server.phone = [call({ state: 'ended', ending: 'missed' })];
        await useCalls().refresh();
        await settle();

        expect(sounding()).toBeNull();
        expect(ends(), 'a call that rang here and nobody took ended with the end tone').toBe(0);
    });

    it('stops at the press of Accept, and ends with the end tone once the call it took ends, whoever ended it', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        const open = atTheDoor();
        const answered = useCalls().accept('call-9');

        await settle();
        expect(sounding(), 'still ringing over a call the reader took').toBeNull();

        open();
        await answered;
        await settle();

        server.phone = [call({ state: 'ended', ending: 'answered', answeredAt: new Date(0).toISOString(), endedAt: new Date(60_000).toISOString() })];
        await useCalls().refresh();
        await settle();

        expect(ends()).toBe(1);

        await useCalls().refresh();
        await settle();

        expect(ends(), 'an end said twice').toBe(1);
    });

    it('ends with the end tone at the press of the reader\'s own Hang up, and only once the server agrees', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await useCalls().accept('call-9');
        await settle();

        const open = atTheDoor();
        const hung = useCalls().hangUp('call-9');

        await settle();
        expect(ends(), 'the end waited for the server').toBe(1);

        open();
        await hung;
        await settle();

        expect(ends()).toBe(1);
    });

    it('says nothing when the reader declines, and rings no end for it', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        await useCalls().decline('call-9');
        await settle();

        expect(sounding()).toBeNull();
        expect(ends()).toBe(0);
    });

    it('rings back on the page that rang once it rings there, and ends with the end tone when it is declined', async () =>
    {
        running();
        server.conversations.push({ id: 'c-sara', kind: 'direct', members: ['alex', 'sara.k'], pinned: false, unread: 0 });

        await useCalls().ring('c-sara');
        await settle();

        expect(sounding(), 'a ringback before a page of theirs had the call').toBeNull();

        server.phone = server.phone.map((one) => ({ ...one, rung: true }));
        await useCalls().refresh();
        await settle();

        expect(sounding()).toBe('ringback');

        server.phone = server.phone.map((one) => ({ ...one, state: 'ended', ending: 'declined', endedAt: new Date(0).toISOString() }));
        await useCalls().refresh();
        await settle();

        expect(sounding()).toBeNull();
        expect(ends()).toBe(1);
    });

    it('rings back nowhere but the page that rang', async () =>
    {
        running();
        server.phone = [call({ out: true })];
        await useCalls().refresh();
        await settle();

        expect(useCalls().here()).toBe(false);
        expect(sounding()).toBeNull();
        expect(ringers.made, 'the engine was fetched for a call nothing here rings').toHaveLength(0);
    });

    it('rings nothing and fetches no engine with the sound off, and rings at once when it is turned on', async () =>
    {
        useSettings().update({ sound: false });
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        expect(ringers.made).toHaveLength(0);

        useSettings().update({ sound: true });
        await settle();

        expect(sounding()).toBe('ring');

        useSettings().update({ sound: false });
        await settle();

        expect(sounding()).toBeNull();
    });

    it('lets go of the engine a moment after nothing of a call is left, so its end is heard out, and makes another for the next', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await useCalls().accept('call-9');
        await settle();

        server.phone = [call({ state: 'ended', ending: 'answered', endedAt: new Date(0).toISOString() })];
        await useCalls().refresh();
        await settle();

        expect(held(), 'the engine went with the end it was playing').toHaveLength(1);

        clock.advance(ENDED_SHOWN_MS);
        await settle();
        clock.advance(RINGER_KEPT_MS - 1);
        await settle();

        expect(held()).toHaveLength(1);

        clock.advance(1);
        await settle();

        expect(held()).toHaveLength(0);

        server.phone = [call({ id: 'call-10' })];
        await useCalls().refresh();
        await settle();

        expect(ringers.made).toHaveLength(2);
        expect(sounding()).toBe('ring');
    });

    it('keeps the engine through a call it is in, so the end is heard the moment it comes', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await useCalls().accept('call-9');
        await settle();

        clock.advance(RINGER_KEPT_MS * 4);
        await settle();

        expect(held()).toHaveLength(1);
    });

    it('lets go of a call that is gone without an end it heard, and says no end for it', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await useCalls().accept('call-9');
        await settle();

        server.phone = [];
        await useCalls().refresh();
        await settle();
        clock.advance(RINGER_KEPT_MS);
        await settle();

        expect(held()).toHaveLength(0);
        expect(ends()).toBe(0);
    });

    it('rings on when the sound is turned off and on again in a moment', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        useSettings().update({ sound: false });
        await settle();
        useSettings().update({ sound: true });
        await settle();
        clock.advance(RINGER_KEPT_MS);
        await settle();

        expect(sounding()).toBe('ring');
        expect(ringers.made, 'a second engine for one call').toHaveLength(1);
    });

    it('lets go of an engine that came after the sound was turned off again', async () =>
    {
        useSettings().update({ sound: false });
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        useSettings().update({ sound: true });
        useSettings().update({ sound: false });
        await settle();

        expect(ringers.made, 'the engine was never asked for').toHaveLength(1);
        expect(sounding()).toBeNull();

        clock.advance(RINGER_KEPT_MS);
        await settle();

        expect(held()).toHaveLength(0);
    });

    it('says an end that came while the engine was still on its way', async () =>
    {
        useSettings().update({ sound: false });
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await useCalls().accept('call-9');
        await settle();

        useSettings().update({ sound: true });
        void useCalls().hangUp('call-9');
        useSettings().update({ backgroundVolume: 0.3 });
        await settle();

        expect(ringers.made, 'the engine was never asked for').toHaveLength(1);
        expect(ends()).toBe(1);
    });

    it('makes no engine that came after the calls stopped', async () =>
    {
        useSettings().update({ sound: false });
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        useSettings().update({ sound: true });
        stops.forEach((stop) => stop());
        stops = [];
        await settle();

        expect(held()).toHaveLength(0);
    });

    it('stops ringing and lets go of the engine when the calls stop', async () =>
    {
        running();
        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        expect(sounding()).toBe('ring');

        stops.forEach((stop) => stop());
        stops = [];

        expect(held()).toHaveLength(0);
    });

    it('is started by the calls\' own chunk, and stopped with it', async () =>
    {
        const stop = begin();

        server.phone = [call()];
        await useCalls().refresh();
        await settle();

        expect(sounding()).toBe('ring');

        stop();

        expect(held()).toHaveLength(0);
    });
});

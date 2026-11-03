import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import type { CallView, CallsState } from '../src/api.ts';
import CallCard from '../src/components/call/call-card.component.azeroth';
import '../src/icons/all.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { startCalls } from '../src/stores/call-loader.ts';
import { ENDED_SHOWN_MS, callRoomOf, useCalls, whyCall } from '../src/stores/calls.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVoice } from '../src/stores/voice.store.ts';
import { CALL_REFUSALS, type CallRefusal } from '../../backend/src/domains/call/refusals.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const SOURCES = import.meta.glob(
    ['../src/**/*.{ts,azeroth}', '!../src/main.azeroth'],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const LAZY = [
    '../src/stores/calls.store.ts',
    '../src/components/call/call.ts',
    '../src/components/call/call-card.component.azeroth',
    '../src/components/call/call-bar.component.azeroth',
    '../src/components/call/call-view.component.azeroth',
    '../src/components/call/said.ts',
    '../src/components/call/ringer.ts'
];

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
};

const reads = () => server.calls.filter((call) => call === 'calls.state').length;

const ringing = (more: Partial<CallView> = {}): CallView => ({
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

const doorbell = async () =>
{
    socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'me', id: 'calls', at: 0 });
    clock.advance(NUDGE_WINDOW_MS);
    await settle();
};

/** Holds every call verb at the server's door until the returned function lets it through. */
const held = () =>
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

/** The voice store's room, stood in for: a join puts this tab in the room it was asked for. */
const inRoom = () =>
{
    const voice = useVoice();
    let room: string | null = null;

    vi.spyOn(voice, 'table').mockImplementation(() => room);
    vi.spyOn(voice, 'joining').mockImplementation(() => false);

    const join = vi.spyOn(voice, 'join').mockImplementation(async (asked) =>
    {
        room = asked;
    });
    const leave = vi.spyOn(voice, 'leave').mockImplementation(() =>
    {
        room = null;
    });

    return { join, leave, out: () => room = null };
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(4_000_000);
    setRuntime({ clock, seed: 23 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    usePeople().reset();
    useSocial().reset();
    useToasts().reset();
    useCalls().reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await useSocial().refresh();
    await settle();
    server.calls = [];
});

afterEach(() =>
{
    vi.restoreAllMocks();
    useCalls().reset();
    useToasts().reset();
    useRealtime().reset();
    cleanup();
});

describe('the reader’s calls', () =>
{
    it('are read when a call of theirs rings, and on no other doorbell', async () =>
    {
        const calls = useCalls();
        const stop = calls.start();

        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
        server.calls = [];

        for (const id of ['notifications', 'party', 'devices'])
        {
            socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'me', id, at: 0 });
            clock.advance(NUDGE_WINDOW_MS);
            await settle();
        }

        expect(reads(), 'a doorbell about something else read the calls').toBe(0);

        server.phone = [ringing()];
        await doorbell();

        expect(reads()).toBe(1);
        expect(calls.current()).toMatchObject({ id: 'call-9', state: 'ringing', out: false });

        stop();
    });

    it('hold the socket while one rings or is live, and let it go once it has ended', async () =>
    {
        const calls = useCalls();
        const hold = vi.spyOn(useRealtime(), 'hold');
        const stop = calls.start();

        server.phone = [ringing()];
        await calls.refresh();

        expect(hold).toHaveBeenCalled();

        stop();
    });

    it('show an answer at the press, put this tab in the call\'s room once it is live, and keep it there', async () =>
    {
        const calls = useCalls();
        const voice = inRoom();
        const stop = calls.start();

        server.phone = [ringing()];
        await calls.refresh();

        const open = held();
        const answered = calls.accept('call-9');

        await settle();
        expect(calls.current()?.state, 'live at the press').toBe('live');
        expect(calls.here()).toBe(true);

        open();
        expect(await answered).toBe(true);
        await settle();

        expect(voice.join).toHaveBeenCalledWith(callRoomOf('call-9'));
        expect(server.calls).toContain('calls.accept');

        await calls.refresh();
        expect(voice.join, 'joined once').toHaveBeenCalledTimes(1);

        stop();
    });

    it('take an answer back with the refusal’s sentence', async () =>
    {
        const calls = useCalls();

        server.phone = [ringing()];
        await calls.refresh();

        server.phoneRefusal = 'call-over';
        expect(await calls.accept('call-9')).toBe(false);

        expect(calls.current()?.state).toBe('ringing');
        expect(calls.here()).toBe(false);
        expect(useToasts().items().map((one) => one.text)).toContain('That call is no longer ringing.');
    });

    it('do not take a call another tab of the account is in, and let go of one another tab took', async () =>
    {
        const calls = useCalls();
        const voice = inRoom();

        server.phone = [ringing({ state: 'live', answeredAt: new Date(0).toISOString() })];
        await calls.refresh();

        expect(calls.here()).toBe(false);
        expect(voice.join).not.toHaveBeenCalled();

        server.phone = [ringing({ id: 'call-10' })];
        await calls.refresh();
        await calls.accept('call-10');
        await settle();

        expect(voice.join).toHaveBeenCalledWith(callRoomOf('call-10'));

        voice.out();
        await calls.refresh();

        expect(calls.here(), 'another tab took it').toBe(false);

        await calls.refresh();
        expect(voice.join, 'and it did not come back by itself').toHaveBeenCalledTimes(1);
    });

    it('leave the call\'s room at a hang up, and say how it ended for a moment', async () =>
    {
        const calls = useCalls();
        const voice = inRoom();
        const stop = calls.start();

        server.phone = [ringing()];
        await calls.refresh();
        await calls.accept('call-9');
        await settle();

        const open = held();
        const hung = calls.hangUp('call-9');

        await settle();
        expect(voice.leave, 'out of the room at the press').toHaveBeenCalled();
        expect(calls.current(), 'ended at the press').toMatchObject({ state: 'ended', ending: 'answered' });

        open();
        expect(await hung).toBe(true);
        await settle();

        expect(calls.current()).toMatchObject({ state: 'ended', ending: 'answered' });

        clock.advance(ENDED_SHOWN_MS);
        await settle();

        expect(calls.current(), 'its moment over').toBeNull();

        stop();
    });

    it('leave the call\'s room when the other side hangs up, and say how it ended', async () =>
    {
        const calls = useCalls();
        const voice = inRoom();
        const stop = calls.start();

        server.phone = [ringing()];
        await calls.refresh();
        await calls.accept('call-9');
        await settle();

        expect(voice.join).toHaveBeenCalledWith(callRoomOf('call-9'));

        server.phone = [ringing({ state: 'ended', ending: 'answered', answeredAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString() })];
        await calls.refresh();
        await settle();

        expect(voice.leave).toHaveBeenCalled();
        expect(calls.here()).toBe(false);
        expect(calls.current()).toMatchObject({ state: 'ended', ending: 'answered' });

        stop();
    });

    it('show nothing read for an account that has gone, before the next account’s own read has come', async () =>
    {
        const calls = useCalls();

        server.phone = [ringing()];
        await calls.refresh();
        expect(calls.current()).not.toBeNull();

        server.phone = [];
        useSession().establish({ id: 'sara.k', handle: 'sara.k', displayName: 'Sara Kamali', bio: '', hue: 20, isMinor: false });

        expect(calls.current()).toBeNull();
        await settle();
        expect(calls.current()).toBeNull();
    });

    it('take nothing from a read that began before they were reset', async () =>
    {
        const calls = useCalls();
        let answer: (state: CallsState) => void = () => undefined;

        vi.spyOn(client.calls, 'state').mockImplementationOnce(async () => await new Promise<CallsState>((resolve) =>
        {
            answer = resolve;
        }));

        const reading = calls.refresh();

        await settle();
        calls.reset();
        await settle();
        answer({ calls: [ringing()] });
        await reading;
        await settle();

        expect(calls.current(), 'a call read for the store before it was reset').toBeNull();

        server.phone = [ringing({ state: 'ended', ending: 'missed', endedAt: new Date(0).toISOString() })];
        await calls.refresh();

        expect(calls.current(), 'the ending of a call only that read had seen').toBeNull();
    });

    it('decline at the press, and ring a room from the reader’s own side', async () =>
    {
        const calls = useCalls();
        const stop = calls.start();

        server.phone = [ringing()];
        await calls.refresh();

        const open = held();
        const declined = calls.decline('call-9');

        await settle();
        expect(calls.current()).toMatchObject({ state: 'ended', ending: 'declined' });
        open();
        expect(await declined).toBe(true);

        server.phone = [];
        server.conversations.push({ id: 'c-sara', kind: 'direct', members: ['alex', 'sara.k'], pinned: false, unread: 0 });

        expect(await calls.ring('c-sara')).toBe(true);
        expect(calls.current()).toMatchObject({ room: 'c-sara', state: 'ringing', out: true, person: 'sara.k' });
        expect(calls.here()).toBe(true);

        stop();
    });

    it('cancel a ring of the reader’s own at the press', async () =>
    {
        const calls = useCalls();

        server.phone = [ringing({ out: true })];
        await calls.refresh();

        const open = held();
        const hung = calls.hangUp('call-9');

        await settle();
        expect(calls.current()).toMatchObject({ state: 'ended', ending: 'cancelled' });

        open();
        expect(await hung).toBe(true);
    });

    it('say a ring that was refused in its own words', async () =>
    {
        const calls = useCalls();

        server.phoneRefusal = 'in-call';
        expect(await calls.ring('c-reza')).toBe(false);
        expect(useToasts().items().map((one) => one.text)).toContain('You are already in a call.');
        expect(calls.current()).toBeNull();
    });

    it('show no ending of a call this page never showed', async () =>
    {
        const calls = useCalls();

        server.phone = [ringing({ state: 'ended', ending: 'missed', endedAt: new Date(0).toISOString() })];
        await calls.refresh();

        expect(calls.current()).toBeNull();
    });

    it('turn every refusal into its own sentence, and anything else into the plain one', () =>
    {
        for (const word of Object.keys(CALL_REFUSALS) as CallRefusal[])
        {
            expect(whyCall(new ApiError(CALL_REFUSALS[word], word, '', undefined))).toBe(`call.refused.${ word }`);
        }

        expect(whyCall(new ApiError(409, 'playing', '', undefined))).toBe('common.actionFailed');
        expect(whyCall(new Error('no'))).toBe('common.actionFailed');
    });
});

describe('the call’s card', () =>
{
    const drawn = () => renderTest(() => CallCard({}) as HTMLElement).container;

    const text = (container: HTMLElement, attribute: string) => container.querySelector(`[${ attribute }]`)?.textContent?.trim() ?? '';

    it('says who is calling, and answers or declines at a press', async () =>
    {
        const calls = useCalls();

        server.phone = [ringing()];
        await calls.refresh();

        const container = drawn();

        expect(text(container, 'data-call-heading')).toBe('Reza Tehrani is calling');
        expect(container.querySelector('[data-call-accept]')).not.toBeNull();

        const classes = (attribute: string) => container.querySelector(`[${ attribute }]`)?.getAttribute('class')?.split(' ') ?? [];

        expect(classes('data-call-card'), 'the buttons go under the words when both do not fit beside them').toContain('flex-wrap');
        expect([...classes('data-call-heading'), ...classes('data-call-status')], 'neither line is ever cut short').not.toContain('truncate');

        container.querySelector<HTMLButtonElement>('[data-call-accept] button')!.click();
        await settle();

        expect(server.calls).toContain('calls.accept');
    });

    it('says Calling, and Ringing once a page of theirs has it', async () =>
    {
        const calls = useCalls();

        server.phone = [ringing({ out: true, rung: false })];
        await calls.refresh();

        const container = drawn();

        expect(text(container, 'data-call-status')).toBe('Calling…');

        server.phone = [ringing({ out: true, rung: true })];
        await calls.refresh();
        await settle();

        expect(text(container, 'data-call-status')).toBe('Ringing…');
        expect(container.querySelector('[data-call-cancel]')).not.toBeNull();
    });

    it('says a call taken on another device is there, and how one ended from the reader’s side', async () =>
    {
        const calls = useCalls();

        server.phone = [ringing({ state: 'live', answeredAt: new Date(0).toISOString() })];
        await calls.refresh();

        const container = drawn();

        expect(text(container, 'data-call-status')).toBe('In a call on another device');
        expect(container.querySelector('[data-call-heading]')?.getAttribute('dir'), 'the heading stands where the reader starts reading').toBe('ltr');
        expect(container.querySelector('[data-call-heading] bdi')?.textContent, 'and the name runs its own way inside it').toBe('Reza Tehrani');

        server.phone = [ringing({ state: 'ended', ending: 'missed', endedAt: new Date(0).toISOString() })];
        await calls.refresh();
        await settle();

        expect(text(container, 'data-call-status')).toBe('Missed call');
    });

    it('hangs up a live call at a press, says how it ended, and lets it go at another', async () =>
    {
        const calls = useCalls();
        const voice = inRoom();

        server.phone = [ringing()];
        await calls.refresh();
        await calls.accept('call-9');
        await settle();

        const container = drawn();

        container.querySelector<HTMLButtonElement>('[data-call-hang-up] button')!.click();
        await settle();

        expect(server.calls).toContain('calls.hangUp');
        expect(voice.leave).toHaveBeenCalled();
        expect(text(container, 'data-call-status')).toBe('Call ended · 0:00');

        container.querySelector<HTMLButtonElement>(`[data-call] button[aria-label="${ useLocale().t('call.close') }"]`)!.click();
        await settle();

        expect(container.querySelector('[data-call]')).toBeNull();
        expect(calls.current()).toBeNull();
    });

    it('says Connecting until somebody is heard in the call, then counts its time', async () =>
    {
        const calls = useCalls();

        inRoom();
        server.phone = [ringing()];
        await calls.refresh();
        await calls.accept('call-9');
        await settle();

        server.phone = [ringing({ state: 'live', answeredAt: new Date(clock.now() - 5000).toISOString() })];
        await calls.refresh();

        expect(text(drawn(), 'data-call-status')).toBe('Connecting…');

        cleanup();
        vi.spyOn(useVoice(), 'people').mockImplementation(() => [{ who: 'reza.t', me: false, muted: false, talk: true, link: null, speaking: false, silenced: false, volume: 1 }]);

        const container = drawn();

        await settle();
        expect(text(container, 'data-call-status')).toBe('0:05');

        clock.advance(1000);
        await settle();
        expect(text(container, 'data-call-status')).toBe('0:06');

        clock.advance(1000);
        await settle();
        expect(text(container, 'data-call-status')).toBe('0:07');
    });

    it('says how long a call lasted to the moment it was hung up, not to the last tick of its clock, on the server’s clock', async () =>
    {
        const calls = useCalls();
        const ahead = 2 * 3_600_000;

        useRealtime().start();
        socket.accept();
        socket.deliver({ v: 1, t: 'hello', n: 1, rt: 'nura-rt/v1', self: 'alex', at: clock.now() + ahead });
        await settle();

        inRoom();
        server.phone = [ringing()];
        await calls.refresh();
        await calls.accept('call-9');
        await settle();

        server.phone = [ringing({ state: 'live', answeredAt: new Date(clock.now() + ahead - 4500).toISOString() })];
        await calls.refresh();
        vi.spyOn(useVoice(), 'people').mockImplementation(() => [{ who: 'reza.t', me: false, muted: false, talk: true, link: null, speaking: false, silenced: false, volume: 1 }]);

        const container = drawn();

        await settle();
        expect(text(container, 'data-call-status')).toBe('0:04');

        clock.advance(900);

        const open = held();
        const hung = calls.hangUp('call-9');

        await settle();
        expect(text(container, 'data-call-status')).toBe('Call ended · 0:05');

        open();
        await hung;
    });

    it('names a caller this page had not been told about, once the server has', async () =>
    {
        usePeople().reset();
        server.calls = [];

        const calls = useCalls();

        server.phone = [ringing()];
        await calls.refresh();

        const container = drawn();

        await vi.waitFor(() => expect(text(container, 'data-call-heading')).toBe('Reza Tehrani is calling'));
        expect(server.calls).toContain('social.names');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');

        const calls = useCalls();

        server.phone = [ringing()];
        await calls.refresh();

        const container = drawn();

        expect(text(container, 'data-call-heading')).toBe('Reza Tehrani داره زنگ می‌زنه');
        expect(container.querySelector('[data-call-heading]')?.getAttribute('dir'), 'a sentence in the reader’s words, whichever way the name in it runs').toBe('rtl');
        expect(container.querySelector('[data-call-accept] button')?.textContent?.trim()).toBe('جواب بده');
    });
});

describe('the calls’ chunk', () =>
{
    it('is fetched a promise after the shell asks, and stopped with the shell', async () =>
    {
        const stops: (() => void)[] = [];

        server.phone = [ringing()];
        await useCalls().refresh();

        startCalls(stops);

        expect(document.querySelector('[data-call]'), 'the card was drawn in the shell’s own tick').toBeNull();
        expect(stops).toHaveLength(1);

        await vi.waitFor(() => expect(document.querySelector('[data-call]')).not.toBeNull(), { timeout: 4000 });

        stops[0]();

        expect(document.querySelector('[data-call]')).toBeNull();
    });

    it('is reached by the shell through the loader alone, and imported eagerly by nothing outside itself', () =>
    {
        const shell = SOURCES['../src/components/app/app-shell.component.azeroth'];

        expect(shell).toMatch(/^import \{ startCalls \} from '\.\.\/\.\.\/stores\/call-loader\.ts';$/m);
        expect(shell).toMatch(/^ {8}startCalls\(stops\);$/m);

        const eager = Object.entries(SOURCES)
            .filter(([path]) => !LAZY.includes(path))
            .filter(([, source]) => [...source.matchAll(/^import (?!type )[^;]*?from '([^']+)';/gm)]
                .some(([, from]) => LAZY.some((lazy) => from.endsWith(lazy.slice(lazy.lastIndexOf('/'))))))
            .map(([path]) => path);

        expect(eager, 'the calls are in a chunk every page pays for').toEqual([]);
        expect(LAZY.filter((lazy) => SOURCES[lazy] === undefined), 'a file this rule is about has moved').toEqual([]);
    });

    it('is never drawn for a shell that went before it arrived', async () =>
    {
        const stops: (() => void)[] = [];

        server.phone = [ringing()];
        await useCalls().refresh();

        startCalls(stops);
        stops[0]();
        await new Promise((resolve) => setTimeout(resolve, 60));
        await settle();

        expect(document.querySelector('[data-call]')).toBeNull();
    });
});

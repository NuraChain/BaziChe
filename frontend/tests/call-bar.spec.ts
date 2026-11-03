import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import type { CallView } from '../src/api.ts';
import Strips from '../src/components/app/strips.component.azeroth';
import CallBar from '../src/components/call/call-bar.component.azeroth';
import CallCard from '../src/components/call/call-card.component.azeroth';
import CallSheet from '../src/components/call/call-view.component.azeroth';
import '../src/icons/all.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { begin } from '../src/components/call/call.ts';
import { callBar, offerCallBar } from '../src/stores/call-bar.ts';
import { useCalls } from '../src/stores/calls.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { setVoiceMedia, useVoice, type VoicePerson } from '../src/stores/voice.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
};

const track = { stop: () => undefined } as unknown as MediaStreamTrack;

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

const reza = (more: Partial<VoicePerson> = {}): VoicePerson => ({ who: 'reza.t', me: false, muted: false, talk: true, link: 'connected', speaking: false, silenced: false, volume: 1, ...more });

/**
 * The reader in the call's room, as far as the voice store says: a join puts this tab there, and the
 * people in the room are whoever `heard` names (nobody but the reader when it is empty).
 */
const inRoom = (heard: () => VoicePerson[] = () => [reza()]) =>
{
    const voice = useVoice();
    let room: string | null = null;

    vi.spyOn(voice, 'table').mockImplementation(() => room);
    vi.spyOn(voice, 'joining').mockImplementation(() => false);
    vi.spyOn(voice, 'mic').mockImplementation(() => 'live');
    vi.spyOn(voice, 'join').mockImplementation(async (asked) =>
    {
        room = asked;
    });
    vi.spyOn(voice, 'leave').mockImplementation(() =>
    {
        room = null;
    });
    vi.spyOn(voice, 'people').mockImplementation(() => (room === null ? [] : heard()));

    return {
        muting: vi.spyOn(voice, 'toggleMute').mockImplementation(() => undefined)
    };
};

/** A call answered in this tab five seconds ago, read back from the server as live. */
const answered = async () =>
{
    const calls = useCalls();

    server.phone = [call()];
    await calls.refresh();
    await calls.accept('call-9');
    await settle();

    server.phone = [call({ state: 'live', answeredAt: new Date(clock.now() - 5000).toISOString() })];
    await calls.refresh();
    await settle();
};

const text = (container: HTMLElement, attribute: string) => container.querySelector(`[${ attribute }]`)?.textContent?.trim() ?? '';

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
    useOverlay().reset();
    useCalls().reset();
    setVoiceMedia(() => ({ getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) }) as unknown as MediaDevices);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await useSocial().refresh();
    await settle();
    server.calls = [];
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useCalls().reset();
    useOverlay().reset();
    useToasts().reset();
    useRealtime().reset();
    setVoiceMedia(null);
});

describe('the bar a live call draws across the top of the page', () =>
{
    it('is drawn by the strips once the calls’ chunk offers it, and goes when that is withdrawn', async () =>
    {
        const { container } = renderTest(() => Strips({}) as HTMLElement);

        await settle();
        expect(container.querySelector('[data-offered]')).toBeNull();

        const unbar = offerCallBar(() =>
        {
            const offered = document.createElement('div');

            offered.setAttribute('data-offered', '');
            return offered;
        });

        await settle();
        expect(container.querySelector('[data-offered]')).not.toBeNull();

        unbar();
        await settle();
        expect(container.querySelector('[data-offered]')).toBeNull();
    });

    it('says who the call is with and for how long, and offers the microphone and the way out', async () =>
    {
        const voice = inRoom();

        await answered();

        const { container } = renderTest(() => CallBar({}) as HTMLElement);

        await settle();

        expect(container.querySelector('[data-call-bar] button')?.getAttribute('aria-label')).toBe('Open the call with Reza Tehrani');
        expect(text(container, 'data-call-bar-status')).toBe('0:05');

        clock.advance(1000);
        await settle();
        expect(text(container, 'data-call-bar-status')).toBe('0:06');

        fire(container.querySelector<HTMLButtonElement>('[data-call-bar-mute] button')!, 'click');
        expect(voice.muting).toHaveBeenCalled();

        fire(container.querySelector<HTMLButtonElement>('[data-call-bar-hang-up] button')!, 'click');
        await settle();
        expect(server.calls).toContain('calls.hangUp');
    });

    it('says Connecting until somebody is heard, and where another device has the call, offers no microphone', async () =>
    {
        let heard: VoicePerson[] = [];

        inRoom(() => heard);
        await answered();

        const { container } = renderTest(() => CallBar({}) as HTMLElement);

        await settle();
        expect(text(container, 'data-call-bar-status')).toBe('Connecting…');

        heard = [reza()];
        cleanup();

        const again = renderTest(() => CallBar({}) as HTMLElement).container;

        await settle();
        expect(text(again, 'data-call-bar-status')).toBe('0:05');

        cleanup();
        useCalls().reset();
        server.phone = [call({ state: 'live', answeredAt: new Date(0).toISOString() })];
        await useCalls().refresh();

        const elsewhere = renderTest(() => CallBar({}) as HTMLElement).container;

        await settle();
        expect(text(elsewhere, 'data-call-bar-status')).toBe('In a call on another device');
        expect(elsewhere.querySelector('[data-call-bar-mute]')).toBeNull();
        expect(elsewhere.querySelector('[data-call-bar-hang-up] button'), 'a call on another device can still be hung up from here').not.toBeNull();
    });

    it('is offered while the calls’ chunk runs, and withdrawn when it stops', () =>
    {
        expect(callBar()).toBeNull();

        const stop = begin();

        expect(callBar()).not.toBeNull();

        stop();
        expect(callBar()).toBeNull();
    });

    it('counts each bar on its own, however often one lets go', () =>
    {
        const calls = useCalls();
        const one = calls.bar();
        const other = calls.bar();

        one();
        one();
        expect(calls.barred(), 'the other bar is still there').toBe(true);

        other();
        expect(calls.barred()).toBe(false);
    });

    it('draws nothing for a call that is not live', async () =>
    {
        server.phone = [call()];
        await useCalls().refresh();

        const { container } = renderTest(() => CallBar({}) as HTMLElement);

        await settle();
        expect(container.querySelector('[data-call-bar]')).toBeNull();
    });

    it('opens the call’s view at a press', async () =>
    {
        inRoom();
        await answered();

        const { container } = renderTest(() => CallBar({}) as HTMLElement);

        await settle();
        fire(container.querySelector<HTMLButtonElement>('[data-call-bar] button')!, 'click');

        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.id)).toContain('call-view'), { timeout: 8000 });
    }, 10_000);

    it('leaves the live call to itself while it is drawn, and a ring to the card', async () =>
    {
        const calls = useCalls();

        inRoom();

        const card = renderTest(() => CallCard({}) as HTMLElement).container;

        renderTest(() => CallBar({}) as HTMLElement);
        await settle();
        expect(calls.barred(), 'a bar on the page says so').toBe(true);

        server.phone = [call()];
        await calls.refresh();
        await settle();
        expect(card.querySelector('[data-call-state="ringing"]'), 'a ring is the card’s whatever the bar').not.toBeNull();

        await answered();
        expect(card.querySelector('[data-call]'), 'the live call is the bar’s').toBeNull();

        cleanup();
        expect(calls.barred(), 'and a bar that has gone says so too').toBe(false);

        const alone = renderTest(() => CallCard({}) as HTMLElement).container;

        await settle();
        expect(alone.querySelector('[data-call-state="live"]'), 'with no bar, the card has the live call').not.toBeNull();

        fire(alone.querySelector<HTMLButtonElement>('button[aria-label="Open the call with Reza Tehrani"]')!, 'click');
        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.id), 'and the way into its view').toContain('call-view'), { timeout: 8000 });
    }, 10_000);
});

describe('the call’s view', () =>
{
    let closed = 0;

    const sheet = async () =>
    {
        closed = 0;

        const { container } = renderTest(() => CallSheet({ overlayId: 'call-view', close: () => (closed += 1) }) as HTMLElement);

        await settle();
        return container;
    };

    it('names the call and its person, with their line, the microphone, the panels and the way out', async () =>
    {
        const voice = inRoom();
        const stopLines = vi.fn();
        const watched = vi.spyOn(useVoice(), 'watchLines').mockImplementation(() => stopLines);

        await answered();

        const container = await sheet();

        expect(container.querySelector('h2')?.textContent).toBe('Call with Reza Tehrani');
        expect(text(container, 'data-call-view-status')).toBe('0:05');
        expect(container.querySelector('li.voice-peer[data-who="reza.t"]'), 'their line').not.toBeNull();
        expect(container.querySelector('[role="meter"]'), 'the microphone’s panel').not.toBeNull();
        expect(watched, 'the lines are watched while it is open').toHaveBeenCalledTimes(1);

        fire(container.querySelector<HTMLButtonElement>('[data-call-view-mute] button')!, 'click');
        expect(voice.muting).toHaveBeenCalled();

        fire(container.querySelector<HTMLButtonElement>('[data-call-view-hang-up] button')!, 'click');
        await settle();

        expect(server.calls).toContain('calls.hangUp');
        expect(closed, 'the view goes with the call').toBe(1);

        cleanup();
        expect(stopLines).toHaveBeenCalled();
    });

    it('rings them while they speak, and says when they have muted themselves', async () =>
    {
        let them = reza();

        inRoom(() => [them]);
        await answered();

        const quiet = await sheet();

        expect(quiet.querySelector('[data-speaking]')).toBeNull();
        expect(quiet.querySelector('[data-call-view-muted]')).toBeNull();

        cleanup();
        them = reza({ speaking: true, muted: true });

        const loud = await sheet();

        expect(loud.querySelector('[data-speaking]')).not.toBeNull();
        expect(text(loud, 'data-call-view-muted')).toBe('Reza Tehrani has muted their microphone');
    });

    it('says another device has the call, with no microphone of this tab’s to offer', async () =>
    {
        server.phone = [call({ state: 'live', answeredAt: new Date(0).toISOString() })];
        await useCalls().refresh();

        const container = await sheet();

        expect(container.textContent).toContain('In a call on another device');
        expect(container.querySelector('[data-call-view-mute]')).toBeNull();
        expect(container.querySelector('li.voice-peer')).toBeNull();
        expect(container.querySelector('[data-call-view-hang-up] button')).not.toBeNull();
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        inRoom();
        await answered();

        const container = await sheet();

        expect(container.querySelector('h2')?.textContent).toBe('تماس با Reza Tehrani');
        expect(container.querySelector('[data-call-view] span[dir]')?.getAttribute('dir'), 'the name stands where the reader starts').toBe('rtl');
        expect(container.querySelector('[data-call-view] span[dir] bdi')?.textContent).toBe('Reza Tehrani');
    });
});

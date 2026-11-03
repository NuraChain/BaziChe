import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import ChatList from '../src/components/chat/chat-list.component.azeroth';
import { ALL_ICONS } from '../src/icons/all.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCallHistory } from '../src/stores/call-history.store.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

/**
 * The Calls tab on the chat list (MS-D39): the reader's calls that ended, newest first, thirty a
 * page, each with whom, which way it went and how it ended in its line's words, and the way to call
 * a friend back; nothing said before the server has answered.
 */

const settle = async () =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

const AT = new Date(380_000).toISOString();

type Ended = (typeof server.callHistory)[number];

const direct = (id: string, room: string, handle: string, change: Partial<Ended> = {}): Ended =>
    ({ id, room, kind: 'direct', with: handle, out: true, ending: 'answered', at: AT, seconds: 312, ...change });

const SAMPLE: Ended[] = [
    direct('k3', 'c-reza', 'reza.t', { out: false, ending: 'missed', seconds: 0 }),
    { id: 'k2', room: 'c-friday', kind: 'group', group: 'friday-night-crew', out: true, ending: 'answered', at: AT, seconds: 754 },
    direct('k1', 'c-sara', 'sara.k')
];

const listed = () =>
{
    const table: Route[] = [{ path: '/app/chats', component: (): HTMLElement => ChatList({ pane: false }) as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/chats'), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

const callsTab = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((one) => one.textContent?.trim() === useLocale().t('chats.tab.calls'));

const open = async (container: HTMLElement) =>
{
    await vi.waitFor(() => expect(callsTab(container)).toBeDefined(), { timeout: 4000 });
    fire(callsTab(container)!, 'click');
};

const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-call-record]')];

const words = (row: HTMLElement) => ({
    name: row.querySelector('[data-call-record-name]')?.textContent?.trim(),
    said: row.querySelector('[data-call-record-said]')?.textContent?.trim(),
    missed: row.querySelector('[data-call-record-said]')?.classList.contains('text-danger'),
    back: row.querySelector('[data-call-record-back] button')?.getAttribute('aria-label') ?? null,
    to: row.querySelector('a')?.getAttribute('href')
});

/** Which of the three call marks a row draws, by the paths of its drawing. */
const way = (row: HTMLElement) =>
{
    const drawn = [...row.querySelectorAll('[data-call-record-said] svg [d]')].map((node) => node.getAttribute('d')).join('|');

    return (['call-in', 'call-out', 'call-missed'] as const).find((name) => ALL_ICONS[name].map(([, attrs]) => String(attrs.d)).filter((d) => d !== 'undefined').join('|') === drawn) ?? null;
};

const rings = async () =>
{
    socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'me', id: 'calls', at: 0 });
    (runtime().clock as ManualClock).advance(NUDGE_WINDOW_MS);
    await settle();
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 21 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    useChat().reset();
    useToasts().reset();
    useCallHistory().reset();

    const group = server.groups.find((one) => one.slug === 'friday-night-crew')!;

    group.role = 'member';
    await useGroups().refresh();
    await useSocial().refresh();
    await useChat().refresh();
});

afterEach(() =>
{
    cleanup();
    useChat().reset();
    useRealtime().reset();
});

describe('the Calls tab', () =>
{
    it('lists the calls that ended, newest first, with whom, which way and how each ended, and the way to call a friend back', async () =>
    {
        server.callHistory = SAMPLE.map((one) => ({ ...one }));

        const container = listed();

        await open(container);
        await vi.waitFor(() => expect(rows(container)).toHaveLength(3), { timeout: 4000 });
        await vi.waitFor(() => expect(words(rows(container)[0]).name).toBe('Reza Tehrani'), { timeout: 4000 });

        expect(rows(container).map(words)).toEqual([
            { name: 'Reza Tehrani', said: 'Missed call', missed: true, back: 'Call Reza Tehrani', to: '/app/chats/c-reza' },
            { name: 'Friday Night Crew', said: 'Voice chat ended · 12:34', missed: false, back: null, to: '/app/chats/c-friday' },
            { name: 'Sara Kamali', said: 'Outgoing call · 5:12', missed: false, back: 'Call Sara Kamali', to: '/app/chats/c-sara' }
        ]);
        expect(rows(container).map(way), 'which way each went').toEqual(['call-missed', 'call-out', 'call-out']);
        const rooms = [...container.querySelectorAll('h2, h3, p, span')].find((node) => node.textContent?.trim() === 'Nothing in this tab.');

        expect(useChat().conversations().length, 'there are conversations to list').toBeGreaterThan(0);
        expect(rooms?.closest('.hidden') ?? null, 'the calls, and not the conversations').not.toBeNull();
        expect(rows(container).every((row) => (row.querySelector('[data-call-record-at]')?.textContent ?? '').trim() !== ''), 'when').toBe(true);
        expect(container.querySelector('[data-call-history] ul')?.getAttribute('aria-label')).toBe('Calls');

        server.calls = [];
        fire(rows(container)[2].querySelector<HTMLButtonElement>('[data-call-record-back] button')!, 'click');

        await vi.waitFor(() => expect(server.calls).toContain('calls.ring'), { timeout: 4000 });
    });

    it('offers no call back to somebody who is not a friend, and says an incoming call as one', async () =>
    {
        server.callHistory = [direct('k9', 'c-peyman', 'peyman', { out: false, seconds: 65 })];

        const container = listed();

        expect(usePeople().byHandle('peyman'), 'nobody the page has met').toBeNull();

        await open(container);
        await vi.waitFor(() => expect(rows(container)).toHaveLength(1), { timeout: 4000 });

        await vi.waitFor(() => expect(words(rows(container)[0]).name, 'somebody the page had not met, asked for').toBe('Peyman Salehi'), { timeout: 4000 });
        expect(words(rows(container)[0])).toMatchObject({ said: 'Incoming call · 1:05', missed: false, back: null });
        expect(way(rows(container)[0])).toBe('call-in');
    });

    it('says nothing about the calls before the server has answered, and that it could not read them when it could not', async () =>
    {
        let release = () => undefined as void;

        server.callHistory = SAMPLE.map((one) => ({ ...one }));
        server.historyHeld = new Promise<void>((resolve) => release = resolve);

        const container = listed();

        await open(container);
        await vi.waitFor(() => expect(container.querySelector('[data-call-history] [data-reading]')).not.toBeNull(), { timeout: 4000 });
        expect(container.textContent, 'no word of having no calls').not.toContain('No calls yet');

        release();
        await vi.waitFor(() => expect(rows(container)).toHaveLength(3), { timeout: 4000 });
        expect(container.querySelector('[data-call-history] [data-reading]')).toBeNull();

        cleanup();
        server.historyHeld = null;
        server.historyRefused = true;

        const refused = listed();

        await open(refused);
        await vi.waitFor(() => expect(refused.querySelector('[data-call-history] [role="alert"]')?.textContent).toContain('Your calls could not be read'), { timeout: 4000 });
        expect(refused.textContent).not.toContain('No calls yet');

        server.historyRefused = false;
        fire([...refused.querySelectorAll<HTMLButtonElement>('[data-call-history] button')].find((one) => one.textContent?.trim() === 'Try again')!, 'click');

        await vi.waitFor(() => expect(rows(refused)).toHaveLength(3), { timeout: 4000 });

        server.historyRefused = true;
        await rings();

        await vi.waitFor(() => expect(refused.querySelector('[data-call-history] [data-compact]')?.textContent).toContain('Your calls could not be read'), { timeout: 4000 });
        expect(rows(refused), 'what was on screen, kept').toHaveLength(3);
    });

    it('says there are no calls yet once the server has said so', async () =>
    {
        const container = listed();

        await open(container);
        await vi.waitFor(() => expect(container.textContent).toContain('No calls yet'), { timeout: 4000 });
        expect(container.textContent).toContain('Calls you make or answer, and the voice chats you join, are listed here.');
        expect(rows(container)).toEqual([]);
    });

    it('turns older pages, reads the first again when the reader\'s calls change and lets the older ones go, keeping each row', async () =>
    {
        server.callHistory = Array.from({ length: 35 }, (_, index) => direct(`old-${ index }`, 'c-sara', 'sara.k', { seconds: index }));

        const container = listed();

        await open(container);
        await vi.waitFor(() => expect(rows(container)).toHaveLength(30), { timeout: 4000 });

        const first = rows(container)[0];
        const more = [...container.querySelectorAll<HTMLButtonElement>('[data-call-history] button')].find((one) => one.textContent?.includes('Show older calls'));

        expect(more, 'Show older calls').toBeDefined();
        fire(more!, 'click');

        await vi.waitFor(() => expect(rows(container)).toHaveLength(35), { timeout: 4000 });
        expect(container.textContent, 'nothing past the last page').not.toContain('Show older calls');
        expect(server.calls).toContain('calls.history 30');

        server.callHistory = [direct('new', 'c-reza', 'reza.t', { out: false, ending: 'missed', seconds: 0 }), ...server.callHistory];

        const reads = () => server.calls.filter((one) => one === 'calls.history').length;

        (runtime().clock as ManualClock).advance(NUDGE_WINDOW_MS);
        await settle();
        await vi.waitFor(() => expect(rows(container), 'the rings of connecting, already answered').toHaveLength(30), { timeout: 4000 });
        fire([...container.querySelectorAll<HTMLButtonElement>('[data-call-history] button')].find((one) => one.textContent?.includes('Show older calls'))!, 'click');
        await vi.waitFor(() => expect(rows(container)).toHaveLength(36), { timeout: 4000 });

        const before = reads();

        socket.deliver({ v: 1, t: 'nudge', n: 2, scope: 'me', id: 'social', at: 0 });
        (runtime().clock as ManualClock).advance(NUDGE_WINDOW_MS);
        await settle();

        expect(reads(), 'a ring about something else reads nothing').toBe(before);
        expect(rows(container), 'and leaves the older pages').toHaveLength(36);

        await rings();
        expect(reads(), 'one ring, one read').toBe(before + 1);

        await vi.waitFor(() => expect(rows(container)[0]?.getAttribute('data-call-record')).toBe('new'), { timeout: 4000 });
        expect(rows(container), 'the first page alone').toHaveLength(30);
        expect(rows(container)[1], 'a call already drawn is the row it was').toBe(first);
    });

    it('is let go of once nothing shows it', async () =>
    {
        server.callHistory = SAMPLE.map((one) => ({ ...one }));

        const container = listed();

        await open(container);
        await vi.waitFor(() => expect(rows(container)).toHaveLength(3), { timeout: 4000 });

        cleanup();
        await settle();

        expect(useCallHistory().calls()).toEqual([]);
        expect(useCallHistory().reading()).toBe('reading');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.callHistory = SAMPLE.map((one) => ({ ...one }));

        const container = listed();

        await open(container);
        await vi.waitFor(() => expect(rows(container)).toHaveLength(3), { timeout: 4000 });
        await vi.waitFor(() => expect(words(rows(container)[0]).name).toBe('Reza Tehrani'), { timeout: 4000 });

        expect(callsTab(container)?.textContent?.trim()).toBe('تماس‌ها');
        expect(rows(container).map((row) => words(row).said)).toEqual(['تماس بی‌جواب', 'چت صوتی تموم شد · ۱۲:۳۴', 'تماس خروجی · ۵:۱۲']);
    });
});

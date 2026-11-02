import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import ForwardSheet from '../src/components/chat/forward-sheet.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const SLUG = 'friday-night-crew';

const ROOM = 'c-friday';

beforeEach(() =>
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
    usePresence().reset();
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    useChat().reset();
    useToasts().reset();
});

afterEach(() =>
{
    useChat().reset();
    useRealtime().reset();
    cleanup();
});

/** The Friday room made its group's, with the reader standing in the group as a test says, and both lists read again. */
const arrange = async (stand: { role?: 'member' | 'admin'; muted?: { until?: string }; send?: boolean; media?: boolean }) =>
{
    const group = server.groups.find((one) => one.slug === SLUG)!;

    server.conversations.find((row) => row.id === ROOM)!.groupId = SLUG;
    group.role = stand.role ?? 'member';
    group.switches = { ...group.switches, send: stand.send ?? true, media: stand.media ?? true };
    if (stand.muted !== undefined)
    {
        group.muted = stand.muted;
    }

    await useChat().refresh();
    await useGroups().refresh();
    await vi.waitFor(() => expect(useChat().conversation(ROOM)?.groupId).toBe(SLUG), { timeout: 4000 });
    await vi.waitFor(() => expect(useGroups().byId(SLUG)?.role).toBe(stand.role ?? 'member'), { timeout: 4000 });
};

/** A line to forward, of the kind a test says: the sheet reads nothing of it but its kind and its gist. */
const line = (kind: Message['kind']) =>
    ({ id: 'm-forward', conversationId: 'c-other', kind, from: 'sara.k', text: 'see you at nine', at: 0, reactions: [] }) as unknown as Message;

/** The rooms the sheet offers, by their titles. */
const offered = (message: Message) =>
{
    const { container } = renderTest(() => ForwardSheet({ message, overlayId: 'forward', close: () => undefined }) as Rendered);

    return () => [...container.querySelectorAll('li button')].map((button) => button.textContent?.trim() ?? '');
};

describe('the rooms a line can be forwarded to', () =>
{
    it('never offers a room whose host keeps its chat quiet', async () =>
    {
        await vi.waitFor(() => expect(useChat().conversation('c-sara')).toBeDefined(), { timeout: 4000 });

        const before = offered(line('text'));

        await vi.waitFor(() => expect(before().length).toBeGreaterThan(1), { timeout: 4000 });
        const all = before().length;

        cleanup();
        server.conversations.find((row) => row.id === 'c-sara')!.quiet = true;
        await useChat().refresh();
        await vi.waitFor(() => expect(useChat().conversation('c-sara')?.quiet).toBe(true), { timeout: 4000 });

        const after = offered(line('text'));

        await vi.waitFor(() => expect(after().length).toBeGreaterThan(0), { timeout: 4000 });
        expect(after().length, 'the quiet room is the one left out').toBe(all - 1);
    });

    it('leaves out a group the reader is muted in, and offers it again once the mute has run out', async () =>
    {
        await arrange({ muted: { until: new Date(runtime().clock.now() + 60_000).toISOString() } });

        const rooms = offered(line('text'));

        await vi.waitFor(() => expect(rooms().length).toBeGreaterThan(0), { timeout: 4000 });
        expect(rooms().some((title) => title.includes('Friday Night Crew')), 'muted there').toBe(false);

        cleanup();
        (runtime().clock as ManualClock).advance(120_000);

        const later = offered(line('text'));

        await vi.waitFor(() => expect(later().some((title) => title.includes('Friday Night Crew'))).toBe(true), { timeout: 4000 });
    });

    it('leaves out a group whose members keep to reading, and offers it to its staff', async () =>
    {
        await arrange({ send: false });

        const rooms = offered(line('text'));

        await vi.waitFor(() => expect(rooms().length).toBeGreaterThan(0), { timeout: 4000 });
        expect(rooms().some((title) => title.includes('Friday Night Crew'))).toBe(false);

        cleanup();
        await arrange({ send: false, role: 'admin' });

        const staff = offered(line('text'));

        await vi.waitFor(() => expect(staff().some((title) => title.includes('Friday Night Crew'))).toBe(true), { timeout: 4000 });
    });

    it('takes words, and not a voice message or a file, to a group that keeps media to its staff', async () =>
    {
        await arrange({ media: false });

        const words = offered(line('text'));

        await vi.waitFor(() => expect(words().some((title) => title.includes('Friday Night Crew'))).toBe(true), { timeout: 4000 });

        cleanup();

        for (const kind of ['voice', 'file'] as const)
        {
            const media = offered(line(kind));

            await vi.waitFor(() => expect(media().length).toBeGreaterThan(0), { timeout: 4000 });
            expect(media().some((title) => title.includes('Friday Night Crew')), kind).toBe(false);
            cleanup();
        }
    });
});

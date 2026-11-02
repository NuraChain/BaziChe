import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import { manualClock } from '../src/lib/clock.ts';
import { whyFailed } from '../src/lib/failure.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import GroupPage from '../src/pages/app/group.page.azeroth';
import { useGroupAdmin } from '../src/stores/group-admin.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

/**
 * The staff's panels of a group's page are chunks of their own, fetched when a tab is first opened:
 * a placeholder while one comes, and what kept it from coming with Try again when it does not.
 */

/** How the next panel's chunk comes: held until let go, or refused with a failure. */
const way = vi.hoisted(() => ({ held: null as Promise<void> | null, refused: null as unknown }));

vi.mock('../src/lib/chunks.ts', async (original) =>
{
    const real = await original<typeof import('../src/lib/chunks.ts')>();

    return {
        ...real,
        chunk: <T>(load: () => Promise<T>) => async () =>
        {
            const refused = way.refused;

            if (refused !== null)
            {
                way.refused = null;
                throw refused;
            }
            await way.held;
            return await load();
        }
    };
});

const SLUG = 'friday-night-crew';

const NOW = 1_800_000_000_000;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const t = (key: Parameters<ReturnType<typeof useLocale>['t']>[0], params?: Record<string, string>) => useLocale().t(key, params);

const owned = () =>
{
    const group = server.groups.find((one) => one.slug === SLUG)!;

    group.owner = 'alex';
    group.role = 'owner';
};

const opened = (search: string) =>
{
    const routes: Route[] = [{ path: '/app/groups/:id', component: (): HTMLElement => GroupPage() as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(`/app/groups/${ SLUG }${ search }`), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

/** The placeholder in sight: the members list keeps one of its own under a hidden section. */
const coming = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-reading]')].find((one) => one.closest('[hidden]') === null) ?? null;

const logOf = (container: HTMLElement) => container.querySelector<HTMLElement>(`section[aria-label="${ t('groups.tab.log') }"]`);

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 7 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useSocial().reset();
    useGroups().reset();
    useGroupAdmin().reset();
    useOverlay().reset();
    useToasts().reset();
    way.held = null;
    way.refused = null;
    await settle();
});

afterEach(() =>
{
    cleanup();
    useGroups().reset();
    useGroupAdmin().reset();
    useOverlay().reset();
    useRealtime().reset();
    way.held = null;
    way.refused = null;
});

describe('a staff panel of a group’s page', () =>
{
    it('is a placeholder until its chunk has come, and the panel once it has', async () =>
    {
        owned();

        let letGo: () => void = () => undefined;
        way.held = new Promise<void>((resolve) =>
        {
            letGo = resolve;
        });

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(coming(container)).not.toBeNull(), { timeout: 4000 });

        expect(coming(container)?.textContent, 'said to a screen reader').toContain(t('common.loading'));
        expect(logOf(container), 'nothing of the panel yet').toBeNull();
        expect(server.calls, 'nothing asked of the server for it yet').not.toContain('groups.log');

        letGo();

        await vi.waitFor(() => expect(logOf(container)).not.toBeNull(), { timeout: 4000 });
        expect(coming(container), 'the placeholder gone').toBeNull();
        await vi.waitFor(() => expect(server.calls).toContain('groups.log'), { timeout: 4000 });
    });

    it('says what kept its chunk from coming, and comes at Try again', async () =>
    {
        owned();

        const lost = new TypeError('Failed to fetch');
        way.refused = lost;

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(container.querySelector('[role="alert"][data-compact]')).not.toBeNull(), { timeout: 4000 });

        const failed = container.querySelector<HTMLElement>('[role="alert"][data-compact]')!;

        expect(failed.textContent).toContain(t(whyFailed(lost)));
        expect(logOf(container)).toBeNull();

        fire([...failed.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === t('common.retry'))!, 'click');

        await vi.waitFor(() => expect(logOf(container)).not.toBeNull(), { timeout: 4000 });
        expect(container.querySelector('[role="alert"][data-compact]'), 'the failure gone').toBeNull();
    });
});

describe('the group’s page', () =>
{
    const SOURCES = import.meta.glob('../src/pages/app/group.page.azeroth', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

    it('carries none of the staff’s panels itself', () =>
    {
        const page = Object.values(SOURCES)[0];

        for (const panel of ['group-requests', 'group-reports', 'group-links', 'group-banned', 'group-log', 'group-permissions'])
        {
            expect(page, panel).not.toContain(`components/social/${ panel }.component.azeroth`);
        }
        expect(page).toContain('lazy-group-panel.component.azeroth');
    });
});

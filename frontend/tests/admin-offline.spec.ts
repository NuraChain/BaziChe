import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter } from 'azerothjs';

import AdminOffline from '../src/components/admin/admin-offline.component.azeroth';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useReports } from '../src/stores/reports.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'moderator' as const };

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const offline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !on });

const strip = (root: ParentNode = document) => root.querySelector<HTMLElement>('[data-offline]');

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-11-01T21:00:00.000Z')), seed: 7 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useToasts().dismissAll();
    useReports().reset();
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    Reflect.deleteProperty(navigator, 'onLine');
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the admin with no network', () =>
{
    it('says so when it opens offline, and goes once the network is back', async () =>
    {
        offline(true);
        renderTest(() => AdminOffline({}) as HTMLElement);
        await settle();

        expect(strip()?.textContent?.trim()).toBe('You’re offline. Nothing here changes until you’re back.');
        expect(strip()?.getAttribute('role')).toBe('status');

        offline(false);
        window.dispatchEvent(new Event('online'));
        await settle();

        expect(strip()).toBeNull();
    });

    it('says so the moment the network goes, and nothing while it is there', async () =>
    {
        renderTest(() => AdminOffline({}) as HTMLElement);
        await settle();

        expect(strip()).toBeNull();

        offline(true);
        window.dispatchEvent(new Event('offline'));
        await settle();

        expect(strip()).not.toBeNull();
    });

    it('stops listening once it is gone', async () =>
    {
        const added = vi.spyOn(window, 'addEventListener');
        const removed = vi.spyOn(window, 'removeEventListener');

        renderTest(() => AdminOffline({}) as HTMLElement);
        await settle();
        cleanup();

        const heard = added.mock.calls.filter(([kind]) => kind === 'online' || kind === 'offline').map(([kind, listener]) => [kind, listener]);
        const dropped = removed.mock.calls.filter(([kind]) => kind === 'online' || kind === 'offline').map(([kind, listener]) => [kind, listener]);

        expect(heard).toHaveLength(2);
        expect(dropped).toEqual(heard);

        added.mockRestore();
        removed.mockRestore();
    });

    it('is drawn by the admin around every section', async () =>
    {
        offline(true);
        useSession().establish(ALEX);

        const router = createRouter({ routes: routes.filter((route) => route.path === '/admin'), history: createMemoryHistory('/admin/people'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() =>
        {
            if (router.pending() || container.querySelector('#admin-main h1') === null)
            {
                throw new Error('waiting for the admin');
            }
        }, { timeout: 5_000, interval: 10 });
        await settle();

        expect(strip(container.querySelector('#admin-shell')!)).not.toBeNull();
    });

    it('speaks the reader’s language', async () =>
    {
        useLocale().setLocale('fa');
        offline(true);
        renderTest(() => AdminOffline({}) as HTMLElement);
        await settle();

        expect(strip()?.textContent?.trim()).toBe('آفلاینی. تا وقتی برنگشتی، اینجا چیزی عوض نمی‌شه.');
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Router } from 'azerothjs';

import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import '../src/locales/admin-catalogue.ts';
import '../src/locales/app-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useReports } from '../src/stores/reports.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { establishAccount, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };

const settle = async () =>
{
    for (let round = 0; round < 4; round += 1)
    {
        for (let step = 0; step < 16; step += 1)
        {
            await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};

const opened = async (at: string, ready: string) =>
{
    const router: Router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const lost = () =>
    {
        const element = document.createElement('p');
        element.dataset.lost = '';
        return element;
    };
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({ fallback: lost }) }) as HTMLElement);

    await vi.waitFor(() =>
    {
        if (router.pending() || container.querySelector(ready) === null)
        {
            throw new Error(`waiting for ${ ready }`);
        }
    }, { timeout: 5_000, interval: 10 });
    await settle();

    return { router, container };
};

const home = (root: ParentNode, words: string) => [...root.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent?.trim() === words) ?? null;

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
    useSession().reset();
    useLocale().setLocale('en');
});

describe('an address inside the app that holds no page', () =>
{
    beforeEach(() =>
    {
        useSession().establish(establishAccount());
    });

    it('says so inside the app, which keeps its nav, with the way home', async () =>
    {
        const { router, container } = await opened('/app/frinds', '#app-main h1');

        expect(container.querySelector('[data-lost]'), 'the whole app gave way to the public page that is not there').toBeNull();
        expect(container.querySelector('#app-main h1')?.textContent, 'the page did not name itself').toBe('There’s no page here.');
        expect(container.querySelectorAll('h1'), 'two headings named the one page').toHaveLength(1);
        expect(container.querySelector('#app-main')?.textContent).toContain('The link may be out of date, or the address mistyped.');
        expect(container.querySelector('#app-shell a[href="/app/friends"]'), 'the nav went with the page').not.toBeNull();
        expect(home(container.querySelector('#app-main')!, 'Go to Home')?.getAttribute('href')).toBe('/app');
        expect(router.location().pathname, 'the address the reader typed was taken from them').toBe('/app/frinds');
    });

    it('takes every depth, and leaves every page the app has where it was', async () =>
    {
        const deep = await opened('/app/games/ludo/create/again', '#app-main');

        expect(deep.container.querySelector('#app-main')?.textContent).toContain('There’s no page here.');

        cleanup();

        const app = routes.find((route) => route.path === '/app')!;

        expect(app.children?.at(-1)?.path, 'a catch-all before a page would answer for it').toMatch(/^\*/);
        expect(app.children?.filter((child) => child.path.startsWith('*'))).toHaveLength(1);
    });

    it('speaks the reader’s language', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = await opened('/app/frinds', '#app-main');

        expect(container.querySelector('#app-main')?.textContent).toContain('اینجا صفحه‌ای نیست.');
        expect(home(container.querySelector('#app-main')!, 'برو به خانه')).not.toBeNull();
    });
});

describe('an address inside the admin that holds no section', () =>
{
    const signIn = (staff?: StaffRole) => useSession().establish({ ...ALEX, ...(staff === undefined ? {} : { staff }) });

    it('says so inside the admin for the staff, with the way to the overview', async () =>
    {
        signIn('moderator');

        const { container } = await opened('/admin/nope', '#admin-main h1');

        expect(container.querySelector('[data-lost]')).toBeNull();
        expect(container.querySelector('#admin-main h1')?.textContent).toBe('There’s no page here.');
        expect(home(container.querySelector('#admin-main')!, 'Go to the overview')?.getAttribute('href')).toBe('/admin/overview');
        expect(container.querySelector('#admin-shell a[href="/admin/people"]')).not.toBeNull();

        const admin = routes.find((route) => route.path === '/admin')!;

        expect(admin.children?.at(-1)?.path).toMatch(/^\*/);
    });

    it('is still the page that is not there for anybody whose role opens no section', async () =>
    {
        signIn();

        const { container } = await opened('/admin/nope', '[data-lost]');

        expect(container.querySelector('#admin-shell')).toBeNull();
    });

    it('is still the page that is not there for a section the role does not open', async () =>
    {
        signIn('moderator');

        const { container } = await opened('/admin/money', '[data-lost]');

        expect(container.querySelector('#admin-shell')).toBeNull();
    });
});

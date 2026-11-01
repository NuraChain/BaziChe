import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { ErrorBoundary, RouterProvider, Routes, createEffect, createMemoryHistory, createRouter, createSignal, type Route, type Router } from 'azerothjs';

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

const page = (name: string) => () =>
{
    const element = document.createElement('section');
    element.dataset.page = name;
    element.textContent = name;
    return element;
};

const broken = (): HTMLElement =>
{
    throw new Error('the page could not be drawn');
};

let builds = 0;

const flaky = () =>
{
    builds += 1;

    if (builds === 1)
    {
        throw new Error('the first build broke');
    }

    return page('flaky')();
};

const [tripped, trip] = createSignal(false);

const later = () =>
{
    createEffect(() =>
    {
        if (tripped())
        {
            throw new Error('an effect broke after the page was drawn');
        }
    });

    return page('later')();
};

let fetches = 0;

let reachable = false;

const lost = async () =>
{
    fetches += 1;

    if (!reachable)
    {
        throw new TypeError('Failed to fetch dynamically imported module: /assets/lost.js');
    }

    return { default: page('lost') };
};

const shellOf = (path: string) => routes.find((route) => route.path === path)!;

const APP: Route[] = [
    { path: '', component: page('home') },
    { path: 'fine', component: page('fine') },
    { path: 'boom', component: broken },
    { path: 'flaky', component: flaky },
    { path: 'later', component: later },
    { path: 'lost', lazy: lost }
];

const ADMIN: Route[] = [
    { path: 'overview', component: page('overview') },
    { path: 'boom', component: broken }
];

/** The app's own arrangement: a boundary over every route, as `App` draws it, so a failure that reached it would be seen. */
const opened = async (shell: string, children: Route[], at: string, ready: string) =>
{
    const router: Router = createRouter({ routes: [{ ...shellOf(shell), children }], history: createMemoryHistory(at), scroll: false });
    const whole = () =>
    {
        const element = document.createElement('p');
        element.dataset.whole = '';
        return element;
    };
    const { container } = renderTest(() => RouterProvider({ router, children: () => ErrorBoundary({ fallback: whole, children: () => Routes({}) }) }) as HTMLElement);

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

const failed = (root: ParentNode) => root.querySelector<HTMLElement>('[data-page-failed]');

const retry = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('[data-page-failed] button')].find((one) => one.textContent?.trim() === useLocale().t('common.retry')) ?? null;

const home = (root: ParentNode) => root.querySelector<HTMLAnchorElement>('[data-page-failed] a');

let said: ReturnType<typeof vi.spyOn>;

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
    builds = 0;
    fetches = 0;
    reachable = false;
    trip(false);
    said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() =>
{
    cleanup();
    said.mockRestore();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('a page of the app that throws', () =>
{
    beforeEach(() =>
    {
        useSession().establish(establishAccount());
    });

    it('is a fallback inside the shell, which keeps its nav, and the whole app never falls', async () =>
    {
        const { container } = await opened('/app', APP, '/app/boom', '[data-page-failed]');
        const main = container.querySelector('#app-main');

        expect(container.querySelector('#app-shell')).not.toBeNull();
        expect(container.querySelector('[data-whole]')).toBeNull();
        expect(failed(main!)).not.toBeNull();
        expect(failed(container)?.getAttribute('role')).toBe('alert');
        expect(failed(container)?.querySelector('h1')?.textContent).toBe('This page stopped working.');
        expect(failed(container)?.querySelector('[data-failed-lead]')?.textContent).toBe('Something broke while it was being shown. The rest of Baziche still works.');
        expect(retry(container)).not.toBeNull();
        expect(home(container)?.getAttribute('href')).toBe('/app');
        expect(home(container)?.textContent?.trim()).toBe('Go to Home');
        expect(container.querySelector('#app-shell a[href="/app/friends"]'), 'the nav went with the page').not.toBeNull();
    });

    it('is written down where every failure of a page is', async () =>
    {
        await opened('/app', APP, '/app/boom', '[data-page-failed]');

        expect(said).toHaveBeenCalledWith('[nura] a page threw, and its shell kept the rest of the app', expect.objectContaining({ message: 'the page could not be drawn' }));
    });

    it('is caught when it throws after it was drawn', async () =>
    {
        const { container } = await opened('/app', APP, '/app/later', '[data-page="later"]');

        trip(true);
        await settle();

        expect(container.querySelector('[data-page="later"]')).toBeNull();
        expect(failed(container)).not.toBeNull();
        expect(container.querySelector('[data-whole]')).toBeNull();
        expect(said).toHaveBeenCalledWith('[nura] a page threw, and its shell kept the rest of the app', expect.objectContaining({ message: 'an effect broke after the page was drawn' }));
    });

    it('is built afresh at Try again', async () =>
    {
        const { container } = await opened('/app', APP, '/app/flaky', '[data-page-failed]');

        retry(container)!.click();
        await settle();

        expect(failed(container)).toBeNull();
        expect(container.querySelector('[data-page="flaky"]')).not.toBeNull();
        expect(builds).toBe(2);
    });

    it('says why when its code could not be fetched, and fetches it again at Try again', async () =>
    {
        const { container } = await opened('/app', APP, '/app/lost', '[data-page-failed]');
        const lead = () => failed(container)?.querySelector('[data-failed-lead]')?.textContent;

        expect(lead()).toBe('The server could not be reached. Check your connection, then try again.');

        const before = fetches;

        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

        try
        {
            retry(container)!.click();
            await settle();
        }
        finally
        {
            Reflect.deleteProperty(navigator, 'onLine');
        }

        expect(fetches, 'Try again asked for nothing').toBe(before + 1);
        expect(failed(container)).not.toBeNull();
        expect(lead(), 'the second failure was said as the first').toBe('You are offline. Check your connection, then try again.');
        expect(retry(container)?.getAttribute('aria-busy')).not.toBe('true');

        reachable = true;
        retry(container)!.click();
        await settle();

        expect(failed(container)).toBeNull();
        expect(container.querySelector('[data-page="lost"]')).not.toBeNull();
    });

    it('lets the failure go once the router has gone elsewhere, and draws where it went', async () =>
    {
        const { router, container } = await opened('/app', APP, '/app/boom', '[data-page-failed]');

        router.navigate('/app/fine');
        await settle();

        expect(failed(container)).toBeNull();
        expect(container.querySelector('[data-page="fine"]')).not.toBeNull();
    });

    it('is tried again when the reader comes back to it, and not built again on the way out', async () =>
    {
        const { router, container } = await opened('/app', APP, '/app/flaky', '[data-page-failed]');

        router.navigate('/app/fine');
        await settle();

        expect(container.querySelector('[data-page="fine"]')).not.toBeNull();
        expect(builds, 'the page that failed was built again on the way out').toBe(1);

        router.navigate('/app/flaky');
        await settle();

        expect(failed(container)).toBeNull();
        expect(container.querySelector('[data-page="flaky"]')).not.toBeNull();
        expect(builds).toBe(2);
    });

    it('leads home, and offers no way home on Home itself', async () =>
    {
        const { container } = await opened('/app', APP, '/app/boom', '[data-page-failed]');

        home(container)!.click();
        await settle();

        expect(failed(container)).toBeNull();
        expect(container.querySelector('[data-page="home"]')).not.toBeNull();

        cleanup();

        const homeless = await opened('/app', [{ path: '', component: broken }, ...APP.slice(1)], '/app', '[data-page-failed]');

        expect(home(homeless.container)).toBeNull();
        expect(retry(homeless.container)).not.toBeNull();
    });

    it('speaks the reader’s language', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = await opened('/app', APP, '/app/boom', '[data-page-failed]');

        expect(failed(container)?.querySelector('h1')?.textContent).toBe('این صفحه از کار افتاد.');
        expect(failed(container)?.querySelector('[data-failed-lead]')?.textContent).toBe('موقع نشون دادنش یه چیزی خراب شد. بقیهٔ بازیچه هنوز کار می‌کنه.');
        expect(home(container)?.textContent?.trim()).toBe('برو به خانه');
        expect(retry(container)).not.toBeNull();
    });
});

describe('a section of the admin that throws', () =>
{
    const signIn = (staff: StaffRole) => useSession().establish({ ...ALEX, staff });

    it('is a fallback inside the admin, which keeps its sections, and leads to the overview', async () =>
    {
        signIn('moderator');

        const { container } = await opened('/admin', ADMIN, '/admin/boom', '[data-page-failed]');

        expect(container.querySelector('#admin-shell')).not.toBeNull();
        expect(container.querySelector('[data-whole]')).toBeNull();
        expect(failed(container.querySelector('#admin-main')!)).not.toBeNull();
        expect(container.querySelector('#admin-shell a[href="/admin/people"]'), 'the sections went with the page').not.toBeNull();
        expect(home(container)?.getAttribute('href')).toBe('/admin/overview');
        expect(home(container)?.textContent?.trim()).toBe('Go to the overview');

        home(container)!.click();
        await settle();

        expect(failed(container)).toBeNull();
        expect(container.querySelector('[data-page="overview"]')).not.toBeNull();
    });

    it('says the way to the overview in Persian', async () =>
    {
        signIn('admin');
        useLocale().setLocale('fa');

        const { container } = await opened('/admin', ADMIN, '/admin/boom', '[data-page-failed]');

        expect(home(container)?.textContent?.trim()).toBe('برو به نمای کلی');
    });
});

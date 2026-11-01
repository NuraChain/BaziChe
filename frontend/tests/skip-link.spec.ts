import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route, type Router } from 'azerothjs';

import '../src/locales/admin-catalogue.ts';
import '../src/locales/app-catalogue.ts';
import { resetChunks } from '../src/lib/chunks.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useDevice } from '../src/stores/device.store.ts';
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

/** A page as `Page` draws one: the router's own focus target, with something to press in it. */
const page = (name: string, routeFocus: boolean) => () =>
{
    const element = document.createElement('section');
    element.dataset.page = name;
    if (routeFocus)
    {
        element.dataset.routeFocus = '';
        element.tabIndex = -1;
    }
    const button = document.createElement('button');
    button.textContent = `First on ${ name }`;
    element.append(button);
    return element;
};

const opened = async (shell: string, children: Route[], at: string, ready: string) =>
{
    const router: Router = createRouter({ routes: [{ ...routes.find((route) => route.path === shell)!, children }], history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

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

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const firstStop = (root: Element) => root.querySelector<HTMLElement>(TABBABLE);

const press = (link: HTMLElement) =>
{
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    return click;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    resetChunks();
    setRuntime({ clock: manualClock(Date.parse('2026-11-02T09:00:00.000Z')), seed: 7 });
    vi.stubGlobal('fetch', async () =>
    {
        throw new TypeError('Failed to fetch');
    });
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
    vi.unstubAllGlobals();
    useDevice().override(null);
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the way past the navigation', () =>
{
    it('is the first thing the keyboard meets in the app, and hands it to the page, not to the address', async () =>
    {
        useSession().establish(establishAccount());
        useDevice().override('sidebar');
        const { container, router } = await opened('/app', [{ path: '', component: page('home', true) }], '/app', '[data-page="home"]');
        const shell = container.querySelector('#app-shell')!;
        const before = router.location();

        expect(shell.querySelector('nav a[href="/app/games"]'), 'the sidebar it is there to pass').not.toBeNull();

        const skip = firstStop(shell)!;

        expect(skip.matches('[data-skip]'), `the first stop was ${ skip.outerHTML.slice(0, 80) }`).toBe(true);
        expect(skip.textContent?.trim()).toBe('Skip to main content');
        expect(skip.getAttribute('href')).toBe('#app-main');

        expect(press(skip).defaultPrevented).toBe(true);
        await settle();

        expect(document.activeElement).toBe(container.querySelector('[data-page="home"]'));
        expect(router.location().fullPath, 'the address took a #').toBe(before.fullPath);
        expect(router.location().key, 'a history entry was added').toBe(before.key);
    });

    it('is the first thing the keyboard meets in the admin, and hands it to the section for as long as it holds it', async () =>
    {
        useSession().establish({ ...ALEX, staff: 'moderator' });
        const { container } = await opened('/admin', [{ path: 'overview', component: page('overview', false) }], '/admin/overview', '[data-page="overview"]');
        const shell = container.querySelector('#admin-shell')!;
        const main = container.querySelector<HTMLElement>('#admin-main')!;

        const skip = firstStop(shell)!;

        expect(skip.matches('[data-skip]'), `the first stop was ${ skip.outerHTML.slice(0, 80) }`).toBe(true);
        expect(skip.getAttribute('href')).toBe('#admin-main');
        expect(main.hasAttribute('tabindex')).toBe(false);

        press(skip);
        await settle();

        expect(document.activeElement).toBe(main);
        expect(main.getAttribute('tabindex')).toBe('-1');

        main.blur();
        await settle();

        expect(main.hasAttribute('tabindex'), 'the section kept a way to take the keyboard by a press').toBe(false);
    });

    it('says the public shell’s words, in Persian too', async () =>
    {
        useSession().establish(establishAccount());
        useLocale().setLocale('fa');
        const { container } = await opened('/app', [{ path: '', component: page('home', true) }], '/app', '[data-page="home"]');

        expect(container.querySelector('[data-skip]')?.textContent?.trim()).toBe('برو به محتوای اصلی');
    });

    it('is a clipped pixel until it holds the keyboard, so it shows nothing, takes no press and takes no column of the grid', async () =>
    {
        useSession().establish(establishAccount());
        const { container } = await opened('/app', [{ path: '', component: page('home', true) }], '/app', '[data-page="home"]');
        const classes = container.querySelector('[data-skip]')!.className.split(/\s+/);

        expect(classes).toEqual(expect.arrayContaining([ 'fixed', 'h-px', 'w-px', 'overflow-hidden', '[clip-path:inset(50%)]', 'focus:h-auto', 'focus:w-auto', 'focus:[clip-path:none]' ]));
        expect(classes.some((name) => name.startsWith('focus:') && /^focus:(static|relative|absolute)$/.test(name)), 'focused, it would join the grid').toBe(false);
    });
});

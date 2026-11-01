import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Router } from 'azerothjs';

import { signOut, watchSignedOut } from '../src/components/app/sign-out.ts';
import '../src/locales/app-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import { answeredUnauthorized, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const DARYA = { id: 'u-darya', handle: 'darya', displayName: 'Darya', bio: '', hue: 280, isMinor: false };

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

let replace: ReturnType<typeof vi.spyOn>;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-11-01T21:00:00.000Z')), seed: 7 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useWallet().reset();
    replace = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);
});

afterEach(() =>
{
    cleanup();
    replace.mockRestore();
    window.history.replaceState({}, '', '/');
    useSession().reset();
    useWallet().reset();
    useLocale().setLocale('en');
});

describe('a session that ends while a page of the app is open', () =>
{
    it('loads sign-in with the page to come back to and why it was opened', async () =>
    {
        const stops = [useRealtime().start(), useSession().start(), watchSignedOut()];

        try
        {
            socket.accept();
            useSession().establish(DARYA);
            server.account = DARYA;
            window.history.replaceState({}, '', '/app/friends?tab=requests');

            server.account = null;
            answeredUnauthorized();
            await settle();

            expect(replace).toHaveBeenCalledTimes(1);
            expect(replace).toHaveBeenCalledWith('/sign-in?next=%2Fapp%2Ffriends%3Ftab%3Drequests&why=ended');
        }
        finally
        {
            for (const stop of stops.reverse())
            {
                stop();
            }
        }
    });

    it('says nothing of why when the reader signed out themselves', async () =>
    {
        useSession().establish(DARYA);

        await signOut();

        expect(replace).toHaveBeenCalledWith('/sign-in');
    });
});

describe('the sign-in page', () =>
{
    const opened = async (at: string) =>
    {
        const router: Router = createRouter({ routes: routes.filter((route) => route.path === '/sign-in'), history: createMemoryHistory(at), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() =>
        {
            if (router.pending() || container.querySelector('#main') === null)
            {
                throw new Error('waiting for the sign-in page');
            }
        }, { timeout: 5_000, interval: 10 });
        await settle();

        return container;
    };

    const notice = (root: ParentNode) => root.querySelector<HTMLElement>('[data-signed-out]');

    it('says the session ended, above the way in', async () =>
    {
        const page = await opened('/sign-in?next=%2Fapp%2Ffriends&why=ended');

        expect(notice(page)?.textContent?.trim()).toBe('You were signed out. Sign in again and you’ll be back where you were.');
        expect(notice(page)?.getAttribute('role')).toBe('status');
        expect(notice(page)!.compareDocumentPosition(page.querySelector('#wallet-heading')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the reason came after the way in').toBeTruthy();
    });

    it('says the wallet left when it did', async () =>
    {
        const page = await opened('/sign-in?next=%2Fapp%2Fchats&why=wallet');

        expect(notice(page)?.textContent?.trim()).toBe('Your wallet switched accounts or disconnected this site, so you were signed out here.');
    });

    it('says nothing to a visitor sent here to sign in, or for a reason it does not know', async () =>
    {
        expect(notice(await opened('/sign-in?next=%2Fapp%2Ffriends'))).toBeNull();

        cleanup();

        expect(notice(await opened('/sign-in?why=constructor'))).toBeNull();
    });

    it('speaks the reader’s language', async () =>
    {
        useLocale().setLocale('fa');

        const page = await opened('/sign-in?why=ended');

        expect(notice(page)?.textContent?.trim()).toBe('از حسابت خارج شدی. دوباره وارد شو تا برگردی همون‌جایی که بودی.');
    });
});

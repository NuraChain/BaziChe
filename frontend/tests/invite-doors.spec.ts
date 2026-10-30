import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import '../src/locales/app-catalogue.ts';
import FriendsPage from '../src/pages/app/friends.page.azeroth';
import MePage from '../src/pages/app/me.page.azeroth';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { establishAccount, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const SOURCES = import.meta.glob(['../src/components/social/invite-chip.component.azeroth'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

let seq = 0;

const signIn = () =>
{
    seq += 1;
    useSession().establish(establishAccount('alex', { id: `u-invite-doors-${ seq }`, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' }));
};

const shown = async (path: string, page: () => HTMLElement) =>
{
    const table: Route[] = [{ path, component: page }];
    const router = createRouter({ routes: table, history: createMemoryHistory(path), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    await settle();

    return container;
};

beforeEach(() =>
{
    cleanup();
    server.reset();
    socket.reset();
    useRealtime().reset();
    useOverlay().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    useSession().reset();
});

describe('the ways to the invite page', () =>
{
    it.each([['en', 'Invite friends', 'Your link, and who joined through it'], ['fa', 'دعوت از دوستا', 'لینکت، و اینکه کیا باهاش اومدن']] as const)(
        'is a chip on the reader\'s own profile beside the collection\'s, in %s',
        async (lang, title, lead) =>
        {
            useLocale().setLocale(lang);
            signIn();
            const page = await shown('/app/me', () => MePage({}) as unknown as HTMLElement);
            const chip = page.querySelector<HTMLAnchorElement>('a[href="/app/invite"]');

            expect(chip?.textContent).toContain(title);
            expect(chip?.textContent).toContain(lead);
            expect(chip?.parentElement, 'in the row the collection\'s chip stands in').toBe(page.querySelector('a[href="/app/shop/collection"]')?.parentElement);
        }
    );

    it('stands beside Add friend at the head of the Friends page', async () =>
    {
        signIn();
        const page = await shown('/app/friends', () => FriendsPage() as HTMLElement);

        await vi.waitFor(() => expect(page.querySelector('header a[href="/app/invite"]')).not.toBeNull(), { timeout: 4000 });

        const door = page.querySelector('header a[href="/app/invite"]')!;
        const add = [...page.querySelectorAll('header button')].find((one) => one.textContent?.trim() === 'Add friend');

        expect(door.textContent?.trim()).toBe('Invite friends');
        expect(add?.nextElementSibling, 'right after Add friend').toBe(door);
    });

    it('carries nothing of the invite page in the profile\'s own chunk, its chip asking nothing', () =>
    {
        const chip = SOURCES['../src/components/social/invite-chip.component.azeroth'];

        expect([...chip.matchAll(/from '([^']+)'/g)].map((match) => match[1]).filter((path) => /invite|api/.test(path))).toEqual([]);
    });
});

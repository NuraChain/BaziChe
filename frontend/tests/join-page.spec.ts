import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import { ApiError } from '@azerothjs/http/api/shared';

import JoinPage from '../src/pages/join.page.azeroth';
import { routes } from '../src/routes.ts';
import { keepInvite, keptInvite } from '../src/lib/invite.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { client, establishAccount, server } from './fake-api.ts';
import { memoryStorage } from './memory-storage.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const SARA = { handle: 'sara.k', displayName: 'Sara Kamali', hue: 140 };

const storage = memoryStorage();

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

const settle = async () =>
{
    for (let i = 0; i < 12; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const open = async (code: string) =>
{
    const table: Route[] = [{ path: '/join/:code', component: JoinPage as unknown as () => HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory(`/join/${ code }`), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);
    await settle();
    return container;
};

const buttonNamed = (container: HTMLElement, words: string) =>
    [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === words) ?? null;

beforeEach(() =>
{
    cleanup();
    storage.fresh();
    useLocale().setLocale('en');
    server.reset();
    useSession().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    storage.restore();
    useSession().reset();
});

describe('the page an invite link opens', () =>
{
    it('shows who invited as their profile shows them, with the way in, and keeps the code and counts the visit', async () =>
    {
        server.invites.ABCD2345 = { inviter: SARA };
        const container = await open('abcd2345');

        await vi.waitFor(() => expect(container.textContent).toContain('Sara Kamali invited you to Baziche'));
        expect(container.textContent).toContain('@sara.k');
        expect(buttonNamed(container, 'Connect wallet')).not.toBeNull();
        expect(server.calls).toContain('public.invite ABCD2345');
        await vi.waitFor(() => expect(server.visits).toEqual([{ code: 'ABCD2345', visitor: expect.stringMatching(TOKEN) }]));
        expect(keptInvite()).toBe('ABCD2345');
    });

    it('names nobody where their profile shows no face, and still keeps the code and counts the visit', async () =>
    {
        server.invites.ABCD2345 = {};
        const container = await open('ABCD2345');

        await vi.waitFor(() => expect(container.textContent).toContain('A friend invited you to Baziche'));
        expect(container.textContent).not.toContain('@');
        await vi.waitFor(() => expect(server.visits).toHaveLength(1));
        expect(keptInvite()).toBe('ABCD2345');
    });

    it('says a link that no longer works, offers the way in all the same, and keeps and counts nothing', async () =>
    {
        const container = await open('ZZZZ2222');

        await vi.waitFor(() => expect(container.textContent).toContain('This invite link no longer works'));
        expect(buttonNamed(container, 'Connect wallet')).not.toBeNull();
        expect(keptInvite()).toBeNull();
        expect(server.visits).toEqual([]);
    });

    it('asks the server nothing about an address that holds no code', async () =>
    {
        const container = await open('not-a-code');

        await vi.waitFor(() => expect(container.textContent).toContain('This invite link no longer works'));
        expect(server.calls.filter((call) => call.startsWith('public.'))).toEqual([]);
    });

    it('counts one device as one visitor, however often it opens a link', async () =>
    {
        server.invites.ABCD2345 = { inviter: SARA };
        await open('ABCD2345');
        cleanup();
        await open('ABCD2345');

        await vi.waitFor(() => expect(server.visits).toHaveLength(2));
        expect(server.visits[1].visitor).toBe(server.visits[0].visitor);
    });

    it('keeps the first link\'s code while it still works, and gives it up to the next link once it does not', async () =>
    {
        server.invites.ABCD2345 = { inviter: SARA };
        server.invites.WXYZ6789 = { inviter: { handle: 'omid.k', displayName: 'Omid', hue: 30 } };
        keepInvite('WXYZ6789');

        await open('ABCD2345');
        await vi.waitFor(() => expect(server.calls).toContain('public.invite WXYZ6789'));
        expect(keptInvite(), 'the first link still works').toBe('WXYZ6789');

        cleanup();
        delete server.invites.WXYZ6789;
        await open('ABCD2345');

        await vi.waitFor(() => expect(keptInvite(), 'the first link no longer works').toBe('ABCD2345'));
    });

    it('tells somebody already signed in that they have an account, the way into it, and keeps nothing for them', async () =>
    {
        establishAccount('alex');
        server.invites.ABCD2345 = { inviter: SARA };
        const container = await open('ABCD2345');

        await vi.waitFor(() => expect(container.textContent).toContain('You already have an account'));
        expect(container.querySelector('a[href="/app"]')?.textContent?.trim()).toBe('Open Baziche');
        expect(buttonNamed(container, 'Connect wallet')).toBeNull();
        await vi.waitFor(() => expect(server.visits).toHaveLength(1));
        expect(keptInvite()).toBeNull();
    });

    it('says it could not ask, with a way to ask again, when the server does not answer', async () =>
    {
        server.invites.ABCD2345 = { inviter: SARA };
        vi.spyOn(client.public, 'invite').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down for a moment.', undefined));
        const container = await open('ABCD2345');

        await vi.waitFor(() => expect(buttonNamed(container, 'Try again')).not.toBeNull());
        expect(container.textContent).not.toContain('no longer works');
        expect(keptInvite()).toBeNull();

        buttonNamed(container, 'Try again')!.click();

        await vi.waitFor(() => expect(container.textContent).toContain('Sara Kamali invited you to Baziche'));
        expect(keptInvite()).toBe('ABCD2345');
    });

    it('opens the wallet chooser at Connect wallet', async () =>
    {
        server.invites.ABCD2345 = { inviter: SARA };
        const container = await open('ABCD2345');

        await vi.waitFor(() => expect(buttonNamed(container, 'Connect wallet')).not.toBeNull());
        buttonNamed(container, 'Connect wallet')!.click();

        await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    });

    it('says all of it in Persian for a Persian reader', async () =>
    {
        useLocale().setLocale('fa');
        server.invites.ABCD2345 = { inviter: SARA };
        const container = await open('ABCD2345');

        await vi.waitFor(() => expect(container.textContent).toContain('Sara Kamali'));
        expect(container.textContent).toContain('بازیچه');
        expect(container.textContent).not.toContain('invited you');
    });
});

describe('the address an invite link carries', () =>
{
    it('is a page of the app for anybody, signed in or not, loaded when it is opened', () =>
    {
        const join = routes.find((one) => one.path === '/join/:code');

        expect(join, 'the route').toBeDefined();
        expect(join?.render).toBe('client');
        expect(join?.guard, 'no guard: a member is told on the page itself').toBeUndefined();
        expect(typeof join?.lazy).toBe('function');
    });
});

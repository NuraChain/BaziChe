import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route } from 'azerothjs';

import { SLOT_IDS } from '../../backend/src/domains/shop/catalogue.ts';
import CollectionPage from '../src/pages/app/collection.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useShop } from '../src/stores/shop.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

let clock: ManualClock;
let seq = 0;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const page = async () =>
{
    seq += 1;
    const account: Account = { id: `u-collection-${ seq }`, handle: `keeper${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };
    server.account = account;
    useSession().establish(account);

    const table: Route[] = [{ path: '/app/shop/collection', component: () => CollectionPage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/shop/collection'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => CollectionPage({}) as unknown as HTMLElement }) as HTMLElement);

    await settle();
    await settle();

    return container;
};

const choices = (root: ParentNode, slot: string) =>
    [...root.querySelectorAll(`[data-slot="${ slot }"] .look-choice`)].map((one) => [one.textContent?.trim(), one.getAttribute('aria-pressed')]);

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-27T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    socket.reset();
    useRealtime().reset();
    useShop().reset();
    useToasts().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useShop().reset();
    useSession().reset();
});

describe('the reader\'s collection', () =>
{
    it('has a row for every place a look goes, Classic chosen until one is', async () =>
    {
        const root = await page();

        expect([...root.querySelectorAll('[data-slot]')].map((one) => one.getAttribute('data-slot')).sort()).toEqual([...SLOT_IDS].sort());
        expect(choices(root, 'ludo.dice')).toEqual([['Classic', 'true']]);
        expect(root.textContent).toContain('From your next game there');
    });

    it('offers what the reader owns where it goes, and chooses it at a press', async () =>
    {
        server.shop.owned = [
            { item: 'dice.neon', via: 'purchase', at: '2026-10-27T11:00:00.000Z' },
            { item: 'back.gold', via: 'purchase', at: '2026-10-27T11:00:00.000Z' }
        ];

        const root = await page();

        expect(choices(root, 'ludo.dice')).toEqual([['Classic', 'true'], ['Midnight Neon dice', 'false']]);
        expect(choices(root, 'backgammon.dice')).toEqual([['Classic', 'true'], ['Midnight Neon dice', 'false']]);
        expect(choices(root, 'poker.back')).toEqual([['Classic', 'true'], ['Royal Gold card back', 'false']]);
        expect(choices(root, 'chess.pieces')).toEqual([['Classic', 'true']]);

        fire(root.querySelectorAll<HTMLButtonElement>('[data-slot="ludo.dice"] .look-choice')[1], 'click');

        expect(choices(root, 'ludo.dice'), 'shown at the press').toEqual([['Classic', 'false'], ['Midnight Neon dice', 'true']]);

        await settle();

        expect(server.calls).toContain('shop.choose ludo.dice dice.neon');
        expect(choices(root, 'backgammon.dice'), 'chosen for one game is chosen for that game alone').toEqual([['Classic', 'true'], ['Midnight Neon dice', 'false']]);
    });

    it('lists the gifts with who sent them, and says none came yet when none did', async () =>
    {
        const quiet = await page();

        expect(quiet.textContent).toContain('Nobody has sent you a look yet.');

        cleanup();
        useShop().reset();
        server.shop.owned = [{ item: 'felt.shiraz', via: 'gift', at: '2026-10-27T11:00:00.000Z', from: 'sara.k' }];

        const root = await page();

        expect(root.textContent).toContain('Shiraz Garden felt');
        expect(root.textContent).toMatch(/From (Sara|sara\.k)/);
    });

    it('lists the reader\'s orders newest first, each with where it stands', async () =>
    {
        server.shop.orders = [
            { id: 'order-2', item: 'dice.glow', price: '12000000000000000000', state: 'sent', deadline: '2026-10-27T12:30:00.000Z', at: '2026-10-27T12:00:00.000Z', hash: `0x${ 'ab'.repeat(32) }` },
            { id: 'order-1', item: 'back.gold', for: 'sara.k', price: '12000000000000000000', state: 'paid', deadline: '2026-10-27T11:30:00.000Z', at: '2026-10-27T11:00:00.000Z', delivered: true }
        ];

        const root = await page();
        const rows = [...root.querySelectorAll('[data-order]')];

        expect(rows.map((row) => row.getAttribute('data-order'))).toEqual(['order-2', 'order-1']);
        expect(rows[0].textContent).toContain('On its way');
        expect(rows[1].textContent).toContain('Paid');
        expect(rows[1].textContent).toContain('For');
    });

    it('offers to claim what the shop owes for the people the reader invited, and only then', async () =>
    {
        const nothing = await page();

        expect(nothing.textContent).toContain('From people you invited');
        expect([...nothing.querySelectorAll('button')].some((one) => one.textContent?.includes('Claim'))).toBe(false);

        cleanup();
        useShop().reset();
        server.shop.earnings = { ...server.shop.earnings, earnings: '1500000000000000000' };

        const owed = await page();

        expect([...owed.querySelectorAll('button')].map((one) => one.textContent?.trim())).toContain('Claim 1.5 NURA');
    });
});

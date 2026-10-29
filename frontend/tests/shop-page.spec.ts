import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route, type Router } from 'azerothjs';

import { BUNDLES, SHOP_COLLECTIONS, SHOP_KINDS } from '../../backend/src/domains/shop/catalogue.ts';
import ShopPage from '../src/pages/app/shop.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useShop } from '../src/stores/shop.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { closedShop, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

let clock: ManualClock;
let seq = 0;
let router: Router;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const signIn = () =>
{
    seq += 1;
    const account: Account = { id: `u-shop-page-${ seq }`, handle: `buyer${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };
    server.account = account;
    useSession().establish(account);
};

const page = async (at = '/app/shop') =>
{
    signIn();
    const table: Route[] = [{ path: '/app/shop', component: () => ShopPage({}) as unknown as HTMLElement }];
    router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => ShopPage({}) as unknown as HTMLElement }) as HTMLElement);
    await settle();
    await settle();
    return container;
};

const sections = (root: ParentNode) => [...root.querySelectorAll('section[data-kind]')].map((one) => one.getAttribute('data-kind'));

const card = (root: ParentNode, item: string) => root.querySelector<HTMLButtonElement>(`[data-look="${ item }"]`);

const sheetOpens = async () =>
{
    await vi.waitFor(() => expect(useOverlay().items().length).toBeGreaterThan(0), { timeout: 4_000 });
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-27T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    socket.reset();
    useRealtime().reset();
    useShop().reset();
    useOverlay().reset();
    useToasts().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useShop().reset();
    useOverlay().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the shop page', () =>
{
    it('opens on the featured collection, its bundles and every kind in the catalogue\'s order', async () =>
    {
        const root = await page();

        expect(root.querySelector('[data-featured]')?.getAttribute('data-featured')).toBe('glow');
        expect(root.querySelector('#shop-featured')?.textContent).toBe('Nura Glow');
        expect(card(root.querySelector('[data-featured]')!, 'bundle.glow'), 'the featured bundle').not.toBeNull();
        expect(root.querySelector('[data-featured] img[data-sigil="glow"]')?.getAttribute('src'), 'the featured collection\'s sigil').toBe('/sigils/glow.svg');
        expect(card(root, 'bundle.oni')?.querySelector('[data-sigil]')?.getAttribute('src'), 'a bundle\'s sigil').toBe('/sigils/oni.svg');
        expect(card(root, 'dice.oni')?.querySelector('[data-sigil]'), 'a look is not a bundle').toBeNull();

        for (const bundle of BUNDLES)
        {
            expect(card(root, bundle.id), bundle.id).not.toBeNull();
        }

        expect(sections(root)).toEqual([...SHOP_KINDS]);
        expect(root.querySelector('section[data-kind="dice"]')?.querySelectorAll('[data-look]').length).toBe(SHOP_COLLECTIONS.length);
    });

    it('keeps the filter in the address, opens on it, and leaves All out of it', async () =>
    {
        const root = await page('/app/shop?for=ludo');

        expect(sections(root)).toEqual(['dice', 'pawns', 'yard', 'celebration']);

        const chip = [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Poker');

        fire(chip!, 'click');
        await settle();

        expect(router.location().query.for).toBe('poker');
        expect(sections(root)).toEqual(['back', 'face', 'felt', 'chips', 'celebration']);

        fire([...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'All')!, 'click');
        await settle();

        expect(router.location().query.for).toBeUndefined();
        expect(sections(root)).toEqual([...SHOP_KINDS]);
    });

    it('reads a word it does not know as All', async () =>
    {
        const root = await page('/app/shop?for=roulette');

        expect(sections(root)).toEqual([...SHOP_KINDS]);
    });

    it('marks a card with its price, Owned, In use, or the sale it is in', async () =>
    {
        server.shop.owned = [
            { item: 'dice.neon', via: 'purchase', at: '2026-10-27T11:00:00.000Z' },
            { item: 'dice.gold', via: 'gift', at: '2026-10-27T11:00:00.000Z', from: 'sara.k' }
        ];
        server.shop.chosen = [{ slot: 'ludo.dice', item: 'dice.gold' }];

        const state = server.shop.state;

        if (state.open)
        {
            server.shop.state = { ...state, items: state.items.map((one) => (one.id === 'dice.shiraz' ? { ...one, sale: { price: '6000000000000000000', until: '2026-11-01T00:00:00.000Z' } } : one)) };
        }

        const root = await page('/app/shop?for=ludo');

        expect(card(root, 'dice.glow')?.textContent).toContain('12 NURA');
        expect(card(root, 'dice.glow')?.textContent).not.toContain('Owned');
        expect(card(root, 'dice.glow')?.textContent).not.toContain('In use');
        expect(card(root, 'dice.neon')?.textContent).toContain('Owned');
        expect(card(root, 'dice.neon')?.textContent).not.toContain('NURA');
        expect(card(root, 'dice.gold')?.textContent).toContain('In use');
        expect(card(root, 'dice.shiraz')?.textContent).toContain('6 NURA');
        expect(card(root, 'dice.shiraz')?.querySelector('s')?.textContent).toBe('12');
        expect(root.querySelector('#shop-sale'), 'a sale is a section of its own while it runs').not.toBeNull();
    });

    it('opens a look\'s sheet at a press, keeps it in the address, and takes it out once closed', async () =>
    {
        const root = await page();

        fire(card(root, 'pawns.shiraz')!, 'click');
        await sheetOpens();

        expect(router.location().query.item).toBe('pawns.shiraz');
        expect(useOverlay().items().map((one) => one.id)).toEqual(['look-sheet']);

        useOverlay().close('look-sheet');
        useOverlay().settle('look-sheet');
        await settle();

        expect(router.location().query.item).toBeUndefined();
    });

    it('opens the sheet the address names', async () =>
    {
        await page('/app/shop?item=bundle.gold');
        await sheetOpens();

        expect(useOverlay().items().map((one) => one.props.item)).toEqual(['bundle.gold']);
    });

    it('says a shop that is turned off as that, above the whole of its catalogue, and asks the wallet nothing', async () =>
    {
        server.shop.state = closedShop();
        const closed = await page();
        const note = closed.querySelector('[data-off="shop"]');

        expect(note?.textContent).toContain('The shop is turned off right now');
        expect(note?.querySelector('[data-off-how]'), 'a player was told what the server is set up with').toBeNull();
        expect(sections(closed).length).toBeGreaterThan(0);
        expect(closed.querySelector('[data-look="dice.glow"]')).not.toBeNull();
        expect(server.calls, 'a wallet was asked what it holds for a shop that sells nothing').not.toContain('shop.balance');
    });

    it('says a refused read as a failure with a way to try again, and NuraChain out of reach as that', async () =>
    {
        server.shop.refuse = { status: 503, code: 'chain-unreachable' };
        const refused = await page();

        expect(refused.textContent).toContain('The shop could not be loaded.');
        expect(refused.textContent).toContain('NuraChain could not be reached just now.');
        expect(refused.textContent).not.toContain('The shop is not open here');
    });

    it('keeps every card where it is when the shop is read again', async () =>
    {
        const root = await page();
        const before = card(root, 'back.neon');

        await useShop().refresh();
        await settle();

        expect(card(root, 'back.neon')).toBe(before);
    });

    it('says the shop in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const root = await page('/app/shop?for=hokm');

        expect(root.querySelector('h1')?.textContent).toBe('فروشگاه');
        expect(root.querySelector('#shop-featured')?.textContent).toBe('درخشش نورا');
        expect(root.querySelector('section[data-kind="back"] h2, section[data-kind="back"] [id="shop-back"]')?.textContent).toContain('پشت کارت‌ها');
        expect(card(root, 'back.glow')?.textContent).toContain('پشت کارت درخشش نورا');
    });
});

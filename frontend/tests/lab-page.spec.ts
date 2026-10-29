import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route, type Router } from 'azerothjs';

import { COLLECTION_NAMES, SHOP_COLLECTIONS, SHOP_KINDS } from '../../backend/src/domains/shop/catalogue.ts';
import LabPage from '../src/pages/app/lab.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useShop } from '../src/stores/shop.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

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

const page = async (at = '/app/shop/lab') =>
{
    seq += 1;
    const account: Account = { id: `u-lab-${ seq }`, handle: `trier${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };

    server.account = account;
    useSession().establish(account);

    const table: Route[] = [{ path: '/app/shop/lab', component: () => LabPage({}) as unknown as HTMLElement }];

    router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });

    const { container } = renderTest(() => RouterProvider({ router, children: () => LabPage({}) as unknown as HTMLElement }) as HTMLElement);

    await settle();
    await settle();

    return container;
};

const chip = (root: ParentNode, words: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === words);

const looks = (root: ParentNode) => [...root.querySelectorAll('[data-lab-looks] [data-look]')].map((one) => one.getAttribute('data-look'));

const wearing = (root: ParentNode) => ({
    collection: root.querySelector('[data-lab-profile]')?.getAttribute('data-lab-profile'),
    frame: root.querySelector('[data-lab-profile] [data-deco]')?.getAttribute('data-deco'),
    cover: root.querySelector('[data-lab-profile] [data-cover]')?.getAttribute('data-cover'),
    plate: root.querySelector('[data-lab-profile] [data-plate]')?.getAttribute('data-plate')
});

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-10-29T12:00:00.000Z')), seed: 3 });
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
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the fitting room', () =>
{
    it('opens on the featured collection, the reader drawn in its frame, its cover and its nameplate, with every look of it listed', async () =>
    {
        const root = await page();

        expect(wearing(root)).toEqual({ collection: 'glow', frame: 'glow', cover: 'glow', plate: 'glow' });
        expect(looks(root)).toEqual(SHOP_KINDS.map((kind) => `${ kind }.glow`));
        expect(root.querySelector('h1')?.textContent).toBe('Fitting room');
    });

    it('offers every collection, and draws the reader in the one chosen, written into the address but for the featured one', async () =>
    {
        const root = await page();

        expect(SHOP_COLLECTIONS.filter((collection) => chip(root, COLLECTION_NAMES[collection].en) === undefined), 'a collection that cannot be chosen').toEqual([]);

        fire(chip(root, 'Jade Dragon Dynasty')!, 'click');
        await settle();

        expect(router.location().query.collection).toBe('jade');
        expect(wearing(root)).toEqual({ collection: 'jade', frame: 'jade', cover: 'jade', plate: 'jade' });
        expect(looks(root)).toContain('pawns.jade');

        fire(chip(root, 'Nura Glow')!, 'click');
        await settle();

        expect(router.location().query.collection, 'the featured collection was written into the address').toBeUndefined();
        expect(wearing(root).collection).toBe('glow');
    });

    it('sets the chosen collection’s tables out under the reader’s profile, fetched as a chunk of their own', async () =>
    {
        const root = await page('/app/shop/lab?collection=void');

        await vi.waitFor(() => expect(root.querySelector('[data-lab-tables]')?.getAttribute('data-lab-tables')).toBe('void'));

        const yard = root.querySelector('[data-lab-tables] .lb-yard');

        expect(yard?.getAttribute('data-yard')).toBe('void');
        expect(root.querySelector('[data-lab-profile]')?.compareDocumentPosition(root.querySelector('[data-lab-tables]')!), 'the tables were not under the profile').toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        fire(chip(root, 'Frost Revenant')!, 'click');
        await settle();

        expect(root.querySelector('[data-lab-tables] .lb-yard'), 'the tables were drawn again for another collection').toBe(yard);
        expect(yard?.getAttribute('data-yard')).toBe('frost');
    });

    it('opens on the collection the address names, and on the featured one for a word it does not know', async () =>

    {
        expect(wearing(await page('/app/shop/lab?collection=storm')).collection).toBe('storm');

        cleanup();

        expect(wearing(await page('/app/shop/lab?collection=ember')).collection).toBe('glow');
    });

    it('keeps the looks to one area, as the shop does, with the area in the address', async () =>
    {
        const root = await page('/app/shop/lab?collection=oni');

        fire(chip(root, 'Ludo')!, 'click');
        await settle();

        expect(router.location().query.for).toBe('ludo');
        expect(looks(root)).toEqual(['dice.oni', 'pawns.oni', 'yard.oni', 'celebration.oni']);
    });

    it('plays the reveal again by drawing the reader anew, and draws them anew in another collection', async () =>
    {
        const root = await page();
        const first = root.querySelector('[data-lab-profile] [data-round]');

        fire(chip(root, 'Play again')!, 'click');
        await settle();

        const second = root.querySelector('[data-lab-profile] [data-round]');

        expect(second).not.toBeNull();
        expect(second, 'Play again kept the header it had').not.toBe(first);
        expect(root.querySelectorAll('[data-lab-profile] [data-round]'), 'the header it had was left beside the new one').toHaveLength(1);
    });

    it('stores nothing while the reader tries looks on', async () =>
    {
        const root = await page();

        fire(chip(root, 'Midnight Neon')!, 'click');
        await settle();
        fire(chip(root, 'Play again')!, 'click');
        await settle();

        expect(server.calls.filter((call) => call.startsWith('shop.choose') || call.startsWith('shop.order'))).toEqual([]);
    });

    it('opens a look’s sheet from its card, with the look in the address while it is open', async () =>
    {
        const root = await page('/app/shop/lab?collection=frost');

        fire(root.querySelector<HTMLButtonElement>('[data-lab-looks] [data-look="dice.frost"]')!, 'click');

        await vi.waitFor(() => expect(useOverlay().items().length).toBeGreaterThan(0), { timeout: 4_000 });
        expect(router.location().query.item).toBe('dice.frost');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');

        const root = await page();

        expect(root.querySelector('h1')?.textContent).toBe('اتاق پرو');
        expect(root.textContent).toContain('اسمت توی فهرست‌ها');
        expect(chip(root, 'دوباره پخش کن')).toBeDefined();
    });
});

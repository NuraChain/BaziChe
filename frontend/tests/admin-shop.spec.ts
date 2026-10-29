import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import ReasonSheet from '../src/components/admin/reason-sheet.component.azeroth';
import ShopItemSheet, { type ShopAsk } from '../src/components/admin/shop-item-sheet.component.azeroth';
import ShopPage from '../src/pages/admin/shop.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { SEARCH_PAUSE_MS } from '../src/services/search.service.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { SHOP_COLLECTIONS, SHOP_KINDS } from '../../backend/src/domains/shop/catalogue.ts';
import { SHOP_ORDERS_PAGE } from '../../backend/src/domains/admin/roles.ts';
import type { AdminShopOrders } from '../../backend/src/schemas.ts';
import { server, staffMember, type AdminShopItem } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-29T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'owner' as const };

const NURA = 10n ** 18n;

const nura = (whole: bigint) => (whole * NURA).toString();

const HASH = `0x${ 'ab'.repeat(32) }`;

let clock: ManualClock;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const opened = async (at = '/admin/shop') =>
{
    const routes: Route[] = [{ path: '/admin/shop', component: () => ShopPage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return { router, container };
};

/** What a node says, its pieces joined by a space, as somebody reads it and as `textContent` does not. */
const text = (node: Element | null | undefined) =>
{
    if (node === null || node === undefined)
    {
        return null;
    }

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];

    for (let at = walker.nextNode(); at !== null; at = walker.nextNode())
    {
        parts.push(at.textContent ?? '');
    }

    return parts.map((part) => part.trim()).filter((part) => part !== '').join(' ');
};

const item = (id: string) => server.shopAdmin.shop.items.find((one) => one.id === id)!;

const row = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-item="${ id }"]`);

const change = (root: ParentNode, id: string) => row(root, id)!.querySelector<HTMLButtonElement>('button:not([data-sold])')!;

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const answered = async (value: unknown) =>
{
    useOverlay().close(asked().id, value);
    await settle();
};

const toasts = () => useToasts().items().map((one) => one.text);

const chips = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].map((one) => [text(one), one.getAttribute('aria-pressed')]);

const chip = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find((one) => text(one)?.startsWith(label))!;

const typeInto = (field: HTMLInputElement | HTMLTextAreaElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const orderOf = (id: string, extra: Partial<AdminShopOrders['rows'][number]> = {}): AdminShopOrders['rows'][number] => ({
    id,
    item: 'dice.inferno',
    price: nura(50n),
    state: 'paid',
    buyer: { handle: 'sara.k', displayName: 'Sara', hue: 20 },
    at: new Date(NOW - 60_000).toISOString(),
    ...extra
});

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(NOW);
    setRuntime({ clock, seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish(ALEX);
    useToasts().dismissAll();
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('Admin › Shop: the looks', () =>
{
    it('lists every collection in the catalogue\'s order, each look with its price, a sale while one runs, how many were sold and whether it is offered', async () =>
    {
        item('dice.inferno').price = nura(40n);
        item('dice.inferno').sold = 3;
        item('pawns.jade').sale = { price: nura(20n), until: new Date(NOW + 2 * 86_400_000).toISOString() };
        item('felt.gold').status = 'retired';
        item('chips.neon').status = 'hidden';

        const { container } = await opened();
        const sections = [...container.querySelectorAll('[data-collection]')];

        expect(container.querySelector('h1')?.textContent).toBe('Shop');
        expect(sections.map((one) => one.getAttribute('data-collection'))).toEqual([...SHOP_COLLECTIONS]);
        expect([...sections[0].querySelectorAll('[data-item]')].map((one) => one.getAttribute('data-item'))).toEqual([...SHOP_KINDS.map((kind) => `${ kind }.glow`), 'bundle.glow']);
        expect(text(sections[0].querySelector('h2'))).toBe('Nura Glow');
        expect(text(row(container, 'dice.glow')!.querySelector('[data-name]'))).toBe('Nura Glow dice');
        expect(text(row(container, 'dice.glow')!.querySelector('[data-now]'))).toBe('12 NURA');
        expect(row(container, 'dice.glow')!.querySelector<HTMLElement>('[data-listed]')!.hidden).toBe(true);
        expect(text(row(container, 'dice.inferno')!.querySelector('[data-now]'))).toBe('40 NURA');
        expect(row(container, 'dice.inferno')!.querySelector<HTMLElement>('[data-listed]')!.hidden).toBe(false);
        expect(text(row(container, 'dice.inferno')!.querySelector('[data-listed]'))).toBe('Listed at 50');
        expect(text(row(container, 'dice.inferno')!.querySelector('[data-sold]'))).toBe('3 sold');
        expect(row(container, 'dice.inferno')!.querySelector('[data-sold]')?.getAttribute('aria-label')).toBe('The orders of Infernal Sovereign dice');
        expect(text(row(container, 'pawns.jade')!.querySelector('[data-sale]'))).toBe('Sale 20 NURA ends in 2 days');
        expect(text(row(container, 'dice.glow')!.querySelector('[data-sale]'))).toBe('No sale');
        expect(text(row(container, 'felt.gold')!.querySelector('[data-name]')?.parentElement)).toBe('Royal Gold felt Retired');
        expect(text(row(container, 'chips.neon')!.querySelector('[data-name]')?.parentElement)).toBe('Midnight Neon chips Hidden');
        expect(text(row(container, 'dice.glow')!.querySelector('[data-name]')?.parentElement)).toBe('Nura Glow dice');
        expect(text(container.querySelector('[data-collection="inferno"] [data-top]'))).toBe('On top of the shop');
        expect(container.querySelector('[data-collection="jade"] [data-top] button')?.getAttribute('aria-label')).toBe('Put Jade Dragon Dynasty on top of the shop');
        expect(change(container, 'dice.glow').getAttribute('aria-label')).toBe('Change Nura Glow dice');
        expect(server.calls.filter((call) => call === 'admin.shop')).toHaveLength(1);
    });

    it('narrows to one collection and to the looks with a sale, hidden or retired, kept in the address', async () =>
    {
        item('pawns.jade').sale = { price: nura(20n), until: new Date(NOW + 86_400_000).toISOString() };
        item('back.jade').status = 'hidden';
        item('felt.gold').status = 'retired';

        const { router, container } = await opened('/admin/shop?collection=jade');

        expect([...container.querySelectorAll('[data-collection]')].map((one) => one.getAttribute('data-collection'))).toEqual(['jade']);
        expect(container.querySelectorAll('[data-item]')).toHaveLength(SHOP_KINDS.length + 1);
        expect(chips(container).filter(([label]) => label?.match(/^(All|With a sale|Hidden|Retired)/))).toEqual([
            ['All 16', 'true'],
            ['With a sale 1', 'false'],
            ['Hidden 1', 'false'],
            ['Retired 0', 'false']
        ]);

        chip(container, 'With a sale').click();
        await settle();

        expect(router.location().search).toContain('list=sale');
        expect([...container.querySelectorAll('[data-item]')].map((one) => one.getAttribute('data-item'))).toEqual(['pawns.jade']);

        chip(container, 'Retired').click();
        await settle();

        expect(container.querySelectorAll('[data-item]')).toHaveLength(0);
        expect(text(container.querySelector('[data-empty]'))).toBe('No look is like that.');

        await router.navigate('/admin/shop?list=retired');
        await settle();

        expect([...container.querySelectorAll('[data-item]')].map((one) => one.getAttribute('data-item'))).toEqual(['felt.gold']);
    });

    it('changes a price at the press, says so once the server has, and keeps the sheet\'s place for nothing', async () =>
    {
        const { container } = await opened();
        let release = () => undefined as void;

        server.shopAdmin.hold = new Promise((resolve) =>
        {
            release = () => resolve();
        });

        change(container, 'dice.glow').click();
        await settle();

        expect(asked().component).toBe(ShopItemSheet);
        expect(asked().props).toMatchObject({ name: 'Nura Glow dice', item: { id: 'dice.glow' } });

        const ask: ShopAsk = { change: { price: nura(7n) }, reason: 'Cheaper for the launch week' };

        await answered(ask);

        expect(text(row(container, 'dice.glow')!.querySelector('[data-now]'))).toBe('7 NURA');
        expect(text(row(container, 'dice.glow')!.querySelector('[data-listed]'))).toBe('Listed at 12');
        expect(toasts()).toEqual([]);

        release();
        await settle();

        expect(server.calls).toContain(`admin.shopItem dice.glow {"price":"${ nura(7n) }","reason":"Cheaper for the launch week"}`);
        expect(toasts()).toEqual(['Nura Glow dice costs 7 NURA now.']);
        expect(server.staff.log[0]).toMatchObject({ kind: 'shop-item', staff: 'alex', staffRole: 'owner', details: { item: 'dice.glow', field: 'price', from: nura(12n), to: nura(7n) } });

        change(container, 'dice.glow').click();
        await settle();

        expect(asked().props).not.toHaveProperty('initial');
    });

    it('puts a look on sale, ends a sale and takes a look out of the shop, each in its own words', async () =>
    {
        const { container } = await opened();

        change(container, 'back.glow').click();
        await settle();
        await answered({ change: { sale: { price: nura(6n), hours: 72 } }, reason: 'A weekend sale' });

        expect(text(row(container, 'back.glow')!.querySelector('[data-sale]'))).toBe('Sale 6 NURA ends in 3 days');
        expect(toasts()).toContain('Nura Glow card back is on sale at 6 NURA.');

        change(container, 'back.glow').click();
        await settle();
        await answered({ change: { sale: false }, reason: 'The weekend is over' });

        expect(text(row(container, 'back.glow')!.querySelector('[data-sale]'))).toBe('No sale');
        expect(toasts()).toContain('The sale on Nura Glow card back is over.');

        change(container, 'chips.neon').click();
        await settle();
        await answered({ change: { status: 'hidden' }, reason: 'Redrawing the chips' });

        expect(row(container, 'chips.neon')?.getAttribute('data-status')).toBe('hidden');
        expect(toasts()).toContain('Midnight Neon chips is hidden from the shop.');
        expect(server.staff.log.map((one) => one.details)).toEqual([
            { item: 'chips.neon', field: 'status', from: 'on-sale', to: 'hidden' },
            { item: 'back.glow', field: 'sale', from: nura(6n) },
            { item: 'back.glow', field: 'sale', to: nura(6n), hours: '72' }
        ]);
    });

    it('takes a refused change back in the refusal\'s words, and opens the sheet again on what was asked', async () =>
    {
        item('dice.glow').sale = { price: nura(5n), until: new Date(NOW + 86_400_000).toISOString() };

        const { container } = await opened();
        const ask: ShopAsk = { change: { price: nura(4n) }, reason: 'Even cheaper' };

        change(container, 'dice.glow').click();
        await settle();
        await answered(ask);

        expect(text(row(container, 'dice.glow')!.querySelector('[data-now]'))).toBe('12 NURA');
        expect(toasts()).toEqual(['A sale has to cost less than the look, and a look on sale has to cost more than its sale.']);
        expect(server.staff.log).toEqual([]);

        change(container, 'dice.glow').click();
        await settle();

        expect(asked().props).toMatchObject({ initial: ask });

        await answered(null);

        change(container, 'dice.glow').click();
        await settle();

        expect(asked().props).toMatchObject({ initial: ask });
    });

    it('puts a collection on top with a reason, and says which is on top', async () =>
    {
        const { container } = await opened();

        container.querySelector<HTMLButtonElement>('[data-collection="jade"] [data-top] button')!.click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'Put Jade Dragon Dynasty on top of the shop?',
            lead: 'It leads the shop and the looks on every game’s page, in place of Infernal Sovereign, until another collection is put there.',
            confirm: 'Put it on top'
        });

        await answered('Jade for the new year');

        expect(text(container.querySelector('[data-collection="jade"] [data-top]'))).toBe('On top of the shop');
        expect(container.querySelector('[data-collection="inferno"] [data-top] button')).not.toBeNull();
        expect(server.calls).toContain('admin.shopFeature jade Jade for the new year');
        expect(toasts()).toEqual(['Jade Dragon Dynasty is on top of the shop.']);
        expect(server.staff.log[0]).toMatchObject({ kind: 'shop-feature', details: { from: 'inferno', to: 'jade' } });
    });

    it('leads from a look\'s sales to its orders, and back to the orders of every look', async () =>
    {
        server.shopAdmin.orders = [orderOf('o-2', { item: 'dice.glow' }), orderOf('o-1')];

        const { router, container } = await opened();

        row(container, 'dice.inferno')!.querySelector<HTMLButtonElement>('[data-sold]')!.click();
        await settle();

        expect(router.location().search).toContain('view=orders');
        expect(router.location().search).toContain('item=dice.inferno');
        expect(text(container.querySelector('[data-only]'))).toBe('Only Infernal Sovereign dice Show the orders of every look');
        expect([...container.querySelectorAll('[data-order]')].map((one) => one.getAttribute('data-order'))).toEqual(['o-1']);

        container.querySelector<HTMLButtonElement>('[data-only] button')!.click();
        await settle();

        expect(router.location().search).not.toContain('item=');
        expect([...container.querySelectorAll('[data-order]')].map((one) => one.getAttribute('data-order'))).toEqual(['o-2', 'o-1']);
    });

    it('says when the shop could not be read, and is answered as nothing for a role that does not open it', async () =>
    {
        server.staff.owners = [];
        server.staff.members = [staffMember('alex', 'moderator')];

        const { container } = await opened();

        expect(container.querySelectorAll('[data-item]')).toHaveLength(0);
        expect(text(container.querySelector('[role="alert"]'))).toContain('The shop could not be read.');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        item('pawns.jade').sale = { price: nura(20n), until: new Date(NOW + 2 * 86_400_000).toISOString() };

        const { container } = await opened();

        expect(container.querySelector('h1')?.textContent).toBe('فروشگاه');
        expect(text(row(container, 'dice.glow')!.querySelector('[data-name]'))).toBe('تاس درخشش نورا');
        expect(text(row(container, 'dice.glow')!.querySelector('[data-now]'))).toBe('۱۲ NURA');
        expect(text(row(container, 'pawns.jade')!.querySelector('[data-sale]'))).toBe('تخفیف ۲۰ NURA پس‌فردا تموم می‌شه');
        expect(text(container.querySelector('[data-collection="inferno"] [data-top]'))).toBe('بالای فروشگاه');
        expect(change(container, 'dice.glow').textContent?.trim()).toBe('تغییر');
    });
});

describe('the sheet that changes a look', () =>
{
    const sheet = (look: Partial<AdminShopItem> = {}, initial?: ShopAsk) =>
    {
        const close = vi.fn();
        const shown: AdminShopItem = { id: 'dice.glow', price: nura(12n), listed: nura(12n), status: 'on-sale', sold: 0, ...look };
        const { container } = renderTest(() => ShopItemSheet({ overlayId: 'sheet', close, item: shown, name: 'Nura Glow dice', ...(initial === undefined ? {} : { initial }) }) as HTMLElement);

        return { close, container };
    };

    const part = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find((one) => text(one) === label)!;

    const confirm = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => text(one) !== 'Cancel' && one.closest('.sm\\:flex-row-reverse') !== null)!;

    const why = (root: ParentNode, value: string) => typeInto(root.querySelector<HTMLTextAreaElement>('#admin-shop-why')!, value);

    const error = (root: ParentNode) => text(root.querySelector('[role="alert"]'));

    it('asks for a price over nothing, not the one it has, and above a sale that runs', async () =>
    {
        const { close, container } = sheet({ sale: { price: nura(5n), until: new Date(NOW + 3_600_000).toISOString() } });

        await settle();
        why(container, 'Cheaper for a week');

        expect(text(container.querySelector('#admin-shop-price-hint'))).toBe('It costs 12 NURA now, and the catalogue lists it at 12 NURA.');

        for (const [typed, said] of [
            ['', 'Write a price in NURA, more than nothing, with four places at most.'],
            ['0', 'Write a price in NURA, more than nothing, with four places at most.'],
            ['1.00001', 'Write a price in NURA, more than nothing, with four places at most.'],
            ['12', 'That is its price already.'],
            ['5', 'It is on sale at 5 NURA, so its price has to be more than that. End the sale first.']
        ])
        {
            typeInto(container.querySelector<HTMLInputElement>('#admin-shop-price')!, typed);
            await settle();
            confirm(container).click();
            await settle();

            expect(error(container), typed).toBe(said);
            expect(close).not.toHaveBeenCalled();
        }

        typeInto(container.querySelector<HTMLInputElement>('#admin-shop-price')!, '۷٫۵');
        await settle();
        confirm(container).click();

        expect(close).toHaveBeenCalledWith({ change: { price: '7500000000000000000' }, reason: 'Cheaper for a week' });
    });

    it('asks for a sale under the price, for the hours chosen', async () =>
    {
        const { close, container } = sheet();

        await settle();
        part(container, 'Sale').click();
        await settle();
        why(container, 'A weekend sale');

        expect(text(confirm(container))).toBe('Start the sale');

        typeInto(container.querySelector<HTMLInputElement>('#admin-shop-sale')!, '12');
        await settle();
        confirm(container).click();
        await settle();

        expect(error(container)).toBe('A sale has to cost less than the look, 12 NURA.');

        typeInto(container.querySelector<HTMLInputElement>('#admin-shop-sale')!, '6');
        container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
        await settle();
        [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) => text(one) === '3 days')!.click();
        await settle();
        confirm(container).click();

        expect(close).toHaveBeenCalledWith({ change: { sale: { price: nura(6n), hours: 72 } }, reason: 'A weekend sale' });
    });

    it('says the sale that runs, and ends it instead', async () =>
    {
        const until = new Date(NOW + 86_400_000).toISOString();
        const { close, container } = sheet({ sale: { price: nura(6n), until } });

        await settle();
        part(container, 'Sale').click();
        await settle();

        expect(text(container.querySelector('[data-running] p'))).toBe(`On sale at 6 NURA until ${ useLocale().date(Date.parse(until), { dateStyle: 'long', timeStyle: 'short' }) }.`);

        container.querySelector<HTMLButtonElement>('[data-end-instead]')!.click();
        await settle();

        expect(text(container.querySelector('[data-ending] p'))).toBe('The sale at 6 NURA ends now, and it costs 12 NURA again.');
        expect(text(confirm(container))).toBe('End the sale');

        why(container, 'Over early');
        confirm(container).click();

        expect(close).toHaveBeenCalledWith({ change: { sale: false }, reason: 'Over early' });
    });

    it('says what each place in the shop means, and asks for a change', async () =>
    {
        const { close, container } = sheet();

        await settle();
        part(container, 'In the shop').click();
        await settle();
        why(container, 'Redrawing it');

        expect(text(container.querySelector('[data-status-lead]'))).toBe('Anybody may buy it.');

        confirm(container).click();
        await settle();

        expect(error(container)).toBe('It is like that already.');

        part(container, 'Retired').click();
        await settle();

        expect(text(container.querySelector('[data-status-lead]'))).toBe('It leaves the shop for good. Whoever owns it keeps it.');

        confirm(container).click();

        expect(close).toHaveBeenCalledWith({ change: { status: 'retired' }, reason: 'Redrawing it' });
    });

    it('asks why, in three characters or more', async () =>
    {
        const { close, container } = sheet();

        await settle();
        typeInto(container.querySelector<HTMLInputElement>('#admin-shop-price')!, '7');
        why(container, '  ok ');
        await settle();
        confirm(container).click();
        await settle();

        expect(text(container.querySelector('#admin-shop-why-error'))).toBe('Say why, in three characters or more.');
        expect(close).not.toHaveBeenCalled();
    });

    it('opens on what was asked before', async () =>
    {
        const { container } = sheet({}, { change: { sale: { price: nura(6n), hours: 168 } }, reason: 'A week of sale' });

        await settle();

        expect(container.querySelector<HTMLInputElement>('#admin-shop-sale')?.value).toBe('6');
        expect(text(container.querySelector('[aria-haspopup="listbox"]'))).toBe('A week');
        expect(container.querySelector<HTMLTextAreaElement>('#admin-shop-why')?.value).toBe('A week of sale');
    });
});

describe('the orders', () =>
{
    it('lists the orders newest first: the look, who paid and for whom, the price, when, how each stands and its transaction', async () =>
    {
        server.shopAdmin.chainId = 1020;
        server.shopAdmin.orders = [
            orderOf('o-3', { item: 'back.jade', state: 'quoted', for: { handle: 'mina', displayName: 'Mina', hue: 40 } }),
            orderOf('o-2', { state: 'failed', failure: 'EnforcedPause' }),
            orderOf('o-1', { state: 'paid', hash: HASH, delivered: false, paidAt: new Date(NOW - 30_000).toISOString() })
        ];

        const { container } = await opened('/admin/shop?view=orders');
        const orders = [...container.querySelectorAll<HTMLElement>('[data-order]')];

        expect(orders.map((one) => one.getAttribute('data-order'))).toEqual(['o-3', 'o-2', 'o-1']);
        expect(text(orders[0].querySelector('[data-name]'))).toBe('Jade Dragon Dynasty card back');
        expect(text(orders[0].querySelector('[data-who]'))).toBe('sara.k for mina');
        expect([...orders[0].querySelectorAll('[data-who] [dir="ltr"]')].map((one) => one.textContent)).toEqual(['sara.k', 'mina']);
        expect(text(orders[0].querySelector('[data-standing]'))).toBe('Not paid yet');
        expect(text(orders[1].querySelector('[data-who]'))).toBe('sara.k');
        expect(text(orders[1].querySelector('[data-failure]'))).toBe('NuraChain said EnforcedPause');
        expect(text(orders[2].querySelector('[data-price]'))).toBe('50 NURA');
        expect(text(orders[2].querySelector('[data-at]'))).toBe('1 minute ago');
        expect(text(orders[2].querySelector('[data-standing]'))).toBe('Paid Delivered nothing Transaction');
        expect(orders[2].querySelector('[data-tx]')?.getAttribute('href')).toBe(`https://explorer.nurachain.net/tx/${ HASH }`);
        expect(orders[2].querySelector('[data-tx]')?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('links no transaction on a chain it cannot name', async () =>
    {
        server.shopAdmin.chainId = 31337;
        server.shopAdmin.orders = [orderOf('o-1', { hash: HASH })];

        const { container } = await opened('/admin/shop?view=orders');

        expect(container.querySelector('[data-order="o-1"] [data-tx]')).toBeNull();
    });

    it('finds orders by how they stand and by person, kept in the address', async () =>
    {
        server.shopAdmin.orders = [
            orderOf('o-3', { state: 'refunded' }),
            orderOf('o-2', { buyer: { handle: 'omid', displayName: 'Omid', hue: 90 } }),
            orderOf('o-1', { state: 'paid', buyer: { handle: 'reza.t', displayName: 'Reza', hue: 200 }, for: { handle: 'omid', displayName: 'Omid', hue: 90 } })
        ];

        const { router, container } = await opened('/admin/shop?view=orders');
        const ids = () => [...container.querySelectorAll('[data-order]')].map((one) => one.getAttribute('data-order'));

        expect(chips(container).map(([label]) => label)).toEqual(['Looks', 'Orders', 'All', 'Paid', 'On its way', 'Not paid yet', 'Failed', 'Refunded', 'Ran out']);

        chip(container, 'Refunded').click();
        await settle();

        expect(router.location().search).toContain('state=refunded');
        expect(ids()).toEqual(['o-3']);

        chip(container, 'All').click();
        await settle();
        typeInto(container.querySelector<HTMLInputElement>('[data-shop-orders] input[type="search"]')!, '@Omid');
        await settle();

        expect(ids()).toEqual(['o-3', 'o-2', 'o-1']);

        clock.advance(SEARCH_PAUSE_MS);
        await settle();

        expect(router.location().search).toContain('person=%40Omid');
        expect(ids()).toEqual(['o-2', 'o-1']);
        expect(server.calls.filter((call) => call.startsWith('admin.shopOrders')).at(-1)).toBe('admin.shopOrders {"person":"@Omid"}');
    });

    it('shows older orders a page at a time', async () =>
    {
        server.shopAdmin.orders = Array.from({ length: SHOP_ORDERS_PAGE + 3 }, (_, at) => orderOf(`o-${ String(at).padStart(3, '0') }`));

        const { container } = await opened('/admin/shop?view=orders');
        const more = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => text(one) === 'Show older');

        expect(container.querySelectorAll('[data-order]')).toHaveLength(SHOP_ORDERS_PAGE);

        more()!.click();
        await settle();

        expect(container.querySelectorAll('[data-order]')).toHaveLength(SHOP_ORDERS_PAGE + 3);
        expect(more()).toBeUndefined();
    });

    it('says when there are no orders, when none is like that, and when they could not be read', async () =>
    {
        const first = await opened('/admin/shop?view=orders');

        expect(text(first.container.querySelector('[data-empty]'))).toBe('No orders yet. An order is here as soon as somebody asks to buy a look.');

        cleanup();

        const found = await opened('/admin/shop?view=orders&state=paid');

        expect(text(found.container.querySelector('[data-empty]'))).toBe('No order is like that.');

        cleanup();
        server.staff.owners = [];

        const failed = await opened('/admin/shop?view=orders');

        expect(text(failed.container.querySelector('[role="alert"]'))).toContain('The orders could not be read.');
    });
});

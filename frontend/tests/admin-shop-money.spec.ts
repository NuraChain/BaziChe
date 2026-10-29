import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import AdminShopMoney from '../src/components/admin/admin-shop-money.component.azeroth';
import MoneyPage from '../src/pages/admin/money.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVault } from '../src/stores/vault.store.ts';
import type { AdminShopMoney as Standing } from '../../backend/src/schemas.ts';
import { client, server, shopMoneyState, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const OWNER = '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f';

const SELLER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const shopWith = (change: Partial<Extract<Standing, { configured: true }>>) =>
{
    server.shopAdmin.money = { ...shopMoneyState(), ...change } as Standing;
};

const shown = async () =>
{
    const routes: Route[] = [{ path: '/admin/money', component: () => AdminShopMoney({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory('/admin/money'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const toasts = () => useToasts().items().map((one) => `${ one.kind } ${ one.text }`);

const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

/** The wallet as the vault store asks it: what the server composed is sent and mined, and a call the server refused never reaches a wallet. */
const sending = () => vi.spyOn(useVault(), 'send').mockImplementation(async (compose) =>
{
    try
    {
        await compose();
        return null;
    }
    catch
    {
        return 'common.actionFailed';
    }
});

const reads = () => server.calls.filter((call) => call === 'admin.shopMoney').length;

const as = (staff: 'owner' | 'admin' | 'moderator') =>
{
    server.staff.owners = [staff === 'owner' ? 'owner' : 'reza.t'];
    server.staff.members = staff === 'owner' ? [] : [staffMember('owner', staff, 'reza.t', '2026-10-20T09:00:00.000Z')];
    server.me = 'owner';
    useSession().reset();
    useSession().establish({ id: 'owner', handle: 'owner', displayName: 'Owner', bio: '', hue: 40, isMinor: false, address: OWNER, staff });
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-10-29T09:00:00.000Z')), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    as('owner');
    useVault().reset();
    useToasts().dismissAll();
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useVault().reset();
    useOverlay().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the shop\'s money, as its owner sees it', () =>
{
    it('says what the contract holds and owes, the inviters\' share, that it sells, its seller and what this wallet may do, in the reader\'s digits', async () =>
    {
        const container = await shown();

        expect(said(container, '#admin-shop-money')).toBe('The shop');
        expect(said(container, '[data-fact="revenue"] dd')).toBe('12 NURA');
        expect(said(container, '[data-fact="owed"] dd')).toBe('3 NURA');
        expect([...container.querySelectorAll('[data-fact="held"] dd')].map((one) => one.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['15 NURA', 'Covers all it owes']);
        expect(container.querySelector('[data-solvent]')?.getAttribute('data-solvent')).toBe('yes');
        expect(said(container, '[data-fact="share"] dd')).toBe('10%');
        expect(said(container, '[data-paused]')).toBe('Taking orders');
        expect(said(container, '[data-seller]')).toBe('0xa0Ee…9720');
        expect(container.querySelector('[data-seller]')?.getAttribute('dir')).toBe('ltr');
        expect([container.querySelector('[data-lost]'), container.querySelector('[data-named]')]).toEqual([null, null]);
        expect([...container.querySelectorAll('[data-role]')].map((one) => one.getAttribute('data-role'))).toEqual(['owner', 'pauser']);
        expect(said(container, '[data-role="owner"]')).toBe('Can take the revenue out, change the inviters’ share and the seller, and refund a paid order.');
        expect(said(container, '[data-undelivered="none"]')).toBe('Every paid order delivered what it was for.');
        expect(container.querySelector('[data-refunding]')).toBeNull();
        expect(['#admin-shop-withdraw', '#admin-shop-share', '#admin-shop-seller'].map((id) => container.querySelector(id) !== null)).toEqual([true, true, true]);
        expect(button(container, 'Pause the shop')).toBeDefined();
        expect(server.calls).toContain('admin.shopMoney');
    });

    it('raises the alarm for a contract short of what it owes, a seller out of its role, and a contract that names another seller', async () =>
    {
        shopWith({ solvent: false, seller: { address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', allowed: false, named: SELLER } });
        const container = await shown();

        expect(container.querySelector('[data-solvent]')?.getAttribute('data-solvent')).toBe('no');
        expect(said(container, '[data-solvent]')).toBe('Short of what it owes');
        expect(said(container, '[data-lost]')).toBe('This server’s key no longer holds the seller’s role on the shop, so nothing can be bought.');
        expect(container.querySelector('[data-lost]')?.getAttribute('role')).toBe('alert');
        expect(said(container, '[data-named]')).toBe('NuraChain names 0x7099…79C8 as the seller, not this server’s key.');
    });

    it('names the paid orders that delivered nothing, leading to them, and the refunds on their way', async () =>
    {
        shopWith({ undelivered: 2, refunding: 1 });
        const container = await shown();

        expect(said(container, 'a[data-undelivered]')).toBe('2 paid orders delivered nothing');
        expect(container.querySelector('a[data-undelivered]')?.getAttribute('href')).toBe('/admin/shop?view=orders&state=undelivered');
        expect(container.querySelector('a[data-undelivered]')?.className).toContain('text-danger');
        expect(said(container, '[data-refunding]')).toBe('1 refund on its way');
        expect(container.querySelector('[data-undelivered="none"]')).toBeNull();
    });

    it('says the shop is paused when it is, and offers to open it again', async () =>
    {
        shopWith({ paused: true });
        const container = await shown();

        expect(said(container, '[data-paused]')).toBe('Paused: nothing can be bought');
        expect(container.querySelector('[data-paused]')?.getAttribute('data-paused')).toBe('yes');
        expect(button(container, 'Open the shop again')).toBeDefined();
        expect(button(container, 'Pause the shop')).toBeUndefined();
    });

    it('offers a wallet with no role on the shop nothing to change, and says so', async () =>
    {
        shopWith({ roles: { owner: false, pauser: false } });
        const container = await shown();

        expect(said(container, '[data-role="none"]')).toBe('Holds no role on the shop, so it can change nothing here.');
        expect(['#admin-shop-withdraw', '#admin-shop-share', '#admin-shop-seller'].map((id) => container.querySelector(id))).toEqual([null, null, null]);
        expect(button(container, 'Pause the shop')).toBeUndefined();
    });

    it('offers a pauser the pause and nothing else', async () =>
    {
        shopWith({ roles: { owner: false, pauser: true } });
        const container = await shown();

        expect(container.querySelector('#admin-shop-withdraw')).toBeNull();
        expect(container.querySelector('#admin-shop-seller')).toBeNull();
        expect(button(container, 'Pause the shop')).toBeDefined();
    });

    it('shows an admin who is not the owner the money and nothing to change, whatever the wallet holds, and says the owner changes it', async () =>
    {
        as('admin');
        const container = await shown();

        expect(said(container, '[data-fact="revenue"] dd')).toBe('12 NURA');
        expect(said(container, '[data-role="owner-only"]')).toBe('Only the owner changes the shop’s money from here.');
        expect([container.querySelector('[data-role="owner"]'), container.querySelector('[data-role="pauser"]')]).toEqual([null, null]);
        expect(['#admin-shop-withdraw', '#admin-shop-share', '#admin-shop-seller'].map((id) => container.querySelector(id))).toEqual([null, null, null]);
        expect(button(container, 'Pause the shop')).toBeUndefined();
    });

    it('takes revenue out through the wallet, says so once the shop is read again, and asks the wallet nothing for no amount', async () =>
    {
        const container = await shown();
        const send = sending();
        const field = container.querySelector<HTMLInputElement>('#admin-shop-withdraw')!;

        typeInto(field, '0');
        fire(button(container, 'Take it out to this wallet')!, 'click');
        await settle();

        expect(said(container, '#admin-shop-withdraw-error')).toBe('Write an amount of NURA, like 12 or 2.5.');
        expect(send).not.toHaveBeenCalled();

        fire(button(container, 'All of it')!, 'click');
        await settle();

        expect(field.value).toBe('12');
        expect(container.querySelector('#admin-shop-withdraw-error')).toBeNull();

        typeInto(field, '۲٫۵');
        await settle();
        fire(button(container, 'Take it out to this wallet')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.shopWithdraw 2500000000000000000');
        expect(toasts()).toEqual(['success 2.5 NURA is in this wallet.']);
        expect(reads()).toBe(2);
        expect(field.value).toBe('');
    });

    it('changes the inviters\' share as basis points, and asks the wallet nothing past the contract\'s own ceiling', async () =>
    {
        const container = await shown();
        const send = sending();
        const field = container.querySelector<HTMLInputElement>('#admin-shop-share')!;

        expect(said(container, '#admin-shop-share-hint')).toBe('From 0 to 30% of what the people they brought in spend.');

        typeInto(field, '31');
        fire(button(container, 'Change the share')!, 'click');
        await settle();

        expect(said(container, '#admin-shop-share-error')).toBe('Write a share from 0 to 30%, like 10 or 7.5.');
        expect(send).not.toHaveBeenCalled();

        typeInto(field, '7.5');
        fire(button(container, 'Change the share')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.shopShare 750');
        expect(toasts()).toEqual(['success Inviters now earn 7.5%.']);

        typeInto(field, '0');
        fire(button(container, 'Change the share')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.shopShare 0');
    });

    it('says what came of a change only once the shop has been read again, so the toast and the figures agree', async () =>
    {
        const container = await shown();
        const admin = client.admin as unknown as Record<string, unknown>;
        const real = admin.shopMoney;
        let release = () => undefined as unknown;

        sending();
        admin.shopMoney = () => new Promise((resolve) =>
        {
            release = () => resolve({ ...shopMoneyState(), share: 750 });
        });

        try
        {
            typeInto(container.querySelector<HTMLInputElement>('#admin-shop-share')!, '7.5');
            fire(button(container, 'Change the share')!, 'click');
            await settle();

            expect(toasts(), 'the toast came before the figures').toEqual([]);
            expect(said(container, '[data-fact="share"] dd')).toBe('10%');

            release();
            await settle();

            expect(toasts()).toEqual(['success Inviters now earn 7.5%.']);
            expect(said(container, '[data-fact="share"] dd')).toBe('7.5%');
        }
        finally
        {
            admin.shopMoney = real;
        }
    });

    it('asks before it changes the seller, and composes nothing for an address that is not one', async () =>
    {
        const container = await shown();
        const field = container.querySelector<HTMLInputElement>('#admin-shop-seller')!;

        sending();
        typeInto(field, '0x1234');
        fire(button(container, 'Change the seller')!, 'click');
        await settle();

        expect(said(container, '#admin-shop-seller-error')).toBe('Write an address: 0x and then 40 letters and digits.');
        expect(useOverlay().items().filter((one) => one.phase !== 'closing')).toHaveLength(0);

        typeInto(field, SELLER);
        fire(button(container, 'Change the seller')!, 'click');
        await settle();

        expect(asked().props).toMatchObject({ title: 'Make 0x7099…79C8 the seller?', confirm: 'Change the seller', cancel: 'Keep this seller', destructive: true });
        expect(server.calls.filter((call) => call.startsWith('admin.shopSeller'))).toEqual([]);

        useOverlay().close(asked().id, false);
        await settle();

        expect(server.calls.filter((call) => call.startsWith('admin.shopSeller'))).toEqual([]);
        expect(field.value).toBe(SELLER);

        fire(button(container, 'Change the seller')!, 'click');
        await settle();
        useOverlay().close(asked().id, true);
        await settle();

        expect(server.calls).toContain(`admin.shopSeller ${ SELLER }`);
        expect(toasts()).toEqual(['success The seller is now 0x7099…79C8.']);
        expect(field.value).toBe('');
    });

    it('asks before it pauses the shop, as a question that loses something, keeps it open when told not now, and opens it again', async () =>
    {
        const container = await shown();

        sending();
        fire(button(container, 'Pause the shop')!, 'click');
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Pause the shop?',
            lead: 'Pausing stops anybody buying. What was bought stays bought, inviters can still claim, and refunds still land.',
            confirm: 'Pause it',
            cancel: 'Not now',
            destructive: true
        });

        useOverlay().close(asked().id, false);
        await settle();

        expect(server.calls.filter((call) => call.startsWith('admin.shopPause'))).toEqual([]);

        fire(button(container, 'Pause the shop')!, 'click');
        await settle();
        shopWith({ paused: true });
        useOverlay().close(asked().id, true);
        await settle();

        expect(server.calls).toContain('admin.shopPause true');
        expect(toasts()).toEqual(['success The shop is paused.']);
        expect(said(container, '[data-paused]')).toBe('Paused: nothing can be bought');

        fire(button(container, 'Open the shop again')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.shopPause false');
        expect(useOverlay().items().filter((one) => one.phase !== 'closing')).toHaveLength(0);
        expect(toasts()).toContain('success The shop is open again.');
    });

    it('says in the staff\'s own words what the contract would refuse, asks no wallet, and keeps what was typed', async () =>
    {
        const container = await shown();
        const field = container.querySelector<HTMLInputElement>('#admin-shop-withdraw')!;

        sending();
        server.shopAdmin.refuse = 'staff-shop-revenue';
        typeInto(field, '20');
        fire(button(container, 'Take it out to this wallet')!, 'click');
        await settle();

        expect(toasts()).toEqual(['error The shop does not hold that much revenue.']);
        expect(field.value).toBe('20');
        expect(reads()).toBe(1);
    });

    it('says what the wallet refused in the vault\'s own words', async () =>
    {
        const container = await shown();

        vi.spyOn(useVault(), 'send').mockResolvedValue('tables.refused.vault-role');
        typeInto(container.querySelector<HTMLInputElement>('#admin-shop-share')!, '12');
        fire(button(container, 'Change the share')!, 'click');
        await settle();

        expect(toasts()).toEqual(['error This wallet does not hold that role on the vault.']);
        expect(reads()).toBe(1);
    });

    it('says the shop\'s money could not be read, and reads it again when asked', async () =>
    {
        const admin = client.admin as unknown as Record<string, unknown>;
        const real = admin.shopMoney;

        admin.shopMoney = () => Promise.reject(new Error('down'));

        try
        {
            const container = await shown();

            expect(container.textContent).toContain('The shop’s money could not be read.');
            expect(container.querySelector('[data-fact]')).toBeNull();

            admin.shopMoney = real;
            fire(button(container, 'Try again')!, 'click');
            await settle();

            expect(said(container, '[data-fact="revenue"] dd')).toBe('12 NURA');
        }
        finally
        {
            admin.shopMoney = real;
        }
    });

    it('says the shop is turned off on a server that keeps no shop, and offers nothing to change', async () =>
    {
        server.shopAdmin.money = { configured: false };
        const container = await shown();

        expect(container.querySelector('[data-off="shop"]')).not.toBeNull();
        expect(container.querySelector('[data-fact]')).toBeNull();
        expect(container.querySelector('#admin-shop-withdraw')).toBeNull();
    });

    it('stands under the vault on Money', async () =>
    {
        const routes: Route[] = [{ path: '/admin/money', component: () => MoneyPage({}) as unknown as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/admin/money'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await settle();

        const vault = container.querySelector('[aria-labelledby="admin-vault"]')!;
        const shop = container.querySelector('[data-shop-money]')!;

        expect(vault.contains(shop)).toBe(false);
        expect(vault.compareDocumentPosition(shop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(said(container, '#admin-shop-money')).toBe('The shop');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        shopWith({ undelivered: 2 });
        const container = await shown();

        expect(said(container, '#admin-shop-money')).toBe('فروشگاه');
        expect(said(container, '[data-fact="revenue"] dd')).toBe('۱۲ NURA');
        expect(said(container, '[data-fact="share"] dd')).toBe('۱۰٪');
        expect(said(container, '[data-paused]')).toBe('سفارش می‌گیره');
        expect(said(container, 'a[data-undelivered]')).toBe('۲ سفارش که پولشون داده شده ولی چیزی تحویل ندادن');
        expect(said(container, '[data-role="pauser"]')).toBe('می‌تونه فروشگاه رو متوقف کنه.');
    });
});

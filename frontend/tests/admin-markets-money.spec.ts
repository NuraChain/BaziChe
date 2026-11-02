import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import AdminMarketsMoney from '../src/components/admin/admin-markets-money.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVault } from '../src/stores/vault.store.ts';
import type { AdminMarkets as Standing } from '../../backend/src/schemas.ts';
import { marketsMoneyState, server, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/**
 * Who operates the markets, on the money page: the server's key and the operator NuraChain names,
 * the alarm when they part, and the owner's wallet moving the role, asked first.
 */

const OWNER = '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f';
const OLD = '0x2Ef2d5a095fD5eCd686d99Ed3cD1F9fF91FC3167';
const NEXT = '0x7f21c8c503F28897C16b20614e1312b9f53c77E7';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const marketsWith = (change: Partial<Extract<Standing, { configured: true }>>) =>
{
    server.marketsAdmin = { ...marketsMoneyState(), ...change } as Standing;
};

const shown = async () =>
{
    const routes: Route[] = [{ path: '/admin/money', component: () => AdminMarketsMoney({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory('/admin/money'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

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

const as = (staff: 'owner' | 'admin') =>
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
    setRuntime({ clock: manualClock(Date.parse('2026-11-03T09:00:00.000Z')), seed: 5 });
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
});

describe('who operates the markets, as the owner sees it', () =>
{
    it('shows this server\'s key, and no alarm while it is the operator NuraChain names', async () =>
    {
        const container = await shown();

        expect(said(container, '[data-operator]')).toBe('0x7f21…77E7');
        expect(container.querySelector('[data-operator]')?.getAttribute('dir')).toBe('ltr');
        expect(container.querySelector('[data-lost]')).toBeNull();
        expect(container.querySelector('[data-named]')).toBeNull();
    });

    it('raises the alarm when the server signs with a key the contract does not name: the moment to change it', async () =>
    {
        marketsWith({ operator: { address: NEXT, allowed: false, named: OLD } });
        const container = await shown();

        expect(said(container, '[data-lost]')).toBe('This server’s key no longer holds the operator’s role on the markets, so nothing can be backed or settled.');
        expect(said(container, '[data-named]')).toBe('NuraChain names 0x2Ef2…3167 as the operator, not this server’s key.');
    });

    it('asks before it moves the role, sends nothing when told no, and has the owner\'s wallet send it when told yes', async () =>
    {
        const container = await shown();
        const field = container.querySelector<HTMLInputElement>('#admin-markets-operator')!;

        sending();
        typeInto(field, '0x1234');
        fire(button(container, 'Change the operator')!, 'click');
        await settle();

        expect(said(container, '#admin-markets-operator-error')).toBe('Write an address: 0x and then 40 letters and digits.');

        typeInto(field, NEXT);
        fire(button(container, 'Change the operator')!, 'click');
        await settle();

        expect(asked().props).toMatchObject({ title: 'Make 0x7f21…77E7 the operator?', confirm: 'Change the operator', cancel: 'Keep this operator', destructive: true });

        useOverlay().close(asked().id, false);
        await settle();
        expect(server.calls.filter((call) => call.startsWith('admin.marketsOperator'))).toEqual([]);

        fire(button(container, 'Change the operator')!, 'click');
        await settle();
        useOverlay().close(asked().id, true);
        await settle();

        expect(server.calls).toContain(`admin.marketsOperator ${ NEXT }`);
        expect(useToasts().items().map((one) => `${ one.kind } ${ one.text }`)).toEqual(['success The operator is now 0x7f21…77E7.']);
        expect(field.value).toBe('');
    });

    it('offers the change only to a wallet that owns the markets', async () =>
    {
        marketsWith({ owner: false });
        const container = await shown();

        expect(container.querySelector('#admin-markets-operator')).toBeNull();
        expect(said(container, '[data-role="owner-only"]')).toBe('Only the wallet that owns the markets can change who operates them.');
    });

    it('says markets are off where this server runs none', async () =>
    {
        server.marketsAdmin = { configured: false };
        const container = await shown();

        expect(container.querySelector('[data-off="markets"]')).not.toBeNull();
        expect(container.querySelector('[data-operator]')).toBeNull();
    });
});

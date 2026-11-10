import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import AdminStakeRate from '../src/components/admin/admin-stake-rate.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const WEI = 10n ** 18n;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const shown = async () =>
{
    const routes: Route[] = [{ path: '/admin/money', component: () => AdminStakeRate({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory('/admin/money'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const typeInto = (root: ParentNode, value: string) =>
{
    const field = root.querySelector<HTMLInputElement>('#admin-rate-amount')!;

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const as = (staff: 'owner' | 'admin' | 'moderator') =>
{
    server.staff.owners = [staff === 'owner' ? 'owner' : 'reza.t'];
    server.staff.members = staff === 'owner' ? [] : [staffMember('owner', staff, 'reza.t', '2026-10-20T09:00:00.000Z')];
    server.me = 'owner';
    useSession().reset();
    useSession().establish({ id: 'owner', handle: 'owner', displayName: 'Owner', bio: '', hue: 40, isMinor: false, staff });
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-11-10T09:00:00.000Z')), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    as('admin');
    useToasts().dismissAll();
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useOverlay().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('what a dollar is in NURA, as the staff set it', () =>
{
    it('says none is set, takes one with a reason for the log, and says what it now is', async () =>
    {
        const container = await shown();

        expect(said(container, '[data-rate-now]')).toBe('No rate is set, so the shortcuts are hidden.');
        expect(button(container, 'Turn off')).toBeUndefined();

        typeInto(container, '2.5');
        fire(button(container, 'Save')!, 'click');
        await settle();

        expect(asked().props).toMatchObject({ title: 'Set $1 to 2.5 NURA?' });

        useOverlay().close(asked().id, 'The price on the exchange today.');
        await settle();

        expect(server.usdRate).toBe((25n * WEI / 10n).toString());
        expect(server.calls).toContain(`admin.setStakeRate ${ 25n * WEI / 10n } The price on the exchange today.`);
        expect(said(container, '[data-rate-now]')).toBe('Now $1 is 2.5 NURA.');
    });

    it('refuses an amount that is not one, and asks nothing', async () =>
    {
        const container = await shown();

        for (const typed of ['0', 'abc', '1.00001'])
        {
            typeInto(container, typed);
            fire(button(container, 'Save')!, 'click');
            await settle();

            expect(container.textContent, typed).toContain('Write a positive amount, to four places at most.');
            expect(useOverlay().items().filter((one) => one.phase !== 'closing'), typed).toHaveLength(0);
        }

        expect(server.usdRate).toBeNull();
    });

    it('turns the shortcuts off again', async () =>
    {
        server.usdRate = (3n * WEI).toString();
        const container = await shown();

        expect(said(container, '[data-rate-now]')).toBe('Now $1 is 3 NURA.');

        fire(button(container, 'Turn off')!, 'click');
        await settle();
        useOverlay().close(asked().id, 'No price we trust today.');
        await settle();

        expect(server.usdRate).toBeNull();
        expect(said(container, '[data-rate-now]')).toBe('No rate is set, so the shortcuts are hidden.');
    });

    it('takes Persian digits, in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const container = await shown();

        typeInto(container, '۲٫۵');
        fire(button(container, useLocale().t('admin.rate.save'))!, 'click');
        await settle();
        useOverlay().close(asked().id, 'قیمت امروز صرافی.');
        await settle();

        expect(server.usdRate).toBe((25n * WEI / 10n).toString());
    });
});

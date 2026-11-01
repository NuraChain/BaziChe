import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import DevicesPage from '../src/pages/app/devices.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevices } from '../src/stores/devices.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';

const opened = () =>
{
    const table: Route[] = [{ path: '/app/me/devices', component: () => DevicesPage() as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/me/devices'), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

const signOut = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLButtonElement>('section[aria-labelledby="devices-live"] button')]
        .find((one) => one.textContent?.trim() === useLocale().t('devices.revoke'));

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(1_500_000), seed: 23 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useDevices().reset();
    useToasts().reset();
});

afterEach(() =>
{
    vi.restoreAllMocks();
    cleanup();
    resetRuntime();
});

describe('signing a browser out that does not go through', () =>
{
    it.each([
        ['the request never got there', new TypeError('Failed to fetch'), 'failure.unreached'],
        ['the server is not answering', new ApiError(503, 'unknown', 'x', undefined), 'failure.down'],
        ['the server refused it', new ApiError(409, 'conflict', 'x', undefined), 'devices.actionFailed']
    ] as const)('says why when %s, and the browser stays signed in', async (_, failure, key) =>
    {
        server.addDevice({ id: 'device-one', exchangeKey: 'exchange-one', signingKey: 'signing-one', label: 'Laptop' });

        const container = opened();

        await vi.waitFor(() => expect(signOut(container)).toBeDefined(), { timeout: 4000 });

        vi.spyOn(client.devices, 'revoke').mockRejectedValueOnce(failure);
        signOut(container)!.click();

        await vi.waitFor(() => expect(useToasts().items().map((one) => [one.kind, one.text])).toEqual([['error', useLocale().t(key)]]), { timeout: 4000 });
        expect(server.calls).not.toContain('devices.revoke');
    });
});

describe('the browsers signed in, before the server has answered', () =>
{
    const live = (container: HTMLElement) => container.querySelector('section[aria-labelledby="devices-live"]')!;

    const anew = async () =>
    {
        useSession().reset();
        await Promise.resolve();
        useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    };

    it('are drawn as being read, and as none only once the server has said so', async () =>
    {
        const real = client.devices.list;
        let open: () => void = () => undefined;

        vi.spyOn(client.devices, 'list').mockImplementationOnce(() => new Promise((resolve, reject) =>
        {
            open = () => void real.call(client.devices).then(resolve, reject);
        }));
        await anew();

        const container = opened();

        await vi.waitFor(() => expect(live(container).querySelector('[data-reading]')).not.toBeNull(), { timeout: 4000 });

        expect(live(container).textContent).not.toContain(useLocale().t('devices.empty'));

        open();

        await vi.waitFor(() => expect(live(container).textContent).toContain(useLocale().t('devices.empty')), { timeout: 4000 });

        expect(live(container).querySelector('[data-reading]')).toBeNull();
    });

    it('say nothing about this browser before its keys and the list are known', async () =>
    {
        const real = client.devices.list;
        const waiting: (() => void)[] = [];
        const open = () => waiting.splice(0).forEach((one) => one());

        vi.spyOn(client.devices, 'list').mockImplementation(() => new Promise((resolve, reject) =>
        {
            waiting.push(() => void real.call(client.devices).then(resolve, reject));
        }));
        await anew();

        const container = opened();

        await vi.waitFor(() => expect(container.querySelector('[data-reading]')).not.toBeNull(), { timeout: 4000 });

        expect(container.textContent, 'this browser is said to be missing before anybody has looked').not.toContain(useLocale().t('devices.self.absent'));
        expect(container.textContent).not.toContain(useLocale().t('devices.enrol'));

        vi.mocked(client.devices.list).mockImplementation(() => real.call(client.devices));
        open();

        await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('devices.self.absent')), { timeout: 4000 });
    });

    it('offer no recovery phrase to make before the server has said whether there is one, and say why when it could not', async () =>
    {
        const real = client.devices.recovery;
        let refusing = true;

        vi.spyOn(client.devices, 'recovery').mockImplementation(() => (refusing ? Promise.reject(new ApiError(503, 'unavailable', 'Down.', undefined)) : real.call(client.devices)));
        await anew();

        const container = opened();
        const recovery = () => container.querySelector('section[aria-labelledby="devices-recovery"]')!;

        await vi.waitFor(() => expect(recovery().querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

        expect(recovery().querySelector('[role="alert"]')?.textContent).toContain(useLocale().t('failure.down'));
        expect(recovery().textContent, 'a phrase is offered to somebody who may already have one').not.toContain(useLocale().t('recovery.make'));

        refusing = false;
        [...recovery().querySelectorAll('button')].find((one) => one.textContent?.includes(useLocale().t('common.retry')))!.click();

        await vi.waitFor(() => expect(recovery().textContent).toContain(useLocale().t('recovery.make')), { timeout: 4000 });
    });

    it('say what went wrong where they would be, and read them again at Try again', async () =>
    {
        const real = client.devices.list;
        let refusing = true;

        vi.spyOn(client.devices, 'list').mockImplementation(() => (refusing ? Promise.reject(new ApiError(503, 'unavailable', 'Down.', undefined)) : real.call(client.devices)));
        await anew();

        const container = opened();

        await vi.waitFor(() => expect(live(container).querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

        const alert = live(container).querySelector('[role="alert"]')!;

        expect(alert.textContent).toContain(useLocale().t('failure.down'));
        expect(live(container).textContent).not.toContain(useLocale().t('devices.empty'));

        refusing = false;
        [...alert.querySelectorAll('button')].find((one) => one.textContent?.includes(useLocale().t('common.retry')))!.click();

        await vi.waitFor(() => expect(live(container).textContent).toContain(useLocale().t('devices.empty')), { timeout: 4000 });

        expect(live(container).querySelector('[role="alert"]')).toBeNull();
    });
});

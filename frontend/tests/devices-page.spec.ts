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

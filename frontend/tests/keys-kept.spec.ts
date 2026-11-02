import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { KEYS_OF, keysOwner } from '../src/lib/key-owner.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { answeredUnauthorized, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const wiped = vi.hoisted(() => ({ epochKeys: 0, deviceKeys: 0 }));

vi.mock('../src/lib/epoch-keys.ts', async (original) => ({
    ...await original<typeof import('../src/lib/epoch-keys.ts')>(),
    forgetEpochKeys: async () =>
    {
        wiped.epochKeys += 1;
    }
}));

vi.mock('../src/lib/device-keys.ts', async (original) =>
{
    const real = await original<typeof import('../src/lib/device-keys.ts')>();

    return {
        ...real,
        keyStore: () => ({
            ...real.keyStore(),
            forget: async () =>
            {
                wiped.deviceKeys += 1;
            }
        })
    };
});

/**
 * A browser's chat keys outlive signing out, because signing back in with the same account would
 * otherwise be a new device that can read nothing sent before it: every older line "Locked". They
 * are wiped when it matters: the session was ended from elsewhere (a lost laptop, a revoked device,
 * the staff), or another account signs in at this browser.
 */

const DARYA = { id: 'u-darya', handle: 'darya', displayName: 'Darya', bio: '', hue: 280, isMinor: false };
const MINA = { ...DARYA, id: 'u-mina', handle: 'mina', displayName: 'Mina' };

const memory = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
};

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(1_000_000), seed: 3 });
    server.reset();
    memory.clear();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) =>
            {
                memory.set(key, value);
            },
            removeItem: (key: string) =>
            {
                memory.delete(key);
            }
        }
    });
    useSession().reset();
    useSettings().reset();
    useRealtime().reset();
    socket.reset();
    wiped.epochKeys = 0;
    wiped.deviceKeys = 0;
});

afterEach(() =>
{
    if (original !== undefined)
    {
        Object.defineProperty(window, 'localStorage', original);
    }
});

describe('a browser’s chat keys', () =>
{
    it('are kept when the person signs out, and still theirs when they sign back in', async () =>
    {
        const session = useSession();

        session.establish(DARYA);
        expect(keysOwner(), 'whose keys these are is written down').toBe(DARYA.id);
        useSettings().update({ voiceLevels: { 'sara.k': 0.4 } });

        await session.signOut();
        await flush();

        expect(wiped, 'signing out kept the keys').toEqual({ epochKeys: 0, deviceKeys: 0 });
        expect(useSettings().settings().voiceLevels, 'what was read and set in the tab is still dropped').toEqual({});
        expect(keysOwner()).toBe(DARYA.id);

        session.establish(DARYA);
        await flush();
        expect(wiped, 'the same person back').toEqual({ epochKeys: 0, deviceKeys: 0 });
    });

    it('are kept when the person signs out everywhere from this browser', async () =>
    {
        useSession().establish(DARYA);
        await useSession().signOutEverywhere();
        await flush();

        expect(wiped).toEqual({ epochKeys: 0, deviceKeys: 0 });
    });

    it('are wiped before another account reads anything at this browser, the device kept for the sign-in that made it', async () =>
    {
        useSession().establish(DARYA);
        await useSession().signOut();

        useSession().establish(MINA);
        await flush();

        expect(wiped.epochKeys, 'the last person’s epoch keys').toBe(1);
        expect(wiped.deviceKeys, 'the device this sign-in was made with is Mina’s, not Darya’s').toBe(0);
        expect(keysOwner()).toBe(MINA.id);
    });

    it('take a browser from before this was written as the signed-in person’s, wiping nothing', async () =>
    {
        expect(memory.has(KEYS_OF)).toBe(false);

        useSession().establish(DARYA);
        await flush();

        expect(wiped).toEqual({ epochKeys: 0, deviceKeys: 0 });
        expect(keysOwner()).toBe(DARYA.id);
    });

    describe('when the session ends somewhere else', () =>
    {
        let stops: (() => void)[] = [];

        beforeEach(() =>
        {
            stops = [useRealtime().start(), useSession().start()];
            socket.accept();
            useSession().establish(DARYA);
            server.account = DARYA;
        });

        afterEach(() =>
        {
            for (const stop of stops.reverse())
            {
                stop();
            }
        });

        it('are wiped, device and all, when the server says the session was revoked', async () =>
        {
            server.account = null;
            server.ended = 'revoked';
            answeredUnauthorized();
            await flush();

            expect(useSession().signedIn()).toBe(false);
            expect(wiped).toEqual({ epochKeys: 1, deviceKeys: 1 });
            expect(keysOwner()).toBeNull();
        });

        it('are kept when the session only ran out', async () =>
        {
            server.account = null;
            answeredUnauthorized();
            await flush();

            expect(useSession().signedIn()).toBe(false);
            expect(wiped).toEqual({ epochKeys: 0, deviceKeys: 0 });
            expect(keysOwner()).toBe(DARYA.id);
        });
    });
});

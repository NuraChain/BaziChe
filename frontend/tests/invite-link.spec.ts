import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KEPT_MS, keepInvite, keptInvite, letInviteGo, visitorToken } from '../src/lib/invite.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { memoryStorage } from './memory-storage.ts';

const storage = memoryStorage();

let clock: ManualClock;

beforeEach(() =>
{
    storage.fresh();
    resetRuntime();
    clock = manualClock(1_790_000_000_000);
    setRuntime({ clock, seed: 2 });
});

afterEach(() =>
{
    storage.restore();
    resetRuntime();
});

describe('the code a link brought, kept on this device', () =>
{
    it('is kept as the link brought it and read back until a wallet signs in', () =>
    {
        expect(keptInvite()).toBeNull();
        expect(keepInvite('ABCD2345')).toBe('ABCD2345');
        expect(keptInvite()).toBe('ABCD2345');

        letInviteGo();

        expect(keptInvite()).toBeNull();
    });

    it('is the first link\'s for thirty days, whatever link comes after it', () =>
    {
        keepInvite('ABCD2345');
        clock.advance(KEPT_MS - 1);

        expect(keepInvite('WXYZ6789'), 'the first code stands').toBe('ABCD2345');
        expect(keptInvite()).toBe('ABCD2345');
    });

    it('is the next link\'s once the first is past its thirty days, and read as nothing then', () =>
    {
        keepInvite('ABCD2345');
        clock.advance(KEPT_MS);

        expect(keptInvite(), 'past the window').toBeNull();
        expect(keepInvite('WXYZ6789')).toBe('WXYZ6789');
        expect(keptInvite()).toBe('WXYZ6789');
    });

    it('gives way to the next link when the page has found that the kept one no longer works', () =>
    {
        keepInvite('ABCD2345');

        expect(keepInvite('WXYZ6789', true)).toBe('WXYZ6789');
        expect(keptInvite()).toBe('WXYZ6789');
    });

    it('starts its thirty days again for the same link opened again', () =>
    {
        keepInvite('ABCD2345');
        clock.advance(KEPT_MS - 10);
        keepInvite('ABCD2345');
        clock.advance(20);

        expect(keptInvite()).toBe('ABCD2345');
    });

    it('reads anything else kept under its name as nothing, and puts a link\'s code over it', () =>
    {
        const now = clock.now();

        for (const kept of [`{"code":"abcd2345","at":${ now }}`, `{"code":"ABCD0345","at":${ now }}`, `{"code":"ABCD23456","at":${ now }}`, '{"code":"ABCD2345"}', 'not json', '"ABCD2345"'])
        {
            storage.memory.set('nura.invite', kept);

            expect(keptInvite(), kept).toBeNull();
            expect(keepInvite('WXYZ6789'), kept).toBe('WXYZ6789');
            expect(keptInvite(), kept).toBe('WXYZ6789');
        }
    });

    it('is no harm where the device keeps nothing', () =>
    {
        storage.refusing();

        expect(keepInvite('ABCD2345')).toBe('ABCD2345');
        expect(keptInvite()).toBeNull();
        expect(() => letInviteGo()).not.toThrow();
    });
});

describe('the token a device names itself by when it opens a link', () =>
{
    it('is twenty-two letters of base64url, made once and the same after', () =>
    {
        const made = visitorToken();

        expect(made).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(visitorToken()).toBe(made);
    });

    it('is made again in place of anything kept under its name that is not one', () =>
    {
        storage.memory.set('nura.visitor', JSON.stringify('short'));

        const made = visitorToken();

        expect(made).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(visitorToken()).toBe(made);
    });

    it('is a token still where the device keeps nothing', () =>
    {
        storage.refusing();

        expect(visitorToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });
});

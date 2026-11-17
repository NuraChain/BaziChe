import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '../../backend/src/schemas.ts';
import { sectionsFor } from '../src/lib/admin-sections.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { logParts, systemSettingsIn, whyStaffRefused, type LogRow } from '../src/lib/staff-words.ts';
import { newestFirst, readSettings, sameSettings, totalsOf, typedSettings } from '../src/lib/system-admin.ts';
import '../src/locales/admin-catalogue.ts';
import { useAdminSystem } from '../src/stores/admin-system.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { ApiError, server, systemPlayer } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const signIn = async (handle: string, staff: 'owner' | 'admin' | 'moderator') =>
{
    const account: Account = { id: `u-${ handle }`, handle, displayName: handle, bio: '', hue: 40, isMinor: false, staff };
    server.me = handle;
    server.account = account;

    if (staff === 'owner')
    {
        server.staff.owners = [handle];
    }
    else
    {
        server.staff.owners = ['alex'];
        server.staff.members = [{ handle, displayName: handle, hue: 40, role: staff }];
    }

    useSession().establish(account);
    await settle();
};

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-11-17T12:00:00.000Z')), seed: 5 });
    server.reset();
    useAdminSystem().reset();
});

afterEach(() =>
{
    useAdminSystem().reset();
    useSession().reset();
});

describe('the seating form, as the owner types it', () =>
{
    it('reads the saved settings back as they were', () =>
    {
        const read = readSettings(typedSettings({ wait: 20, skill: 'intermediate', most: 40 }));

        expect(read).toEqual({ settings: { wait: 20, skill: 'intermediate', most: 40 }, bad: [] });
    });

    it('names each field outside its range and sends nothing', () =>
    {
        expect(readSettings({ wait: '4', skill: 'advanced', most: '201' })).toEqual({ settings: null, bad: ['wait', 'most'] });
        expect(readSettings({ wait: '121', skill: 'grandmaster', most: '0' }).bad).toEqual(['wait', 'skill', 'most']);
        expect(readSettings({ wait: '7.5', skill: 'casual', most: '' }).bad).toEqual(['wait', 'most']);
    });

    it('reads Persian and Arabic digits at the ends of the ranges', () =>
    {
        expect(readSettings({ wait: '۵', skill: 'semi-pro', most: '٢٠٠' }).settings).toEqual({ wait: 5, skill: 'semi-pro', most: 200 });
        expect(readSettings({ wait: '۱۲۰', skill: 'casual', most: '1' }).settings).toEqual({ wait: 120, skill: 'casual', most: 1 });
    });

    it('knows a set that changes nothing', () =>
    {
        expect(sameSettings({ wait: 20, skill: 'casual', most: 40 }, { wait: 20, skill: 'casual', most: 40 })).toBe(true);
        expect(sameSettings({ wait: 20, skill: 'casual', most: 40 }, { wait: 20, skill: 'advanced', most: 40 })).toBe(false);
    });
});

describe('the figures of the system players page', () =>
{
    it('adds every game up and puts the newest error first', () =>
    {
        expect(totalsOf(server.systemAdmin.view.games)).toEqual({ seated: 1, playing: 5, live: 2, today: 6 });
        expect(newestFirst([{ at: '2026-11-17T10:00:00.000Z' }, { at: '2026-11-17T11:00:00.000Z' }]).map((one) => one.at)).toEqual(['2026-11-17T11:00:00.000Z', '2026-11-17T10:00:00.000Z']);
    });

    it('is a section for an admin and above, never for a moderator', () =>
    {
        expect(sectionsFor('admin')).toContain('system');
        expect(sectionsFor('owner')).toContain('system');
        expect(sectionsFor('moderator')).not.toContain('system');
    });
});

describe('the system players page, as the staff hold it', () =>
{
    it('reads nothing the page has not asked for', async () =>
    {
        await signIn('alex', 'owner');

        expect(server.calls.filter((one) => one.startsWith('admin.system'))).toEqual([]);

        useAdminSystem().want('system');
        await settle();

        expect(server.calls.filter((one) => one.startsWith('admin.system'))).toEqual(['admin.system']);
        expect(useAdminSystem().system()?.games.map((one) => [one.game, one.strategy?.version])).toEqual([['chess', 2], ['hokm', 1]]);
    });

    it('switches system players on for the owner, logged with what it was', async () =>
    {
        await signIn('alex', 'owner');
        useAdminSystem().want('system');
        await settle();

        await useAdminSystem().switchTo(true, 'evenings are quiet');
        await settle();

        expect(useAdminSystem().system()?.on).toBe(true);
        expect(server.staff.log[0]).toMatchObject({ kind: 'system-players', reason: 'evenings are quiet', details: { part: 'switch', from: 'off', to: 'on' } });
    });

    it('switches one game off and leaves the other as it was', async () =>
    {
        await signIn('alex', 'owner');
        useAdminSystem().want('system');
        await settle();

        await useAdminSystem().setGame('hokm', false, 'agent too weak');
        await settle();

        expect(server.calls).toContain('admin.setSystemGames hokm=false');
        expect(useAdminSystem().system()?.games.map((one) => [one.game, one.on])).toEqual([['chess', true], ['hokm', false]]);
    });

    it('answers a game the site does not have with its refusal, in words', async () =>
    {
        await signIn('alex', 'owner');

        const refused = await useAdminSystem().setGame('go', false, 'typo').catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(ApiError);
        expect(whyStaffRefused(refused)).toBe('admin.refused.staff-system-game');
        expect(useLocale().t(whyStaffRefused(refused))).toBe('There is no such game.');
    });

    it('saves the settings, and refuses a pool past its cap in words', async () =>
    {
        await signIn('alex', 'owner');
        useAdminSystem().want('system');
        await settle();

        await useAdminSystem().setSettings({ wait: 30, skill: 'advanced', most: 80 }, 'more tables');
        await settle();

        expect(useAdminSystem().system()).toMatchObject({ wait: 30, skill: 'advanced', most: 80 });
        expect(server.staff.log[0].details).toEqual({ part: 'settings', from: 'wait 20s, skill intermediate, most 40', to: 'wait 30s, skill advanced, most 80' });

        const refused = await useAdminSystem().setSettings({ wait: 30, skill: 'advanced', most: 500 }, 'too many').catch((error: unknown) => error);

        expect(whyStaffRefused(refused)).toBe('admin.refused.staff-system-settings');
    });

    it('lets an admin read the page but answers every change to the setting as a missing thing', async () =>
    {
        await signIn('sam', 'admin');
        useAdminSystem().want('system');
        await settle();

        expect(useAdminSystem().system()).not.toBeNull();
        await expect(useAdminSystem().switchTo(true, 'not mine')).rejects.toBeInstanceOf(ApiError);
        await expect(useAdminSystem().setGame('chess', false, 'not mine')).rejects.toBeInstanceOf(ApiError);
        await expect(useAdminSystem().setSettings({ wait: 30, skill: 'casual', most: 10 }, 'not mine')).rejects.toBeInstanceOf(ApiError);
        expect(server.systemAdmin.view.on).toBe(false);
    });

    it('shows a moderator nothing, the page failing to load', async () =>
    {
        await signIn('mo', 'moderator');
        useAdminSystem().want('system');
        await settle();

        expect(useAdminSystem().system()).toBeNull();
        expect(useAdminSystem().systemFailed()).toBe(true);
    });

    it('reads the pool a page at a time', async () =>
    {
        server.systemAdmin.players = [
            systemPlayer('sara.m', { table: 'k7qx', game: 'chess', playing: true }),
            systemPlayer('amir_h7'),
            systemPlayer('neda.r', { table: 'p2ab', game: 'hokm', playing: false })
        ];
        await signIn('sam', 'admin');
        useAdminSystem().want('players');
        await settle();

        expect(useAdminSystem().players.rows().map((one) => one.handle)).toEqual(['sara.m', 'amir_h7']);
        expect(useAdminSystem().players.more()).toBe(true);

        await useAdminSystem().players.older();

        expect(server.calls).toContain('admin.systemPlayers amir_h7');
        expect(useAdminSystem().players.rows().map((one) => one.handle)).toEqual(['sara.m', 'amir_h7', 'neda.r']);
        expect(useAdminSystem().players.more()).toBe(false);
    });

    it('retires one for an admin, keeps the page it was on, and the pool counts follow', async () =>
    {
        server.systemAdmin.players = ['sara.m', 'amir_h7', 'neda.r'].map((handle) => systemPlayer(handle));
        server.systemAdmin.view.pool = { size: 3, retired: 0 };
        await signIn('sam', 'admin');
        useAdminSystem().want('system');
        useAdminSystem().want('players');
        await settle();
        await useAdminSystem().players.older();

        await useAdminSystem().retire('neda.r', 'plays too oddly');
        await settle();

        expect(useAdminSystem().players.rows().map((one) => [one.handle, one.retired])).toEqual([['sara.m', false], ['amir_h7', false], ['neda.r', true]]);
        expect(useAdminSystem().system()?.pool).toEqual({ size: 2, retired: 1 });
        expect(server.staff.log[0]).toMatchObject({ kind: 'system-players', person: 'neda.r', reason: 'plays too oddly', details: { part: 'retire' } });
    });

    it('asks again from the first page and forgets the tail when the pool is read again', async () =>
    {
        server.systemAdmin.players = ['sara.m', 'amir_h7', 'neda.r'].map((handle) => systemPlayer(handle));
        await signIn('sam', 'admin');
        useAdminSystem().want('players');
        await settle();
        await useAdminSystem().players.older();

        await useAdminSystem().refresh();
        await settle();

        expect(useAdminSystem().players.rows().map((one) => one.handle)).toEqual(['sara.m', 'amir_h7']);
    });
});

describe('the staff log’s words for system players', () =>
{
    const line = (row: Partial<LogRow>) => logParts({ id: 'log-1', at: '2026-11-17T10:00:00.000Z', staff: 'alex', kind: 'system-players', reason: 'why', details: {}, ...row } as LogRow, useLocale()).map((part) => part.text).join('');

    it('says the switch, the games and the settings from what the server records', () =>
    {
        expect(line({ details: { part: 'switch', from: 'off', to: 'on' } })).toBe('alex switched system players on.');
        expect(line({ details: { part: 'switch', from: 'on', to: 'off' } })).toBe('alex switched system players off.');
        expect(line({ details: { part: 'games', from: 'off: hokm', to: 'all on' } })).toBe('alex let system players into every game.');
        expect(line({ details: { part: 'games', from: 'all on', to: 'off: chess, hokm' } })).toBe('alex changed the games for system players: off in Chess and Hokm.');
        expect(line({ details: { part: 'settings', from: 'wait 20s, skill intermediate, most 40', to: 'wait 30s, skill semi-pro, most 120' } }))
            .toBe('alex set system players to wait 30 seconds, play at Semi-pro skill, and number at most 120.');
    });

    it('says a retirement of the system player it names, and a record it cannot read plainly', () =>
    {
        expect(line({ person: 'sara.m', details: { part: 'retire' } })).toBe('alex retired the system player sara.m.');
        expect(line({ details: { part: 'settings', to: 'something else' } })).toBe('alex changed the system player settings.');
        expect(systemSettingsIn('wait 5s, skill casual, most 1')).toEqual({ wait: 5, skill: 'casual', most: 1 });
        expect(systemSettingsIn('wait 5s, skill heroic, most 1')).toBeNull();
    });
});

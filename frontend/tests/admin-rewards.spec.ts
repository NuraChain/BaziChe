import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REWARD_AMOUNTS, REWARD_CAP } from '../../backend/src/domains/reward/rules.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { manualClock } from '../src/lib/clock.ts';
import { wholeNuraOf } from '../src/lib/nura.ts';
import { poolWith, poolWithout, readAmounts, shareOf, typedAmounts } from '../src/lib/reward-admin.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { logParts, type LogRow } from '../src/lib/staff-words.ts';
import '../src/locales/admin-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useAdminRewards } from '../src/stores/admin-rewards.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { ApiError, server } from './fake-api.ts';

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

const grant = (index: number) => ({
    kind: 'grant' as const,
    id: `grant-${ index }`,
    person: { handle: 'dana', displayName: 'Dana', hue: 10 },
    source: 'checkin' as const,
    amount: 1000,
    wanted: 1000,
    at: '2026-10-27T10:00:00.000Z'
});

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-10-27T12:00:00.000Z')), seed: 5 });
    server.reset();
    useAdminRewards().reset();
});

afterEach(() =>
{
    useAdminRewards().reset();
    useSession().reset();
});

describe('the amounts form, as the owner types it', () =>
{
    it('reads the default set as the whole cap, split by source', () =>
    {
        const read = readAmounts(typedAmounts(REWARD_AMOUNTS));

        expect(read.most).toBe(REWARD_CAP);
        expect(read.over).toBe(false);
        expect(read.amounts?.ladder).toEqual([...REWARD_AMOUNTS.ladder]);
        expect(read.bySource).toEqual({ checkin: 50_000, bonus: 20_000, daily: 90_000, weekly: 40_000 });
    });

    it('refuses a set whose most per cycle passes the cap, and says by how much as it is typed', () =>
    {
        const read = readAmounts({ ...typedAmounts(REWARD_AMOUNTS), daily: '1001' });

        expect(read.most).toBe(REWARD_CAP + 90);
        expect(read.over).toBe(true);
        expect(read.amounts, 'a set past the cap is never sent').toBeNull();
    });

    it('names the fields that are not whole NURA and sums nothing until they are', () =>
    {
        const typed = typedAmounts(REWARD_AMOUNTS);
        const read = readAmounts({ ...typed, ladder: typed.ladder.map((one, at) => (at === 2 ? '1.5' : one)), chest: '' });

        expect(read.bad).toEqual(['ladder.3', 'chest']);
        expect(read.most).toBeNull();
        expect(read.amounts).toBeNull();
    });

    it('reads Persian and Arabic digits and thousands separators', () =>
    {
        expect(wholeNuraOf('۱٬۰۰۰', REWARD_CAP)).toBe(1000);
        expect(wholeNuraOf('٢٠٠', REWARD_CAP)).toBe(200);
        expect(wholeNuraOf('20,000', REWARD_CAP)).toBe(20_000);
        expect(wholeNuraOf('-5', REWARD_CAP)).toBeNull();
        expect(wholeNuraOf('200001', REWARD_CAP)).toBeNull();
    });
});

describe('the small sums of the rewards page', () =>
{
    it('says how much of a budget is used, nothing of nothing being none', () =>
    {
        expect(shareOf(250, 1000)).toBe(25);
        expect(shareOf(2000, 1000)).toBe(100);
        expect(shareOf(0, 0)).toBe(0);
        expect(shareOf(5, 0)).toBe(100);
    });

    it('adds a look to the pool once and takes it out wherever it is', () =>
    {
        expect(poolWith(['a', 'b'], 'b')).toEqual(['a', 'b']);
        expect(poolWith(['a'], 'b')).toEqual(['a', 'b']);
        expect(poolWithout(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    });
});

describe('the rewards page, as the staff hold it', () =>
{
    it('reads nothing the page has not asked for', async () =>
    {
        await signIn('alex', 'owner');

        expect(server.calls.filter((one) => one.startsWith('admin.reward'))).toEqual([]);

        useAdminRewards().want('config');
        await settle();

        expect(server.calls.filter((one) => one.startsWith('admin.reward'))).toEqual(['admin.rewardConfig']);
        expect(useAdminRewards().config()?.on).toBe(false);
    });

    it('switches rewards on for the owner and reads the config again', async () =>
    {
        await signIn('alex', 'owner');
        useAdminRewards().want('config');
        await settle();

        await useAdminRewards().switchTo(true, 'launch day');
        await settle();

        expect(useAdminRewards().config()?.on).toBe(true);
        expect(server.staff.log[0]).toMatchObject({ kind: 'reward-config', reason: 'launch day', details: { part: 'switch' } });
    });

    it('lets an admin read the config but answers the switch as a missing thing', async () =>
    {
        await signIn('sam', 'admin');
        useAdminRewards().want('config');
        await settle();

        expect(useAdminRewards().config()).not.toBeNull();
        await expect(useAdminRewards().switchTo(true, 'not mine')).rejects.toBeInstanceOf(ApiError);
        expect(server.rewardsAdmin.config.on).toBe(false);
    });

    it('opens a day and reads its lines a page at a time', async () =>
    {
        server.rewardsAdmin.entries[1023] = [0, 1, 2].map(grant);
        await signIn('alex', 'owner');
        useAdminRewards().open(1023);
        await settle();

        expect(useAdminRewards().entries.rows().map((one) => one.id)).toEqual(['grant-0', 'grant-1']);
        expect(useAdminRewards().entries.more()).toBe(true);

        await useAdminRewards().entries.older();

        expect(server.calls).toContain('admin.rewardDay 1023 grant-1');
        expect(useAdminRewards().entries.rows().map((one) => one.id)).toEqual(['grant-0', 'grant-1', 'grant-2']);
        expect(useAdminRewards().entries.more()).toBe(false);

        useAdminRewards().open(1023);
        await settle();

        expect(useAdminRewards().opened(), 'opening the open day closes it').toBeNull();
        expect(useAdminRewards().entries.rows()).toEqual([]);
    });

    it('freezes a player, and the frozen list and the top earners follow', async () =>
    {
        await signIn('sam', 'admin');
        useAdminRewards().want('frozen');
        useAdminRewards().want('overview');
        await settle();

        expect(useAdminRewards().frozen.rows()).toEqual([]);

        await useAdminRewards().freeze('dana', true, 'farm accounts');
        await settle();

        expect(useAdminRewards().frozen.rows().map((one) => [one.person.handle, one.reason])).toEqual([['dana', 'farm accounts']]);
        expect(useAdminRewards().overview()?.top[0].frozen).toBe(true);
    });

    it('asks for another cycle’s log and closes the day that was open', async () =>
    {
        await signIn('alex', 'owner');
        useAdminRewards().want('days');
        useAdminRewards().open(1023);
        await settle();

        useAdminRewards().showCycle(33);
        await settle();

        expect(server.calls).toContain('admin.rewardDays 33');
        expect(useAdminRewards().days()?.cycle).toBe(33);
        expect(useAdminRewards().opened()).toBeNull();
    });
});

describe('the staff log’s words for rewards', () =>
{
    const line = (row: Partial<LogRow>) => logParts({ id: 'log-1', at: '2026-10-27T10:00:00.000Z', staff: 'alex', kind: 'reward-config', reason: 'why', details: {}, ...row } as LogRow, useLocale()).map((part) => part.text).join('');

    it('says what part of the config changed', () =>
    {
        expect(line({ details: { part: 'switch', from: 'off', to: 'on' } })).toBe('alex switched rewards on.');
        expect(line({ details: { part: 'budget', from: '25000000', to: '1000' } })).toBe('alex changed the cycle budget from 25,000,000 to 1,000 NURA.');
        expect(line({ details: { part: 'amounts', from: '{}', to: JSON.stringify(REWARD_AMOUNTS) } })).toBe('alex changed what rewards pay: at most 200,000 NURA a player a cycle.');
        expect(line({ details: { part: 'looks' } })).toBe('alex changed the reward looks.');
    });

    it('says a freeze and a thaw of the person it names', () =>
    {
        expect(line({ kind: 'reward-freeze', person: 'dana', details: { to: 'frozen' } })).toBe('alex froze dana’s rewards.');
        expect(line({ kind: 'reward-freeze', person: 'dana', details: { to: 'thawed' } })).toBe('alex unfroze dana’s rewards.');
    });
});

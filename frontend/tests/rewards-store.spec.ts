import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { claimableCount, useRewards, withdrawSaid } from '../src/stores/rewards.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

let clock: ReturnType<typeof manualClock>;
let seq = 0;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const signIn = async (rewards = true) =>
{
    seq += 1;
    const account: Account = { id: `u-rewards-${ seq }`, handle: `rewards${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, ...(rewards ? { rewards: true as const } : {}) };
    server.account = account;
    useSession().establish(account);
    await settle();
};

const historyRow = (index: number) => ({ id: `grant-${ index }`, kind: 'check-in' as const, at: `2026-10-${ String(27 - index).padStart(2, '0') }T20:30:00.000Z`, amount: 500 });

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-27T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useRewards().reset();
});

afterEach(() =>
{
    useRewards().reset();
    useSession().reset();
});

describe('the rewards, as the browser holds them', () =>
{
    it('is loading until the state is answered, and reads nothing the page has not asked for', async () =>
    {
        let answer: () => void = () => undefined;
        server.rewards.stateHolds = [new Promise<void>((resolve) =>
        {
            answer = resolve;
        })];
        await signIn();

        expect(server.calls.filter((one) => one.startsWith('rewards.')), 'nothing before the page wants it').toEqual([]);

        useRewards().want('state');
        await settle();

        expect(useRewards().loading()).toBe(true);
        expect(useRewards().state()).toBeNull();

        answer();
        await settle();

        expect(useRewards().loading()).toBe(false);
        expect(useRewards().failed()).toBe(false);
        expect(useRewards().state()?.position).toBe(1);
        expect(useRewards().claimable()).toBe(true);
        expect(useRewards().dailyQuests().map((one) => one.metric)).toEqual(['played', 'tally:kots']);
    });

    it('checks in, reads the state again, and says nothing when the day paid in full', async () =>
    {
        await signIn();
        useRewards().want('state');
        await settle();

        const checking = useRewards().checkIn();

        expect(useRewards().busy()).toBe('check-in');

        await checking;

        expect(server.calls.filter((one) => one.startsWith('rewards.'))).toEqual(['rewards.state', 'rewards.checkIn', 'rewards.state']);
        expect(useRewards().busy()).toBeNull();
        expect(useRewards().claimable()).toBe(false);
        expect(useRewards().state()?.ladder[0].claimed).toBe(true);
        expect(useRewards().said()).toBeNull();
    });

    it('says why a check-in paid less when the day’s budget ran out', async () =>
    {
        server.rewards.reason = 'reward-budget';
        await signIn();
        useRewards().want('state');
        await settle();

        await useRewards().checkIn();

        expect(useRewards().said()).toEqual({ on: 'check-in', reason: 'reward-budget' });
    });

    it('says the reason a claim comes back with, and reads the quest as claimed', async () =>
    {
        server.rewards.reason = 'reward-cap';
        await signIn();
        useRewards().want('state');
        await settle();

        await useRewards().claimQuest('daily', 'any-played-daily');

        expect(server.calls).toContain('rewards.claimQuest daily any-played-daily');
        expect(useRewards().said()).toEqual({ on: 'quests', reason: 'reward-cap' });
        expect(useRewards().dailyQuests().find((one) => one.id === 'any-played-daily')?.claimed).toBe(true);
        expect(useRewards().dailyQuests().find((one) => one.id === 'hokm-tally:kots-daily')?.claimed, 'a quest with no progress is not claimed').toBe(false);
    });

    it('takes a claim the page was behind on as only a reason to read again', async () =>
    {
        await signIn();
        useRewards().want('state');
        await settle();

        await useRewards().claimQuest('daily', 'hokm-tally:kots-daily');

        expect(useRewards().said()).toBeNull();
    });

    it('reads the history a page at a time until there is no more', async () =>
    {
        server.rewards.history = [0, 1, 2].map(historyRow);
        await signIn();
        useRewards().want('history');
        await settle();

        expect(useRewards().history().map((one) => one.id)).toEqual(['grant-0', 'grant-1']);
        expect(useRewards().hasOlder()).toBe(true);

        await useRewards().older();

        expect(server.calls).toContain('rewards.history grant-1');
        expect(useRewards().history().map((one) => one.id)).toEqual(['grant-0', 'grant-1', 'grant-2']);
        expect(useRewards().hasOlder()).toBe(false);
    });

    it('reads the state again when the server rings about rewards', async () =>
    {
        await signIn();
        useRewards().want('state');
        await settle();

        const unlisten = useRewards().listen();
        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        server.rewards.state = { ...server.rewards.state, streak: 4, position: 5 };
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope: 'me', id: 'rewards' });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(useRewards().state()?.position).toBe(5);

        unlisten();
    });
});

describe('rewards switched off, and the navigation’s dot', () =>
{
    it('reads only the balance, and has no door with nothing to withdraw, while the session says rewards are off', async () =>
    {
        await signIn(false);
        const stop = useRewards().start();
        useRewards().want('state');
        await settle();

        expect(new Set(server.calls.filter((one) => one.startsWith('rewards.')))).toEqual(new Set(['rewards.balance']));
        expect(useRewards().open()).toBe(false);
        expect(useRewards().door()).toBe(false);
        expect(useRewards().ready()).toBe(0);

        stop();
    });

    it('keeps the door, and what is left to withdraw, while rewards are off and NURA earned is left', async () =>
    {
        server.rewards.balance = 5_000;
        server.rewards.refuse = { status: 404, code: 'reward-off' };
        await signIn();
        useRewards().want('state');
        await settle();

        expect(useRewards().open()).toBe(false);
        expect(useRewards().door()).toBe(true);
        expect(useRewards().withdrawable()).toBe(5_000);
        expect(useRewards().ready()).toBe(0);
    });

    it('reads the state again on the server’s ring from app start, before the page is opened', async () =>
    {
        await signIn();
        const stop = useRewards().start();
        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(useRewards().ready()).toBe(2);

        server.rewards.state = { ...server.rewards.state, weekly: [{ id: 'any-won-weekly', game: 'any', metric: 'won', target: 3, reward: 3000, progress: 3, done: true, claimed: false }] };
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope: 'me', id: 'rewards' });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(useRewards().ready()).toBe(3);

        stop();
    });

    it('reads the state once at app start, so the dot counts the check-in and every finished quest before the page is opened', async () =>
    {
        server.rewards.state = {
            ...server.rewards.state,
            weekly: [{ id: 'any-won-weekly', game: 'any', metric: 'won', target: 3, reward: 3000, progress: 3, done: true, claimed: false }]
        };
        await signIn();
        const stop = useRewards().start();
        await settle();

        expect(server.calls.filter((one) => one.startsWith('rewards.'))).toEqual(['rewards.state']);
        expect(useRewards().open()).toBe(true);
        expect(useRewards().ready(), 'the check-in, a daily and a weekly quest').toBe(3);

        stop();
    });

    it('closes the door once a read is told rewards were switched off since the session was read', async () =>
    {
        server.rewards.refuse = { status: 404, code: 'reward-off' };
        await signIn();
        useRewards().want('state');
        await settle();

        expect(useRewards().open()).toBe(false);
        expect(useRewards().ready()).toBe(0);
    });

    it('counts nothing claimable once everything is claimed', () =>
    {
        const state = { ...server.rewards.state, claimable: false, daily: server.rewards.state.daily.map((one) => ({ ...one, claimed: true })) };

        expect(claimableCount(state)).toBe(0);
        expect(claimableCount(null)).toBe(0);
    });
});

describe('what a withdrawal says', () =>
{
    it('reads too little to withdraw and a payout on its way off the answer', () =>
    {
        expect(withdrawSaid({ status: 'none', amount: 0, queued: 0 })).toEqual({ reason: 'withdraw-least' });
        expect(withdrawSaid({ status: 'queued', amount: 4200, queued: 4200 })).toEqual({ reason: 'withdraw-queued', amount: 4200 });
        expect(withdrawSaid({ status: 'ready', amount: 0, queued: 0 })).toBeNull();
    });

    it('says the payout under way after the press', async () =>
    {
        server.rewards.withdraw = { status: 'queued', amount: 1500, queued: 1500 };
        await signIn();
        useRewards().want('state');
        await settle();

        await useRewards().withdraw();

        expect(useRewards().said()).toEqual({ on: 'withdraw', reason: 'withdraw-queued', amount: 1500 });
    });

    it('says the server’s refusal of a withdrawal by its code', async () =>
    {
        await signIn();
        useRewards().want('state');
        await settle();
        server.rewards.refuse = { status: 409, code: 'reward-frozen' };

        await useRewards().withdraw();

        expect(useRewards().said()).toEqual({ on: 'withdraw', reason: 'reward-frozen' });
    });
});

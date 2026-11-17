import { describe, expect, it } from 'vitest';

import { rewardSeries, type RewardsSampled } from '../src/ops/monitor.ts';
import { rendered } from '../src/ops/prometheus.ts';

const NURA = 10n ** 18n;

const sampled = (patch: Partial<RewardsSampled> = {}): RewardsSampled => ({
    on: true,
    grantedToday: (12_500n * NURA + NURA / 2n).toString(),
    waiting: 3,
    oldest: 90,
    failed: 1,
    balance: (25_001_000n * NURA).toString(),
    ...patch
});

describe('the rewards figures the monitor exports', () =>
{
    it('says the switch, today\'s grants and the wallet in whole NURA, and the payout queue', () =>
    {
        const text = rendered(rewardSeries(sampled()));

        expect(text).toContain('baziche_rewards_on 1\n');
        expect(text).toContain('baziche_rewards_granted_today_nura 12500\n');
        expect(text).toContain('baziche_reward_payouts{state="waiting"} 3\n');
        expect(text).toContain('baziche_reward_payouts{state="failed"} 1\n');
        expect(text).toContain('baziche_reward_payouts_oldest_seconds 90\n');
        expect(text).toContain('baziche_rewards_wallet_nura 25001000\n');
    });

    it('leaves the balance out when there is no wallet or the chain did not answer, rather than saying 0', () =>
    {
        const text = rendered(rewardSeries(sampled({ balance: null, on: false })));

        expect(text).toContain('baziche_rewards_on 0\n');
        expect(text).not.toMatch(/^baziche_rewards_wallet_nura /m);
    });

    it('says nothing before the first sample', () =>
    {
        expect(rewardSeries(undefined)).toEqual([]);
    });
});

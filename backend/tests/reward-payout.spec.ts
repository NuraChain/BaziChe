import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';

import { closeChains, fakeRewardChain } from './fake-chain.ts';
import { createRewardWallet, type RewardWallet } from '../src/chain/rewards.ts';
import {
    affordable,
    createRewardPayoutService,
    nextNonce,
    payoutHold,
    payoutStep,
    queueNeeds,
    REWARD_GAS_RESERVE,
    REWARD_PAYOUT_ATTEMPTS,
    REWARD_REPLACED_AFTER_MS,
    transferFee,
    worthCounting,
    type SentSeen
} from '../src/domains/reward/payout.ts';

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PLAYER = '0x2222222222222222222222222222222222222222';
const NURA = 10n ** 18n;
const NOW = Date.UTC(2026, 10, 16, 12);

const walletOn = (url: string) => createRewardWallet({ rpcUrl: url, chainId: '1020', rewardsKey: KEY });

const seen = (over: Partial<SentSeen>): SentSeen => ({
    receipt: 'pending',
    attempts: 1,
    nonce: 4,
    used: null,
    usedSince: null,
    ...over
});

afterEach(closeChains);

describe('reward payout on the chain', () =>
{
    it('sends the signed bytes and marks the payout mined once its receipt says so', async () =>
    {
        const { url, chain } = await fakeRewardChain({ balance: 5_000n * NURA, pending: 7, latest: 7 });
        const wallet = walletOn(url);
        const amount = 1_000n * NURA;
        const gasPrice = await wallet.gasPrice();
        const fee = transferFee(gasPrice);

        expect(affordable(await wallet.balanceOf(wallet.address!), 0n, amount, fee)).toBe(true);

        const nonce = nextNonce(await wallet.transactionCount(wallet.address!, 'pending'), null);
        const prepared = await wallet.prepareTransfer(PLAYER, amount, nonce, gasPrice);
        expect(nonce).toBe(7);
        expect(await wallet.broadcast(prepared.raw)).toBe(prepared.hash);
        expect(chain.sent).toEqual([prepared.raw]);

        expect(await wallet.mined(prepared.hash)).toBe('pending');
        chain.receipts.set(prepared.hash.toLowerCase(), 'success');
        const receipt = await wallet.mined(prepared.hash);

        expect(payoutStep(seen({ receipt, nonce }), NOW)).toBe('mine');
    });

    it('after a crash between saving the hash and the receipt, only sends the saved bytes again', async () =>
    {
        const { url, chain } = await fakeRewardChain({ balance: 5_000n * NURA, pending: 3, latest: 3 });
        const before = walletOn(url);
        const saved = await before.prepareTransfer(PLAYER, 1_000n * NURA, 3, await before.gasPrice());

        const after = walletOn(url);
        const receipt = await after.mined(saved.hash);
        const step = payoutStep(seen({ receipt, nonce: 3 }), NOW);

        expect(step).toBe('broadcast');
        expect(await after.broadcast(saved.raw)).toBe(saved.hash);
        chain.refuse = 'already known';
        expect(await after.broadcast(saved.raw)).toBe(saved.hash);
        expect(new Set(chain.sent)).toEqual(new Set([saved.raw]));
    });

    it('retries a reverted payout with a fresh nonce until the attempts run out', async () =>
    {
        const { url, chain } = await fakeRewardChain({ balance: 5_000n * NURA, pending: 4, latest: 4 });
        const wallet = walletOn(url);
        const first = await wallet.prepareTransfer(PLAYER, 1_000n * NURA, 4, await wallet.gasPrice());
        await wallet.broadcast(first.raw);
        chain.receipts.set(first.hash.toLowerCase(), 'reverted');
        chain.pending = 5;
        chain.latest = 5;

        const receipt = await wallet.mined(first.hash);
        expect(receipt).toBe('reverted');
        for (let attempts = 1; attempts < REWARD_PAYOUT_ATTEMPTS; attempts += 1)
        {
            expect(payoutStep(seen({ receipt, attempts }), NOW)).toBe('retry');
        }

        expect(nextNonce(await wallet.transactionCount(wallet.address!, 'pending'), null)).toBe(5);
    });

    it('fails a payout after its last attempt, whether it reverted or lost its nonce', () =>
    {
        const old = NOW - REWARD_REPLACED_AFTER_MS;

        expect(payoutStep(seen({ receipt: 'reverted', attempts: REWARD_PAYOUT_ATTEMPTS }), NOW)).toBe('fail');
        expect(payoutStep(seen({ nonce: 4, used: 6, usedSince: old, attempts: REWARD_PAYOUT_ATTEMPTS }), NOW)).toBe('fail');
        expect(payoutStep(seen({ receipt: 'success', attempts: REWARD_PAYOUT_ATTEMPTS }), NOW)).toBe('mine');
    });

    it('takes a payout as replaced only when its nonce has been seen used for long enough', () =>
    {
        const old = NOW - REWARD_REPLACED_AFTER_MS;
        const fresh = NOW - 1_000;

        expect(payoutStep(seen({ nonce: 4, used: 5, usedSince: old }), NOW)).toBe('retry');
        expect(payoutStep(seen({ nonce: 4, used: 5, usedSince: fresh }), NOW)).toBe('broadcast');
        expect(payoutStep(seen({ nonce: 4, used: 5, usedSince: null }), NOW)).toBe('broadcast');
        expect(payoutStep(seen({ nonce: 4, used: 4, usedSince: old }), NOW)).toBe('broadcast');
        expect(payoutStep(seen({ nonce: null, used: 9, usedSince: old }), NOW)).toBe('broadcast');
        expect(payoutStep(seen({ receipt: 'success', nonce: 4, used: 5, usedSince: old }), NOW)).toBe('mine');
        expect(worthCounting(new Date(fresh), NOW)).toBe(false);
        expect(worthCounting(new Date(old), NOW)).toBe(true);
    });

    it('counts the wait from the first sighting of the used nonce, not from signing, so a slow transfer is not paid twice', async () =>
    {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        try
        {
            let used = 5;
            const payout = { id: 'p1', userId: 'u1', state: 'sent', txHash: '0xabc', rawTransaction: '0xraw', txNonce: '4', attempts: 1, sentAt: new Date(NOW - 3 * REWARD_REPLACED_AFTER_MS) };
            const updates: unknown[] = [];
            const builder = { where: () => builder, orderBy: () => builder, limit: () => builder, getMany: async () => [payout] };
            const db = {
                getRepository: () => ({
                    createQueryBuilder: () => builder,
                    update: async (_where: unknown, set: unknown) =>
                    {
                        updates.push(set);
                        return { affected: 1 };
                    }
                })
            } as unknown as DataSource;
            const wallet = {
                configured: true,
                address: PLAYER,
                transactionCount: async () => used,
                mined: async () => 'pending',
                broadcast: async () => payout.txHash
            } as unknown as RewardWallet;
            const service = createRewardPayoutService(db, wallet);

            // Signed half an hour ago, but its nonce is only now seen used: it waits.
            expect(await service.sweep(1_000)).toMatchObject({ retried: 0 });
            vi.setSystemTime(NOW + REWARD_REPLACED_AFTER_MS - 1);
            expect(await service.sweep(1_000)).toMatchObject({ retried: 0 });

            // A read that no longer shows the nonce used starts the wait again.
            used = 4;
            expect(await service.sweep(1_000)).toMatchObject({ retried: 0 });
            used = 5;
            vi.setSystemTime(NOW + REWARD_REPLACED_AFTER_MS);
            expect(await service.sweep(1_000)).toMatchObject({ retried: 0 });
            expect(updates).toEqual([]);

            vi.setSystemTime(NOW + 2 * REWARD_REPLACED_AFTER_MS);
            expect(await service.sweep(1_000)).toMatchObject({ retried: 1 });
            expect(updates).toEqual([expect.objectContaining({ state: 'queued', txNonce: null })]);
        }
        finally
        {
            vi.useRealTimers();
        }
    });

    it('holds a payout of a frozen, suspended or minor player, at the queue and again at signing', () =>
    {
        const clear = { minor: false, suspended: false, frozen: false };

        expect(payoutHold(clear)).toBeUndefined();
        expect(payoutHold({ ...clear, frozen: true })).toBe('reward-frozen');
        expect(payoutHold({ ...clear, suspended: true })).toBe('reward-suspended');
        expect(payoutHold({ ...clear, minor: true })).toBe('reward-minor');
        expect(payoutHold({ minor: true, suspended: true, frozen: true })).toBe('reward-minor');
    });

    it('never signs with a nonce the chain or an earlier payout has used', () =>
    {
        expect(nextNonce(7, null)).toBe(7);
        expect(nextNonce(3, 9)).toBe(10);
        expect(nextNonce(12, 9)).toBe(12);
    });

    it('keeps an unaffordable payout waiting, and flags the wallet exactly when the queue cannot be paid', async () =>
    {
        const amount = 1_000n * NURA;
        const { url, chain } = await fakeRewardChain();
        const wallet = walletOn(url);
        const fee = transferFee(await wallet.gasPrice());
        const enough = amount + fee + REWARD_GAS_RESERVE;

        chain.balance = enough;
        expect(affordable(await wallet.balanceOf(wallet.address!), 0n, amount, fee)).toBe(true);
        chain.balance = enough - 1n;
        expect(affordable(await wallet.balanceOf(wallet.address!), 0n, amount, fee)).toBe(false);
        expect(affordable(enough, 1n, amount, fee)).toBe(false);

        const queue = [amount, 2_500n * NURA, 4_000n * NURA];
        const needed = queueNeeds(queue.reduce((sum, one) => sum + one, 0n), queue.length, fee);
        const paysAll = (held: bigint) =>
        {
            let inFlight = 0n;
            for (const one of queue)
            {
                if (!affordable(held, inFlight, one, fee))
                {
                    return false;
                }
                inFlight += one + fee;
            }
            return true;
        };

        expect(paysAll(needed)).toBe(true);
        expect(paysAll(needed - 1n)).toBe(false);
    });

    it('says the network is unreachable instead of guessing when the node is down', async () =>
    {
        const { url, chain } = await fakeRewardChain({ balance: 5_000n * NURA });
        const wallet = walletOn(url);
        const prepared = await wallet.prepareTransfer(PLAYER, 1_000n * NURA, 0, await wallet.gasPrice());
        chain.down = true;

        await expect(wallet.broadcast(prepared.raw)).rejects.toMatchObject({ status: 503, code: 'chain-unreachable' });
        await expect(wallet.mined(prepared.hash)).rejects.toMatchObject({ status: 503 });
        await expect(wallet.gasPrice()).rejects.toMatchObject({ status: 503 });
        expect(chain.sent).toEqual([]);
    });

    it('turns withdrawals off with a clear refusal, and nothing else, when the rewards wallet is unconfigured', async () =>
    {
        const wallet = createRewardWallet({ rpcUrl: '', chainId: '1020', rewardsKey: '' });
        const service = createRewardPayoutService({} as DataSource, wallet);

        expect(wallet.configured).toBe(false);
        expect(createRewardWallet({ rpcUrl: 'https://example.com', chainId: '1020', rewardsKey: '' }).configured).toBe(false);
        await expect(service.withdraw('00000000-0000-0000-0000-000000000001'))
            .rejects.toMatchObject({ status: 409, code: 'reward-wallet' });
        expect(await service.sweep(1_000)).toEqual({ mined: 0, retried: 0, failed: 0, faults: [] });
        expect((await service.audit({ ids: [], after: null, deadline: performance.now() + 1_000 })).found).toEqual([]);
    });
});

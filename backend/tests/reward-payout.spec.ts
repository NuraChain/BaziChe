import { describe, expect, it } from 'vitest';

import { fakeChain } from './fake-chain.ts';
import { createRewardWallet } from '../src/chain/rewards.ts';
import { createRewardPayoutService } from '../src/domains/reward/payout.ts';
import type { DataSource } from 'typeorm';

describe('reward payout wallet', () =>
{
    it('can persist a signed transaction before broadcasting those exact bytes', async () =>
    {
        let expected = '0x' as `0x${ string }`;
        const url = await fakeChain((rpc) =>
        {
            if (rpc.method === 'eth_chainId')
            {
                return { result: '0x3fc' };
            }

            if (rpc.method === 'eth_gasPrice')
            {
                return { result: '0x3b9aca00' };
            }

            if (rpc.method === 'eth_getTransactionCount')
            {
                return { result: '0x7' };
            }

            if (rpc.method === 'eth_sendRawTransaction')
            {
                return { result: expected };
            }

            return { result: '0x' };
        });

        const wallet = createRewardWallet({
            rpcUrl: url.url,
            chainId: '1020',
            rewardsKey: '0x1111111111111111111111111111111111111111111111111111111111111111'
        });

        expect(await wallet.transactionCount(wallet.address!)).toBe(7);
        const prepared = await wallet.prepareTransfer('0x2222222222222222222222222222222222222222', 1_000n, 7);
        expected = prepared.hash;

        expect(prepared.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(prepared.raw).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(await wallet.broadcast(prepared.raw)).toBe(prepared.hash);
        expect(await wallet.broadcast(prepared.raw)).toBe(prepared.hash);
    });

    it('reports a reverted receipt so the payout service can move to a bounded retry', async () =>
    {
        const url = await fakeChain((rpc) =>
        {
            if (rpc.method === 'eth_chainId')
            {
                return { result: '0x3fc' };
            }
            if (rpc.method === 'eth_getTransactionReceipt')
            {
                return { result: { status: '0x0', blockNumber: '0x2' } };
            }
            return { result: '0x' };
        });

        const wallet = createRewardWallet({
            rpcUrl: url.url,
            chainId: '1020',
            rewardsKey: '0x1111111111111111111111111111111111111111111111111111111111111111'
        });

        expect(await wallet.mined(`0x${ 'ab'.repeat(32) }`)).toBe('reverted');
    });

    it('refuses withdrawal before touching the database when the rewards wallet is unconfigured', async () =>
    {
        const wallet = createRewardWallet({ rpcUrl: '', chainId: '1020', rewardsKey: '' });
        const service = createRewardPayoutService({} as DataSource, wallet);

        await expect(service.withdraw('00000000-0000-0000-0000-000000000001'))
            .rejects.toMatchObject({ status: 409, code: 'reward-wallet' });
    });

    it('sends a native transfer from the rewards wallet and reports mined receipts', async () =>
    {
        const url = await fakeChain((rpc) =>
        {
            if (rpc.method === 'eth_chainId')
            {
                return { result: '0x3fc' };
            }

            if (rpc.method === 'eth_gasPrice')
            {
                return { result: '0x3b9aca00' };
            }

            if (rpc.method === 'eth_getTransactionCount')
            {
                return { result: '0x0' };
            }

            if (rpc.method === 'eth_estimateGas')
            {
                return { result: '0x5208' };
            }

            if (rpc.method === 'eth_sendTransaction' || rpc.method === 'eth_sendRawTransaction')
            {
                return { result: '0xabc123' };
            }

            if (rpc.method === 'eth_getTransactionReceipt')
            {
                return {
                    result: {
                        status: '0x1',
                        blockNumber: '0x2'
                    }
                };
            }

            return { result: '0x' };
        });

        const wallet = createRewardWallet({
            rpcUrl: url.url,
            chainId: '1020',
            rewardsKey: '0x1111111111111111111111111111111111111111111111111111111111111111'
        });

        const sent = await wallet.transfer('0x2222222222222222222222222222222222222222', 1_000n);

        expect(sent.ok).toBe(true);
        if (sent.ok)
        {
            expect(sent.hash).toMatch(/^0x[a-fA-F0-9]+$/);
            expect(await wallet.mined(sent.hash)).toBe('success');
        }
    });

    it('refuses to configure without the wallet key or RPC', () =>
    {
        expect(createRewardWallet({ rpcUrl: '', chainId: '1020', rewardsKey: '' }).configured).toBe(false);
        expect(createRewardWallet({ rpcUrl: 'https://example.com', chainId: '1020', rewardsKey: '' }).configured).toBe(false);
    });
});

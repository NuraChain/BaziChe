import {
    TransactionReceiptNotFoundError,
    createWalletClient,
    defineChain,
    getAddress,
    isAddress,
    keccak256,
    nonceManager,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { boundedClient, boundedTransport, reached } from './rpc.ts';
import { gasFloorOf, type Mined } from './vault.ts';

export interface RewardWalletSettings
{
    rpcUrl: string;
    chainId: string;
    rewardsKey: string;
}

export type RewardTransfer = { ok: true; hash: Hex } | { ok: false; refusal: 'wallet' | 'network' };

export interface RewardWallet
{
    readonly configured: boolean;
    readonly address: Address | null;
    readonly chainId: number;
    gasPrice(): Promise<bigint>;
    balanceOf(address: Address): Promise<bigint>;
    transactionCount(address: Address): Promise<number>;
    prepareTransfer(to: Address, amount: bigint, nonce: number): Promise<{ hash: Hex; raw: Hex }>;
    broadcast(raw: Hex): Promise<Hex>;
    transfer(to: Address, amount: bigint): Promise<RewardTransfer>;
    mined(hash: Hex): Promise<Mined>;
}

export function createRewardWallet(settings: RewardWalletSettings): RewardWallet
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== ''
        && Number.isSafeInteger(chainId)
        && chainId > 0
        && /^0x[0-9a-fA-F]{64}$/.test(settings.rewardsKey);
    const account = configured ? privateKeyToAccount(settings.rewardsKey as Hex, { nonceManager }) : null;
    const floor = gasFloorOf(chainId);
    const chain = defineChain({
        id: configured ? chainId : 1,
        name: 'NuraChain',
        nativeCurrency: { name: 'Nura', symbol: 'NURA', decimals: 18 },
        rpcUrls: { default: { http: [configured ? settings.rpcUrl : 'http://127.0.0.1'] } }
    });

    const reader = () => boundedClient(settings.rpcUrl);

    const ready = () =>
    {
        if (!configured || account === null)
        {
            throw new Error('The rewards wallet is not configured.');
        }

        return { account };
    };

    const gasPrice = async () =>
    {
        const current = await reached(reader().getGasPrice());
        return current > floor ? current : floor;
    };

    return {
        configured,
        address: account?.address ?? null,
        chainId,

        gasPrice,

        async balanceOf(address)
        {
            return await reached(reader().getBalance({ address }));
        },

        async transactionCount(address)
        {
            return await reached(reader().getTransactionCount({ address, blockTag: 'pending' }));
        },

        async prepareTransfer(to, amount, nonce)
        {
            if (!configured || account === null || !isAddress(to))
            {
                throw new Error('The rewards wallet is not configured for this transfer.');
            }

            const raw = await account.signTransaction({
                chainId,
                nonce,
                to: getAddress(to),
                value: amount,
                gas: 21_000n,
                gasPrice: await gasPrice(),
                type: 'legacy'
            });

            return { hash: keccak256(raw), raw };
        },

        async broadcast(raw)
        {
            if (!configured)
            {
                throw new Error('The rewards wallet is not configured.');
            }

            return await reached(reader().sendRawTransaction({ serializedTransaction: raw }));
        },

        async transfer(to, amount)
        {
            if (!configured || !isAddress(to))
            {
                return { ok: false, refusal: 'wallet' };
            }

            try
            {
                const wallet = createWalletClient({ account: ready().account, chain, transport: boundedTransport(settings.rpcUrl) });
                const hash = await wallet.sendTransaction({
                    account: ready().account,
                    to: getAddress(to),
                    value: amount,
                    gasPrice: await gasPrice(),
                    gas: 21_000n
                });

                return { ok: true, hash };
            }
            catch (error)
            {
                if (error instanceof Error && error.name === 'TransactionExecutionError')
                {
                    return { ok: false, refusal: 'network' };
                }

                return await reached(Promise.reject(error));
            }
        },

        async mined(hash)
        {
            try
            {
                const receipt = await reached(reader().getTransactionReceipt({ hash }));
                if (receipt.status === 'success')
                {
                    return 'success';
                }

                if (receipt.status === 'reverted')
                {
                    return 'reverted';
                }

                return 'pending';
            }
            catch (error)
            {
                if (error instanceof TransactionReceiptNotFoundError)
                {
                    return 'pending';
                }

                return await reached(Promise.reject(error));
            }
        }
    };
}

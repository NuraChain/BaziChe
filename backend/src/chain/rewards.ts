import {
    TransactionReceiptNotFoundError,
    getAddress,
    isAddress,
    keccak256,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { boundedClient, reached } from './rpc.ts';
import { gasFloorOf, type Mined } from './vault.ts';

export interface RewardWalletSettings
{
    rpcUrl: string;
    chainId: string;
    rewardsKey: string;
}

/** A plain native transfer always costs this much gas, so the price is the only thing to read. */
export const REWARD_TRANSFER_GAS = 21_000n;

export interface RewardWallet
{
    readonly configured: boolean;
    readonly address: Address | null;
    readonly chainId: number;
    gasPrice(): Promise<bigint>;
    balanceOf(address: Address): Promise<bigint>;
    /** 'pending' is the next nonce to sign with; 'latest' is how many nonces mined blocks have used. */
    transactionCount(address: Address, tag?: 'pending' | 'latest'): Promise<number>;
    prepareTransfer(to: Address, amount: bigint, nonce: number, gasPrice: bigint): Promise<{ hash: Hex; raw: Hex }>;
    broadcast(raw: Hex): Promise<Hex>;
    mined(hash: Hex): Promise<Mined>;
}

/**
 * A node that already holds these bytes, or has mined them, refuses them again. That is the outcome
 * a rebroadcast wanted, so it is not a fault; whether the transfer mined is read from its receipt.
 */
const ALREADY_SEEN = /already known|known transaction|already imported|nonce too low/i;

export function createRewardWallet(settings: RewardWalletSettings): RewardWallet
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== ''
        && Number.isSafeInteger(chainId)
        && chainId > 0
        && /^0x[0-9a-fA-F]{64}$/.test(settings.rewardsKey);
    const account = configured ? privateKeyToAccount(settings.rewardsKey as Hex) : null;
    const floor = gasFloorOf(chainId);

    const reader = () => boundedClient(settings.rpcUrl);

    return {
        configured,
        address: account?.address ?? null,
        chainId,

        async gasPrice()
        {
            const current = await reached(reader().getGasPrice());
            return current > floor ? current : floor;
        },

        async balanceOf(address)
        {
            return await reached(reader().getBalance({ address }));
        },

        async transactionCount(address, tag = 'pending')
        {
            return await reached(reader().getTransactionCount({ address, blockTag: tag }));
        },

        async prepareTransfer(to, amount, nonce, gasPrice)
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
                gas: REWARD_TRANSFER_GAS,
                gasPrice: gasPrice > floor ? gasPrice : floor,
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

            // Before `reached`, which takes any answer the node gives as an error for an unreachable network.
            const asked = reader().sendRawTransaction({ serializedTransaction: raw }).catch((error: unknown) =>
            {
                if (error instanceof Error && ALREADY_SEEN.test(error.message))
                {
                    return keccak256(raw);
                }

                throw error;
            });

            return await reached(asked);
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

                throw error;
            }
        }
    };
}

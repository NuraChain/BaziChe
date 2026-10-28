import {
    BaseError,
    TransactionReceiptNotFoundError,
    decodeErrorResult,
    encodeFunctionData,
    getAddress,
    isAddress,
    parseAbi,
    zeroAddress,
    type Address,
    type Hex
} from 'viem';

import { boundedClient, reached, refusedByContract, unreached } from './rpc.ts';
import { gasFloorOf, vaultIdOf, type Mined } from './vault.ts';

/** `ArcadeTips` (`contracts/baziche/ArcadeTips.sol` in the SmartContract project), by hand, as the shop's ABI is. */
export const TIPS_ABI = parseAbi([
    'function tip(bytes32 id, address to, uint64 deadline) payable',
    'function tipOf(address from, bytes32 id) view returns (address to, uint256 amount, uint64 givenAt)',
    'function paused() view returns (bool)',
    'error ZeroAddress()',
    'error ZeroAmount()',
    'error SelfTip()',
    'error TipUsed(address from, bytes32 id)',
    'error TipExpired(address from, bytes32 id, uint64 deadline)',
    'error EnforcedPause()',
    'error FailedCall()',
    'error InsufficientBalance(uint256 balance, uint256 needed)'
]);

/** One gift as the contract holds it under its giver and its id. `to` is null for an id that giver never used. */
export interface Tip
{
    to: Address | null;
    amount: bigint;
    givenAt: bigint;
}

export interface TipCall
{
    to: Address;
    data: Hex;
    value: bigint;
    chainId: number;
    gasPrice: bigint | null;
}

export type TipAsked = { ok: true; call: TipCall } | { ok: false; error: string };

export interface TipsSettings
{
    rpcUrl: string;
    chainId: string;
    tips: string;
}

export interface TipsChain
{
    readonly configured: boolean;
    readonly address: Address | null;
    readonly chainId: number;

    /** The giver's `tip`, asked of the contract from the giver's address first, so a gift it would refuse is said before a wallet is asked. */
    tipCall(from: Address, id: Hex, to: Address, amount: bigint, deadline: bigint): Promise<TipAsked>;
    tipOf(from: Address, id: Hex): Promise<Tip>;
    mined(hash: Hex): Promise<Mined>;

    /** The NURA a wallet holds, in wei. */
    balanceOf(address: Address): Promise<bigint>;
}

/** A donation's id on the chain: the donation's uuid as 32 bytes, as a paid game's and an order's are. */
export const tipIdOf = vaultIdOf;

/** The contract's word for refusing a call, by name, or null for something that was not a refusal. */
export function tipRefusalOf(error: unknown)
{
    if (!(error instanceof BaseError))
    {
        return null;
    }

    const raw = error.walk((cause) =>
    {
        const data = (cause as { data?: unknown }).data;
        return typeof data === 'string' && /^0x[0-9a-fA-F]{8}/.test(data);
    }) as { data: Hex } | null;

    if (raw !== null)
    {
        try
        {
            return decodeErrorResult({ abi: TIPS_ABI, data: raw.data }).errorName;
        }
        catch
        {
            return 'reverted';
        }
    }

    // A node asked to move more than the sender holds refuses before the contract is reached.
    if (/insufficient funds/i.test(error.message))
    {
        return 'InsufficientFunds';
    }

    return refusedByContract(error) ? 'reverted' : null;
}

export function createTipsChain(settings: TipsSettings): TipsChain
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== '' && isAddress(settings.tips) && Number.isSafeInteger(chainId) && chainId > 0;
    const tips = configured ? getAddress(settings.tips) : null;
    const floor = gasFloorOf(chainId);

    const reader = () => boundedClient(settings.rpcUrl);

    const ready = () =>
    {
        if (tips === null)
        {
            throw new Error('Donations are not configured.');
        }

        return tips;
    };

    const suggested = async () =>
    {
        try
        {
            return await reader().getGasPrice().then((live) => (live > floor ? live : floor));
        }
        catch (error)
        {
            if (unreached(error))
            {
                return floor;
            }

            throw error;
        }
    };

    return {
        configured,
        address: tips,
        chainId,

        async tipCall(from, id, to, amount, deadline)
        {
            const data = encodeFunctionData({ abi: TIPS_ABI, functionName: 'tip', args: [id, to, deadline] });

            try
            {
                await reader().call({ account: from, to: ready(), data, value: amount });
            }
            catch (error)
            {
                const refusal = tipRefusalOf(error);

                if (refusal !== null)
                {
                    return { ok: false, error: refusal };
                }

                return await reached(Promise.reject(error));
            }

            return { ok: true, call: { to: ready(), data, value: amount, chainId, gasPrice: floor > 0n ? await suggested() : null } };
        },

        async tipOf(from, id)
        {
            const [to, amount, givenAt] = await reached(reader().readContract({ address: ready(), abi: TIPS_ABI, functionName: 'tipOf', args: [from, id] }));

            return { to: to === zeroAddress ? null : getAddress(to), amount, givenAt };
        },

        async mined(hash)
        {
            try
            {
                const receipt = await reader().getTransactionReceipt({ hash });
                return receipt.status === 'success' ? 'success' : 'reverted';
            }
            catch (error)
            {
                if (error instanceof BaseError && error.walk((cause) => cause instanceof TransactionReceiptNotFoundError) !== null)
                {
                    return 'pending';
                }

                return await reached(Promise.reject(error));
            }
        },

        balanceOf: (address) => reached(reader().getBalance({ address }))
    };
}

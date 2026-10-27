import type { WalletApi } from '../stores/wallet.store.ts';
import type { WalletFailure } from './wallet.ts';

/** Why this browser's wallet cannot send a call the server composed for the account signed in. */
export type SendRefusal = 'rejected' | 'unavailable' | 'wrong-chain' | 'locked' | 'asking' | 'no-wallet' | 'wrong-account' | 'wallet-failed';

export const REFUSAL_OF: Record<WalletFailure, SendRefusal> = {
    'no-wallet': 'no-wallet',
    rejected: 'rejected',
    unauthorized: 'locked',
    pending: 'asking',
    chain: 'wrong-chain',
    unavailable: 'unavailable',
    busy: 'unavailable',
    suspended: 'unavailable',
    unknown: 'wallet-failed'
};

/**
 * Null when the wallet may send for `owner` on `chainId`. A locked wallet answers `eth_accounts` with
 * nothing, so the address is asked for before anything is concluded from it; and a call from another
 * account is refused here, because the chain would take it from anybody.
 */
export async function readyToSend(wallet: Pick<WalletApi, 'address' | 'reach' | 'failure' | 'toChain'>, owner: string | null, chainId: number): Promise<SendRefusal | null>
{
    const signer = wallet.address() ?? await wallet.reach();

    if (signer === null)
    {
        return REFUSAL_OF[wallet.failure() ?? 'no-wallet'];
    }

    if (owner === null || signer.toLowerCase() !== owner.toLowerCase())
    {
        return 'wrong-account';
    }

    return await wallet.toChain(chainId) ? null : REFUSAL_OF[wallet.failure() ?? 'chain'];
}

import type { WalletCall } from '../api.ts';
import type { MessageKey } from '../locales/en.ts';
import type { VaultApi } from '../stores/vault.store.ts';
import { whyStaffRefused } from './staff-words.ts';

/**
 * A call the owner's wallet sends, through the vault's own way to a wallet: `null` once it is mined,
 * otherwise what to say, in the staff's own words when the server refused it before a wallet was asked.
 */
export async function ownerSends(vaults: Pick<VaultApi, 'send'>, compose: () => Promise<WalletCall>): Promise<MessageKey | null>
{
    let refused: MessageKey | null = null;
    const answer = await vaults.send(async () =>
    {
        try
        {
            return await compose();
        }
        catch (error)
        {
            const word = whyStaffRefused(error);

            refused = word === 'common.actionFailed' ? null : word;
            throw error;
        }
    });

    return answer === null ? null : refused ?? answer;
}

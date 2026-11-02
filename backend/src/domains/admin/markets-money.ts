import type { HttpError } from '@azerothjs/http';
import { getAddress, isAddress, type Address } from 'viem';

import type { MarketsAsked, MarketsChain } from '../../chain/markets.ts';
import type { AdminMarkets } from '../../schemas.ts';
import { wireCall } from '../stake/service.ts';
import { staffRefusal } from './staff.ts';

const off = () => staffRefusal('staff-markets-off', 'Markets are not open here.');

const noAddress = () => staffRefusal('staff-markets-address', 'That is not an address the markets can name.');

const REFUSED: Partial<Record<string, () => HttpError>> = {
    AccessControlUnauthorizedAccount: () => staffRefusal('staff-markets-role', 'This wallet does not own the markets.'),
    ZeroAddress: noAddress
};

const refusedBy = (error: string) => (REFUSED[error] ?? (() => staffRefusal('staff-markets-refused', 'The markets would refuse that.')))();

/**
 * Who operates `ArcadeMarkets`, and the one call to change it that only the owner's wallet sends:
 * the server's key signs every position and settles every market, and when that key is replaced the
 * contract has to be told, or no market can be backed or paid. Asked of the contract first, as the
 * shop's seller is.
 */
export function createMarketsMoney(markets: MarketsChain)
{
    const answered = (owner: Address, asked: MarketsAsked) =>
    {
        if (!asked.ok)
        {
            throw refusedBy(asked.error);
        }

        return wireCall(owner, asked.call);
    };

    return {
        /** The operator as this server signs with it and as NuraChain names it, and whether the reader's wallet may change it. */
        async standing(reader: Address): Promise<AdminMarkets>
        {
            if (!markets.configured || markets.address === null || markets.operator === null)
            {
                return { configured: false };
            }

            const roles = await markets.roles(reader);

            return {
                configured: true,
                markets: markets.address,
                chainId: markets.chainId,
                operator: { address: markets.operator, allowed: roles.operatorAllowed, named: roles.named },
                owner: roles.owner
            };
        },

        async operator(owner: Address, address: string)
        {
            if (!markets.configured)
            {
                throw off();
            }

            if (!isAddress(address) || BigInt(address) === 0n)
            {
                throw noAddress();
            }

            return answered(owner, await markets.operatorCall(owner, getAddress(address)));
        }
    };
}

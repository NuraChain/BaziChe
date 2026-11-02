import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { errorResponse } from '@azerothjs/http';

import type { MarketsAsked, MarketsChain } from '../src/chain/markets.ts';
import { createMarketsMoney } from '../src/domains/admin/markets-money.ts';

/**
 * The money page's markets: who operates them as this server signs and as NuraChain names it, and
 * the owner's one call to move the role, refused before any wallet is asked when it would fail.
 */

const OWNER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SERVER: Address = '0x7f21c8c503F28897C16b20614e1312b9f53c77E7';
const OLD: Address = '0x2Ef2d5a095fD5eCd686d99Ed3cD1F9fF91FC3167';
const MARKETS: Address = '0x728715176B9e3E3bD61297B732dE7FeDf61A01ea';

const chainOf = (over: Partial<MarketsChain> = {}, answer: MarketsAsked = { ok: true, call: { to: MARKETS, data: '0x', value: 0n, chainId: 1020, gasPrice: null } }) => ({
    configured: true,
    address: MARKETS,
    chainId: 1020,
    operator: SERVER,
    roles: () => Promise.resolve({ named: OLD, operatorAllowed: false, owner: true }),
    operatorCall: () => Promise.resolve(answer),
    ...over
} as unknown as MarketsChain);

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    return thrown === null ? null : (await errorResponse(thrown).json() as { error: { code: string } }).error.code;
};

describe('who operates the markets, on the money page', () =>
{
    it('says the server signs with a key NuraChain does not name, which is when the owner has to move the role', async () =>
    {
        await expect(createMarketsMoney(chainOf()).standing(OWNER)).resolves.toEqual({
            configured: true,
            markets: MARKETS,
            chainId: 1020,
            operator: { address: SERVER, allowed: false, named: OLD },
            owner: true
        });
    });

    it('says markets are off where they are not configured, asking the chain nothing', async () =>
    {
        const money = createMarketsMoney(chainOf({ configured: false, roles: () => Promise.reject(new Error('asked')) }));

        await expect(money.standing(OWNER)).resolves.toEqual({ configured: false });
        expect(await word(money.operator(OWNER, SERVER))).toBe('staff-markets-off');
    });

    it('composes setOperator for the owner\'s wallet, and refuses an address that is none or a wallet that owns nothing', async () =>
    {
        const call = await createMarketsMoney(chainOf()).operator(OWNER, SERVER.toLowerCase());

        expect(call.from).toBe(OWNER);
        expect(call.to).toBe(MARKETS);
        expect(await word(createMarketsMoney(chainOf()).operator(OWNER, 'nope'))).toBe('staff-markets-address');
        expect(await word(createMarketsMoney(chainOf()).operator(OWNER, `0x${ '0'.repeat(40) }`))).toBe('staff-markets-address');
        expect(await word(createMarketsMoney(chainOf({}, { ok: false, error: 'AccessControlUnauthorizedAccount' })).operator(SERVER, SERVER))).toBe('staff-markets-role');
        expect(await word(createMarketsMoney(chainOf({}, { ok: false, error: 'EnforcedPause' })).operator(OWNER, SERVER))).toBe('staff-markets-refused');
    });
});

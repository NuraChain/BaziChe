import { decodeFunctionData, encodeFunctionResult, type Abi, type Address, type Hex } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import { createMarketsChain, MARKETS_ABI } from '../src/chain/markets.ts';
import { createShopChain, SHOP_ABI } from '../src/chain/shop.ts';
import { createVault, VAULT_ABI } from '../src/chain/vault.ts';
import { callOf, closeChains, fakeChain, silentChain, type Answer, type Rpc } from './fake-chain.ts';

const CONTRACT: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const KEY: Hex = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';
const BLOCK = '0x1f';

afterEach(() => closeChains());

/** A node that answers a contract's figures from `figures`, and writes down at which block every one was asked. */
const node = async (abi: Abi, figures: Record<string, bigint | boolean>, coin: bigint) =>
{
    const asked: { what: string; block: unknown }[] = [];
    const { url } = await fakeChain((rpc: Rpc): Answer =>
    {
        if (rpc.method === 'eth_blockNumber')
        {
            return { result: BLOCK };
        }

        if (rpc.method === 'eth_getBalance')
        {
            asked.push({ what: `balance ${ String(rpc.params[0]).toLowerCase() }`, block: rpc.params[1] });
            return { result: `0x${ coin.toString(16) }` };
        }

        const { functionName } = decodeFunctionData({ abi, data: callOf(rpc).data });

        asked.push({ what: functionName, block: rpc.params[1] });

        return { result: encodeFunctionResult({ abi, functionName, result: figures[functionName] } as never) };
    });

    return { url, asked };
};

const BOOKS: { name: string; abi: Abi; owing: Record<string, bigint>; open: (url: string) => { books(): Promise<unknown> } }[] = [
    {
        name: 'the vault',
        abi: VAULT_ABI as Abi,
        owing: { totalBalances: 20n, totalLocked: 30n, fees: 7n },
        open: (url: string) => createVault({ rpcUrl: url, chainId: '31337', vault: CONTRACT, refereeKey: KEY, games: [] })
    },
    {
        name: 'the shop',
        abi: SHOP_ABI as Abi,
        owing: { revenue: 40n, totalEarnings: 17n },
        open: (url: string) => createShopChain({ rpcUrl: url, chainId: '31337', shop: CONTRACT, sellerKey: KEY })
    },
    {
        name: 'the markets contract',
        abi: MARKETS_ABI as Abi,
        owing: { owed: 50n, fees: 7n },
        open: (url: string) => createMarketsChain({ rpcUrl: url, chainId: '31337', markets: CONTRACT, operatorKey: KEY })
    }
];

describe('a contract\'s own books', () =>
{
    for (const one of BOOKS)
    {
        it(`reads what ${ one.name } holds, what it owes and its own word on whether that is covered, every figure at one block`, async () =>
        {
            const owed = Object.values(one.owing).reduce((sum, figure) => sum + figure, 0n);
            const { url, asked } = await node(one.abi, { ...one.owing, solvent: false }, owed - 1n);

            await expect(one.open(url).books()).resolves.toEqual({ held: owed - 1n, owed, solvent: false });
            expect(asked.map((read) => read.what).sort()).toEqual([`balance ${ CONTRACT.toLowerCase() }`, 'solvent', ...Object.keys(one.owing)].sort());
            expect(asked.every((read) => read.block === BLOCK), 'a figure was read at another block').toBe(true);
        });

        it(`answers ${ one.name }'s books as a chain that could not be reached when it could not`, async () =>
        {
            const url = await silentChain();

            await expect(one.open(url).books()).rejects.toMatchObject({ status: 503, code: 'chain-unreachable' });
        }, 15_000);
    }
});

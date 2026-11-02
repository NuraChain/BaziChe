import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, keccak256, parseTransaction, toBytes, type Address, type Hex } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import { createNftChain, NFT_ABI, tokenIdOf, tokenPathOf } from '../src/chain/minting.ts';
import { closeChains, fakeChain, type Answer, type Rpc } from './fake-chain.ts';

const LOOKS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ACHIEVEMENTS: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const MINTER_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;

const chainOn = (url: string) => createNftChain({ rpcUrl: url, chainId: '31337', minterKey: MINTER_KEY, looks: LOOKS, achievements: ACHIEVEMENTS });

const sending = (sent: { to?: string; data: Hex }[], refusal?: { errorName: string; args?: readonly unknown[] }) => (rpc: Rpc): Answer =>
{
    switch (rpc.method)
    {
        case 'eth_call':
            return refusal === undefined
                ? { result: '0x' }
                : { error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: NFT_ABI, errorName: refusal.errorName, args: refusal.args ?? [] } as never) } };
        case 'eth_chainId': return { result: '0x7a69' };
        case 'eth_gasPrice': return { result: '0x3b9aca00' };
        case 'eth_getTransactionCount': return { result: '0x0' };
        case 'eth_estimateGas': return { result: '0x30000' };
        case 'eth_sendRawTransaction':
        {
            const one = parseTransaction(rpc.params[0] as Hex);
            sent.push({ to: one.to ?? undefined, data: one.data! });
            return { result: HASH };
        }
        default: return { error: { code: -32601, message: `no ${ rpc.method }` } };
    }
};

afterEach(() => closeChains());

describe('a token\'s id', () =>
{
    it('is keccak256 of the key, as both contracts derive it, and its metadata path is the 64 hex digits', () =>
    {
        expect(tokenIdOf('dice.shiraz')).toBe(keccak256(toBytes('dice.shiraz')));
        expect(tokenPathOf(tokenIdOf('dice.shiraz'))).toMatch(/^[0-9a-f]{64}$/);
        expect(tokenIdOf('dice.shiraz')).not.toBe(tokenIdOf('dice.neon'));
    });
});

describe('the NFT contracts, as the worker calls them', () =>
{
    it('are not configured without the minter key or either contract, and say so', () =>
    {
        const settings = { rpcUrl: 'http://127.0.0.1:1', chainId: '31337', minterKey: MINTER_KEY, looks: LOOKS, achievements: ACHIEVEMENTS };

        expect(createNftChain(settings).configured).toBe(true);
        expect(createNftChain({ ...settings, minterKey: '' }).configured).toBe(false);
        expect(createNftChain({ ...settings, looks: '' }).configured).toBe(false);
        expect(createNftChain({ ...settings, achievements: 'nope' }).configured).toBe(false);
        expect(createNftChain({ ...settings, rpcUrl: '' }).configured).toBe(false);
    });

    it('mints one look with mint and several with mintBatch, to the looks contract, from the minter', async () =>
    {
        const sent: { to?: string; data: Hex }[] = [];
        const { url } = await fakeChain(sending(sent));
        const chain = chainOn(url);
        const dice = tokenIdOf('dice.shiraz');
        const back = tokenIdOf('back.neon');

        await expect(chain.mintLooks(OWNER, [dice])).resolves.toEqual({ ok: true, hash: HASH });
        await expect(chain.mintLooks(OWNER, [dice, back])).resolves.toEqual({ ok: true, hash: HASH });

        expect(sent.map((one) => one.to)).toEqual([LOOKS.toLowerCase(), LOOKS.toLowerCase()]);
        expect(decodeFunctionData({ abi: NFT_ABI, data: sent[0].data })).toEqual({ functionName: 'mint', args: [OWNER, BigInt(dice)] });
        expect(decodeFunctionData({ abi: NFT_ABI, data: sent[1].data })).toEqual({ functionName: 'mintBatch', args: [OWNER, [BigInt(dice), BigInt(back)]] });
    });

    it('defines an achievement soulbound on the template, then awards it, on the achievements contract', async () =>
    {
        const sent: { to?: string; data: Hex }[] = [];
        const { url } = await fakeChain(sending(sent));
        const chain = chainOn(url);

        await chain.define('ludo-won-97');
        await chain.award(OWNER, tokenIdOf('ludo-won-97'));

        expect(sent.map((one) => one.to)).toEqual([ACHIEVEMENTS.toLowerCase(), ACHIEVEMENTS.toLowerCase()]);
        expect(decodeFunctionData({ abi: NFT_ABI, data: sent[0].data })).toEqual({ functionName: 'defineAchievement', args: ['ludo-won-97', true, ''] });
        expect(decodeFunctionData({ abi: NFT_ABI, data: sent[1].data })).toEqual({ functionName: 'award', args: [OWNER, BigInt(tokenIdOf('ludo-won-97'))] });
    });

    it('answers a refusal by the contract\'s own error name and sends nothing', async () =>
    {
        const sent: { to?: string; data: Hex }[] = [];
        const id = tokenIdOf('dice.shiraz');
        const { url } = await fakeChain(sending(sent, { errorName: 'AlreadyHeld', args: [OWNER, BigInt(id)] }));

        await expect(chainOn(url).mintLooks(OWNER, [id])).resolves.toEqual({ ok: false, refusal: 'AlreadyHeld' });
        expect(sent).toEqual([]);
    });

    it('names a wallet that takes no ERC-1155 by its error, so the token can be put aside', async () =>
    {
        const sent: { to?: string; data: Hex }[] = [];
        const { url } = await fakeChain(sending(sent, { errorName: 'ERC1155InvalidReceiver', args: [OWNER] }));

        await expect(chainOn(url).burnLook(OWNER, tokenIdOf('dice.shiraz'))).resolves.toEqual({ ok: false, refusal: 'ERC1155InvalidReceiver' });
    });

    it('reads what is held, earned and defined before it sends anything', async () =>
    {
        const asked: string[] = [];
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            const call = rpc.params[0] as { data: Hex };
            const { functionName } = decodeFunctionData({ abi: NFT_ABI, data: call.data });
            asked.push(functionName);

            switch (functionName)
            {
                case 'balanceOf': return { result: encodeFunctionResult({ abi: NFT_ABI, functionName: 'balanceOf', result: 1n }) };
                case 'earned': return { result: encodeFunctionResult({ abi: NFT_ABI, functionName: 'earned', result: false }) };
                default: return { result: encodeFunctionResult({ abi: NFT_ABI, functionName: 'achievements', result: [true, true, 3n] }) };
            }
        });
        const chain = chainOn(url);

        await expect(chain.holdsLook(OWNER, tokenIdOf('dice.shiraz'))).resolves.toBe(true);
        await expect(chain.earned(OWNER, tokenIdOf('ludo-won-97'))).resolves.toBe(false);
        await expect(chain.defined(tokenIdOf('ludo-won-97'))).resolves.toBe(true);
        expect(asked).toEqual(['balanceOf', 'earned', 'achievements']);
    });
});

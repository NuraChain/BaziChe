import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, zeroAddress, type Address, type Hex } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import { createTipsChain, tipIdOf, TIPS_ABI, type TipAsked } from '../src/chain/tips.ts';
import { NURA_GAS_FLOOR } from '../src/chain/vault.ts';
import { callOf, closeChains, fakeChain, silentChain, type Answer, type Rpc } from './fake-chain.ts';

const TIPS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const GIVER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PLAYER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;
const AMOUNT = 5n * 10n ** 18n;
const DEADLINE = 1_900_000_000n;
const ID = tipIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6');

const tipsOn = (url: string, chainId = '31337') => createTipsChain({ rpcUrl: url, chainId, tips: TIPS });

const receipt = (status: '0x0' | '0x1') => ({
    blockHash: HASH,
    blockNumber: '0x5',
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    from: GIVER,
    gasUsed: '0x5208',
    logs: [],
    logsBloom: `0x${ '00'.repeat(256) }`,
    status,
    to: TIPS,
    transactionHash: HASH,
    transactionIndex: '0x0',
    type: '0x0'
});

const reverted = (errorName: string, args: readonly unknown[] = []): Answer => ({
    error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: TIPS_ABI, errorName, args } as never) }
});

afterEach(() => closeChains());

describe('a gift\'s id', () =>
{
    it('is the donation\'s uuid as 32 bytes, whatever case it was written in', () =>
    {
        expect(ID).toBe(`0x${ '0'.repeat(32) }3fa85f6457174562b3fc2c963f66afa6`);
        expect(tipIdOf('3FA85F64-5717-4562-B3FC-2C963F66AFA6')).toBe(ID);
    });
});

describe('a gift\'s call', () =>
{
    it('is asked of the contract from the giver, carrying the amount, and handed to the wallet as that call', async () =>
    {
        const asked: { from?: string; value?: string; data: Hex }[] = [];
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            asked.push(rpc.params[0] as { from?: string; value?: string; data: Hex });
            return { result: '0x' };
        });
        const made = await tipsOn(url).tipCall(GIVER, ID, PLAYER, AMOUNT, DEADLINE);

        expect(asked).toHaveLength(1);
        expect(asked[0].from?.toLowerCase()).toBe(GIVER.toLowerCase());
        expect(BigInt(asked[0].value ?? '0x0')).toBe(AMOUNT);
        expect(made).toMatchObject({ ok: true, call: { to: TIPS, value: AMOUNT, chainId: 31337, gasPrice: null } });
        expect(decodeFunctionData({ abi: TIPS_ABI, data: (made as Extract<TipAsked, { ok: true }>).call.data })).toEqual({ functionName: 'tip', args: [ID, PLAYER, DEADLINE] });
    });

    it('names what the contract would refuse, so a wallet is never asked to send it', async () =>
    {
        for (const [errorName, args] of [['TipUsed', [GIVER, ID]], ['TipExpired', [GIVER, ID, DEADLINE]], ['SelfTip', []], ['EnforcedPause', []]] as const)
        {
            const { url } = await fakeChain(() => reverted(errorName, args));

            await expect(tipsOn(url).tipCall(GIVER, ID, PLAYER, AMOUNT, DEADLINE), errorName).resolves.toEqual({ ok: false, error: errorName });
        }
    });

    it('says a giver is short of NURA when the node will not move what they do not hold', async () =>
    {
        const { url } = await fakeChain(() => ({ error: { code: -32000, message: 'insufficient funds for transfer' } }));

        await expect(tipsOn(url).tipCall(GIVER, ID, PLAYER, AMOUNT, DEADLINE)).resolves.toEqual({ ok: false, error: 'InsufficientFunds' });
    });

    it('suggests NuraChain\'s floor to the wallet there', async () =>
    {
        const { url } = await fakeChain((rpc): Answer => (rpc.method === 'eth_gasPrice' ? { result: '0x0' } : { result: '0x' }));

        await expect(tipsOn(url, '1020').tipCall(GIVER, ID, PLAYER, AMOUNT, DEADLINE)).resolves.toMatchObject({ ok: true, call: { chainId: 1020, gasPrice: NURA_GAS_FLOOR } });
    });

    it('throws when the chain cannot be reached, so nothing is handed out', async () =>
    {
        const url = await silentChain();

        await expect(tipsOn(url).tipCall(GIVER, ID, PLAYER, AMOUNT, DEADLINE)).rejects.toMatchObject({ status: 503 });
    }, 15_000);
});

describe('a gift as the contract holds it', () =>
{
    it('is read by its giver and its id, and a gift never made is nobody\'s', async () =>
    {
        let held: readonly [Address, bigint, bigint] = [zeroAddress, 0n, 0n];
        const { url } = await fakeChain((rpc): Answer =>
        {
            expect(decodeFunctionData({ abi: TIPS_ABI, data: callOf(rpc).data as Hex })).toEqual({ functionName: 'tipOf', args: [GIVER, ID] });

            return { result: encodeFunctionResult({ abi: TIPS_ABI, functionName: 'tipOf', result: held }) };
        });
        const tips = tipsOn(url);

        await expect(tips.tipOf(GIVER, ID)).resolves.toEqual({ to: null, amount: 0n, givenAt: 0n });

        held = [PLAYER.toLowerCase() as Address, AMOUNT, 1_800_000_000n];

        await expect(tips.tipOf(GIVER, ID)).resolves.toEqual({ to: PLAYER, amount: AMOUNT, givenAt: 1_800_000_000n });
    });

    it('reads a transaction as waiting, made or refused, and a wallet\'s NURA', async () =>
    {
        let answer: unknown = null;
        const { url } = await fakeChain((rpc) => ({ result: rpc.method === 'eth_getBalance' ? '0x4563918244f40000' : answer }));
        const tips = tipsOn(url);

        await expect(tips.mined(HASH)).resolves.toBe('pending');
        answer = receipt('0x1');
        await expect(tips.mined(HASH)).resolves.toBe('success');
        answer = receipt('0x0');
        await expect(tips.mined(HASH)).resolves.toBe('reverted');
        await expect(tips.balanceOf(GIVER)).resolves.toBe(AMOUNT);
    });
});

describe('donations that are configured', () =>
{
    it('need an rpc, a contract and a chain', () =>
    {
        const settings = { rpcUrl: 'http://127.0.0.1:1', chainId: '31337', tips: TIPS };

        expect(createTipsChain(settings).configured).toBe(true);
        expect(createTipsChain(settings).address).toBe(TIPS);
        expect(createTipsChain({ ...settings, rpcUrl: '' }).configured).toBe(false);
        expect(createTipsChain({ ...settings, tips: '' }).configured).toBe(false);
        expect(createTipsChain({ ...settings, tips: '0x1234' }).configured).toBe(false);
        expect(createTipsChain({ ...settings, chainId: '' }).configured).toBe(false);
        expect(createTipsChain({ ...settings, chainId: 'nura' }).configured).toBe(false);
        expect(createTipsChain({ ...settings, tips: '' }).address).toBeNull();
    });
});

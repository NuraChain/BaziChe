import { decodeFunctionData, encodeErrorResult, encodeFunctionData, encodeFunctionResult, numberToHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';

import { createNftChain, NFT_ABI } from '../src/chain/minting.ts';
import { closeChains, fakeChain, type Answer, type Rpc } from './fake-chain.ts';

const LOOKS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ACHIEVEMENTS: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const ADMIN: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const MINTER_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MINTER = privateKeyToAccount(MINTER_KEY).address;
const MINTER_ROLE: Hex = `0x${ 'ab'.repeat(32) }`;
const ADMIN_ROLE: Hex = `0x${ '0'.repeat(64) }`;
const HASH: Hex = `0x${ 'cd'.repeat(32) }`;
const CODE: Hex = '0x6080604052';

const SETTINGS = { rpcUrl: 'http://127.0.0.1:1', chainId: '31337', minterKey: MINTER_KEY, looks: LOOKS, achievements: ACHIEVEMENTS };

interface World
{
    chain: number;
    code: Hex;

    /** Whether the contract has no roles at all: `MINTER_ROLE()` reverts, as a contract that is not an AccessControl one does. */
    plain: boolean;

    /** Whom each role is held by, lower case. */
    held: Map<Hex, Set<string>>;

    /** Whether the contract refuses `grantRole` and `revokeRole` from whoever asks. */
    refuse: boolean;

    calls: { from?: string; to?: string; data: Hex }[];
    transaction: unknown;
}

const world = (over: Partial<World> = {}): World => ({
    chain: 31337,
    code: CODE,
    plain: false,
    held: new Map([[MINTER_ROLE, new Set<string>()], [ADMIN_ROLE, new Set([ADMIN.toLowerCase()])]]),
    refuse: false,
    calls: [],
    transaction: null,
    ...over
});

const node = (w: World) => (rpc: Rpc): Answer =>
{
    switch (rpc.method)
    {
        case 'eth_chainId': return { result: numberToHex(w.chain) };
        case 'eth_getCode': return { result: w.code };
        case 'eth_gasPrice': return { result: '0x3b9aca00' };
        case 'eth_getTransactionByHash': return { result: w.transaction };
        case 'eth_call':
        {
            const call = rpc.params[0] as { from?: string; to?: string; data: Hex };
            const asked = decodeFunctionData({ abi: NFT_ABI, data: call.data });

            switch (asked.functionName)
            {
                case 'MINTER_ROLE':
                    return w.plain ? { error: { code: 3, message: 'execution reverted' } } : { result: encodeFunctionResult({ abi: NFT_ABI, functionName: 'MINTER_ROLE', result: MINTER_ROLE }) };
                case 'DEFAULT_ADMIN_ROLE':
                    return { result: encodeFunctionResult({ abi: NFT_ABI, functionName: 'DEFAULT_ADMIN_ROLE', result: ADMIN_ROLE }) };
                case 'hasRole':
                {
                    const [role, account] = asked.args as [Hex, Address];

                    return { result: encodeFunctionResult({ abi: NFT_ABI, functionName: 'hasRole', result: w.held.get(role)?.has(account.toLowerCase()) ?? false }) };
                }
                case 'grantRole':
                case 'revokeRole':
                    w.calls.push({ from: call.from, to: call.to, data: call.data });

                    return w.refuse
                        ? { error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: NFT_ABI, errorName: 'AccessControlUnauthorizedAccount', args: [call.from as Address, ADMIN_ROLE] }) } }
                        : { result: '0x' };
                default:
                    return { error: { code: -32601, message: `no ${ asked.functionName }` } };
            }
        }
        default: return { error: { code: -32601, message: `no ${ rpc.method }` } };
    }
};

const chainOn = (url: string) => createNftChain({ ...SETTINGS, rpcUrl: url });

afterEach(() => closeChains());

describe('the contracts the NFT worker mints on', () =>
{
    it('are named by the key the worker mints with, which is whom MINTER_ROLE is for, and listed with the keys the staff address them by', () =>
    {
        const chain = createNftChain(SETTINGS);

        expect(chain.minter).toBe(MINTER);
        expect(chain.contracts).toEqual([
            { key: 'looks', name: 'Baziche Looks', address: LOOKS },
            { key: 'achievements', name: 'Baziche Achievements', address: ACHIEVEMENTS }
        ]);
    });

    it('are none, and the minter nobody, until the key, the node and both contracts are written', () =>
    {
        for (const missing of [{ minterKey: '' }, { looks: '' }, { achievements: 'nope' }, { rpcUrl: '' }])
        {
            const chain = createNftChain({ ...SETTINGS, ...missing });

            expect(chain.contracts, JSON.stringify(missing)).toEqual([]);
            expect(chain.minter).toBeNull();
        }
    });
});

describe('what NuraChain says of a contract\'s roles', () =>
{
    it('is read from the contract itself: the role it names, whether the minter holds it, and whether the reader\'s wallet is its admin', async () =>
    {
        const w = world();
        const { url, asked } = await fakeChain(node(w));
        const chain = chainOn(url);
        const [looks] = chain.contracts;

        await expect(chain.standing(looks, ADMIN)).resolves.toEqual({ node: 31337, deployed: true, role: MINTER_ROLE, minter: false, admin: true });
        expect(asked).toContain('eth_getCode');

        w.held.get(MINTER_ROLE)?.add(MINTER.toLowerCase());

        await expect(chain.standing(looks, STRANGER)).resolves.toEqual({ node: 31337, deployed: true, role: MINTER_ROLE, minter: true, admin: false });
        await expect(chain.standing(looks, null)).resolves.toEqual({ node: 31337, deployed: true, role: MINTER_ROLE, minter: true, admin: null });
    });

    it('is read for every contract on its own, so one holding the role and one lacking it are told apart', async () =>
    {
        const held = world();
        const bare = world();
        const { url: heldUrl } = await fakeChain(node(held));
        const { url: bareUrl } = await fakeChain(node(bare));

        held.held.get(MINTER_ROLE)?.add(MINTER.toLowerCase());

        const withRole = await chainOn(heldUrl).standing(chainOn(heldUrl).contracts[0], ADMIN);
        const without = await chainOn(bareUrl).standing(chainOn(bareUrl).contracts[1], ADMIN);

        expect([withRole.minter, without.minter]).toEqual([true, false]);
    });

    it('reads nothing of roles from a node on another chain than the one this server is set to', async () =>
    {
        const w = world({ chain: 1020 });
        const { url, asked } = await fakeChain(node(w));
        const chain = chainOn(url);

        await expect(chain.standing(chain.contracts[0], ADMIN)).resolves.toEqual({ node: 1020, deployed: true, role: null, minter: false, admin: null });
        expect(asked).not.toContain('eth_call');
    });

    it('reads nothing of roles where the address holds no contract', async () =>
    {
        const w = world({ code: '0x' });
        const { url, asked } = await fakeChain(node(w));
        const chain = chainOn(url);

        await expect(chain.standing(chain.contracts[0], ADMIN)).resolves.toEqual({ node: 31337, deployed: false, role: null, minter: false, admin: null });
        expect(asked).not.toContain('eth_call');
    });

    it('says a contract that does not answer to roles has none, and is not taken for one the minter lacks the role on', async () =>
    {
        const w = world({ plain: true });
        const { url } = await fakeChain(node(w));
        const chain = chainOn(url);

        await expect(chain.standing(chain.contracts[0], ADMIN)).resolves.toEqual({ node: 31337, deployed: true, role: null, minter: false, admin: null });
    });
});

describe('a role call composed for the admin\'s wallet', () =>
{
    it('is grantRole or revokeRole of the role the contract names, for the minter\'s own address, to the contract, asked of it from the admin and never sent', async () =>
    {
        const w = world();
        const { url, asked } = await fakeChain(node(w));
        const chain = chainOn(url);
        const [looks, achievements] = chain.contracts;

        const granted = await chain.roleCall(looks, ADMIN, true);
        const revoked = await chain.roleCall(achievements, ADMIN, false);

        expect(granted.ok && revoked.ok).toBe(true);

        if (granted.ok && revoked.ok)
        {
            expect(granted.call).toMatchObject({ to: LOOKS, value: 0n, chainId: 31337 });
            expect(decodeFunctionData({ abi: NFT_ABI, data: granted.call.data })).toEqual({ functionName: 'grantRole', args: [MINTER_ROLE, MINTER] });
            expect(revoked.call).toMatchObject({ to: ACHIEVEMENTS, value: 0n, chainId: 31337 });
            expect(decodeFunctionData({ abi: NFT_ABI, data: revoked.call.data })).toEqual({ functionName: 'revokeRole', args: [MINTER_ROLE, MINTER] });
            expect(granted.call.data).toBe(encodeFunctionData({ abi: NFT_ABI, functionName: 'grantRole', args: [MINTER_ROLE, MINTER] }));
        }

        expect(w.calls.map((call) => [call.from?.toLowerCase(), call.to?.toLowerCase()])).toEqual([
            [ADMIN.toLowerCase(), LOOKS.toLowerCase()],
            [ADMIN.toLowerCase(), ACHIEVEMENTS.toLowerCase()]
        ]);
        expect(asked.filter((method) => method.startsWith('eth_send') || method === 'eth_signTransaction'), 'a transaction was sent').toEqual([]);
    });

    it('is refused by the contract\'s own word when it would refuse it, and says nothing else', async () =>
    {
        const w = world({ refuse: true });
        const { url } = await fakeChain(node(w));
        const chain = chainOn(url);

        await expect(chain.roleCall(chain.contracts[0], STRANGER, true)).resolves.toEqual({ ok: false, refusal: 'AccessControlUnauthorizedAccount' });
    });
});

describe('a transaction the wallet reported', () =>
{
    it('is read as the node holds it, and is nothing where the node holds none', async () =>
    {
        const w = world();
        const { url } = await fakeChain(node(w));
        const chain = chainOn(url);

        await expect(chain.transactionOf(HASH)).resolves.toBeNull();

        const data = encodeFunctionData({ abi: NFT_ABI, functionName: 'grantRole', args: [MINTER_ROLE, MINTER] });

        w.transaction = {
            hash: HASH,
            from: ADMIN.toLowerCase(),
            to: LOOKS.toLowerCase(),
            input: data,
            blockHash: null,
            blockNumber: null,
            transactionIndex: null,
            gas: '0x30000',
            gasPrice: '0x3b9aca00',
            nonce: '0x0',
            value: '0x0',
            type: '0x0',
            v: '0x1b',
            r: '0x1',
            s: '0x1'
        };

        await expect(chain.transactionOf(HASH)).resolves.toEqual({ from: ADMIN, to: LOOKS, input: data });
    });
});

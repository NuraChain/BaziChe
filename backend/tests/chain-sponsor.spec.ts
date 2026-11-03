import { decodeFunctionData, encodeFunctionResult, parseTransaction, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';

import { createProfileSponsor, FORWARDER_ABI, isSignature, TRUSTED_ABI, type ForwardRequest } from '../src/chain/sponsor.ts';
import { callOf, closeChains, fakeChain, type Answer, type Rpc } from './fake-chain.ts';

const REGISTRY: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const FORWARDER: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const SPONSOR_KEY: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const PERSON_KEY: Hex = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const person = privateKeyToAccount(PERSON_KEY);
const HASH: Hex = `0x${ 'cd'.repeat(32) }`;

/** OpenZeppelin's own `_FORWARD_REQUEST_TYPEHASH` string, in `ERC2771Forwarder.sol`. */
const OZ_FORWARD_REQUEST = 'ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)';

const sponsorOn = (url: string) => createProfileSponsor({ rpcUrl: url, chainId: '31337', registry: REGISTRY, sponsorKey: SPONSOR_KEY });

const REQUEST: ForwardRequest = { from: person.address, to: REGISTRY, gas: 200_000n, nonce: 4n, deadline: 1_900_000_000, data: '0x1234abcd' };

interface World
{
    valid: boolean;
    reverts: boolean;
    sent: { to?: string; data: Hex; gas?: bigint }[];
}

const answering = (world: World) => (rpc: Rpc): Answer =>
{
    switch (rpc.method)
    {
        case 'eth_chainId': return { result: '0x7a69' };
        case 'eth_gasPrice': return { result: '0x3b9aca00' };
        case 'eth_getTransactionCount': return { result: '0x0' };
        case 'eth_getBalance': return { result: '0x5' };
        case 'eth_estimateGas': return { result: '0x30d40' };
        case 'eth_sendRawTransaction':
        {
            const one = parseTransaction(rpc.params[0] as Hex);
            world.sent.push({ to: one.to ?? undefined, data: one.data!, gas: one.gas });
            return { result: HASH };
        }
        case 'eth_call':
        {
            const { to, data } = callOf(rpc);

            if (to?.toLowerCase() === REGISTRY.toLowerCase())
            {
                return { result: encodeFunctionResult({ abi: TRUSTED_ABI, functionName: 'trustedForwarder', result: FORWARDER }) };
            }

            const called = decodeFunctionData({ abi: FORWARDER_ABI, data: data as Hex });

            switch (called.functionName)
            {
                case 'nonces': return { result: encodeFunctionResult({ abi: FORWARDER_ABI, functionName: 'nonces', result: 4n }) };
                case 'verify': return { result: encodeFunctionResult({ abi: FORWARDER_ABI, functionName: 'verify', result: world.valid }) };
                default: return world.reverts ? { error: { code: 3, message: 'execution reverted', data: '0xd6bda275' } } : { result: '0x' };
            }
        }
        default: return { error: { code: -32601, message: `no ${ rpc.method }` } };
    }
};

const world = (over: Partial<World> = {}): World => ({ valid: true, reverts: false, sent: [], ...over });

afterEach(() => closeChains());

describe('the server paying a profile\'s gas, on the chain', () =>
{
    it('is not configured without its own key, the registry, the chain or the RPC', () =>
    {
        const settings = { rpcUrl: 'http://127.0.0.1:1', chainId: '31337', registry: REGISTRY, sponsorKey: SPONSOR_KEY };

        expect(createProfileSponsor(settings).configured).toBe(true);
        expect(createProfileSponsor(settings).address).toBe(privateKeyToAccount(SPONSOR_KEY).address);
        expect(createProfileSponsor({ ...settings, sponsorKey: '' }).configured).toBe(false);
        expect(createProfileSponsor({ ...settings, sponsorKey: '0x1234' }).configured).toBe(false);
        expect(createProfileSponsor({ ...settings, registry: '' }).configured).toBe(false);
        expect(createProfileSponsor({ ...settings, chainId: '' }).configured).toBe(false);
        expect(createProfileSponsor({ ...settings, rpcUrl: '' }).configured).toBe(false);
    });

    it('asks a person to sign OpenZeppelin\'s ForwardRequest, for the forwarder the registry trusts, and a wallet\'s signature over it recovers to them', async () =>
    {
        const { url } = await fakeChain(answering(world()));
        const typed = JSON.parse(await sponsorOn(url).typedData(REQUEST)) as {
            types: { ForwardRequest: { name: string; type: string }[] };
            primaryType: string;
            domain: { name: string; version: string; chainId: number; verifyingContract: Address };
            message: Record<string, unknown>;
        };
        const fields = typed.types.ForwardRequest;

        expect(`ForwardRequest(${ fields.map((one) => `${ one.type } ${ one.name }`).join(',') })`).toBe(OZ_FORWARD_REQUEST);
        expect(typed.domain).toEqual({ name: 'NuraForwarder', version: '1', chainId: 31337, verifyingContract: FORWARDER });
        expect(typed.message).toEqual({ from: person.address, to: REGISTRY, value: '0', gas: '200000', nonce: '4', deadline: 1_900_000_000, data: '0x1234abcd' });

        const asSigned = { domain: typed.domain, types: { ForwardRequest: fields }, primaryType: 'ForwardRequest' as const, message: { ...REQUEST, value: 0n } };
        const signature = await person.signTypedData(asSigned);

        expect(isSignature(signature)).toBe(true);
        await expect(recoverTypedDataAddress({ ...asSigned, signature })).resolves.toBe(person.address);
    });

    it('sends a request the forwarder verifies and the chain would take, to the forwarder, with the gas it needs to give the call all of its own', async () =>
    {
        const seen = world();
        const { url } = await fakeChain(answering(seen));
        const signature: Hex = `0x${ '11'.repeat(65) }`;

        await expect(sponsorOn(url).relay(REQUEST, signature)).resolves.toEqual({ ok: true, hash: HASH });
        expect(seen.sent).toHaveLength(1);
        expect(seen.sent[0].to).toBe(FORWARDER.toLowerCase());
        expect(seen.sent[0].gas).toBe(200_000n * 64n / 63n + 120_000n);
        expect(decodeFunctionData({ abi: FORWARDER_ABI, data: seen.sent[0].data })).toEqual({
            functionName: 'execute',
            args: [{ from: person.address, to: REGISTRY, value: 0n, gas: 200_000n, deadline: 1_900_000_000, data: '0x1234abcd', signature }]
        });
    });

    it('sends nothing for a signature the forwarder does not take, or a write the chain would refuse', async () =>
    {
        const forged = world({ valid: false });
        const refused = world({ reverts: true });
        const signature: Hex = `0x${ '11'.repeat(65) }`;

        await expect(sponsorOn((await fakeChain(answering(forged))).url).relay(REQUEST, signature)).resolves.toEqual({ ok: false, refusal: 'signature' });
        await expect(sponsorOn((await fakeChain(answering(refused))).url).relay(REQUEST, signature)).resolves.toEqual({ ok: false, refusal: 'reverted' });
        expect([...forged.sent, ...refused.sent]).toEqual([]);
    });

    it('reads what a wallet holds, the next nonce and the gas a write takes, and never prices gas under the chain\'s floor', async () =>
    {
        const { url } = await fakeChain(answering(world()));
        const sponsor = sponsorOn(url);

        await expect(sponsor.balanceOf(person.address)).resolves.toBe(5n);
        await expect(sponsor.nonceOf(person.address)).resolves.toBe(4n);
        await expect(sponsor.estimate(person.address, '0x1234')).resolves.toBe(200_000n);
        await expect(sponsor.gasPrice()).resolves.toBe(1_000_000_000n);
        await expect(createProfileSponsor({ rpcUrl: url, chainId: '1020', registry: REGISTRY, sponsorKey: SPONSOR_KEY }).gasPrice()).resolves.toBe(47_000_000_000n);
    });
});

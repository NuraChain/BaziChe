import { HttpError } from '@azerothjs/http';
import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';

import { NFT_ABI, type NftChain, type NftContract, type NftTransaction } from '../src/chain/minting.ts';
import type { Mined } from '../src/chain/vault.ts';

export const FAKE_LOOKS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

export const FAKE_ACHIEVEMENTS: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

/** The address of the key the fake worker mints with. */
export const FAKE_MINTER: Address = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';

export const MINTER_ROLE: Hex = `0x${ 'ab'.repeat(32) }`;

const unreached = () => new HttpError(503, 'We could not reach the network. Try again in a moment.', { code: 'chain-unreachable', expose: true });

/**
 * The NFT contracts a spec steers: who holds `MINTER_ROLE` and `DEFAULT_ADMIN_ROLE` on each, which chain the
 * node is on, whether there is a contract, what a receipt says and which transaction a hash names.
 * `sends` plays the owner's wallet: it puts the call it was handed on the chain as a mined transaction.
 */
export function fakeNft(configured = true)
{
    const contracts: NftContract[] = configured
        ? [{ key: 'looks', name: 'Baziche Looks', address: FAKE_LOOKS }, { key: 'achievements', name: 'Baziche Achievements', address: FAKE_ACHIEVEMENTS }]
        : [];
    const state = {
        node: 31337,
        away: false,

        /** Contracts (by key) with no code, and those that answer to no roles. */
        bare: new Set<string>(),
        plain: new Set<string>(),

        /** Whom `MINTER_ROLE` and `DEFAULT_ADMIN_ROLE` are held by on each contract, by key, lower case. */
        minters: new Map<string, Set<string>>(contracts.map((one) => [one.key, new Set<string>()])),
        admins: new Map<string, Set<string>>(contracts.map((one) => [one.key, new Set<string>()])),

        /** What the contract would refuse a role call with, by its error's name; `null` takes it. */
        refuse: null as string | null,

        receipts: new Map<Hex, Mined>(),
        transactions: new Map<Hex, NftTransaction>(),
        composed: [] as { key: string; admin: Address; grant: boolean }[]
    };

    const reach = () =>
    {
        if (state.away)
        {
            throw unreached();
        }
    };

    const keyOf = (contract: NftContract) => contract.key;

    const chain: NftChain = {
        configured,
        chainId: 31337,
        looks: configured ? FAKE_LOOKS : null,
        achievements: configured ? FAKE_ACHIEVEMENTS : null,
        minter: configured ? FAKE_MINTER : null,
        contracts,

        standing(contract, wallet)
        {
            reach();

            const key = keyOf(contract);
            const deployed = !state.bare.has(key);

            if (state.node !== 31337 || !deployed || state.plain.has(key))
            {
                return Promise.resolve({ node: state.node, deployed, role: null, minter: false, admin: null });
            }

            return Promise.resolve({
                node: state.node,
                deployed,
                role: MINTER_ROLE,
                minter: state.minters.get(key)?.has(FAKE_MINTER.toLowerCase()) ?? false,
                admin: wallet === null ? null : state.admins.get(key)?.has(wallet.toLowerCase()) ?? false
            });
        },

        roleCall(contract, admin, grant)
        {
            reach();
            state.composed.push({ key: keyOf(contract), admin, grant });

            const refusal = state.refuse ?? (state.admins.get(keyOf(contract))?.has(admin.toLowerCase()) ? null : 'AccessControlUnauthorizedAccount');

            return Promise.resolve(refusal === null
                ? {
                    ok: true as const,
                    call: {
                        to: contract.address,
                        data: encodeFunctionData({ abi: NFT_ABI, functionName: grant ? 'grantRole' : 'revokeRole', args: [MINTER_ROLE, FAKE_MINTER] }),
                        value: 0n,
                        chainId: 31337,
                        gasPrice: null
                    }
                }
                : { ok: false as const, refusal });
        },

        transactionOf(hash)
        {
            reach();

            return Promise.resolve(state.transactions.get(hash) ?? null);
        },

        mined(hash)
        {
            reach();

            return Promise.resolve(state.receipts.get(hash) ?? 'pending');
        },

        holdsLook: () => Promise.resolve(false),
        earned: () => Promise.resolve(false),
        defined: () => Promise.resolve(true),
        mintLooks: () => Promise.resolve({ ok: true, hash: `0x${ '00'.repeat(32) }` }),
        burnLook: () => Promise.resolve({ ok: true, hash: `0x${ '00'.repeat(32) }` }),
        define: () => Promise.resolve({ ok: true, hash: `0x${ '00'.repeat(32) }` }),
        award: () => Promise.resolve({ ok: true, hash: `0x${ '00'.repeat(32) }` })
    };

    return {
        chain,
        state,

        /** A wallet makes the owner's `call` a transaction under `hash` that the chain mines as `receipt`; a success moves the role as the contract would. */
        sends(hash: Hex, call: { from: string; to: string; data: string }, receipt: Mined = 'success')
        {
            state.transactions.set(hash, { from: getAddress(call.from), to: getAddress(call.to), input: call.data as Hex });
            state.receipts.set(hash, receipt);

            if (receipt === 'success')
            {
                const key = contracts.find((one) => one.address.toLowerCase() === call.to.toLowerCase())?.key ?? '';
                const grant = call.data.startsWith(encodeFunctionData({ abi: NFT_ABI, functionName: 'grantRole', args: [MINTER_ROLE, FAKE_MINTER] }).slice(0, 10));
                const held = state.minters.get(key);

                if (grant)
                {
                    held?.add(FAKE_MINTER.toLowerCase());
                }
                else
                {
                    held?.delete(FAKE_MINTER.toLowerCase());
                }
            }
        }
    };
}

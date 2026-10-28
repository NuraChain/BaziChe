import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';

import { TIPS_ABI, type Tip, type TipAsked, type TipsChain } from '../src/chain/tips.ts';
import type { Mined } from '../src/chain/vault.ts';

export const FAKE_TIPS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

const NONE: Tip = { to: null, amount: 0n, givenAt: 0n };

/** A gifts contract a spec steers: what it holds, what it refuses, what a transaction came to, whether it can be reached. */
export function fakeTips(configured = true)
{
    const held = new Map<string, Tip>();
    const receipts = new Map<Hex, Mined>();
    const calls: { from: Address; id: Hex; to: Address; amount: bigint; deadline: bigint }[] = [];
    const asked: string[] = [];
    const state = { refuse: null as string | null, away: false, balance: 10n ** 24n };

    const reach = () =>
    {
        if (state.away)
        {
            throw Object.assign(new Error('NuraChain could not be reached.'), { status: 503 });
        }
    };

    const tips: TipsChain = {
        configured,
        address: configured ? FAKE_TIPS : null,
        chainId: 31337,

        tipCall(from, id, to, amount, deadline): Promise<TipAsked>
        {
            reach();
            calls.push({ from, id, to, amount, deadline });
            asked.push(`call ${ id }`);

            return Promise.resolve(state.refuse === null
                ? { ok: true, call: { to: FAKE_TIPS, data: encodeFunctionData({ abi: TIPS_ABI, functionName: 'tip', args: [id, to, deadline] }), value: amount, chainId: 31337, gasPrice: null } }
                : { ok: false, error: state.refuse });
        },

        tipOf(from, id)
        {
            reach();
            asked.push(`tip ${ id }`);

            return Promise.resolve(held.get(`${ from.toLowerCase() } ${ id }`) ?? NONE);
        },

        mined(hash)
        {
            reach();

            return Promise.resolve(receipts.get(hash) ?? 'pending');
        },

        balanceOf()
        {
            reach();

            return Promise.resolve(state.balance);
        }
    };

    return {
        tips,
        calls,
        asked,
        state,
        receipts,

        /** The contract records a gift under its giver and its id, as a mined `tip` would. */
        give(from: string, id: Hex, to: string, amount: bigint)
        {
            held.set(`${ from.toLowerCase() } ${ id }`, { to: getAddress(to), amount, givenAt: 1n });
        }
    };
}

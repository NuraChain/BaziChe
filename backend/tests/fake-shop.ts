import { encodeFunctionData, keccak256, stringToHex, zeroAddress, type Address, type Hex } from 'viem';

import { SHOP_ABI, type Quote, type Sale, type ShopAsked, type ShopCall, type ShopChain, type ShopEarned } from '../src/chain/shop.ts';
import type { Mined } from '../src/chain/vault.ts';

export const FAKE_SHOP: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

export const FAKE_SELLER: Address = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';

const NOBODY: Sale = { buyer: null, paidAt: 0n, refunded: false, referrer: null, price: 0n, cut: 0n };

const notHere = (): Promise<never> => Promise.reject(new Error('the fake shop has no owner\'s calls'));

/** A shop a spec steers: what it has sold, what it refuses, what a transaction came to, whether it can be reached. */
export function fakeShop(configured = true)
{
    const sales = new Map<Hex, Sale>();
    const receipts = new Map<Hex, Mined>();
    const quotes: { quote: Quote; signature: Hex }[] = [];
    const asked: string[] = [];
    const state = {
        refuse: null as string | null,
        claimRefuse: null as string | null,
        away: false,
        balance: 10n ** 24n,
        earned: { earnings: 0n, referralBps: 1000 } as ShopEarned,
        books: { held: 0n, owed: 0n, solvent: true }
    };

    const reach = () =>
    {
        if (state.away)
        {
            throw Object.assign(new Error('NuraChain could not be reached.'), { status: 503 });
        }
    };

    const callOf = (data: Hex, value: bigint): ShopCall => ({ to: FAKE_SHOP, data, value, chainId: 31337, gasPrice: null });

    const shop: ShopChain = {
        configured,
        address: configured ? FAKE_SHOP : null,
        chainId: 31337,
        seller: configured ? FAKE_SELLER : null,

        sign: (quote) => Promise.resolve(keccak256(stringToHex(`${ quote.order }:${ quote.buyer }:${ quote.item }:${ quote.price }:${ quote.referrer }:${ quote.deadline }`))),

        buyCall(quote, signature): Promise<ShopAsked>
        {
            reach();
            quotes.push({ quote, signature });
            asked.push(`buy ${ quote.order }`);

            return Promise.resolve(state.refuse === null
                ? { ok: true, call: callOf(encodeFunctionData({ abi: SHOP_ABI, functionName: 'buy', args: [quote, signature] }), quote.price) }
                : { ok: false, refusal: { error: state.refuse } });
        },

        saleOf(order)
        {
            reach();
            asked.push(`sale ${ order }`);

            return Promise.resolve(sales.get(order) ?? NOBODY);
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
        },

        earnedBy()
        {
            reach();

            return Promise.resolve(state.earned);
        },

        claimCall(address): Promise<ShopAsked>
        {
            reach();
            asked.push(`claim ${ address }`);

            return Promise.resolve(state.claimRefuse === null
                ? { ok: true, call: callOf(encodeFunctionData({ abi: SHOP_ABI, functionName: 'claim' }), 0n) }
                : { ok: false, refusal: { error: state.claimRefuse } });
        },

        books()
        {
            reach();

            return Promise.resolve({ ...state.books });
        },

        ledger: notHere,
        withdrawCall: notHere,
        fundCall: notHere,
        refundCall: notHere,
        sellerCall: notHere,
        shareCall: notHere,
        pauseCall: notHere
    };

    return {
        shop,
        state,
        quotes,
        asked,

        /** The newest quote the shop was asked to take. */
        last: () => quotes.at(-1)!.quote,

        /** The shop sells the order its quote names, as a mined `buy` of it would. */
        sell(quote: Quote, refunded = false)
        {
            sales.set(quote.order, {
                buyer: quote.buyer,
                paidAt: 1n,
                refunded,
                referrer: quote.referrer === zeroAddress ? null : quote.referrer,
                price: quote.price,
                cut: quote.referrer === zeroAddress ? 0n : quote.price / 10n
            });
        },

        mine(hash: Hex, outcome: Mined)
        {
            receipts.set(hash, outcome);
        }
    };
}

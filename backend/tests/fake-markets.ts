import { encodeFunctionData, type Address, type Hex } from 'viem';

import { MARKETS_ABI, type ChainState, type Claims, type MarketOnChain, type MarketsAsked, type MarketsChain, type MarketsSent, type PositionOnChain, type Terms, type Ticket } from '../src/chain/markets.ts';
import type { Mined } from '../src/chain/vault.ts';

export const FAKE_MARKETS: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

export const FAKE_OPERATOR: Address = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

const NONE: MarketOnChain = { state: 'none', winner: 0, claimableAt: 0n, pool: 0n, bettors: 0 };

const NOBODY: PositionOnChain = { bettor: null, outcome: 0, amount: 0n, claimed: false };

/**
 * A markets contract a spec steers: the markets and positions it holds, what it refuses, what a
 * transaction came to, its clock, and whether it can be reached. It signs nothing anybody checks:
 * a signature is the ticket's id, so a spec can tell which ticket a call carried.
 */
export function fakeMarkets(configured = true)
{
    const markets = new Map<Hex, MarketOnChain>();
    const positions = new Map<Hex, PositionOnChain>();
    const receipts = new Map<Hex, Mined>();
    const claims = new Map<Hex, Claims>();
    const placed: { terms: Terms; ticket: Ticket; signature: Hex }[] = [];
    const claimed: { from: Address; tickets: readonly Hex[] }[] = [];
    const sent: string[] = [];
    const state = {
        refusePlace: null as string | null,
        refuseClaim: [] as string[],
        refuseSend: null as string | null,
        away: false,
        balance: 10n ** 24n,
        clock: null as bigint | null,
        hashes: 0,
        books: { held: 0n, owed: 0n, solvent: true }
    };

    const reach = () =>
    {
        if (state.away)
        {
            throw Object.assign(new Error('NuraChain could not be reached.'), { status: 503 });
        }
    };

    const call = (data: Hex, value: bigint): MarketsAsked => ({ ok: true, call: { to: FAKE_MARKETS, data, value, chainId: 31337, gasPrice: null } });

    const send = (what: string): MarketsSent =>
    {
        if (state.refuseSend !== null)
        {
            return { ok: false, error: state.refuseSend };
        }

        state.hashes += 1;
        sent.push(what);

        return { ok: true, hash: `0x${ state.hashes.toString(16).padStart(64, '0') }` };
    };

    const chain: MarketsChain = {
        configured,
        address: configured ? FAKE_MARKETS : null,
        chainId: 31337,
        operator: configured ? FAKE_OPERATOR : null,

        sign: (ticket) => Promise.resolve(ticket.id),

        placeCall(terms, ticket, signature)
        {
            reach();
            placed.push({ terms, ticket, signature });

            return Promise.resolve(state.refusePlace === null
                ? call(encodeFunctionData({ abi: MARKETS_ABI, functionName: 'place', args: [terms, ticket, signature] }), ticket.amount)
                : { ok: false, error: state.refusePlace });
        },

        claimCall(from, tickets)
        {
            reach();
            claimed.push({ from, tickets });

            const refusal = state.refuseClaim.shift();

            return Promise.resolve(refusal === undefined
                ? call(encodeFunctionData({ abi: MARKETS_ABI, functionName: 'claim', args: [tickets] }), 0n)
                : { ok: false, error: refusal });
        },

        settle(market, outcome)
        {
            reach();

            return Promise.resolve(send(`settle ${ market } ${ outcome }`));
        },

        cancel(market)
        {
            reach();

            return Promise.resolve(send(`cancel ${ market }`));
        },

        marketOf(market)
        {
            reach();

            return Promise.resolve(markets.get(market) ?? NONE);
        },

        positionOf(ticket)
        {
            reach();

            return Promise.resolve(positions.get(ticket) ?? NOBODY);
        },

        payoutOf()
        {
            reach();

            return Promise.resolve(0n);
        },

        mined(hash)
        {
            reach();

            return Promise.resolve(receipts.get(hash) ?? 'pending');
        },

        claimsIn(hash)
        {
            reach();

            return Promise.resolve(claims.get(hash) ?? 'pending');
        },

        balanceOf()
        {
            reach();

            return Promise.resolve(state.balance);
        },

        clock()
        {
            reach();

            return Promise.resolve(state.clock ?? BigInt(Math.floor(Date.now() / 1000)));
        },

        books()
        {
            reach();

            return Promise.resolve({ ...state.books });
        }
    };

    return {
        chain,
        placed,
        claimed,
        sent,
        state,
        receipts,
        claims,
        markets,
        positions,

        /** The contract takes a ticket as a mined `place` would: the first opens its market. */
        take(ticket: Ticket, as: Partial<PositionOnChain> = {})
        {
            positions.set(ticket.id, { bettor: ticket.bettor, outcome: ticket.outcome, amount: ticket.amount, claimed: false, ...as });

            const market = markets.get(ticket.market) ?? { ...NONE, state: 'open' as ChainState };

            markets.set(ticket.market, { ...market, pool: market.pool + ticket.amount, bettors: market.bettors + 1 });
        },

        /** The market as the operator's transaction, the owner or anybody left it. */
        resolve(market: Hex, to: ChainState, winner = 0, claimableAt = 0n)
        {
            markets.set(market, { ...(markets.get(market) ?? NONE), state: to, winner, claimableAt });
        }
    };
}

import {
    BaseError,
    TransactionNotFoundError,
    TransactionReceiptNotFoundError,
    createWalletClient,
    decodeErrorResult,
    defineChain,
    encodeFunctionData,
    getAddress,
    hashStruct,
    hashTypedData,
    isAddress,
    isAddressEqual,
    nonceManager,
    parseAbi,
    parseEventLogs,
    zeroAddress,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { booksOf, boundedClient, boundedTransport, reached, refusedByContract, unreached, type Books } from './rpc.ts';
import { gasFloorOf, vaultIdOf, type Mined } from './vault.ts';

/** `ArcadeMarkets` (`contracts/baziche/ArcadeMarkets.sol` in the SmartContract project), by hand, as the shop's ABI is. */
export const MARKETS_ABI = parseAbi([
    'struct Terms { bytes32 market; bytes32 game; uint8 outcomes; uint64 closesAt; uint16 feeBps; uint256 maxStake; uint256 maxPerBettor; uint256 maxPool; uint32 minBettors; uint8 minOutcomes; }',
    'struct Ticket { bytes32 id; bytes32 market; bytes32 terms; address bettor; uint8 outcome; uint256 amount; uint64 deadline; }',
    'struct Market { bytes32 terms; uint8 state; uint8 outcomes; uint8 winner; uint8 backedOutcomes; uint8 minOutcomes; uint16 feeBps; uint32 bettors; uint32 minBettors; uint64 closesAt; uint64 claimableAt; uint256 pool; uint256 left; uint256 backingLeft; }',
    'function place(Terms terms, Ticket ticket, bytes signature) payable',
    'function claim(bytes32[] tickets)',
    'function settle(bytes32 market, uint8 outcome)',
    'function cancel(bytes32 market)',
    'function marketOf(bytes32 market) view returns (Market)',
    'function positionOf(bytes32 ticket) view returns (bytes32 market, address bettor, uint8 outcome, uint256 amount, bool claimed)',
    'function payoutOf(bytes32 ticket) view returns (uint256)',
    'function termsHash(Terms terms) pure returns (bytes32)',
    'function ticketDigest(Ticket ticket) view returns (bytes32)',
    'function disputeWindow() view returns (uint64)',
    'function paused() view returns (bool)',
    'function owed() view returns (uint256)',
    'function fees() view returns (uint256)',
    'function solvent() view returns (bool)',
    'event Claimed(bytes32 indexed ticket, address indexed bettor, uint256 amount)',
    'error ZeroAddress()',
    'error ZeroAmount()',
    'error InvalidTerms(bytes32 market)',
    'error TermsMismatch(bytes32 market, bytes32 terms)',
    'error TicketUsed(bytes32 ticket)',
    'error NotBettor(bytes32 ticket, address bettor)',
    'error WrongAmount(bytes32 ticket, uint256 amount, uint256 sent)',
    'error TicketExpired(bytes32 ticket, uint64 deadline)',
    'error TicketTooLong(bytes32 ticket, uint64 deadline)',
    'error InvalidSignature(bytes32 ticket)',
    'error MarketClosed(bytes32 market)',
    'error OutcomeOutOfRange(bytes32 market, uint8 outcome)',
    'error StakeTooLarge(bytes32 ticket, uint256 amount, uint256 most)',
    'error BettorLimit(bytes32 ticket, uint256 staked, uint256 most)',
    'error PoolLimit(bytes32 market, uint256 pool, uint256 most)',
    'error UnknownMarket(bytes32 market)',
    'error MarketResolved(bytes32 market, uint8 state)',
    'error MarketOpen(bytes32 market)',
    'error TooEarly(bytes32 market, uint256 at)',
    'error NoTickets()',
    'error UnknownTicket(bytes32 ticket)',
    'error AlreadyClaimed(bytes32 ticket)',
    'error NothingOwed(bytes32 ticket)',
    'error NotYetClaimable(bytes32 market, uint64 claimableAt)',
    'error NotSettled(bytes32 market, uint8 state)',
    'error DisputeClosed(bytes32 market, uint64 claimableAt)',
    'error DisputeWindowTooLong(uint64 window)',
    'error InsufficientFees(uint256 available, uint256 required)',
    'error EnforcedPause()',
    'error ExpectedPause()',
    'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
    'error ReentrancyGuardReentrantCall()',
    'error FailedCall()',
    'error InsufficientBalance(uint256 balance, uint256 needed)'
]);

export const TERMS_FIELDS = [
    { name: 'market', type: 'bytes32' },
    { name: 'game', type: 'bytes32' },
    { name: 'outcomes', type: 'uint8' },
    { name: 'closesAt', type: 'uint64' },
    { name: 'feeBps', type: 'uint16' },
    { name: 'maxStake', type: 'uint256' },
    { name: 'maxPerBettor', type: 'uint256' },
    { name: 'maxPool', type: 'uint256' },
    { name: 'minBettors', type: 'uint32' },
    { name: 'minOutcomes', type: 'uint8' }
] as const;

export const TICKET_FIELDS = [
    { name: 'id', type: 'bytes32' },
    { name: 'market', type: 'bytes32' },
    { name: 'terms', type: 'bytes32' },
    { name: 'bettor', type: 'address' },
    { name: 'outcome', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint64' }
] as const;

/** The contract's `State`, by its index. */
export const CHAIN_STATES = ['none', 'open', 'settled', 'refunded', 'cancelled', 'expired'] as const;

export type ChainState = (typeof CHAIN_STATES)[number];

export interface Terms
{
    market: Hex;
    game: Hex;
    outcomes: number;
    closesAt: bigint;
    feeBps: number;
    maxStake: bigint;
    maxPerBettor: bigint;
    maxPool: bigint;
    minBettors: number;
    minOutcomes: number;
}

export interface Ticket
{
    id: Hex;
    market: Hex;
    terms: Hex;
    bettor: Address;
    outcome: number;
    amount: bigint;
    deadline: bigint;
}

/** One market as the contract holds it. */
export interface MarketOnChain
{
    state: ChainState;
    winner: number;
    claimableAt: bigint;
    pool: bigint;
    bettors: number;
}

/** One position as the contract holds it. `bettor` is null for a ticket nobody placed. */
export interface PositionOnChain
{
    bettor: Address | null;
    outcome: number;
    amount: bigint;
    claimed: boolean;
}

export interface MarketsCall
{
    to: Address;
    data: Hex;
    value: bigint;
    chainId: number;
    gasPrice: bigint | null;
}

/** A call the contract would take, composed for a wallet, or the word it would refuse it with. */
export type MarketsAsked = { ok: true; call: MarketsCall } | { ok: false; error: string };

/** A transaction this server sent with the operator's key, or the word the contract refused it with first. */
export type MarketsSent = { ok: true; hash: Hex } | { ok: false; error: string };

/**
 * What a bettor's claim paid each of its positions, once it is mined: none for one the chain refused.
 * `unknown` is a hash the node holds no transaction under, mined or waiting: one the wallet replaced
 * (sped up or cancelled), one it dropped, or one that was never sent.
 */
export type Claims = 'pending' | 'unknown' | 'reverted' | { ticket: Hex; amount: bigint }[];

export interface MarketsSettings
{
    rpcUrl: string;
    chainId: string;
    markets: string;
    operatorKey: string;
}

export interface MarketsChain
{
    readonly configured: boolean;
    readonly address: Address | null;
    readonly chainId: number;

    /** The address of the key this server signs tickets and settles markets with. */
    readonly operator: Address | null;

    sign(ticket: Ticket): Promise<Hex>;

    /** The bettor's `place`, asked of the contract from the bettor's address first, so a ticket it would refuse is said before a wallet is asked. */
    placeCall(terms: Terms, ticket: Ticket, signature: Hex): Promise<MarketsAsked>;
    claimCall(from: Address, tickets: readonly Hex[]): Promise<MarketsAsked>;
    settle(market: Hex, outcome: number): Promise<MarketsSent>;
    cancel(market: Hex): Promise<MarketsSent>;
    marketOf(market: Hex): Promise<MarketOnChain>;
    positionOf(ticket: Hex): Promise<PositionOnChain>;
    payoutOf(ticket: Hex): Promise<bigint>;
    mined(hash: Hex): Promise<Mined>;

    /** Read off the receipt of a bettor's `claim`, from this contract's own `Claimed` events. */
    claimsIn(hash: Hex): Promise<Claims>;

    /** The NURA a wallet holds, in wei. */
    balanceOf(address: Address): Promise<bigint>;

    /** The time of the chain's newest block, in seconds: the clock a dispute window runs out by. */
    clock(): Promise<bigint>;

    /** What the contract holds against every stake, share and refund it owes, and its fees. */
    books(): Promise<Books>;
}

/** A market's or a position's id on the chain: its uuid as 32 bytes, as an order's is. */
export const marketIdOf = vaultIdOf;

export function marketsDomain(chainId: number, markets: Address)
{
    return { name: 'ArcadeMarkets', version: '1', chainId, verifyingContract: markets } as const;
}

/** The hash a ticket names its market's terms by: their EIP-712 struct hash, as `termsHash` works it out. */
export function termsHashOf(terms: Terms)
{
    return hashStruct({ data: terms, primaryType: 'Terms', types: { Terms: TERMS_FIELDS } });
}

export function ticketDigestOf(chainId: number, markets: Address, ticket: Ticket)
{
    return hashTypedData({ domain: marketsDomain(chainId, markets), types: { Ticket: TICKET_FIELDS }, primaryType: 'Ticket', message: ticket });
}

/** The contract's word for refusing a call, by name, or null for something that was not a refusal. */
export function marketsRefusalOf(error: unknown)
{
    if (!(error instanceof BaseError))
    {
        return null;
    }

    const raw = error.walk((cause) =>
    {
        const data = (cause as { data?: unknown }).data;
        return typeof data === 'string' && /^0x[0-9a-fA-F]{8}/.test(data);
    }) as { data: Hex } | null;

    if (raw !== null)
    {
        try
        {
            return decodeErrorResult({ abi: MARKETS_ABI, data: raw.data }).errorName;
        }
        catch
        {
            return 'reverted';
        }
    }

    // A node asked to move more than the sender holds refuses before the contract is reached.
    if (/insufficient funds/i.test(error.message))
    {
        return 'InsufficientFunds';
    }

    return refusedByContract(error) ? 'reverted' : null;
}

export function createMarketsChain(settings: MarketsSettings): MarketsChain
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== ''
        && isAddress(settings.markets)
        && Number.isSafeInteger(chainId)
        && chainId > 0
        && /^0x[0-9a-fA-F]{64}$/.test(settings.operatorKey);
    const markets = configured ? getAddress(settings.markets) : null;

    // The vault's referee is this same key, and both send transactions with it: one nonce manager
    // keeps one count for the address, whichever of the two sends.
    const account = configured ? privateKeyToAccount(settings.operatorKey as Hex, { nonceManager }) : null;
    const floor = gasFloorOf(chainId);
    const chain = defineChain({
        id: configured ? chainId : 1,
        name: 'NuraChain',
        nativeCurrency: { name: 'Nura', symbol: 'NURA', decimals: 18 },
        rpcUrls: { default: { http: [configured ? settings.rpcUrl : 'http://127.0.0.1'] } }
    });

    const reader = () => boundedClient(settings.rpcUrl);

    const ready = () =>
    {
        if (markets === null || account === null)
        {
            throw new Error('Markets are not configured.');
        }

        return { markets, account };
    };

    const suggested = async () =>
    {
        try
        {
            return await reader().getGasPrice().then((live) => (live > floor ? live : floor));
        }
        catch (error)
        {
            if (unreached(error))
            {
                return floor;
            }

            throw error;
        }
    };

    const asked = async (from: Address, data: Hex, value = 0n): Promise<MarketsAsked> =>
    {
        const { markets: to } = ready();

        try
        {
            await reader().call({ account: from, to, data, value });
        }
        catch (error)
        {
            const refusal = marketsRefusalOf(error);

            if (refusal !== null)
            {
                return { ok: false, error: refusal };
            }

            return await reached(Promise.reject(error));
        }

        return { ok: true, call: { to, data, value, chainId, gasPrice: floor > 0n ? await suggested() : null } };
    };

    /** Sends nothing the contract would refuse: it is asked first, so a refusal costs no gas and comes back by name. */
    const send = async (data: Hex): Promise<MarketsSent> =>
    {
        const { markets: to, account: from } = ready();

        try
        {
            await reader().call({ account: from.address, to, data });
        }
        catch (error)
        {
            const refusal = marketsRefusalOf(error);

            if (refusal !== null)
            {
                return { ok: false, error: refusal };
            }

            return await reached(Promise.reject(error));
        }

        try
        {
            const wallet = createWalletClient({ account: from, chain, transport: boundedTransport(settings.rpcUrl) });
            const live = await reached(reader().getGasPrice());
            const hash = await wallet.sendTransaction({ to, data, gasPrice: live > floor ? live : floor });

            return { ok: true, hash };
        }
        catch (error)
        {
            nonceManager.reset({ address: from.address, chainId });
            return await reached(Promise.reject(error));
        }
    };

    const read = <T>(functionName: string, args: readonly unknown[] = []) =>
        reader().readContract({ address: ready().markets, abi: MARKETS_ABI, functionName, args } as never) as Promise<T>;

    /** Whether the node holds any transaction under this hash: asked once it has no receipt for it, so one still waiting. */
    const waiting = async (hash: Hex) =>
    {
        try
        {
            await reader().getTransaction({ hash });
            return true;
        }
        catch (error)
        {
            if (error instanceof BaseError && error.walk((cause) => cause instanceof TransactionNotFoundError) !== null)
            {
                return false;
            }

            return await reached(Promise.reject(error));
        }
    };

    return {
        configured,
        address: markets,
        chainId,
        operator: account?.address ?? null,

        sign: (ticket) => ready().account.signTypedData({
            domain: marketsDomain(chainId, ready().markets),
            types: { Ticket: TICKET_FIELDS },
            primaryType: 'Ticket',
            message: ticket
        }),

        placeCall: (terms, ticket, signature) =>
            asked(ticket.bettor, encodeFunctionData({ abi: MARKETS_ABI, functionName: 'place', args: [terms, ticket, signature] }), ticket.amount),

        claimCall: (from, tickets) => asked(from, encodeFunctionData({ abi: MARKETS_ABI, functionName: 'claim', args: [tickets] })),

        settle: (market, outcome) => send(encodeFunctionData({ abi: MARKETS_ABI, functionName: 'settle', args: [market, outcome] })),

        cancel: (market) => send(encodeFunctionData({ abi: MARKETS_ABI, functionName: 'cancel', args: [market] })),

        async marketOf(market)
        {
            const held = await reached(read<{ state: number; winner: number; claimableAt: bigint; pool: bigint; bettors: number }>('marketOf', [market]));

            return {
                state: CHAIN_STATES[held.state] ?? 'none',
                winner: held.winner,
                claimableAt: held.claimableAt,
                pool: held.pool,
                bettors: held.bettors
            };
        },

        async positionOf(ticket)
        {
            const [, bettor, outcome, amount, claimed] = await reached(read<readonly [Hex, Address, number, bigint, boolean]>('positionOf', [ticket]));

            return { bettor: bettor === zeroAddress ? null : getAddress(bettor), outcome, amount, claimed };
        },

        payoutOf: (ticket) => reached(read<bigint>('payoutOf', [ticket])),

        async mined(hash)
        {
            try
            {
                const receipt = await reader().getTransactionReceipt({ hash });
                return receipt.status === 'success' ? 'success' : 'reverted';
            }
            catch (error)
            {
                if (error instanceof BaseError && error.walk((cause) => cause instanceof TransactionReceiptNotFoundError) !== null)
                {
                    return 'pending';
                }

                return await reached(Promise.reject(error));
            }
        },

        async claimsIn(hash)
        {
            const { markets: at } = ready();
            let receipt;

            try
            {
                receipt = await reader().getTransactionReceipt({ hash });
            }
            catch (error)
            {
                if (error instanceof BaseError && error.walk((cause) => cause instanceof TransactionReceiptNotFoundError) !== null)
                {
                    return await waiting(hash) ? 'pending' : 'unknown';
                }

                return await reached(Promise.reject(error));
            }

            if (receipt.status !== 'success')
            {
                return 'reverted';
            }

            return parseEventLogs({ abi: MARKETS_ABI, eventName: 'Claimed', logs: receipt.logs })
                .filter((log) => isAddressEqual(log.address, at))
                .map((log) => ({ ticket: log.args.ticket, amount: log.args.amount }));
        },

        balanceOf: (address) => reached(reader().getBalance({ address })),

        clock: async () => (await reached(reader().getBlock())).timestamp,

        books: () => booksOf(settings.rpcUrl, ready().markets, MARKETS_ABI, ['owed', 'fees'])
    };
}

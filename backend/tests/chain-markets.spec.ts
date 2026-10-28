import {
    concat,
    decodeFunctionData,
    encodeAbiParameters,
    encodeErrorResult,
    encodeEventTopics,
    encodeFunctionResult,
    keccak256,
    parseTransaction,
    recoverAddress,
    toBytes,
    zeroAddress,
    type Address,
    type Hex
} from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import {
    createMarketsChain,
    MARKETS_ABI,
    marketIdOf,
    TERMS_FIELDS,
    termsHashOf,
    TICKET_FIELDS,
    ticketDigestOf,
    type MarketsAsked,
    type Terms,
    type Ticket
} from '../src/chain/markets.ts';
import { callOf, closeChains, fakeChain, silentChain, type Answer, type Rpc } from './fake-chain.ts';

const MARKETS: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const OTHER: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const OPERATOR_KEY: Hex = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';
const OPERATOR: Address = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';
const BETTOR: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;
const NURA = 10n ** 18n;

/** The contract's `TERMS_TYPEHASH` and `TICKET_TYPEHASH` strings, word for word. */
const TERMS_TYPE = 'Terms(bytes32 market,bytes32 game,uint8 outcomes,uint64 closesAt,uint16 feeBps,uint256 maxStake,uint256 maxPerBettor,uint256 maxPool,uint32 minBettors,uint8 minOutcomes)';
const TICKET_TYPE = 'Ticket(bytes32 id,bytes32 market,bytes32 terms,address bettor,uint8 outcome,uint256 amount,uint64 deadline)';

const MARKET = marketIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6');

const TERMS: Terms = {
    market: MARKET,
    game: marketIdOf('9b2c1a7e-0f3d-4c4e-8a5b-6d7e8f901234'),
    outcomes: 3,
    closesAt: 1_900_000_090n,
    feeBps: 0,
    maxStake: 500n * NURA,
    maxPerBettor: 1_000n * NURA,
    maxPool: 100_000n * NURA,
    minBettors: 2,
    minOutcomes: 2
};

const TICKET: Ticket = {
    id: marketIdOf('1c6f8e2a-4b3d-4e5f-9a8b-7c6d5e4f3a2b'),
    market: MARKET,
    terms: termsHashOf(TERMS),
    bettor: BETTOR,
    outcome: 2,
    amount: 25n * NURA,
    deadline: 1_900_000_060n
};

const marketsOn = (url: string, chainId = '31337') => createMarketsChain({ rpcUrl: url, chainId, markets: MARKETS, operatorKey: OPERATOR_KEY });

const reverted = (errorName: string, args: readonly unknown[] = []): Answer => ({
    error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: MARKETS_ABI, errorName, args } as never) }
});

const receipt = (status: '0x0' | '0x1', logs: unknown[] = []) => ({
    blockHash: HASH,
    blockNumber: '0x5',
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    from: BETTOR,
    gasUsed: '0x5208',
    logs,
    logsBloom: `0x${ '00'.repeat(256) }`,
    status,
    to: MARKETS,
    transactionHash: HASH,
    transactionIndex: '0x0',
    type: '0x0'
});

/** A transaction the node holds and has not mined. */
const waiting = {
    blockHash: null,
    blockNumber: null,
    from: BETTOR,
    gas: '0x30000',
    gasPrice: '0x3b9aca00',
    hash: HASH,
    input: '0x',
    nonce: '0x2',
    to: MARKETS,
    transactionIndex: null,
    value: '0x0',
    type: '0x0',
    chainId: '0x7a69',
    v: '0x1b',
    r: `0x${ '11'.repeat(32) }`,
    s: `0x${ '22'.repeat(32) }`
};

const claimedLog = (address: Address, ticket: Hex, amount: bigint, index: number) => ({
    address,
    topics: encodeEventTopics({ abi: MARKETS_ABI, eventName: 'Claimed', args: { ticket, bettor: BETTOR } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
    blockHash: HASH,
    blockNumber: '0x5',
    logIndex: `0x${ index.toString(16) }`,
    transactionHash: HASH,
    transactionIndex: '0x0',
    removed: false
});

afterEach(() => closeChains());

describe('what a ticket names', () =>
{
    it('names a market and a position by their uuid as 32 bytes', () =>
    {
        expect(MARKET).toBe(`0x${ '0'.repeat(32) }3fa85f6457174562b3fc2c963f66afa6`);
        expect(marketIdOf('3FA85F64-5717-4562-B3FC-2C963F66AFA6')).toBe(MARKET);
    });

    it('builds the contract\'s own two type strings from its fields', () =>
    {
        expect(`Terms(${ TERMS_FIELDS.map((field) => `${ field.type } ${ field.name }`).join(',') })`).toBe(TERMS_TYPE);
        expect(`Ticket(${ TICKET_FIELDS.map((field) => `${ field.type } ${ field.name }`).join(',') })`).toBe(TICKET_TYPE);
    });

    it('names the terms by the hash the contract works out, built by hand from its type string', () =>
    {
        const byHand = keccak256(encodeAbiParameters(
            [{ type: 'bytes32' }, ...TERMS_FIELDS.map((field) => ({ type: field.type }))],
            [keccak256(toBytes(TERMS_TYPE)), ...TERMS_FIELDS.map((field) => TERMS[field.name])]
        ));

        expect(termsHashOf(TERMS)).toBe(byHand);
        expect(termsHashOf({ ...TERMS, closesAt: TERMS.closesAt + 1n }), 'every term is in it').not.toBe(byHand);
    });

    it('is signed over the digest the contract checks, for this contract on this chain alone', () =>
    {
        const domain = keccak256(encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
            [keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(toBytes('ArcadeMarkets')), keccak256(toBytes('1')), 31337n, MARKETS]
        ));
        const struct = keccak256(encodeAbiParameters(
            [{ type: 'bytes32' }, ...TICKET_FIELDS.map((field) => ({ type: field.type }))],
            [keccak256(toBytes(TICKET_TYPE)), ...TICKET_FIELDS.map((field) => TICKET[field.name])]
        ));

        expect(ticketDigestOf(31337, MARKETS, TICKET)).toBe(keccak256(concat(['0x1901', domain, struct])));
        expect(ticketDigestOf(1020, MARKETS, TICKET)).not.toBe(ticketDigestOf(31337, MARKETS, TICKET));
        expect(ticketDigestOf(31337, OTHER, TICKET)).not.toBe(ticketDigestOf(31337, MARKETS, TICKET));
    });

    it('is signed with the operator\'s key, the same signature every time', async () =>
    {
        const markets = marketsOn('http://127.0.0.1:1');
        const signature = await markets.sign(TICKET);

        expect(markets.operator).toBe(OPERATOR);
        expect(await recoverAddress({ hash: ticketDigestOf(31337, MARKETS, TICKET), signature })).toBe(OPERATOR);
        expect(await markets.sign(TICKET)).toBe(signature);
    });
});

describe('a placement', () =>
{
    it('is asked of the contract from the bettor, carrying the stake, and handed to the wallet as that call', async () =>
    {
        const asked: { from?: string; value?: string }[] = [];
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            asked.push(rpc.params[0] as { from?: string; value?: string });
            return { result: '0x' };
        });
        const signature: Hex = `0x${ '11'.repeat(65) }`;
        const made = await marketsOn(url).placeCall(TERMS, TICKET, signature);

        expect(asked[0].from?.toLowerCase()).toBe(BETTOR.toLowerCase());
        expect(BigInt(asked[0].value ?? '0x0')).toBe(TICKET.amount);
        expect(made).toMatchObject({ ok: true, call: { to: MARKETS, value: TICKET.amount, chainId: 31337, gasPrice: null } });
        expect(decodeFunctionData({ abi: MARKETS_ABI, data: (made as Extract<MarketsAsked, { ok: true }>).call.data })).toEqual({ functionName: 'place', args: [TERMS, TICKET, signature] });
    });

    it('names what the contract would refuse, so a wallet is never asked to send it', async () =>
    {
        const cases = [
            ['TicketExpired', [TICKET.id, TICKET.deadline]],
            ['MarketClosed', [MARKET]],
            ['BettorLimit', [TICKET.id, 1n, 2n]],
            ['PoolLimit', [MARKET, 1n, 2n]],
            ['InvalidSignature', [TICKET.id]],
            ['EnforcedPause', []]
        ] as const;

        for (const [errorName, args] of cases)
        {
            const { url } = await fakeChain(() => reverted(errorName, args));

            await expect(marketsOn(url).placeCall(TERMS, TICKET, '0x'), errorName).resolves.toEqual({ ok: false, error: errorName });
        }
    });

    it('says a bettor is short of NURA when the node will not move what they do not hold', async () =>
    {
        const { url } = await fakeChain(() => ({ error: { code: -32000, message: 'insufficient funds for transfer' } }));

        await expect(marketsOn(url).placeCall(TERMS, TICKET, '0x')).resolves.toEqual({ ok: false, error: 'InsufficientFunds' });
    });

    it('throws when the chain cannot be reached, so nothing is handed out', async () =>
    {
        const url = await silentChain();

        await expect(marketsOn(url).placeCall(TERMS, TICKET, '0x')).rejects.toMatchObject({ status: 503 });
    }, 15_000);
});

describe('a claim', () =>
{
    it('is asked from the bettor with nothing sent, for every ticket named', async () =>
    {
        const asked: { from?: string; value?: string }[] = [];
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            asked.push(rpc.params[0] as { from?: string; value?: string });
            return { result: '0x' };
        });
        const made = await marketsOn(url).claimCall(BETTOR, [TICKET.id, MARKET]);

        expect(asked[0].from?.toLowerCase()).toBe(BETTOR.toLowerCase());
        expect(BigInt(asked[0].value ?? '0x0')).toBe(0n);
        expect(decodeFunctionData({ abi: MARKETS_ABI, data: (made as Extract<MarketsAsked, { ok: true }>).call.data })).toEqual({ functionName: 'claim', args: [[TICKET.id, MARKET]] });

        const { url: refusing } = await fakeChain(() => reverted('NotYetClaimable', [MARKET, 1n]));

        await expect(marketsOn(refusing).claimCall(BETTOR, [TICKET.id])).resolves.toEqual({ ok: false, error: 'NotYetClaimable' });
    });

    it('is read off its receipt: what each of this contract\'s tickets was paid, and nothing another contract said', async () =>
    {
        let answer: unknown = null;
        let held: unknown = null;
        const { url } = await fakeChain((rpc: Rpc) => ({ result: rpc.method === 'eth_getTransactionByHash' ? held : answer }));
        const markets = marketsOn(url);

        await expect(markets.claimsIn(HASH), 'a hash the node holds nothing under: replaced, dropped or never sent').resolves.toBe('unknown');

        held = waiting;
        await expect(markets.claimsIn(HASH), 'one the node holds and has not mined').resolves.toBe('pending');

        answer = receipt('0x0');
        await expect(markets.claimsIn(HASH)).resolves.toBe('reverted');

        answer = receipt('0x1', [claimedLog(MARKETS, TICKET.id, 40n * NURA, 0), claimedLog(OTHER, MARKET, 9n, 1)]);
        await expect(markets.claimsIn(HASH)).resolves.toEqual([{ ticket: TICKET.id, amount: 40n * NURA }]);
    });
});

describe('settling and calling off', () =>
{
    const sending = async (refuse: Answer | null) =>
    {
        const asked: string[] = [];
        let raw: Hex | null = null;
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            asked.push(rpc.method);

            switch (rpc.method)
            {
                case 'eth_call': return refuse ?? { result: '0x' };
                case 'eth_chainId': return { result: '0x7a69' };
                case 'eth_gasPrice': return { result: '0x3b9aca00' };
                case 'eth_getTransactionCount': return { result: '0x2' };
                case 'eth_estimateGas': return { result: '0x30000' };
                case 'eth_sendRawTransaction':
                    raw = rpc.params[0] as Hex;
                    return { result: HASH };
                default: return { error: { code: -32601, message: `no ${ rpc.method }` } };
            }
        });

        return { markets: marketsOn(url), asked, raw: () => raw };
    };

    it('asks the contract first from the operator, then sends it and answers its hash', async () =>
    {
        const { markets, raw } = await sending(null);

        await expect(markets.settle(MARKET, 1)).resolves.toEqual({ ok: true, hash: HASH });

        const sent = parseTransaction(raw()!);

        expect(sent.to).toBe(MARKETS.toLowerCase());
        expect(decodeFunctionData({ abi: MARKETS_ABI, data: sent.data! })).toEqual({ functionName: 'settle', args: [MARKET, 1] });
    });

    it('sends nothing the contract would refuse, and answers its word', async () =>
    {
        const { markets, asked } = await sending(reverted('MarketOpen', [MARKET]));

        await expect(markets.cancel(MARKET)).resolves.toEqual({ ok: false, error: 'MarketOpen' });
        expect(asked).toEqual(['eth_call']);
    });
});

describe('what the contract holds', () =>
{
    it('reads a market by its state\'s name, its winner, when it may be claimed from, its pool and its bettors', async () =>
    {
        let held = { terms: HASH, state: 0, outcomes: 0, winner: 0, backedOutcomes: 0, minOutcomes: 0, feeBps: 0, bettors: 0, minBettors: 0, closesAt: 0n, claimableAt: 0n, pool: 0n, left: 0n, backingLeft: 0n };
        const { url } = await fakeChain((rpc): Answer =>
        {
            expect(decodeFunctionData({ abi: MARKETS_ABI, data: callOf(rpc).data as Hex })).toEqual({ functionName: 'marketOf', args: [MARKET] });

            return { result: encodeFunctionResult({ abi: MARKETS_ABI, functionName: 'marketOf', result: held }) };
        });
        const markets = marketsOn(url);

        await expect(markets.marketOf(MARKET)).resolves.toEqual({ state: 'none', winner: 0, claimableAt: 0n, pool: 0n, bettors: 0 });

        held = { ...held, state: 2, outcomes: 3, winner: 2, bettors: 4, claimableAt: 1_900_001_000n, pool: 90n * NURA };
        await expect(markets.marketOf(MARKET)).resolves.toEqual({ state: 'settled', winner: 2, claimableAt: 1_900_001_000n, pool: 90n * NURA, bettors: 4 });

        for (const [index, state] of [[1, 'open'], [3, 'refunded'], [4, 'cancelled'], [5, 'expired']] as const)
        {
            held = { ...held, state: index };
            await expect(markets.marketOf(MARKET), state).resolves.toMatchObject({ state });
        }
    });

    it('reads a ticket nobody placed as nobody\'s, and one placed as its bettor\'s', async () =>
    {
        let held: readonly [Hex, Address, number, bigint, boolean] = [`0x${ '00'.repeat(32) }`, zeroAddress, 0, 0n, false];
        const { url } = await fakeChain((): Answer => ({ result: encodeFunctionResult({ abi: MARKETS_ABI, functionName: 'positionOf', result: held }) }));
        const markets = marketsOn(url);

        await expect(markets.positionOf(TICKET.id)).resolves.toEqual({ bettor: null, outcome: 0, amount: 0n, claimed: false });

        held = [MARKET, BETTOR.toLowerCase() as Address, 2, 25n * NURA, true];
        await expect(markets.positionOf(TICKET.id)).resolves.toEqual({ bettor: BETTOR, outcome: 2, amount: 25n * NURA, claimed: true });
    });

    it('reads the time of the chain\'s newest block', async () =>
    {
        const { url } = await fakeChain((rpc): Answer => (rpc.method === 'eth_getBlockByNumber'
            ? { result: { number: '0x5', timestamp: '0x7148ba00', hash: HASH, parentHash: HASH, transactions: [], gasLimit: '0x1', gasUsed: '0x0', logsBloom: `0x${ '00'.repeat(256) }`, miner: zeroAddress, extraData: '0x', difficulty: '0x0', size: '0x1', stateRoot: HASH, receiptsRoot: HASH, transactionsRoot: HASH, sha3Uncles: HASH, uncles: [], nonce: '0x0000000000000000', mixHash: HASH, baseFeePerGas: '0x0' } }
            : { error: { code: -32601, message: `no ${ rpc.method }` } }));

        await expect(marketsOn(url).clock()).resolves.toBe(0x7148ba00n);
    });
});

describe('markets that are configured', () =>
{
    it('need an rpc, a contract, a chain and an operator key of the right shape', () =>
    {
        const settings = { rpcUrl: 'http://127.0.0.1:1', chainId: '31337', markets: MARKETS, operatorKey: OPERATOR_KEY };

        expect(createMarketsChain(settings)).toMatchObject({ configured: true, address: MARKETS, operator: OPERATOR });
        expect(createMarketsChain({ ...settings, rpcUrl: '' }).configured).toBe(false);
        expect(createMarketsChain({ ...settings, markets: '' }).configured).toBe(false);
        expect(createMarketsChain({ ...settings, markets: '0x1234' }).configured).toBe(false);
        expect(createMarketsChain({ ...settings, chainId: 'nura' }).configured).toBe(false);
        expect(createMarketsChain({ ...settings, operatorKey: '' }).configured).toBe(false);
        expect(createMarketsChain({ ...settings, operatorKey: '0x1234' }).operator).toBeNull();
    });
});

import {
    concat,
    decodeFunctionData,
    encodeAbiParameters,
    encodeErrorResult,
    encodeFunctionResult,
    keccak256,
    recoverTypedDataAddress,
    stringToHex,
    zeroAddress,
    type Address,
    type Hex
} from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import {
    createShopChain,
    itemOf,
    orderIdOf,
    OWNER_ROLE,
    PAUSER_ROLE,
    QUOTE_FIELDS,
    quoteDigest,
    quoteDomain,
    SELLER_ROLE,
    SHOP_ABI,
    type Quote,
    type ShopAsked
} from '../src/chain/shop.ts';
import { NURA_GAS_FLOOR } from '../src/chain/vault.ts';
import { callOf, closeChains, fakeChain, silentChain, type Answer, type Rpc } from './fake-chain.ts';

const SHOP: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const SELLER_KEY: Hex = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';
const SELLER: Address = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';
const BUYER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const INVITER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OWNER: Address = '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f';
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;
const PRICE = 12n * 10n ** 18n;

/** The contract's `QUOTE_TYPEHASH` string, word for word. */
const QUOTE_TYPE = 'Quote(bytes32 order,address buyer,bytes32 item,uint256 price,address referrer,uint64 deadline)';

const quoteOf = (overrides: Partial<Quote> = {}): Quote => ({
    order: orderIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6'),
    buyer: BUYER,
    item: itemOf('dice.shiraz'),
    price: PRICE,
    referrer: zeroAddress,
    deadline: 1_900_000_000n,
    ...overrides
});

const shopOn = (url: string, chainId = '31337') => createShopChain({ rpcUrl: url, chainId, shop: SHOP, sellerKey: SELLER_KEY });

const receipt = (status: '0x0' | '0x1') => ({
    blockHash: HASH,
    blockNumber: '0x5',
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    from: BUYER,
    gasUsed: '0x5208',
    logs: [],
    logsBloom: `0x${ '00'.repeat(256) }`,
    status,
    to: SHOP,
    transactionHash: HASH,
    transactionIndex: '0x0',
    type: '0x0'
});

const reverted = (errorName: string, args: readonly unknown[]): Answer => ({
    error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: SHOP_ABI, errorName, args } as never) }
});

afterEach(() => closeChains());

describe('a quote', () =>
{
    it('names an order by its row and what is bought by the look\'s id', () =>
    {
        expect(orderIdOf('3FA85F64-5717-4562-B3FC-2C963F66AFA6')).toBe(`0x${ '0'.repeat(32) }3fa85f6457174562b3fc2c963f66afa6`);
        expect(itemOf('dice.shiraz')).toBe(keccak256(stringToHex('dice.shiraz')));
        expect(itemOf('bundle.glow')).not.toBe(itemOf('dice.glow'));
    });

    it('is the digest the contract checks, built by hand from the contract\'s own type string', () =>
    {
        const quote = quoteOf({ referrer: INVITER });
        const domain = keccak256(encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
            [
                keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
                keccak256(stringToHex('ArcadeShop')),
                keccak256(stringToHex('1')),
                1020n,
                SHOP
            ]
        ));
        const struct = keccak256(encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint64' }],
            [keccak256(stringToHex(QUOTE_TYPE)), quote.order, quote.buyer, quote.item, quote.price, quote.referrer, quote.deadline]
        ));

        expect(`Quote(${ QUOTE_FIELDS.map((field) => `${ field.type } ${ field.name }`).join(',') })`).toBe(QUOTE_TYPE);
        expect(quoteDigest(1020, SHOP, quote)).toBe(keccak256(concat(['0x1901', domain, struct])));
        expect(quoteDigest(31337, SHOP, quote), 'a quote for one chain was good on another').not.toBe(quoteDigest(1020, SHOP, quote));
        expect(quoteDigest(1020, OWNER, quote), 'a quote for one shop was good at another').not.toBe(quoteDigest(1020, SHOP, quote));
    });

    it('is signed with the server\'s key, the same signature every time it is asked again', async () =>
    {
        const shop = shopOn('http://127.0.0.1:1');
        const quote = quoteOf();
        const signature = await shop.sign(quote);

        expect(shop.seller).toBe(SELLER);
        expect(await recoverTypedDataAddress({ domain: quoteDomain(31337, SHOP), types: { Quote: QUOTE_FIELDS }, primaryType: 'Quote', message: quote, signature })).toBe(SELLER);
        expect(await shop.sign(quote), 'the same order was signed two ways').toBe(signature);
        expect(await shop.sign(quoteOf({ price: PRICE - 1n }))).not.toBe(signature);
    });
});

describe('a purchase', () =>
{
    it('is asked of the shop from the buyer, carrying the price, and handed to the wallet as that call', async () =>
    {
        const asked: { from?: string; value?: string; data: Hex }[] = [];
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            asked.push(rpc.params[0] as { from?: string; value?: string; data: Hex });
            return { result: '0x' };
        });
        const shop = shopOn(url);
        const quote = quoteOf();
        const signature = await shop.sign(quote);
        const bought = await shop.buyCall(quote, signature);

        expect(asked).toHaveLength(1);
        expect(asked[0].from?.toLowerCase()).toBe(BUYER.toLowerCase());
        expect(BigInt(asked[0].value ?? '0x0')).toBe(PRICE);
        expect(bought).toMatchObject({ ok: true, call: { to: SHOP, value: PRICE, chainId: 31337, gasPrice: null } });
        expect(decodeFunctionData({ abi: SHOP_ABI, data: (bought as Extract<ShopAsked, { ok: true }>).call.data })).toEqual({ functionName: 'buy', args: [quote, signature] });
    });

    it('names what the shop would refuse, so a wallet is never asked to send it', async () =>
    {
        const { url } = await fakeChain(() => reverted('QuoteExpired', [quoteOf().order, 1_900_000_000n]));

        await expect(shopOn(url).buyCall(quoteOf(), `0x${ '33'.repeat(65) }`)).resolves.toEqual({ ok: false, refusal: { error: 'QuoteExpired' } });
    });

    it('says when a sale is stopped', async () =>
    {
        const { url } = await fakeChain(() => ({ error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: SHOP_ABI, errorName: 'EnforcedPause' }) } }));

        await expect(shopOn(url).buyCall(quoteOf(), `0x${ '33'.repeat(65) }`)).resolves.toEqual({ ok: false, refusal: { error: 'EnforcedPause' } });
    });

    it('says a buyer is short of NURA when the node will not move what they do not hold', async () =>
    {
        const { url } = await fakeChain(() => ({ error: { code: -32000, message: 'insufficient funds for transfer' } }));

        await expect(shopOn(url).buyCall(quoteOf(), `0x${ '33'.repeat(65) }`)).resolves.toEqual({ ok: false, refusal: { error: 'InsufficientFunds' } });
    });

    it('suggests NuraChain\'s floor to the wallet there', async () =>
    {
        const { url } = await fakeChain((rpc): Answer => (rpc.method === 'eth_gasPrice' ? { result: '0x0' } : { result: '0x' }));

        await expect(shopOn(url, '1020').buyCall(quoteOf(), `0x${ '33'.repeat(65) }`)).resolves.toMatchObject({ ok: true, call: { chainId: 1020, gasPrice: NURA_GAS_FLOOR } });
    });

    it('throws when the chain cannot be reached, so nothing is handed out', async () =>
    {
        const url = await silentChain();

        await expect(shopOn(url).buyCall(quoteOf(), `0x${ '33'.repeat(65) }`)).rejects.toMatchObject({ status: 503 });
    }, 15_000);
});

describe('a sale', () =>
{
    it('reads an order back as sold, to whom, when, with its inviter and their cut', async () =>
    {
        const order = quoteOf().order;
        const { url } = await fakeChain((rpc): Answer =>
        {
            expect(decodeFunctionData({ abi: SHOP_ABI, data: callOf(rpc).data as Hex })).toEqual({ functionName: 'saleOf', args: [order] });

            return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'saleOf', result: [BUYER.toLowerCase() as Address, 1_800_000_000n, false, INVITER, PRICE, PRICE / 10n] }) };
        });

        await expect(shopOn(url).saleOf(order)).resolves.toEqual({ buyer: BUYER, paidAt: 1_800_000_000n, refunded: false, referrer: INVITER, price: PRICE, cut: PRICE / 10n });
    });

    it('reads an order nobody paid as nobody\'s, and one given back as refunded', async () =>
    {
        let sale: readonly [Address, bigint, boolean, Address, bigint, bigint] = [zeroAddress, 0n, false, zeroAddress, 0n, 0n];
        const { url } = await fakeChain(() => ({ result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'saleOf', result: sale }) }));
        const shop = shopOn(url);

        await expect(shop.saleOf(quoteOf().order)).resolves.toEqual({ buyer: null, paidAt: 0n, refunded: false, referrer: null, price: 0n, cut: 0n });

        sale = [BUYER, 1_800_000_000n, true, zeroAddress, PRICE, 0n];

        await expect(shop.saleOf(quoteOf().order)).resolves.toMatchObject({ buyer: BUYER, refunded: true, referrer: null });
    });

    it('reads a transaction as waiting, paid or refused', async () =>
    {
        let answer: unknown = null;
        const { url } = await fakeChain(() => ({ result: answer }));
        const shop = shopOn(url);

        await expect(shop.mined(HASH)).resolves.toBe('pending');
        answer = receipt('0x1');
        await expect(shop.mined(HASH)).resolves.toBe('success');
        answer = receipt('0x0');
        await expect(shop.mined(HASH)).resolves.toBe('reverted');
    });
});

describe('what a buyer holds and an inviter is owed', () =>
{
    it('reads the NURA in a wallet and what the shop owes an inviter, and asks the shop for a claim from the inviter', async () =>
    {
        const asked: { method: string; from?: string }[] = [];
        const { url } = await fakeChain((rpc): Answer =>
        {
            if (rpc.method === 'eth_getBalance')
            {
                asked.push({ method: 'balance', from: String(rpc.params[0]) });
                return { result: '0x2a' };
            }

            const call = rpc.params[0] as { from?: string; data: Hex };
            const called = decodeFunctionData({ abi: SHOP_ABI, data: call.data });

            asked.push({ method: called.functionName, from: call.from });

            switch (called.functionName)
            {
                case 'earnings':
                    expect(called.args).toEqual([INVITER]);
                    return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'earnings', result: 7n }) };
                case 'referralBps': return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'referralBps', result: 1500 }) };
                case 'claim': return reverted('NothingToClaim', []);
                default: return { error: { code: -32601, message: `no ${ called.functionName }` } };
            }
        });
        const shop = shopOn(url);

        await expect(shop.balanceOf(BUYER)).resolves.toBe(42n);
        await expect(shop.earnedBy(INVITER)).resolves.toEqual({ earnings: 7n, referralBps: 1500 });
        await expect(shop.claimCall(INVITER)).resolves.toEqual({ ok: false, refusal: { error: 'NothingToClaim' } });
        expect(asked.find((one) => one.method === 'balance')?.from?.toLowerCase()).toBe(BUYER.toLowerCase());
        expect(asked.find((one) => one.method === 'claim')?.from?.toLowerCase()).toBe(INVITER.toLowerCase());
    });

    it('hands the inviter\'s wallet the claim the shop would take', async () =>
    {
        const { url } = await fakeChain(() => ({ result: '0x' }));
        const claimed = await shopOn(url).claimCall(INVITER);

        expect(claimed).toMatchObject({ ok: true, call: { to: SHOP, value: 0n } });
        expect(decodeFunctionData({ abi: SHOP_ABI, data: (claimed as Extract<ShopAsked, { ok: true }>).call.data })).toEqual({ functionName: 'claim' });
    });
});

describe('the owner\'s view of the shop', () =>
{
    it('names the roles as the contract does', () =>
    {
        expect(SELLER_ROLE).toBe(keccak256(stringToHex('SELLER_ROLE')));
        expect(PAUSER_ROLE).toBe('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a');
        expect(OWNER_ROLE).toBe(`0x${ '00'.repeat(32) }`);
    });

    it('reads what the shop holds, what inviters are owed and the roles the owner and the server hold', async () =>
    {
        const { url } = await fakeChain((rpc): Answer =>
        {
            if (rpc.method === 'eth_getBalance')
            {
                return { result: '0x64' };
            }

            const called = decodeFunctionData({ abi: SHOP_ABI, data: callOf(rpc).data as Hex });

            switch (called.functionName)
            {
                case 'revenue': return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'revenue', result: 70n }) };
                case 'totalEarnings': return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'totalEarnings', result: 30n }) };
                case 'solvent': return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'solvent', result: true }) };
                case 'referralBps': return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'referralBps', result: 1000 }) };
                case 'paused': return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'paused', result: false }) };
                case 'seller': return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'seller', result: SELLER.toLowerCase() as Address }) };
                case 'hasRole':
                {
                    const [role, holder] = called.args;
                    const owner = holder.toLowerCase() === OWNER.toLowerCase();

                    return { result: encodeFunctionResult({ abi: SHOP_ABI, functionName: 'hasRole', result: owner ? role === OWNER_ROLE : role === SELLER_ROLE }) };
                }
                default: return { error: { code: -32601, message: `no ${ called.functionName }` } };
            }
        });

        await expect(shopOn(url).ledger(OWNER)).resolves.toEqual({
            revenue: 70n,
            owed: 30n,
            held: 100n,
            solvent: true,
            referralBps: 1000,
            paused: false,
            chainSeller: SELLER,
            sellerAllowed: true,
            ownerAllowed: true,
            pauserAllowed: false
        });
    });

    it('asks the shop as the owner before it hands the owner\'s wallet a call, and names what the shop would refuse', async () =>
    {
        const seen: { from?: string; value?: string; data: Hex }[] = [];
        const { url } = await fakeChain((rpc): Answer =>
        {
            const call = rpc.params[0] as { from?: string; value?: string; data: Hex };
            seen.push(call);

            switch (decodeFunctionData({ abi: SHOP_ABI, data: call.data }).functionName)
            {
                case 'withdraw': return reverted('InsufficientRevenue', [1n, 2n]);
                case 'refund': return { error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: SHOP_ABI, errorName: 'FailedCall' }) } };
                default: return { result: '0x' };
            }
        });
        const shop = shopOn(url);
        const order = quoteOf().order;
        const decoded = (asked: ShopAsked) => (asked.ok ? decodeFunctionData({ abi: SHOP_ABI, data: asked.call.data }) : asked.refusal);

        expect(await shop.withdrawCall(OWNER, OWNER, 2n)).toEqual({ ok: false, refusal: { error: 'InsufficientRevenue' } });
        expect(await shop.refundCall(OWNER, order)).toEqual({ ok: false, refusal: { error: 'FailedCall' } });
        expect(decoded(await shop.fundCall(OWNER, 5n))).toEqual({ functionName: 'fund' });
        expect(decoded(await shop.sellerCall(OWNER, SELLER))).toEqual({ functionName: 'setSeller', args: [SELLER] });
        expect(decoded(await shop.shareCall(OWNER, 1500))).toEqual({ functionName: 'setReferralBps', args: [1500] });
        expect(decoded(await shop.pauseCall(OWNER, true))).toEqual({ functionName: 'pause' });
        expect(decoded(await shop.pauseCall(OWNER, false))).toEqual({ functionName: 'unpause' });
        expect(decodeFunctionData({ abi: SHOP_ABI, data: seen[0].data })).toEqual({ functionName: 'withdraw', args: [OWNER, 2n] });
        expect(decodeFunctionData({ abi: SHOP_ABI, data: seen[1].data })).toEqual({ functionName: 'refund', args: [order] });
        expect(seen.map((call) => call.from?.toLowerCase())).toEqual(Array(7).fill(OWNER.toLowerCase()));
        expect(BigInt(seen[2].value ?? '0x0'), 'funding the shop carried nothing').toBe(5n);
        await expect(shop.fundCall(OWNER, 5n)).resolves.toMatchObject({ ok: true, call: { to: SHOP, value: 5n, chainId: 31337, gasPrice: null } });
    });
});

describe('a shop that is configured', () =>
{
    it('needs an rpc, a shop, a chain and a seller key of the right shape', () =>
    {
        const settings = { rpcUrl: 'http://127.0.0.1:1', chainId: '31337', shop: SHOP, sellerKey: SELLER_KEY };

        expect(createShopChain(settings).configured).toBe(true);
        expect(createShopChain(settings).address).toBe(SHOP);
        expect(createShopChain({ ...settings, rpcUrl: '' }).configured).toBe(false);
        expect(createShopChain({ ...settings, shop: '' }).configured).toBe(false);
        expect(createShopChain({ ...settings, shop: '0x1234' }).configured).toBe(false);
        expect(createShopChain({ ...settings, chainId: '' }).configured).toBe(false);
        expect(createShopChain({ ...settings, chainId: 'nura' }).configured).toBe(false);
        expect(createShopChain({ ...settings, sellerKey: '' }).configured).toBe(false);
        expect(createShopChain({ ...settings, sellerKey: SELLER_KEY.slice(0, 40) }).configured).toBe(false);
        expect(createShopChain({ ...settings, sellerKey: '' }).seller).toBeNull();
        expect(createShopChain({ ...settings, shop: '' }).address).toBeNull();
    });
});

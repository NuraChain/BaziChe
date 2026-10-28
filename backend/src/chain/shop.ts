import {
    BaseError,
    TransactionReceiptNotFoundError,
    decodeErrorResult,
    encodeFunctionData,
    getAddress,
    hashTypedData,
    isAddress,
    keccak256,
    parseAbi,
    stringToHex,
    zeroAddress,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { booksOf, boundedClient, reached, refusedByContract, unreached, type Books } from './rpc.ts';
import { gasFloorOf, vaultIdOf, type Mined } from './vault.ts';

/** `ArcadeShop` (`contracts/baziche/ArcadeShop.sol` in the SmartContract project), by hand, as the vault's ABI is. */
export const SHOP_ABI = parseAbi([
    'struct Quote { bytes32 order; address buyer; bytes32 item; uint256 price; address referrer; uint64 deadline; }',
    'function buy(Quote quote, bytes signature) payable',
    'function claim()',
    'function refund(bytes32 order)',
    'function withdraw(address to, uint256 amount)',
    'function fund() payable',
    'function setSeller(address newSeller)',
    'function setReferralBps(uint16 newBps)',
    'function pause()',
    'function unpause()',
    'function saleOf(bytes32 order) view returns (address buyer, uint64 paidAt, bool refunded, address referrer, uint256 price, uint256 cut)',
    'function quoteDigest(Quote quote) view returns (bytes32)',
    'function revenue() view returns (uint256)',
    'function totalEarnings() view returns (uint256)',
    'function earnings(address referrer) view returns (uint256)',
    'function referralBps() view returns (uint16)',
    'function seller() view returns (address)',
    'function paused() view returns (bool)',
    'function solvent() view returns (bool)',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'error ZeroAddress()',
    'error ZeroAmount()',
    'error ReferralBpsOutOfRange(uint16 bps)',
    'error OrderSold(bytes32 order)',
    'error NotBuyer(bytes32 order, address buyer)',
    'error WrongPrice(bytes32 order, uint256 price, uint256 sent)',
    'error QuoteExpired(bytes32 order, uint64 deadline)',
    'error QuoteTooLong(bytes32 order, uint64 deadline)',
    'error InvalidSignature(bytes32 order)',
    'error NotSold(bytes32 order)',
    'error AlreadyRefunded(bytes32 order)',
    'error InsufficientRevenue(uint256 available, uint256 required)',
    'error NothingToClaim()',
    'error EnforcedPause()',
    'error ExpectedPause()',
    'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
    'error FailedCall()',
    'error InsufficientBalance(uint256 balance, uint256 needed)'
]);

export const QUOTE_FIELDS = [
    { name: 'order', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'item', type: 'bytes32' },
    { name: 'price', type: 'uint256' },
    { name: 'referrer', type: 'address' },
    { name: 'deadline', type: 'uint64' }
] as const;

/** `keccak256("SELLER_ROLE")`, as the contract names it. */
export const SELLER_ROLE = keccak256(stringToHex('SELLER_ROLE'));

/** `keccak256("PAUSER_ROLE")`. */
export const PAUSER_ROLE = keccak256(stringToHex('PAUSER_ROLE'));

/** The owner's role: AccessControl's `DEFAULT_ADMIN_ROLE`, all zeroes. */
export const OWNER_ROLE: Hex = `0x${ '0'.repeat(64) }`;

export interface Quote
{
    order: Hex;
    buyer: Address;
    item: Hex;
    price: bigint;
    referrer: Address;
    deadline: bigint;
}

/** One order's sale as the contract holds it. `buyer` is null for an order nobody has paid. */
export interface Sale
{
    buyer: Address | null;
    paidAt: bigint;
    refunded: boolean;
    referrer: Address | null;
    price: bigint;
    cut: bigint;
}

export interface ShopCall
{
    to: Address;
    data: Hex;
    value: bigint;
    chainId: number;
    gasPrice: bigint | null;
}

/** What the contract said no with: one of its errors, by name. */
export interface ShopRefusalOnChain
{
    error: string;
}

export type ShopAsked = { ok: true; call: ShopCall } | { ok: false; refusal: ShopRefusalOnChain };

export interface ShopLedger
{
    revenue: bigint;
    owed: bigint;
    held: bigint;
    solvent: boolean;
    referralBps: number;
    paused: boolean;
    chainSeller: Address;

    /** Whether the key this server signs quotes with holds SELLER_ROLE now. */
    sellerAllowed: boolean;
    ownerAllowed: boolean;
    pauserAllowed: boolean;
}

/** What an inviter can claim from the shop now, and the share of a sale an inviter is credited. */
export interface ShopEarned
{
    earnings: bigint;
    referralBps: number;
}

export interface ShopSettings
{
    rpcUrl: string;
    chainId: string;
    shop: string;
    sellerKey: string;
}

export interface ShopChain
{
    readonly configured: boolean;
    readonly address: Address | null;
    readonly chainId: number;

    /** The address of the key this server signs quotes with. */
    readonly seller: Address | null;
    sign(quote: Quote): Promise<Hex>;

    /** The buyer's `buy`, asked of the contract from the buyer's address first, so a quote it would refuse is said before a wallet is asked. */
    buyCall(quote: Quote, signature: Hex): Promise<ShopAsked>;
    saleOf(order: Hex): Promise<Sale>;
    mined(hash: Hex): Promise<Mined>;

    /** The NURA a wallet holds, in wei. */
    balanceOf(address: Address): Promise<bigint>;
    earnedBy(address: Address): Promise<ShopEarned>;
    claimCall(address: Address): Promise<ShopAsked>;

    /** What the shop holds against its revenue and every inviter's unclaimed credit. */
    books(): Promise<Books>;
    ledger(owner: Address): Promise<ShopLedger>;
    withdrawCall(owner: Address, to: Address, amount: bigint): Promise<ShopAsked>;
    fundCall(owner: Address, amount: bigint): Promise<ShopAsked>;
    refundCall(owner: Address, order: Hex): Promise<ShopAsked>;
    sellerCall(owner: Address, next: Address): Promise<ShopAsked>;
    shareCall(owner: Address, bps: number): Promise<ShopAsked>;
    pauseCall(owner: Address, paused: boolean): Promise<ShopAsked>;
}

/** An order's id on the chain: the order's uuid as 32 bytes, as a paid game's is. */
export const orderIdOf = vaultIdOf;

/** What the quote names as bought: the hash of the look's or the bundle's id. */
export function itemOf(id: string)
{
    return keccak256(stringToHex(id));
}

export function quoteDomain(chainId: number, shop: Address)
{
    return { name: 'ArcadeShop', version: '1', chainId, verifyingContract: shop } as const;
}

export function quoteDigest(chainId: number, shop: Address, quote: Quote)
{
    return hashTypedData({ domain: quoteDomain(chainId, shop), types: { Quote: QUOTE_FIELDS }, primaryType: 'Quote', message: quote });
}

export function shopRefusalOf(error: unknown): ShopRefusalOnChain | null
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
            return { error: decodeErrorResult({ abi: SHOP_ABI, data: raw.data }).errorName };
        }
        catch
        {
            return { error: 'reverted' };
        }
    }

    // A node asked to move more than the sender holds refuses before the contract is reached.
    if (/insufficient funds/i.test(error.message))
    {
        return { error: 'InsufficientFunds' };
    }

    return refusedByContract(error) ? { error: 'reverted' } : null;
}

export function createShopChain(settings: ShopSettings): ShopChain
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== ''
        && isAddress(settings.shop)
        && Number.isSafeInteger(chainId)
        && chainId > 0
        && /^0x[0-9a-fA-F]{64}$/.test(settings.sellerKey);
    const shop = configured ? getAddress(settings.shop) : null;
    const account = configured ? privateKeyToAccount(settings.sellerKey as Hex) : null;
    const floor = gasFloorOf(chainId);

    const reader = () => boundedClient(settings.rpcUrl);

    const ready = () =>
    {
        if (shop === null || account === null)
        {
            throw new Error('The shop is not configured.');
        }

        return { shop, account };
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

    const callTo = async (data: Hex, value: bigint): Promise<ShopCall> => ({
        to: ready().shop,
        data,
        value,
        chainId,
        gasPrice: floor > 0n ? await suggested() : null
    });

    const asked = async (from: Address, data: Hex, value = 0n): Promise<ShopAsked> =>
    {
        const { shop: to } = ready();

        try
        {
            await reader().call({ account: from, to, data, value });
        }
        catch (error)
        {
            const refusal = shopRefusalOf(error);

            if (refusal !== null)
            {
                return { ok: false, refusal };
            }

            return await reached(Promise.reject(error));
        }

        return { ok: true, call: await callTo(data, value) };
    };

    const read = <T>(functionName: string, args: readonly unknown[] = []) =>
        reader().readContract({ address: ready().shop, abi: SHOP_ABI, functionName, args } as never) as Promise<T>;

    return {
        configured,
        address: shop,
        chainId,
        seller: account?.address ?? null,

        sign: (quote) => ready().account.signTypedData({
            domain: quoteDomain(chainId, ready().shop),
            types: { Quote: QUOTE_FIELDS },
            primaryType: 'Quote',
            message: quote
        }),

        buyCall: (quote, signature) =>
            asked(quote.buyer, encodeFunctionData({ abi: SHOP_ABI, functionName: 'buy', args: [quote, signature] }), quote.price),

        async saleOf(order)
        {
            const [buyer, paidAt, refunded, referrer, price, cut] = await reached(read<readonly [Address, bigint, boolean, Address, bigint, bigint]>('saleOf', [order]));

            return {
                buyer: buyer === zeroAddress ? null : getAddress(buyer),
                paidAt,
                refunded,
                referrer: referrer === zeroAddress ? null : getAddress(referrer),
                price,
                cut
            };
        },

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

        balanceOf: (address) => reached(reader().getBalance({ address })),

        async earnedBy(address)
        {
            const [earnings, referralBps] = await reached(Promise.all([read<bigint>('earnings', [address]), read<number>('referralBps')]));

            return { earnings, referralBps: Number(referralBps) };
        },

        claimCall: (address) => asked(address, encodeFunctionData({ abi: SHOP_ABI, functionName: 'claim' })),

        books: () => booksOf(settings.rpcUrl, ready().shop, SHOP_ABI, ['revenue', 'totalEarnings']),

        async ledger(owner)
        {
            const { shop: at, account: key } = ready();
            const [revenue, owed, held, solvent, referralBps, paused, chainSeller, sellerAllowed, ownerAllowed, pauserAllowed] = await reached(Promise.all([
                read<bigint>('revenue'),
                read<bigint>('totalEarnings'),
                reader().getBalance({ address: at }),
                read<boolean>('solvent'),
                read<number>('referralBps'),
                read<boolean>('paused'),
                read<Address>('seller'),
                read<boolean>('hasRole', [SELLER_ROLE, key.address]),
                read<boolean>('hasRole', [OWNER_ROLE, owner]),
                read<boolean>('hasRole', [PAUSER_ROLE, owner])
            ]));

            return { revenue, owed, held, solvent, referralBps: Number(referralBps), paused, chainSeller: getAddress(chainSeller), sellerAllowed, ownerAllowed, pauserAllowed };
        },

        withdrawCall: (owner, to, amount) => asked(owner, encodeFunctionData({ abi: SHOP_ABI, functionName: 'withdraw', args: [to, amount] })),

        fundCall: (owner, amount) => asked(owner, encodeFunctionData({ abi: SHOP_ABI, functionName: 'fund' }), amount),

        refundCall: (owner, order) => asked(owner, encodeFunctionData({ abi: SHOP_ABI, functionName: 'refund', args: [order] })),

        sellerCall: (owner, next) => asked(owner, encodeFunctionData({ abi: SHOP_ABI, functionName: 'setSeller', args: [next] })),

        shareCall: (owner, bps) => asked(owner, encodeFunctionData({ abi: SHOP_ABI, functionName: 'setReferralBps', args: [bps] })),

        pauseCall: (owner, paused) => asked(owner, encodeFunctionData({ abi: SHOP_ABI, functionName: paused ? 'pause' : 'unpause' }))
    };
}

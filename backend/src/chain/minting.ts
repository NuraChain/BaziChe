import {
    BaseError,
    ContractFunctionRevertedError,
    TransactionNotFoundError,
    TransactionReceiptNotFoundError,
    createWalletClient,
    decodeErrorResult,
    defineChain,
    encodeFunctionData,
    getAddress,
    isAddress,
    keccak256,
    nonceManager,
    parseAbi,
    stringToHex,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { boundedClient, boundedTransport, reached, refusedByContract, unreached } from './rpc.ts';
import { gasFloorOf, type Mined } from './vault.ts';

/**
 * `ArcadeLooks` and `ArcadeAchievements` (`contracts/baziche/` in the SmartContract project) as the
 * NFT worker calls them, by hand as the vault's ABI is: what it reads before it sends, and what it
 * sends with the minter key, which is never the key that pays out tables.
 */
export const NFT_ABI = parseAbi([
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function mint(address owner, uint256 id)',
    'function mintBatch(address owner, uint256[] ids)',
    'function burn(address owner, uint256 id)',
    'function earned(address player, uint256 id) view returns (bool)',
    'function achievements(uint256 id) view returns (bool, bool, uint64)',
    'function defineAchievement(string name, bool soulbound, string metadataURI) returns (uint256 id)',
    'function award(address player, uint256 id)',
    'function MINTER_ROLE() view returns (bytes32)',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function grantRole(bytes32 role, address account)',
    'function revokeRole(bytes32 role, address account)',
    'error ZeroAddress()',
    'error AlreadyHeld(address owner, uint256 id)',
    'error NotHeld(address owner, uint256 id)',
    'error Soulbound(uint256 id)',
    'error UnknownAchievement(uint256 id)',
    'error AchievementLocked(uint256 id)',
    'error AlreadyEarned(address player, uint256 id)',
    'error ERC1155InvalidReceiver(address receiver)',
    'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)'
]);

/** A token's id in either collection: `uint256(keccak256(bytes(key)))`, as both contracts derive it. */
export const tokenIdOf = (key: string): Hex => keccak256(stringToHex(key));

/** The id as ERC-1155 metadata names it: 64 lower-case hex digits, no `0x`. */
export const tokenPathOf = (id: Hex) => id.slice(2).toLowerCase();

/** What the contract said no with, by its error's name: `AlreadyHeld`, `ERC1155InvalidReceiver`, or `reverted` when it gave none. */
export type Sent = { ok: true; hash: Hex } | { ok: false; refusal: string };

export interface NftChainSettings
{
    rpcUrl: string;
    chainId: string;
    minterKey: string;
    looks: string;
    achievements: string;
}

/** One NFT contract the worker mints on, by the key the staff address it with: an address a client sends is never looked up. */
export interface NftContract
{
    key: string;
    name: string;
    address: Address;
}

/** What NuraChain says about one contract and its roles, as far as it could be read. */
export interface NftStanding
{
    /** The chain id the node answered, which the staff compare with the one this server is set to. */
    node: number;

    /** Whether the address holds code. */
    deployed: boolean;

    /** `MINTER_ROLE` as the contract names it, or null where nothing was read: another chain, no code, or a contract with no roles. */
    role: Hex | null;

    /** Whether the minter key holds `MINTER_ROLE`. */
    minter: boolean;

    /** Whether the reader's wallet holds `DEFAULT_ADMIN_ROLE`, or null when there was no wallet to ask about. */
    admin: boolean | null;
}

export interface NftCall
{
    to: Address;
    data: Hex;
    value: bigint;
    chainId: number;
    gasPrice: bigint | null;
}

/** A role call the contract would take, composed for a wallet, or the word it would refuse it with. */
export type NftAsked = { ok: true; call: NftCall } | { ok: false; refusal: string };

/** A transaction as the node holds it. */
export interface NftTransaction
{
    from: Address;
    to: Address | null;
    input: Hex;
}

export interface NftChain
{
    /** Whether the key, the RPC and both contracts are set. Without them nothing is ever sent. */
    readonly configured: boolean;

    readonly chainId: number;

    /** The two contracts, checksummed, or null when unset: what the explorer links point at. */
    readonly looks: Address | null;
    readonly achievements: Address | null;

    /** The address of the key the worker mints with, which is what `MINTER_ROLE` is granted to. */
    readonly minter: Address | null;

    /** Every contract the worker mints on, in the order the staff see them; none until the worker is configured. */
    readonly contracts: readonly NftContract[];

    /** What NuraChain says of a contract and its roles. Nothing of roles is read on a node that is on another chain or where there is no code. */
    standing(contract: NftContract, wallet: Address | null): Promise<NftStanding>;

    /** `grantRole` or `revokeRole` of `MINTER_ROLE` for the minter, composed for `admin`'s wallet and asked of the contract from it first. */
    roleCall(contract: NftContract, admin: Address, grant: boolean): Promise<NftAsked>;

    /** A transaction as the node holds it, or null when it holds none under that hash. */
    transactionOf(hash: Hex): Promise<NftTransaction | null>;

    /** Whether `owner` holds look `id` now. */
    holdsLook(owner: Address, id: Hex): Promise<boolean>;

    /** Whether `player` was ever awarded achievement `id`. */
    earned(player: Address, id: Hex): Promise<boolean>;

    /** Whether achievement `id` is defined on the contract yet. */
    defined(id: Hex): Promise<boolean>;

    mintLooks(owner: Address, ids: readonly Hex[]): Promise<Sent>;

    burnLook(owner: Address, id: Hex): Promise<Sent>;

    /** Defines achievement `key`, soulbound and on the template. */
    define(key: string): Promise<Sent>;

    award(player: Address, id: Hex): Promise<Sent>;

    mined(hash: Hex): Promise<Mined>;
}

/** The contract's own error, by name, out of whatever viem threw; null for anything that is not a refusal. */
export function nftRefusalOf(error: unknown): string | null
{
    if (!(error instanceof BaseError))
    {
        return null;
    }

    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);

    if (reverted instanceof ContractFunctionRevertedError && reverted.data !== undefined)
    {
        return reverted.data.errorName;
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
            return decodeErrorResult({ abi: NFT_ABI, data: raw.data }).errorName;
        }
        catch
        {
            return 'reverted';
        }
    }

    return refusedByContract(error) ? 'reverted' : null;
}

export function createNftChain(settings: NftChainSettings): NftChain
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== ''
        && isAddress(settings.looks)
        && isAddress(settings.achievements)
        && Number.isSafeInteger(chainId)
        && chainId > 0
        && /^0x[0-9a-fA-F]{64}$/.test(settings.minterKey);
    const looks = isAddress(settings.looks) ? getAddress(settings.looks) : null;
    const achievements = isAddress(settings.achievements) ? getAddress(settings.achievements) : null;
    const account = configured ? privateKeyToAccount(settings.minterKey as Hex, { nonceManager }) : null;
    const floor = gasFloorOf(chainId);
    const chain = defineChain({
        id: configured ? chainId : 1,
        name: 'NuraChain',
        nativeCurrency: { name: 'Nura', symbol: 'NURA', decimals: 18 },
        rpcUrls: { default: { http: [configured ? settings.rpcUrl : 'http://127.0.0.1'] } }
    });

    const reader = () => boundedClient(settings.rpcUrl);

    const contracts: readonly NftContract[] = configured && looks !== null && achievements !== null
        ? [{ key: 'looks', name: 'Baziche Looks', address: looks }, { key: 'achievements', name: 'Baziche Achievements', address: achievements }]
        : [];

    const ready = (at: Address | null) =>
    {
        if (!configured || account === null || at === null)
        {
            throw new Error('The NFT contracts are not configured.');
        }

        return { to: at, from: account };
    };

    const read = <T>(at: Address | null, functionName: string, args: readonly unknown[]) =>
        reached(reader().readContract({ address: ready(at).to, abi: NFT_ABI, functionName, args } as never) as Promise<T>);

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

    /** Asks first, then sends only what would pass: a refusal is answered by name, and nothing is spent on it. */
    const send = async (at: Address | null, data: Hex): Promise<Sent> =>
    {
        const { to, from } = ready(at);

        try
        {
            await reader().call({ account: from.address, to, data });
        }
        catch (error)
        {
            const refusal = nftRefusalOf(error);

            if (refusal !== null)
            {
                return { ok: false, refusal };
            }

            return await reached(Promise.reject(error));
        }

        try
        {
            const live = await reached(reader().getGasPrice());
            const wallet = createWalletClient({ account: from, chain, transport: boundedTransport(settings.rpcUrl) });
            const hash = await wallet.sendTransaction({ to, data, gasPrice: live > floor ? live : floor });

            return { ok: true, hash };
        }
        catch (error)
        {
            nonceManager.reset({ address: from.address, chainId });
            return await reached(Promise.reject(error));
        }
    };

    return {
        configured,
        chainId,
        looks,
        achievements,
        minter: account?.address ?? null,
        contracts,

        async standing(contract, wallet)
        {
            ready(contract.address);

            const [node, code] = await reached(Promise.all([reader().getChainId(), reader().getCode({ address: contract.address })]));
            const deployed = code !== undefined && code !== '0x';
            const unread = { node, deployed, role: null, minter: false, admin: null };

            if (node !== chainId || !deployed)
            {
                return unread;
            }

            try
            {
                const [role, owner] = await Promise.all([read<Hex>(contract.address, 'MINTER_ROLE', []), read<Hex>(contract.address, 'DEFAULT_ADMIN_ROLE', [])]);
                const [minter, admin] = await Promise.all([
                    account === null ? false : read<boolean>(contract.address, 'hasRole', [role, account.address]),
                    wallet === null ? null : read<boolean>(contract.address, 'hasRole', [owner, wallet])
                ]);

                return { node, deployed, role, minter, admin };
            }
            catch (error)
            {
                if (refusedByContract(error))
                {
                    return unread;
                }

                throw error;
            }
        },

        async roleCall(contract, admin, grant)
        {
            const { to, from } = ready(contract.address);
            const role = await read<Hex>(contract.address, 'MINTER_ROLE', []);
            const data = encodeFunctionData({ abi: NFT_ABI, functionName: grant ? 'grantRole' : 'revokeRole', args: [role, from.address] });

            try
            {
                await reader().call({ account: admin, to, data });
            }
            catch (error)
            {
                const refusal = nftRefusalOf(error);

                if (refusal !== null)
                {
                    return { ok: false, refusal };
                }

                return await reached(Promise.reject(error));
            }

            return { ok: true, call: { to, data, value: 0n, chainId, gasPrice: floor > 0n ? await suggested() : null } };
        },

        async transactionOf(hash)
        {
            try
            {
                const found = await reader().getTransaction({ hash });

                return { from: getAddress(found.from), to: found.to === null ? null : getAddress(found.to), input: found.input };
            }
            catch (error)
            {
                if (error instanceof BaseError && error.walk((cause) => cause instanceof TransactionNotFoundError) !== null)
                {
                    return null;
                }

                return await reached(Promise.reject(error));
            }
        },

        holdsLook: async (owner, id) => await read<bigint>(looks, 'balanceOf', [owner, BigInt(id)]) > 0n,

        earned: (player, id) => read<boolean>(achievements, 'earned', [player, BigInt(id)]),

        defined: async (id) => (await read<readonly [boolean, boolean, bigint]>(achievements, 'achievements', [BigInt(id)]))[0],

        mintLooks: (owner, ids) => send(looks, ids.length === 1
            ? encodeFunctionData({ abi: NFT_ABI, functionName: 'mint', args: [owner, BigInt(ids[0])] })
            : encodeFunctionData({ abi: NFT_ABI, functionName: 'mintBatch', args: [owner, ids.map((id) => BigInt(id))] })),

        burnLook: (owner, id) => send(looks, encodeFunctionData({ abi: NFT_ABI, functionName: 'burn', args: [owner, BigInt(id)] })),

        define: (key) => send(achievements, encodeFunctionData({ abi: NFT_ABI, functionName: 'defineAchievement', args: [key, true, ''] })),

        award: (player, id) => send(achievements, encodeFunctionData({ abi: NFT_ABI, functionName: 'award', args: [player, BigInt(id)] })),

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
        }
    };
}

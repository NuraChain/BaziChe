import {
    createWalletClient,
    defineChain,
    encodeFunctionData,
    getAddress,
    isAddress,
    nonceManager,
    parseAbi,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { boundedClient, boundedTransport, reached, refusedByContract } from './rpc.ts';
import { gasFloorOf } from './vault.ts';

export const FORWARDER_ABI = parseAbi([
    'struct ForwardRequestData { address from; address to; uint256 value; uint256 gas; uint48 deadline; bytes data; bytes signature; }',
    'function verify(ForwardRequestData request) view returns (bool)',
    'function execute(ForwardRequestData request) payable',
    'function nonces(address owner) view returns (uint256)'
]);

/** What the profile proxy says of the forwarder it trusts, as every ERC-2771 contract does. */
export const TRUSTED_ABI = parseAbi(['function trustedForwarder() view returns (address)']);

/** OpenZeppelin's `ERC2771Forwarder`, which `NuraForwarder` is with its name: EIP-712, version "1". */
const FORWARD_REQUEST = [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' }
] as const;

/** What the person signs: one call to the profile registry, from their own wallet, carrying no NURA. */
export interface ForwardRequest
{
    from: Address;
    to: Address;
    gas: bigint;
    nonce: bigint;
    deadline: number;
    data: Hex;
}

export type Relayed = { ok: true; hash: Hex } | { ok: false; refusal: 'signature' | 'reverted' };

export interface SponsorSettings
{
    rpcUrl: string;
    chainId: string;
    registry: string;
    sponsorKey: string;
}

export interface ProfileSponsor
{
    /** Whether the key, the RPC, the chain and the registry are set: without them the server pays for nothing. */
    readonly configured: boolean;

    /** The wallet that pays, which the admin funds. */
    readonly address: Address | null;

    /** What a person's wallet holds, in wei. */
    balanceOf(owner: Address): Promise<bigint>;

    /** What a unit of gas costs now, never under the chain's own floor. */
    gasPrice(): Promise<bigint>;

    /** The gas `data` takes sent to the registry from `owner` directly, which is what it takes forwarded. */
    estimate(owner: Address, data: Hex): Promise<bigint>;

    /** The forwarder's next nonce for `owner`, which their signature must name. */
    nonceOf(owner: Address): Promise<bigint>;

    /** The request as EIP-712 typed data, the JSON a wallet's `eth_signTypedData_v4` takes. */
    typedData(request: ForwardRequest): Promise<string>;

    /** Checks the signature on the forwarder, asks the chain whether it would pass, and sends it only then, paid by this key. */
    relay(request: ForwardRequest, signature: Hex): Promise<Relayed>;
}

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export const isSignature = (text: string): text is Hex => SIGNATURE.test(text);

/**
 * The server paying a profile's gas for somebody whose wallet holds none: they sign a request to
 * the forwarder the profile proxy trusts, and this key sends it, so the registry sees them as its
 * sender and the gas comes from here.
 *
 * Nothing here decides who is paid for: `domains/profile/sponsor.ts` builds the request from the
 * person's own profile and holds the limits. This only refuses what the chain would.
 */
export function createProfileSponsor(settings: SponsorSettings): ProfileSponsor
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== ''
        && isAddress(settings.registry)
        && Number.isSafeInteger(chainId)
        && chainId > 0
        && /^0x[0-9a-fA-F]{64}$/.test(settings.sponsorKey);
    const registry = isAddress(settings.registry) ? getAddress(settings.registry) : null;
    const account = configured ? privateKeyToAccount(settings.sponsorKey as Hex, { nonceManager }) : null;
    const floor = gasFloorOf(chainId);
    const chain = defineChain({
        id: configured ? chainId : 1,
        name: 'NuraChain',
        nativeCurrency: { name: 'Nura', symbol: 'NURA', decimals: 18 },
        rpcUrls: { default: { http: [configured ? settings.rpcUrl : 'http://127.0.0.1'] } }
    });

    const reader = () => boundedClient(settings.rpcUrl);

    let forwarder: Address | null = null;

    const ready = () =>
    {
        if (!configured || account === null || registry === null)
        {
            throw new Error('The profile sponsor is not configured.');
        }

        return { account, registry };
    };

    // Read once: the proxy can be upgraded to trust another, and a restart is when that is picked up.
    const forwarderOf = async () =>
    {
        forwarder ??= getAddress(await reached(reader().readContract({ address: ready().registry, abi: TRUSTED_ABI, functionName: 'trustedForwarder' })));

        return forwarder;
    };

    const gasPrice = async () =>
    {
        const live = await reached(reader().getGasPrice());

        return live > floor ? live : floor;
    };

    const requestData = (request: ForwardRequest, signature: Hex) => ({
        from: request.from,
        to: request.to,
        value: 0n,
        gas: request.gas,
        deadline: request.deadline,
        data: request.data,
        signature
    });

    return {
        configured,
        address: account?.address ?? null,

        balanceOf: (owner) => reached(reader().getBalance({ address: owner })),

        gasPrice,

        estimate: (owner, data) => reached(reader().estimateGas({ account: owner, to: ready().registry, data })),

        nonceOf: async (owner) => await reached(reader().readContract({ address: await forwarderOf(), abi: FORWARDER_ABI, functionName: 'nonces', args: [owner] })),

        async typedData(request)
        {
            const verifyingContract = await forwarderOf();

            return JSON.stringify({
                types: {
                    EIP712Domain: [
                        { name: 'name', type: 'string' },
                        { name: 'version', type: 'string' },
                        { name: 'chainId', type: 'uint256' },
                        { name: 'verifyingContract', type: 'address' }
                    ],
                    ForwardRequest: FORWARD_REQUEST
                },
                primaryType: 'ForwardRequest',
                domain: { name: 'NuraForwarder', version: '1', chainId, verifyingContract },
                message: {
                    from: request.from,
                    to: request.to,
                    value: '0',
                    gas: request.gas.toString(),
                    nonce: request.nonce.toString(),
                    deadline: request.deadline,
                    data: request.data
                }
            });
        },

        async relay(request, signature)
        {
            const { account: from } = ready();
            const to = await forwarderOf();
            const asked = requestData(request, signature);

            // `verify` answers for the signer, the nonce, the deadline and the target all at once.
            if (!await reached(reader().readContract({ address: to, abi: FORWARDER_ABI, functionName: 'verify', args: [asked] })))
            {
                return { ok: false, refusal: 'signature' };
            }

            const data = encodeFunctionData({ abi: FORWARDER_ABI, functionName: 'execute', args: [asked] });
            // The forwarder keeps a 64th of what it is given, and refuses a request it could not give all of `gas` to.
            const gas = request.gas * 64n / 63n + 120_000n;

            try
            {
                await reader().call({ account: from.address, to, data, gas });
            }
            catch (error)
            {
                if (refusedByContract(error))
                {
                    return { ok: false, refusal: 'reverted' };
                }

                return await reached(Promise.reject(error));
            }

            try
            {
                const wallet = createWalletClient({ account: from, chain, transport: boundedTransport(settings.rpcUrl) });
                const hash = await wallet.sendTransaction({ to, data, gas, gasPrice: await gasPrice() });

                return { ok: true, hash };
            }
            catch (error)
            {
                nonceManager.reset({ address: from.address, chainId });
                return await reached(Promise.reject(error));
            }
        }
    };
}

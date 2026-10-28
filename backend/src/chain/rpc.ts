import { HttpError } from '@azerothjs/http';
import {
    AbiDecodingDataSizeTooSmallError,
    AbiDecodingZeroDataError,
    BaseError,
    ContractFunctionRevertedError,
    ContractFunctionZeroDataError,
    createPublicClient,
    ExecutionRevertedError,
    http,
    HttpRequestError,
    RpcRequestError,
    TimeoutError,
    type Abi,
    type Address
} from 'viem';

const CHAIN_CALL_TIMEOUT_MS = 4_000;

const CHAIN_DEADLINE_MS = 2 * CHAIN_CALL_TIMEOUT_MS;

export const ONE_USE = { connection: 'close' } as const;

export function boundedTransport(rpcUrl: string)
{
    const deadline = AbortSignal.timeout(CHAIN_DEADLINE_MS);
    return http(rpcUrl, {
        timeout: CHAIN_CALL_TIMEOUT_MS,
        retryCount: 0,
        fetchFn: (input, init) => fetch(input, {
            ...init,
            headers: { ...Object.fromEntries(new Headers(init?.headers)), ...ONE_USE },
            signal: AbortSignal.any([deadline, AbortSignal.timeout(CHAIN_CALL_TIMEOUT_MS), ...(init?.signal ? [init.signal] : [])])
        })
    });
}

export function boundedClient(rpcUrl: string)
{
    return createPublicClient({
        ccipRead: false,
        transport: boundedTransport(rpcUrl)
    });
}

export function refusedByContract(error: unknown)
{
    return error instanceof BaseError && error.walk((cause) =>
        cause instanceof ExecutionRevertedError
        || (cause instanceof ContractFunctionRevertedError && cause.raw !== undefined && cause.raw !== '0x')
        || cause instanceof ContractFunctionZeroDataError
        || cause instanceof AbiDecodingZeroDataError
        || cause instanceof AbiDecodingDataSizeTooSmallError) !== null;
}

export class Unanswered extends Error
{
    override readonly name = 'Unanswered';
}

const FETCH_GAVE_UP: ReadonlySet<string> = new Set(['TimeoutError', 'AbortError']);

export function unreached(error: unknown)
{
    if (error instanceof BaseError)
    {
        return !refusedByContract(error) && error.walk((cause) =>
            cause instanceof TimeoutError
            || cause instanceof HttpRequestError
            || cause instanceof RpcRequestError) !== null;
    }

    return error instanceof Unanswered
        || (error instanceof Error && (FETCH_GAVE_UP.has(error.name) || (error instanceof TypeError && error.message === 'fetch failed')));
}

/** What a contract holds, what its own books say it owes, and whether its own `solvent()` says it covers that. */
export interface Books
{
    held: bigint;
    owed: bigint;
    solvent: boolean;
}

/** A contract's books, every figure read at one block, so a payment landing between two reads cannot make them disagree. */
export async function booksOf(rpcUrl: string, address: Address, abi: Abi, owing: readonly string[]): Promise<Books>
{
    const client = boundedClient(rpcUrl);
    const blockNumber = await reached(client.getBlockNumber());
    const read = <T>(functionName: string) => client.readContract({ address, abi, functionName, blockNumber } as never) as Promise<T>;
    const [held, solvent, owed] = await reached(Promise.all([
        client.getBalance({ address, blockNumber }),
        read<boolean>('solvent'),
        Promise.all(owing.map((functionName) => read<bigint>(functionName)))
    ]));

    return { held, owed: owed.reduce((sum, one) => sum + one, 0n), solvent };
}

export async function reached<T>(asked: Promise<T>)
{
    try
    {
        return await asked;
    }
    catch (error)
    {
        throw unreached(error)
            ? new HttpError(503, 'We could not reach the network. Try again in a moment.', { code: 'chain-unreachable', expose: true, cause: error })
            : error;
    }
}

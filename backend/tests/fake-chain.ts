import { createServer as httpServer, type Server, type ServerResponse } from 'node:http';
import { createServer as tcpServer, type AddressInfo, type Socket } from 'node:net';

import { encodeErrorResult, keccak256, parseAbi, type Hex } from 'viem';

export type Rpc = { method: string; params: unknown[] };

export type Answer = { result: unknown } | { error: { code: number; message: string; data?: string } } | { status: number } | 'stall';

const OFFCHAIN_LOOKUP = parseAbi(['error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)']);

export const REFUSED_BY_FETCH: ReadonlySet<number> = new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111,
    113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
    554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665,
    6666, 6667, 6668, 6669, 6679, 6697, 10080
]);

const open: Array<() => void> = [];

export function closeChains()
{
    open.splice(0).forEach((close) => close());
}

export async function listen(server: Server | ReturnType<typeof tcpServer>)
{
    for (;;)
    {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        const { port } = server.address() as AddressInfo;

        if (!REFUSED_BY_FETCH.has(port))
        {
            return `http://127.0.0.1:${ port }/`;
        }

        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

export async function silentChain()
{
    const sockets = new Set<Socket>();
    const server = tcpServer((socket) => sockets.add(socket));
    open.push(() =>
    {
        sockets.forEach((socket) => socket.destroy());
        server.close();
    });
    return listen(server);
}

export async function fakeChain(answer: (rpc: Rpc) => Answer | Promise<Answer>)
{
    const asked: string[] = [];
    const held = new Set<ServerResponse>();
    const server = httpServer(async (request, response) =>
    {
        let body = '';
        for await (const chunk of request)
        {
            body += String(chunk);
        }
        const rpc = JSON.parse(body) as Rpc & { id: number };
        asked.push(rpc.method);
        const reply = await answer(rpc);
        if (response.destroyed)
        {
            return;
        }
        if (reply === 'stall')
        {
            held.add(response);
            response.writeHead(200, { 'content-type': 'application/json' });
            response.write('{"jsonrpc":"2.0",');
            return;
        }
        if ('status' in reply)
        {
            response.writeHead(reply.status);
            response.end();
            return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, ...reply }));
    });
    open.push(() =>
    {
        held.forEach((response) => response.destroy());
        server.close();
    });
    return { url: await listen(server), asked };
}

export async function tiredHost(answer: (request: { url: string; body: string }) => unknown)
{
    const answered = new WeakMap<Socket, number>();
    const held = new Set<ServerResponse>();
    let sockets = 0;
    const server = httpServer(async (request, response) =>
    {
        let body = '';
        for await (const chunk of request)
        {
            body += String(chunk);
        }
        const before = answered.get(request.socket) ?? 0;
        answered.set(request.socket, before + 1);
        if (before > 0)
        {
            held.add(response);
            return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(answer({ url: request.url ?? '', body })));
    });
    server.on('connection', () =>
    {
        sockets += 1;
    });
    open.push(() =>
    {
        held.forEach((response) => response.destroy());
        server.closeAllConnections();
        server.close();
    });
    return { url: await listen(server), sockets: () => sockets };
}

export async function lookupGateway()
{
    let hits = 0;
    const server = httpServer((_request, response) =>
    {
        hits += 1;
        response.end('{"data":"0x"}');
    });
    const url = await listen(server);
    open.push(() => server.close());
    return { url, hits: () => hits };
}

export function offchainLookup(sender: string, gatewayUrl: string)
{
    return {
        error: {
            code: 3,
            message: 'execution reverted',
            data: encodeErrorResult({
                abi: OFFCHAIN_LOOKUP,
                errorName: 'OffchainLookup',
                args: [sender as Hex, [`${ gatewayUrl }{sender}/{data}`], '0xdeadbeef', '0x12345678', '0x']
            })
        }
    };
}

export function callOf(rpc: Rpc)
{
    return rpc.params[0] as { to?: string; data: Hex };
}

/** A chain that knows only the rewards wallet: its balance, its nonces, the bytes it was sent and the receipts it can show. */
export interface RewardChain
{
    balance: bigint;
    gasPrice: bigint;
    pending: number;
    latest: number;
    receipts: Map<string, 'success' | 'reverted'>;
    sent: Hex[];
    /** What the node says to the next broadcast instead of taking it. */
    refuse: string | null;
    /** Every call answers 502, as a node that is not there. */
    down: boolean;
}

export async function fakeRewardChain(start: Partial<RewardChain> = {})
{
    const chain: RewardChain = {
        balance: 0n,
        gasPrice: 47_000_000_000n,
        pending: 0,
        latest: 0,
        receipts: new Map(),
        sent: [],
        refuse: null,
        down: false,
        ...start
    };
    const hex = (value: bigint | number) => `0x${ value.toString(16) }`;
    const { url, asked } = await fakeChain((rpc): Answer =>
    {
        if (chain.down)
        {
            return { status: 502 };
        }

        switch (rpc.method)
        {
            case 'eth_chainId':
                return { result: hex(1020) };
            case 'eth_gasPrice':
                return { result: hex(chain.gasPrice) };
            case 'eth_getBalance':
                return { result: hex(chain.balance) };
            case 'eth_getTransactionCount':
                return { result: hex(rpc.params[1] === 'latest' ? chain.latest : chain.pending) };
            case 'eth_sendRawTransaction':
            {
                const raw = rpc.params[0] as Hex;
                if (chain.refuse !== null)
                {
                    const message = chain.refuse;
                    chain.refuse = null;
                    return { error: { code: -32000, message } };
                }
                chain.sent.push(raw);
                return { result: keccak256(raw) };
            }
            case 'eth_getTransactionReceipt':
            {
                const status = chain.receipts.get(String(rpc.params[0]).toLowerCase());
                return {
                    result: status === undefined ? null : {
                        status: status === 'success' ? '0x1' : '0x0',
                        blockNumber: '0x2',
                        transactionHash: rpc.params[0]
                    }
                };
            }
            default:
                return { result: '0x' };
        }
    });

    return { url, asked, chain };
}

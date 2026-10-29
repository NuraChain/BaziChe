/**
 * NuraChain out of the server's reach while people go on paying on it, over the api of the built
 * server and a local chain. The server reaches the node only through a proxy this pass holds; the
 * buyer's wallet reaches the node itself, as a browser's wallet does through its own provider. The
 * pass cuts the proxy, has a look paid for on the chain, and wants the order kept on its way, the
 * alert raised, and then, with the line given back, the look delivered and the alert cleared.
 *
 *   QA_BASE=http://localhost:5300 QA_RPC=http://127.0.0.1:8645 QA_PROXY_PORT=8646 \
 *     QA_LOG=<a file holding the server's output> node tools/qa/outage-pass.mjs
 *
 * The server runs built, on a database nobody else uses, with `NURA_RPC_URL` naming the proxy
 * (`http://127.0.0.1:<QA_PROXY_PORT>`), `NURA_CHAIN_ID=31337`, `NURA_SHOP_ADDRESS`,
 * `NURA_REFEREE_KEY` and `ADMIN_WALLET_ADDRESS` set to hardhat's #6 (`QA_OWNER_KEY` names another
 * owner's key). It may be started before the pass: until the proxy listens, NuraChain is simply out
 * of reach, which the pass waits out before it begins. NuraChain counts as out of reach only after two
 * reconciliation passes that cannot reach it, and they run a minute apart, so the pass takes about
 * five minutes.
 */
import { createServer, connect } from 'node:net';
import { readFileSync } from 'node:fs';

import { createPublicClient, createWalletClient, decodeFunctionData, http, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { LOOKS } from '../../backend/src/domains/shop/catalogue.ts';
import { shopArtifact } from './vault-deploy.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const PROXY_PORT = Number(process.env.QA_PROXY_PORT ?? 8646);

const LOG = process.env.QA_LOG;

const OWNER_KEY = process.env.QA_OWNER_KEY ?? '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';

const ITEM = 'dice.gold';

const WEI = 10n ** 18n;

/** The first reconciliation pass is half a minute after a boot. */
const REACHED_WITHIN_MS = 90_000;

/** Two passes that cannot reach the chain, a minute apart, then the next sample of the server. */
const UNREACHED_WITHIN_MS = 240_000;

const DELIVERED_WITHIN_MS = 60_000;

const CLEARED_WITHIN_MS = 150_000;

/** How long an order paid while the line is cut is watched for anything happening to it. */
const KEPT_MS = 15_000;

const ABI = shopArtifact().abi;

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }`);
        return true;
    }

    failures += 1;
    console.log(`  FAIL  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);
    return false;
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (ms, look) =>
{
    const end = Date.now() + ms;

    for (;;)
    {
        const found = await look();

        if (found !== null && found !== undefined && found !== false)
        {
            return found;
        }

        if (Date.now() > end)
        {
            return null;
        }

        await pause(1000);
    }
};

/**
 * The server's only way to the node: every connection piped to it byte for byte while the line holds.
 * Cut, it stops listening and drops every connection it carries, so a request the server has on its
 * way fails as surely as a new one.
 */
const proxy = () =>
{
    const node = new URL(RPC);
    const open = new Set();
    let server = null;

    const carry = (client) =>
    {
        const upstream = connect(Number(node.port), node.hostname);

        open.add(client);
        open.add(upstream);
        client.pipe(upstream);
        upstream.pipe(client);

        for (const end of [client, upstream])
        {
            end.on('error', () => undefined);
            end.on('close', () =>
            {
                open.delete(end);
                client.destroy();
                upstream.destroy();
            });
        }
    };

    return {
        listen: () => new Promise((resolve, reject) =>
        {
            server = createServer(carry);
            server.once('error', reject);
            server.listen(PROXY_PORT, '127.0.0.1', () => resolve());
        }),
        cut: () => new Promise((resolve) =>
        {
            for (const socket of open)
            {
                socket.destroy();
            }

            open.clear();
            server.close(() => resolve());
        })
    };
};

const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        for (const line of response.headers.getSetCookie?.() ?? [])
        {
            if (line.startsWith('nura.session=') || line.startsWith('__Host-nura.session='))
            {
                cookie = line.split(';')[0];
            }
        }

        const text = await response.text();
        let parsed = null;

        try
        {
            parsed = text === '' ? null : JSON.parse(text);
        }
        catch
        {
            parsed = null;
        }

        return { status: response.status, body: parsed, text };
    };

    return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body) };
};

const node = async (method, params = []) =>
{
    const answer = await (await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })).json();

    if (answer.error !== undefined)
    {
        throw new Error(`${ method }: ${ answer.error.message }`);
    }

    return answer.result;
};

const chain = { ...hardhat, rpcUrls: { default: { http: [RPC] } } };

const reader = createPublicClient({ chain, transport: http(RPC) });

const signed = async (name, wallet = privateKeyToAccount(generatePrivateKey())) =>
{
    const who = session();

    who.account = wallet;
    who.address = wallet.address;
    who.wallet = createWalletClient({ account: wallet, chain, transport: http(RPC) });
    who.handle = (await signInWallet(who.post, name, wallet)).handle;

    return who;
};

const logged = (...words) =>
{
    if (LOG === undefined || LOG === '')
    {
        return null;
    }

    return readFileSync(LOG, 'utf8').split('\n').find((line) => words.every((word) => line.includes(word))) ?? false;
};

const loggedOk = (label, ...words) =>
{
    const found = logged(...words);

    return found === null ? console.log(`  SKIP  ${ label } — QA_LOG names no file of the server's output`) : ok(label, found !== false);
};

const overviewOf = async (owner) => (await owner.get('/admin/overview')).body ?? {};

const chainDown = (overview) => (overview.alerts ?? []).find((one) => one.alert === 'chain-down') ?? null;

const orderOf = async (who, id) => (await who.get(`/shop/orders/${ id }`)).body ?? null;

const owns = async (who) => ((await who.get('/shop/collection')).body?.owned ?? []).some((look) => look.item === ITEM);

const main = async () =>
{
    console.log(`outage pass against ${ BASE }, the server reaching ${ RPC } through 127.0.0.1:${ PROXY_PORT }`);

    if (!LOOKS.some((look) => look.id === ITEM))
    {
        throw new Error(`${ ITEM } is no look the catalogue sells`);
    }

    const line = proxy();

    await line.listen();

    const owner = await signed('Outage Owner', privateKeyToAccount(OWNER_KEY));

    if ((await owner.get('/auth/me')).body?.account?.staff !== 'owner')
    {
        console.log(`  the server does not name ${ owner.address } as its owner: start it with ADMIN_WALLET_ADDRESS set to that, or hand QA_OWNER_KEY the key of the one it names`);
        process.exit(1);
    }

    const buyer = await signed('Outage Buyer');

    await node('hardhat_setBalance', [buyer.address, toHex(100n * WEI)]);

    console.log('\n[1] NuraChain within reach, through the proxy');

    ok('the shop is open', (await buyer.get('/shop')).body?.open === true);

    const reached = await until(REACHED_WITHIN_MS, async () => (await overviewOf(owner)).payouts?.reachable === true);

    ok('the server reaches NuraChain through the proxy, and the owner\'s overview says so', reached !== null);
    ok('and no alert says otherwise', chainDown(await overviewOf(owner)) === null);

    console.log('\n[2] the line to NuraChain cut, and a look paid for meanwhile');

    const ordered = await buyer.post('/shop/orders', { item: ITEM });

    if (!ok('an order is composed while the line holds', ordered.status === 200, `${ ordered.status } ${ ordered.text.slice(0, 160) }`))
    {
        return;
    }

    const id = ordered.body.order.id;
    const quote = decodeFunctionData({ abi: ABI, data: ordered.body.call.data }).args[0];

    await line.cut();

    const hash = await buyer.wallet.sendTransaction({ to: ordered.body.call.to, data: ordered.body.call.data, value: BigInt(ordered.body.call.value) });
    const receipt = await reader.waitForTransactionReceipt({ hash });

    ok('the buyer\'s wallet pays it on NuraChain itself, which the server cannot reach', receipt.status === 'success');

    const told = await buyer.post(`/shop/orders/${ id }/sent`, { hash });

    ok('the hash is handed in all the same', told.status === 200 && told.body?.state === 'sent', `${ told.status } ${ told.body?.state }`);

    await pause(KEPT_MS);

    ok('while the line is cut the order stays on its way: not delivered, not failed, not run out', (await orderOf(buyer, id))?.state === 'sent');
    ok('and the look is not handed over before NuraChain says it was sold', !await owns(buyer));

    const down = await until(UNREACHED_WITHIN_MS, async () => chainDown(await overviewOf(owner)));

    ok('two reconciliation passes that cannot reach NuraChain raise an error on the owner\'s overview', down?.level === 'error', JSON.stringify(down ?? null));
    ok('and the money on its way says it was not reached', (await overviewOf(owner)).payouts?.reachable === false);
    ok('under the alert the order is still on its way', (await orderOf(buyer, id))?.state === 'sent');
    loggedOk('the server says it as an error', 'alert raised', '"chain-down"', 'error');

    console.log('\n[3] the line given back');

    await line.listen();

    const delivered = await until(DELIVERED_WITHIN_MS, async () =>
    {
        const order = await orderOf(buyer, id);

        return order?.state === 'paid' ? order : null;
    });

    ok('the order is delivered once NuraChain can be reached again', delivered !== null);
    ok('and the look is the buyer\'s, bought', delivered !== null && await owns(buyer));

    const [saleBuyer, , , , salePrice] = await reader.readContract({ address: ordered.body.call.to, abi: ABI, functionName: 'saleOf', args: [quote.order] });

    ok('the shop holds the sale as it was quoted, to the buyer at the price', saleBuyer.toLowerCase() === buyer.address.toLowerCase() && salePrice === quote.price, JSON.stringify({ buyer: saleBuyer, price: String(salePrice) }));

    const cleared = await until(CLEARED_WITHIN_MS, async () => chainDown(await overviewOf(owner)) === null);

    ok('a pass that reaches NuraChain again clears the alert', cleared !== null);
    ok('and the owner\'s overview says NuraChain is reached', (await overviewOf(owner)).payouts?.reachable === true);
    loggedOk('the server says the alert cleared', 'alert cleared', '"chain-down"');
};

main()
    .catch((error) =>
    {
        failures += 1;
        console.error(error);
    })
    .finally(() =>
    {
        console.log(`\noutage pass: ${ failures === 0 ? 'clean' : `${ failures } FAILED` }, ${ checks } checks`);
        process.exit(failures === 0 ? 0 : 1);
    });

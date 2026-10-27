/**
 * The shop over the real api, the built server and a local chain: looks bought with NURA by wallets
 * made for the run, paid to `ArcadeShop` with the purchase the server composes, and delivered when
 * the shop says they were sold. Every sale is read back from the shop itself.
 *
 *   PGDATABASE=<the server's database> QA_BASE=http://localhost:5300 QA_SHOP=<the shop> node tools/qa/shop-pass.mjs
 *
 * The server runs built, on a database nobody else uses, with NURA_RPC_URL, NURA_CHAIN_ID=31337,
 * NURA_SHOP_ADDRESS and NURA_REFEREE_KEY naming a hardhat node and the shop `vault-deploy.mjs` put on
 * it for this run (QA_SHOP is that shop, QA_RPC the node). PGDATABASE names the server's database,
 * because an invite is counted, a friendship made, a minor marked and a quote run out by hand.
 */
import { createPublicClient, createWalletClient, decodeFunctionData, formatEther, hashTypedData, http, recoverTypedDataAddress, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { BUNDLES, LOOKS } from '../../backend/src/domains/shop/catalogue.ts';
import { databaseName, sql } from './db.mjs';
import { SHOP_REFERRAL_BPS, VAULT_ADMIN_KEY, shopArtifact } from './vault-deploy.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const SHOP = process.env.QA_SHOP;

const WEI = 10n ** 18n;

const HELLO_WITHIN_MS = 8000;

const PAID_WITHIN_MS = 30_000;

const RUNG_WITHIN_MS = 3000;

const ABI = shopArtifact().abi;

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }${ detail === '' || detail.length > 100 ? '' : ` — ${ detail }` }`);
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

        await pause(250);
    }
};

const literal = (text) => `'${ String(text).replaceAll('\'', '\'\'') }'`;

const shown = (wei) => `${ formatEther(wei) } NURA`;

const tag = () => Math.floor(Math.random() * 100000);

const said = (answer) => `${ answer.status } ${ answer.body?.error?.code ?? '' } ${ (answer.text ?? '').slice(0, 160) }`;

const refusedAs = (label, answer, word) =>
    ok(label, answer.status >= 400 && answer.body?.error?.code === word, said(answer));

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

    return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body), cookie: () => cookie, rung: 0 };
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

const read = (functionName, args = []) => reader.readContract({ address: SHOP, abi: ABI, functionName, args });

const connect = (who) => new Promise((resolve, reject) =>
{
    const socket = new WebSocket(`${ BASE.replace(/^http/, 'ws') }/ws`, { headers: { cookie: who.cookie(), origin: BASE } });
    const patience = setTimeout(() => reject(new Error(`the server never said hello to ${ who.name }`)), HELLO_WITHIN_MS);

    socket.addEventListener('message', (event) =>
    {
        const frame = JSON.parse(String(event.data));

        if (frame.t === 'hello')
        {
            clearTimeout(patience);
            who.socket = socket;
            resolve();
        }

        if (frame.t === 'nudge' && frame.scope === 'me' && frame.id === 'shop')
        {
            who.rung += 1;
        }
    });

    socket.addEventListener('error', () =>
    {
        clearTimeout(patience);
        reject(new Error(`the socket for ${ who.name } would not open; is PUBLIC_ORIGIN ${ BASE }?`));
    });
});

/** Everybody the pass signed in, whose sockets are closed however it ends. */
const everyone = [];

const player = async (name, holds = 1000n * WEI) =>
{
    const who = session();
    const account = privateKeyToAccount(generatePrivateKey());

    everyone.push(who);

    who.name = `${ name } ${ tag() }`;
    who.account = account;
    who.address = account.address;
    who.wallet = createWalletClient({ account, chain, transport: http(RPC) });
    who.handle = (await signInWallet(who.post, who.name, account)).handle;
    who.id = sql(`select id from users where handle = ${ literal(who.handle) }`);
    await node('hardhat_setBalance', [account.address, toHex(holds)]);
    await connect(who);

    return who;
};

const send = async (who, call) =>
{
    const hash = await who.wallet.sendTransaction({
        to: call.to,
        data: call.data,
        value: BigInt(call.value),
        ...(call.gasPrice === undefined ? {} : { gasPrice: BigInt(call.gasPrice) })
    });
    const receipt = await reader.waitForTransactionReceipt({ hash });

    return { hash, mined: receipt.status, gasPaid: receipt.gasUsed * receipt.effectiveGasPrice };
};

/**
 * Sends a call the chain will refuse and has it mined anyway: a node that mines each transaction as
 * it comes answers a refused one with an error and no hash, so the block is made by hand.
 */
const sendRefused = async (who, call) =>
{
    await node('evm_setAutomine', [false]);

    try
    {
        const hash = await who.wallet.sendTransaction({ to: call.to, data: call.data, value: BigInt(call.value), gas: 300_000n });

        await node('evm_mine');

        return { hash, mined: (await reader.waitForTransactionReceipt({ hash })).status };
    }
    finally
    {
        await node('evm_setAutomine', [true]);
    }
};

/** Pays an order with the purchase the server composed, hands its hash in and waits for the worker to deliver it. */
const pay = async (who, purchase) =>
{
    const sent = await send(who, purchase.call);
    const told = await who.post(`/shop/orders/${ purchase.order.id }/sent`, { hash: sent.hash });
    const paid = await until(PAID_WITHIN_MS, async () =>
    {
        const order = (await who.get(`/shop/orders/${ purchase.order.id }`)).body;

        return order?.state === 'paid' ? order : null;
    });

    return { sent, told, paid };
};

const quoteOf = (call) => decodeFunctionData({ abi: ABI, data: call.data }).args;

const collected = async (who) => (await who.get('/shop/collection')).body?.owned ?? [];

const befriend = (one, other) =>
    sql(`insert into friendships (user_id, friend_id) values (${ literal(one.id) }, ${ literal(other.id) }), (${ literal(other.id) }, ${ literal(one.id) })`);

const admin = createWalletClient({ account: privateKeyToAccount(VAULT_ADMIN_KEY), chain, transport: http(RPC) });

const asAdmin = async (functionName) =>
    reader.waitForTransactionReceipt({ hash: await admin.writeContract({ address: SHOP, abi: ABI, functionName }) });

async function main()
{
    if (SHOP === undefined || SHOP === '')
    {
        throw new Error('QA_SHOP names no shop: run tools/qa/vault-deploy.mjs on the node and start the server with its NURA_SHOP_ADDRESS');
    }

    console.log(`the shop pass, against ${ BASE } on ${ databaseName() }, the shop at ${ SHOP }`);

    const inviter = await player('Inviter');
    const buyer = await player('Buyer');
    const friend = await player('Friend');

    sql(`insert into referrals (invitee_id, inviter_id, counted_at) values (${ literal(buyer.id) }, ${ literal(inviter.id) }, now())`);
    befriend(buyer, friend);

    console.log('\nthe shop as a buyer finds it');

    const state = (await buyer.get('/shop')).body;

    ok('the shop is open, on this chain, with every look and every bundle on sale', state?.open === true && state.chainId === 31337 && state.items?.length === LOOKS.length + BUNDLES.length, `${ state?.items?.length } items`);
    ok('it features a collection and says the buyer may buy', state?.featured === 'glow' && state.may === 'yes', JSON.stringify({ featured: state?.featured, may: state?.may }));

    const price = BigInt(state.items.find((item) => item.id === 'dice.glow').price);

    console.log('\na look bought');

    const ordered = await buyer.post('/shop/orders', { item: 'dice.glow' });

    ok('an order is priced and its purchase composed', ordered.status === 200 && ordered.body.order.price === price.toString(), said(ordered));

    const [quote, signature] = quoteOf(ordered.body.call);
    const domain = { name: 'ArcadeShop', version: '1', chainId: 31337, verifyingContract: SHOP };
    const types = { Quote: [
        { name: 'order', type: 'bytes32' },
        { name: 'buyer', type: 'address' },
        { name: 'item', type: 'bytes32' },
        { name: 'price', type: 'uint256' },
        { name: 'referrer', type: 'address' },
        { name: 'deadline', type: 'uint64' }
    ] };

    ok('the quote\'s digest is the one the shop itself works out', await read('quoteDigest', [quote]) === hashTypedData({ domain, types, primaryType: 'Quote', message: quote }));
    ok('the quote is signed by the shop\'s seller', (await recoverTypedDataAddress({ domain, types, primaryType: 'Quote', message: quote, signature })) === await read('seller'));
    ok('it names the buyer, the price and, once their invite counted, whoever brought them in', quote.buyer === buyer.address && quote.price === price && quote.referrer === inviter.address, JSON.stringify({ buyer: quote.buyer, referrer: quote.referrer }));
    ok('the purchase is sent by the buyer\'s wallet, carrying the price', ordered.body.call.from === buyer.address && BigInt(ordered.body.call.value) === price);

    const again = await buyer.post('/shop/orders', { item: 'dice.glow' });

    ok('asked for again, the order and its purchase are the same', again.status === 200 && again.body.order.id === ordered.body.order.id && again.body.call.data === ordered.body.call.data);

    const revenue = await read('revenue');
    const rungBefore = buyer.rung;
    const bought = await pay(buyer, ordered.body);

    ok('the buyer\'s wallet paid the shop', bought.sent.mined === 'success');
    ok('the server took the transaction', bought.told.status === 200 && bought.told.body.state === 'sent', said(bought.told));
    ok('the look was delivered once the shop said it was sold', bought.paid?.delivered === true, JSON.stringify(bought.paid));
    ok('the buyer was rung', await until(RUNG_WITHIN_MS, () => buyer.rung > rungBefore) !== null);
    ok('it is in the buyer\'s collection, bought', (await collected(buyer)).some((look) => look.item === 'dice.glow' && look.via === 'purchase'));

    const sale = await read('saleOf', [quote.order]);
    const cut = price * BigInt(SHOP_REFERRAL_BPS) / 10_000n;

    ok('the shop holds the sale: the buyer, the price, the inviter and their cut', sale[0] === buyer.address && sale[4] === price && sale[3] === inviter.address && sale[5] === cut, JSON.stringify(sale.map(String)));
    ok('the shop\'s revenue grew by the price less the inviter\'s cut', await read('revenue') === revenue + price - cut);

    const owned = await buyer.post('/shop/orders', { item: 'dice.glow' });

    refusedAs('a look the buyer owns is not sold to them again', owned, 'shop-owned');

    console.log('\na gift');

    const gift = await buyer.post('/shop/orders', { item: 'back.glow', for: friend.handle });

    ok('a look is bought for a friend', gift.status === 200 && gift.body.order.for === friend.handle, said(gift));

    const given = await pay(buyer, gift.body);

    ok('it was delivered to the friend', given.paid?.delivered === true);
    ok('the friend holds it as a gift from the buyer, and the buyer does not', (await collected(friend)).some((look) => look.item === 'back.glow' && look.via === 'gift' && look.from === buyer.handle) && !(await collected(buyer)).some((look) => look.item === 'back.glow'));

    const stranger = await player('Stranger');

    refusedAs('a look is given to friends only', await buyer.post('/shop/orders', { item: 'felt.glow', for: stranger.handle }), 'shop-friend');

    console.log('\na bundle, priced down for what the buyer owns');

    const bundle = state.items.find((item) => item.id === 'bundle.glow');
    const bundled = await buyer.post('/shop/orders', { item: 'bundle.glow' });

    ok('the bundle costs less than its price for somebody who owns a look of it', bundled.status === 200 && BigInt(bundled.body.order.price) < BigInt(bundle.price), `${ shown(BigInt(bundled.body?.order?.price ?? 0)) } of ${ shown(BigInt(bundle.price)) }`);

    const whole = await pay(buyer, bundled.body);
    const glow = (await collected(buyer)).filter((look) => look.item.endsWith('.glow'));

    ok('every look of it the buyer lacked was delivered', whole.paid?.delivered === true && glow.length === 15, `${ glow.length } of 15`);

    console.log('\nwho may not buy, and what is refused');

    const minor = await player('Minor');

    sql(`update users set is_minor = true, allow_stranger_messages = false where id = ${ literal(minor.id) }`);
    refusedAs('somebody under 18', await minor.post('/shop/orders', { item: 'dice.neon' }), 'shop-minor');

    const broke = await player('Broke', 0n);

    refusedAs('somebody whose wallet cannot pay is told so before a wallet is asked', await broke.post('/shop/orders', { item: 'dice.neon' }), 'shop-funds');
    refusedAs('a name that is no look', await buyer.post('/shop/orders', { item: 'dice.nowhere' }), 'shop-item');

    console.log('\na payment the chain refuses, and paying again');

    const paused = await buyer.post('/shop/orders', { item: 'pawns.neon' });

    await asAdmin('pause');

    const refused = await sendRefused(buyer, paused.body.call);

    ok('a payment while the shop is paused is refused by the chain', refused.mined === 'reverted');
    await buyer.post(`/shop/orders/${ paused.body.order.id }/sent`, { hash: refused.hash });

    const failed = await until(PAID_WITHIN_MS, async () =>
    {
        const order = (await buyer.get(`/shop/orders/${ paused.body.order.id }`)).body;

        return order?.state === 'failed' ? order : null;
    });

    ok('the order says the chain refused it, in the shop\'s own word', failed?.failure === 'EnforcedPause', JSON.stringify(failed));
    refusedAs('while paused, a new order is refused before a wallet is asked', await buyer.post('/shop/orders', { item: 'yard.neon' }), 'shop-closed');

    await asAdmin('unpause');

    const retried = await buyer.post('/shop/orders', { item: 'pawns.neon' });

    ok('asked again, the same order is handed back to be paid', retried.status === 200 && retried.body.order.id === paused.body.order.id && retried.body.order.state === 'quoted', said(retried));
    ok('and paid this time', (await pay(buyer, retried.body)).paid?.delivered === true);

    console.log('\nan order nobody pays');

    const unpaid = await buyer.post('/shop/orders', { item: 'chips.neon' });

    sql(`update shop_orders set deadline = date_trunc('second', now() - interval '6 minutes') where id = ${ literal(unpaid.body.order.id) }`);

    const ran = await until(PAID_WITHIN_MS, async () => ((await buyer.get(`/shop/orders/${ unpaid.body.order.id }`)).body?.state === 'expired'));

    ok('runs out once it can no longer be paid', ran !== null);

    console.log('\nwhat the inviter earned');

    const earned = (await inviter.get('/shop/earnings')).body;
    const owedOnChain = await read('earnings', [inviter.address]);

    ok('the inviter is told what the shop owes them, as the shop holds it', earned?.earnings === owedOnChain.toString() && owedOnChain > 0n && earned.share === SHOP_REFERRAL_BPS, JSON.stringify(earned));

    const before = await reader.getBalance({ address: inviter.address });
    const claim = await inviter.post('/shop/earnings/claim');
    const claimed = claim.status === 200 ? await send(inviter, claim.body) : null;

    ok('the claim is composed for the inviter\'s wallet and paid', claimed?.mined === 'success', said(claim));
    ok('the inviter\'s wallet holds what it was owed, less the gas', claimed !== null && await reader.getBalance({ address: inviter.address }) === before + owedOnChain - claimed.gasPaid);
    ok('the shop owes them nothing now', await read('earnings', [inviter.address]) === 0n);
    refusedAs('a claim with nothing to claim', await inviter.post('/shop/earnings/claim'), 'shop-nothing');

    console.log('\nthe shop\'s books');

    const [held, owedAll, revenueNow, solvent] = await Promise.all([reader.getBalance({ address: SHOP }), read('totalEarnings'), read('revenue'), read('solvent')]);

    ok('the shop holds exactly its revenue and what inviters have still to claim, and says it is solvent', held === revenueNow + owedAll && solvent === true, `${ shown(held) } held, ${ shown(revenueNow) } revenue, ${ shown(owedAll) } owed`);
}

main()
    .catch((error) =>
    {
        console.error(error);
        failures += 1;
    })
    .finally(() =>
    {
        for (const who of everyone)
        {
            who.socket?.close();
        }

        console.log(`\n${ checks - failures } of ${ checks } checks passed`);
        process.exitCode = failures === 0 ? 0 : 1;
    });

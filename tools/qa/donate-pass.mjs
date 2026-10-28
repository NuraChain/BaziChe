/**
 * Donations over the real api, the built server and a local chain: a watcher gives NURA to a player
 * of the game they watch, sent to `ArcadeTips` from the watcher's own wallet with the call the
 * server composes, and believed once the contract holds it. Every gift is read back from the
 * contract and from the player's wallet.
 *
 *   PGDATABASE=<the server's database> QA_BASE=http://localhost:5300 QA_TIPS=<the gifts contract> node tools/qa/donate-pass.mjs
 *
 * The server runs built, on a database nobody else uses, with NURA_RPC_URL, NURA_CHAIN_ID=31337 and
 * NURA_TIPS_ADDRESS naming a hardhat node and the gifts contract `vault-deploy.mjs` put on it for
 * this run (QA_TIPS is that contract, QA_RPC the node). PGDATABASE names the server's database,
 * because a minor is marked and a gift run out by hand. The node's clock is moved on by half an
 * hour at the end, so the next run wants a new node.
 */
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, formatEther, http, toHex, zeroAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { LEAST_NURA, MOST_NURA, PRESETS_NURA } from '../../backend/src/domains/donate/policy.ts';
import { DONATE_REFUSALS } from '../../backend/src/domains/donate/refusals.ts';
import { databaseName, sql } from './db.mjs';
import { VAULT_ADMIN_KEY, tipsArtifact } from './vault-deploy.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const TIPS = process.env.QA_TIPS;

const WEI = 10n ** 18n;

const HELLO_WITHIN_MS = 8000;

const SETTLED_WITHIN_MS = 30_000;

/** A gift nobody said they sent is asked about every thirty seconds, so one made by hand can wait that long to be found. */
const UNSENT_WITHIN_MS = 45_000;

const RUNG_WITHIN_MS = 3000;

const ABI = tipsArtifact().abi;

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

const tag = () => Math.floor(Math.random() * 100000);

const said = (answer) => `${ answer.status } ${ answer.body?.error?.code ?? '' } ${ (answer.text ?? '').slice(0, 160) }`;

const refusedAs = (label, answer, word) =>
    ok(label, answer.status === DONATE_REFUSALS[word] && answer.body?.error?.code === word, said(answer));

/** A donation's id as the contract keys it: its uuid as 32 bytes. */
const idOf = (uuid) => `0x${ uuid.replaceAll('-', '').toLowerCase().padStart(64, '0') }`;

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

const tipOf = (from, id) => reader.readContract({ address: TIPS, abi: ABI, functionName: 'tipOf', args: [from, id] });

const balance = (address) => reader.getBalance({ address });

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

        if (frame.t === 'nudge' && frame.scope === 'me' && frame.id === 'donations')
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

const person = async (name, holds = 1000n * WEI) =>
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

    return { hash, mined: receipt.status };
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

/** A gift as its giver reads it, once it is no longer on its way. */
const settled = (giver, id, within = SETTLED_WITHIN_MS) => until(within, async () =>
{
    const gift = (await giver.get(`/donations/${ id }`)).body;

    return gift !== null && gift.state !== 'prepared' && gift.state !== 'sent' ? gift : null;
});

const give = (giver, match, to, nura) => giver.post('/donations', { match, to, amount: (nura * WEI).toString() });

const playersFor = async (who, match) => (await who.get(`/donations/players?match=${ match }`)).body?.players ?? [];

const noticesOf = async (who) => ((await who.get('/notifications/')).body?.items ?? []).filter((one) => one.kind === 'donation');

const receivedBy = async (who) => (await who.get('/donations/history?side=received')).body?.donations ?? [];

const admin = createWalletClient({ account: privateKeyToAccount(VAULT_ADMIN_KEY), chain, transport: http(RPC) });

const asAdmin = async (functionName) =>
    reader.waitForTransactionReceipt({ hash: await admin.writeContract({ address: TIPS, abi: ABI, functionName }) });

async function main()
{
    if (TIPS === undefined || TIPS === '')
    {
        throw new Error('QA_TIPS names no gifts contract: run tools/qa/vault-deploy.mjs on the node and start the server with its NURA_TIPS_ADDRESS');
    }

    console.log(`the donate pass, against ${ BASE } on ${ databaseName() }, the gifts contract at ${ TIPS }`);

    const host = await person('Host');
    const guest = await person('Guest');
    const watcher = await person('Watcher');

    // A game of a move a day, so no clock plays for anybody or ends it while the pass works.
    const opened = await host.post('/tables/quick', { game: 'ludo', seats: 2, mode: 'turns', voice: 'off' });

    await guest.post('/tables/quick', { game: 'ludo', seats: 2, mode: 'turns', voice: 'off' });

    const tableId = opened.body?.id;
    const match = await until(10_000, async () => (await host.get(`/tables/${ tableId }`)).body?.matchId ?? null);

    if (match === null)
    {
        throw new Error(`the two players were never dealt a game at ${ tableId }: ${ said(opened) }`);
    }

    console.log('\nwhat a watcher is told');

    const before = (await watcher.get('/donations')).body;
    const presets = PRESETS_NURA.map((nura) => (BigInt(nura) * WEI).toString());

    ok('donations are open, with the amounts the sheet offers and the least and most a gift may be, in wei', before?.open === true && JSON.stringify(before.presets) === JSON.stringify(presets) && before.least === (BigInt(LEAST_NURA) * WEI).toString() && before.most === (BigInt(MOST_NURA) * WEI).toString(), JSON.stringify(before));
    ok('a watcher who has not confirmed the terms of playing for NURA may not give yet, and takes donations', before?.may === 'donate-terms' && before.accepting === true);
    refusedAs('a gift from them is refused in that word', await give(watcher, match, host.handle, 5n), 'donate-terms');

    await watcher.post('/vault/terms', { adult: true });

    ok('once they have, they may', (await watcher.get('/donations')).body?.may === 'yes');

    console.log('\nwho may be given NURA');

    const players = await playersFor(watcher, match);

    ok('a watcher may give to both players of the game, each named by handle', players.length === 2 && players.every((one) => one.may === true) && players.map((one) => one.who).sort().join() === [host.handle, guest.handle].sort().join(), JSON.stringify(players));

    await host.post('/vault/terms', { adult: true });

    ok('a player of it may give to nobody in it', (await playersFor(host, match)).every((one) => one.may === false));
    refusedAs('and a gift from them is refused as a player\'s', await give(host, match, guest.handle, 5n), 'donate-playing');
    refusedAs('a game nobody is playing is nobody\'s to give in', await give(watcher, '00000000-0000-4000-8000-000000000000', host.handle, 5n), 'donate-nobody');
    refusedAs('less than the least is not a gift', await watcher.post('/donations', { match, to: host.handle, amount: (BigInt(LEAST_NURA) * WEI - 1n).toString() }), 'donate-amount');
    refusedAs('nor more than the most', await watcher.post('/donations', { match, to: host.handle, amount: (BigInt(MOST_NURA) * WEI + 1n).toString() }), 'donate-amount');

    console.log('\na gift made');

    const paying = await give(watcher, match, host.handle, 5n);
    const call = paying.body?.call;
    const decoded = call === undefined ? null : decodeFunctionData({ abi: ABI, data: call.data });
    const left = (Date.parse(paying.body?.donation?.deadline ?? '') - Date.now()) / 60_000;

    ok('a gift is written and its call composed, from the watcher\'s wallet, to the gifts contract, carrying the amount', paying.status === 200 && call?.from === watcher.address && call.to.toLowerCase() === TIPS.toLowerCase() && BigInt(call.value) === 5n * WEI && paying.body.donation.state === 'prepared', said(paying));
    ok('the call is tip(the gift\'s id, the player\'s wallet, its deadline), good for half an hour', decoded?.functionName === 'tip' && decoded.args[0] === idOf(paying.body.donation.id) && decoded.args[1] === host.address && left > 29 && left <= 30, JSON.stringify(decoded?.args?.map(String)));

    const again = await give(watcher, match, `@${ host.handle.toUpperCase() }`, 5n);

    ok('asked for again, by the handle in any case, the gift and its call are the same', again.status === 200 && again.body.donation.id === paying.body.donation.id && again.body.call.data === call?.data, said(again));

    const held = await balance(host.address);
    const rungBefore = host.rung;
    const sent = await send(watcher, call);
    const told = await watcher.post(`/donations/${ paying.body.donation.id }/sent`, { hash: sent.hash });
    const gift = await settled(watcher, paying.body.donation.id);
    const record = await tipOf(watcher.address, idOf(paying.body.donation.id));

    ok('the watcher\'s wallet sent it and the server took the transaction', sent.mined === 'success' && told.status === 200 && told.body.state === 'sent' && told.body.hash === sent.hash.toLowerCase(), said(told));
    ok('the server believed it once the contract held it', gift?.state === 'confirmed' && gift.confirmedAt !== undefined, JSON.stringify(gift));
    ok('the contract holds the gift under the watcher and its id: the player and the amount', record[0] === host.address && record[1] === 5n * WEI && record[2] > 0n, JSON.stringify(record.map(String)));
    ok('the player\'s own wallet holds five NURA more, all of it', await balance(host.address) === held + 5n * WEI, `${ formatEther(await balance(host.address) - held) } NURA`);
    ok('the player was rung', await until(RUNG_WITHIN_MS, () => host.rung > rungBefore) !== null);

    const notices = await noticesOf(host);

    ok('the player is told who sent how much, once', notices.length === 1 && notices[0].actor === watcher.handle && notices[0].ref?.amount === (5n * WEI).toString(), JSON.stringify(notices));

    const received = await receivedBy(host);
    const given = (await watcher.get('/donations/history?side=given')).body?.donations ?? [];

    ok('the player\'s list of NURA received has it, from the watcher, at Ludo', received.length === 1 && received[0].id === paying.body.donation.id && received[0].from === watcher.handle && received[0].state === 'confirmed' && received[0].game === 'ludo', JSON.stringify(received));
    ok('the watcher\'s list of NURA given has it, to the player', given.some((one) => one.id === paying.body.donation.id && one.to === host.handle && one.state === 'confirmed'));

    const table = (await host.get(`/tables/${ tableId }`)).body;
    const lines = ((await host.get(`/chat/${ table?.conversationId }/messages`)).body?.messages ?? [])
        .filter((one) => one.kind === 'system' && one.payload?.key === 'chat.line.donation')
        .map((one) => one.payload.params);

    ok('the game\'s chat says who gave whom how much', lines.length === 1 && lines[0].who === watcher.handle && lines[0].to === host.handle && lines[0].amount === (5n * WEI).toString(), JSON.stringify(lines));

    console.log('\na gift that is not the one prepared');

    const other = await give(watcher, match, guest.handle, 10n);
    const deadline = decodeFunctionData({ abi: ABI, data: other.body.call.data }).args[2];
    const forged = { to: TIPS, value: toHex(10n * WEI), data: encodeFunctionData({ abi: ABI, functionName: 'tip', args: [idOf(other.body.donation.id), host.address, deadline] }) };
    const hostHeld = await balance(host.address);

    await send(watcher, forged);

    const failed = await settled(watcher, other.body.donation.id, UNSENT_WITHIN_MS);

    ok('a gift sent by hand under its id to another player is found though nobody said it was sent, failed, and believed of nobody', failed?.state === 'failed' && failed.failure === 'mismatch', JSON.stringify(failed));
    ok('the contract passed the NURA to whoever the hand-made call named, which only that call could do', await balance(host.address) === hostHeld + 10n * WEI);
    ok('the player it was prepared for is told nothing and lists nothing received', (await noticesOf(guest)).length === 0 && (await receivedBy(guest)).length === 0);
    ok('and the player it went to is told of no second gift', (await noticesOf(host)).length === 1 && (await receivedBy(host)).length === 1);

    console.log('\nwho takes none, and who may not give');

    const off = await guest.post('/donations/accepting', { on: false });

    ok('a player who turns donations off is told so, and offered to nobody', off.body?.accepting === false && (await guest.get('/donations')).body?.accepting === false && (await playersFor(watcher, match)).find((one) => one.who === guest.handle)?.may === false, said(off));
    refusedAs('and a gift for them is answered as nobody\'s', await give(watcher, match, guest.handle, 5n), 'donate-nobody');

    await guest.post('/donations/accepting', { on: true });

    ok('turned on again, they may be given NURA', (await playersFor(watcher, match)).find((one) => one.who === guest.handle)?.may === true);

    sql(`update users set is_minor = true, allow_stranger_messages = false where id = ${ literal(watcher.id) }`);

    ok('a watcher marked under 18 may not give', (await watcher.get('/donations')).body?.may === 'donate-minor');
    refusedAs('and a gift from them is refused in that word', await give(watcher, match, guest.handle, 5n), 'donate-minor');

    sql(`update users set is_minor = false where id = ${ literal(watcher.id) }`);
    sql(`update users set is_minor = true, allow_stranger_messages = false where id = ${ literal(guest.id) }`);

    ok('nor may a player marked under 18 be given NURA', (await playersFor(watcher, match)).find((one) => one.who === guest.handle)?.may === false);

    sql(`update users set is_minor = false where id = ${ literal(guest.id) }`);

    await node('hardhat_setBalance', [watcher.address, toHex(2n * WEI)]);

    const short = await give(watcher, match, guest.handle, 5n);

    refusedAs('a wallet that holds less than the gift is told so before its wallet is asked', short, 'donate-funds');
    ok('with what it holds', short.body?.error?.details?.held === (2n * WEI).toString() && short.body.error.details.amount === (5n * WEI).toString(), JSON.stringify(short.body?.error?.details));

    await node('hardhat_setBalance', [watcher.address, toHex(1000n * WEI)]);
    await asAdmin('pause');

    refusedAs('a paused gifts contract closes giving', await give(watcher, match, guest.handle, 5n), 'donate-closed');

    await asAdmin('unpause');

    const kept = sql(`select count(*) from donations where giver_id = ${ literal(watcher.id) } and receiver_id = ${ literal(guest.id) } and amount = ${ (5n * WEI).toString() }`);

    ok('a refused gift leaves nothing written', kept === '0', `${ kept } rows`);

    console.log('\na gift nobody made');

    const unsent = await give(watcher, match, guest.handle, 3n);

    sql(`update donations set deadline = now() - interval '6 minutes' where id = ${ literal(unsent.body.donation.id) }`);

    const lapsed = await settled(watcher, unsent.body.donation.id);

    ok('a gift nobody sent is let go of once its deadline is well past', lapsed?.state === 'expired' && lapsed.failure === undefined, JSON.stringify(lapsed));

    console.log('\na gift sent too late');

    const late = await give(watcher, match, guest.handle, 4n);

    await node('evm_increaseTime', [31 * 60]);
    await node('evm_mine');

    const tooLate = await sendRefused(watcher, late.body.call);

    await watcher.post(`/donations/${ late.body.donation.id }/sent`, { hash: tooLate.hash });

    const reverted = await settled(watcher, late.body.donation.id);

    ok('the chain refuses a gift past its deadline, and the server says so in the contract\'s word', tooLate.mined === 'reverted' && reverted?.state === 'reverted' && reverted.failure === 'TipExpired', JSON.stringify(reverted));
    ok('the contract holds nothing under its id', (await tipOf(watcher.address, idOf(late.body.donation.id)))[0] === zeroAddress);
    ok('and that player was never given anything', (await receivedBy(guest)).length === 0 && (await noticesOf(guest)).length === 0);
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

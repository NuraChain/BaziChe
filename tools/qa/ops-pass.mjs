/**
 * The server watched, over the api of the built server and a local chain: the metrics a monitor
 * outside reads, the sockets and requests it counts, a spectator's delay it times, and alerts raised
 * and cleared, each said in the server's log, named on the owner's overview and written into the
 * metrics.
 *
 *   PGDATABASE=<the server's database> QA_BASE=http://localhost:5400 QA_LOG=<a file holding the
 *   server's output> QA_METRICS_TOKEN=<its METRICS_TOKEN> QA_NODE_STOP="<stops the node>" \
 *   node tools/qa/ops-pass.mjs
 *
 * The server runs built, in production, on a database nobody else uses, with the contracts
 * tools/qa/vault-deploy.mjs deployed on a node of its own (NURA_RPC_URL, NURA_CHAIN_ID=31337,
 * NURA_VAULT_ADDRESS, NURA_REFEREE_KEY, NURA_SHOP_ADDRESS), METRICS_TOKEN written, and
 * ADMIN_WALLET_ADDRESS hardhat's published #6 (QA_OWNER_KEY names another owner's key). The monitor
 * reads the database every thirty seconds and the reconciliation runs once a minute, so each alert is
 * waited for up to ninety seconds, and NuraChain out of reach up to four minutes. QA_NODE_STOP, a
 * command cmd.exe runs, stops the node for that last part; without it the part is left out.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { FAMILIES } from '../../backend/src/ops/measures.ts';
import { PROMETHEUS_TYPE } from '../../backend/src/ops/prometheus.ts';
import { databaseName, sql } from './db.mjs';
import { tableBody } from './tables.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const LOG = process.env.QA_LOG;

const TOKEN = process.env.QA_METRICS_TOKEN ?? '';

const NODE_STOP = process.env.QA_NODE_STOP;

const OWNER_KEY = process.env.QA_OWNER_KEY ?? '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';

const HELLO_WITHIN_MS = 10_000;

const SAMPLED_WITHIN_MS = 90_000;

const UNREACHED_WITHIN_MS = 240_000;

const BACKLOG_SECONDS = 660;

const literal = (text) => `'${ String(text).replaceAll('\'', '\'\'') }'`;

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

        return { status: response.status, body: parsed };
    };

    return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body), cookie: () => cookie, handle: null, socket: null, frames: [] };
};

const signed = async (name, wallet = privateKeyToAccount(generatePrivateKey())) =>
{
    const who = session();
    const me = await signInWallet(who.post, name, wallet);

    who.handle = me.handle;
    return who;
};

/** A socket as a browser opens one, keeping every frame it is handed. */
const connect = (who) => new Promise((resolve, reject) =>
{
    const socket = new WebSocket(`${ BASE.replace(/^http/, 'ws') }/ws`, { headers: { cookie: who.cookie(), origin: BASE } });
    const patience = setTimeout(() => reject(new Error(`the server never said hello to ${ who.handle }`)), HELLO_WITHIN_MS);

    socket.addEventListener('message', (event) =>
    {
        const frame = JSON.parse(String(event.data));

        who.frames.push(frame);

        if (frame.t === 'hello')
        {
            clearTimeout(patience);
            who.socket = socket;
            resolve(socket);
        }
    });

    socket.addEventListener('error', () =>
    {
        clearTimeout(patience);
        reject(new Error(`the socket for ${ who.handle } would not open; is PUBLIC_ORIGIN ${ BASE }?`));
    });
});

/** An upgrade the gate should turn away, and whether it was. */
const refusedUpgrade = (headers) => new Promise((resolve) =>
{
    const socket = new WebSocket(`${ BASE.replace(/^http/, 'ws') }/ws`, { headers });
    const done = (refused) =>
    {
        clearTimeout(patience);
        resolve(refused);
    };
    const patience = setTimeout(() => done(false), HELLO_WITHIN_MS);

    socket.addEventListener('open', () =>
    {
        socket.close();
        done(false);
    });
    socket.addEventListener('error', () => done(true));
});

const closed = (socket) => new Promise((resolve) =>
{
    socket.addEventListener('close', () => resolve());
    socket.close(1000);
});

/** The metrics as a map of each series' line to its value. */
const metrics = async (token = TOKEN) =>
{
    const response = await fetch(`${ BASE }/api/metrics`, token === '' ? {} : { headers: { authorization: `Bearer ${ token }` } });
    const text = await response.text();
    const values = new Map();

    for (const line of text.split('\n'))
    {
        if (line !== '' && !line.startsWith('#'))
        {
            const at = line.lastIndexOf(' ');

            values.set(line.slice(0, at), Number(line.slice(at + 1)));
        }
    }

    return { status: response.status, type: response.headers.get('content-type'), text, values };
};

const valueOf = (read, series) => read.values.get(series) ?? 0;

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

async function theEndpoint()
{
    console.log('\nthe metrics a monitor outside reads');

    const missing = await fetch(`${ BASE }/api/metrics`);
    const missingBody = await missing.text();
    const wrong = await fetch(`${ BASE }/api/metrics`, { headers: { authorization: `Bearer ${ 'x'.repeat(40) }` } });

    ok('without the token it is an address nothing is served at', missing.status === 404 && JSON.parse(missingBody)?.error?.code === 'not-found', `${ missing.status } ${ missingBody.slice(0, 80) }`);
    ok('and a wrong token is answered in the same bytes', wrong.status === missing.status && await wrong.text() === missingBody);

    const read = await metrics();

    ok('with the token, the text format', read.status === 200 && read.type === PROMETHEUS_TYPE, `${ read.status } ${ read.type }`);
    ok('naming every measure and every route family', read.text.includes('# TYPE baziche_up_seconds gauge') && read.text.includes('# TYPE baziche_requests_total counter')
        && FAMILIES.every((family) => read.values.has(`baziche_requests_total{family="${ family }"}`)));
}

async function theSockets(player)
{
    console.log('\nthe sockets and the requests it counts');

    const before = await metrics();
    const socket = await connect(player);

    await closed(socket);

    const foreign = await refusedUpgrade({ cookie: player.cookie(), origin: 'http://elsewhere.example' });
    const unsigned = await refusedUpgrade({ origin: BASE });

    ok('an upgrade from another site and one with no session are turned away', foreign && unsigned);

    for (let read = 0; read < 3; read += 1)
    {
        await player.get('/catalogue');
    }

    await pause(200);

    const after = await metrics();
    const grew = (series, by = 1) => valueOf(after, series) - valueOf(before, series) >= by;

    ok('a socket opened is counted', grew('baziche_sockets_opened_total'));
    ok('and how it closed', grew('baziche_sockets_closed_total{code="1000"}'));
    ok('and each upgrade turned away by why', grew('baziche_sockets_refused_total{reason="origin"}') && grew('baziche_sockets_refused_total{reason="cookie"}'));
    ok('every request under its route family', grew('baziche_requests_total{family="catalogue"}', 3));
}

async function theSpectator(owner, host, guest, watcher)
{
    console.log('\na spectator\'s delay');

    const before = await metrics();
    const table = await host.post('/tables', tableBody({ game: 'ludo', seats: 2, mode: 'live', privacy: 'public' }));

    await guest.post(`/tables/${ table.body.id }/seat`);
    await host.post(`/tables/${ table.body.id }/ready`, { ready: true });
    await guest.post(`/tables/${ table.body.id }/ready`, { ready: true });

    const started = await host.post(`/tables/${ table.body.id }/start`);
    const matchId = started.body?.id;

    if (!ok('a public live game is dealt', typeof matchId === 'string', `${ started.status }`))
    {
        return;
    }

    await connect(watcher);
    await watcher.get(`/tables/${ table.body.id }`);

    const players = new Map([[host.handle, host], [guest.handle, guest]]);
    let plays = 0;

    for (let turn = 0; turn < 40 && plays < 8; turn += 1)
    {
        const state = (await host.get(`/matches/${ matchId }`)).body;
        const seat = state?.players?.find((one) => one.seat === state.turn);
        const mover = players.get(seat?.who);

        if (mover === undefined || state.finishedAt !== undefined)
        {
            break;
        }

        const view = (await mover.get(`/matches/${ matchId }`)).body.view;
        const play = view.die === undefined || view.moves.length === 0 ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: view.moves[0] };
        const answer = await mover.post(`/matches/${ matchId }/play`, { key: `ops-${ turn }`, rev: state.rev, play });

        plays += answer.status === 200 ? 1 : 0;
        await pause(150);
    }

    const watched = await until(5_000, () => watcher.frames.filter((frame) => frame.t === 'watch').length >= 1 ? watcher.frames.filter((frame) => frame.t === 'watch') : null) ?? [];

    ok('the spectator is handed the moves as they are made', watched.length >= 1, `${ watched.length } frames for ${ plays } plays`);

    const after = await metrics();
    const delivered = valueOf(after, 'baziche_watch_frames_total') - valueOf(before, 'baziche_watch_frames_total');
    const p95 = after.values.get('baziche_watch_delivery_ms{quantile="0.95"}');

    ok('each frame handed to its spectator is timed', delivered >= watched.length, `${ delivered } timed, ${ watched.length } seen`);
    ok('and the 95th of the last five minutes is under a second', p95 !== undefined && p95 < 1000, `${ p95 } ms`);

    const overview = (await owner.get('/admin/overview')).body;

    ok('the owner\'s overview says the same', (overview?.health?.watch?.delivery?.frames ?? 0) >= watched.length, JSON.stringify(overview?.health?.watch?.delivery ?? null));

    watcher.socket?.close(1000);
}

async function theBacklog(owner, moderator, buyer)
{
    console.log('\nwork the server is behind on: raised, named and cleared');

    const order = randomUUID();

    sql(`insert into shop_orders (id, buyer_id, recipient_id, item_id, price, buyer_address, deadline, state, tx_hash, sent_at)
         select ${ literal(order) }, u.id, u.id, 'dice.glow', 5000000000000000000, w.address, now() + interval '20 minutes', 'sent',
                '0x' || encode(gen_random_bytes(32), 'hex'), now() - make_interval(secs => ${ BACKLOG_SECONDS })
           from users u join wallets w on w.user_id = u.id where u.handle = ${ literal(buyer.handle) } limit 1`);

    const raised = await until(SAMPLED_WITHIN_MS, () => (logged('alert raised', '"backlog"', '"orders"') ?? true) && true);

    loggedOk('the server says the alert once it crosses, as a warning about the queue', 'alert raised', '"backlog"', '"orders"', 'warn');
    ok('within one sample of the database', raised !== null);

    const seen = (await owner.get('/admin/overview')).body;
    const standing = seen?.alerts?.find((one) => one.alert === 'backlog' && one.about === 'orders');
    const queue = seen?.health?.watch?.queues?.find((one) => one.queue === 'orders');

    ok('the owner\'s overview names it, a warning with since when', standing?.level === 'warn' && typeof standing?.since === 'string', JSON.stringify(standing ?? null));
    ok('beside the queue it is about, its oldest past ten minutes', (queue?.count ?? 0) >= 1 && (queue?.oldest ?? 0) >= 600, JSON.stringify(queue ?? null));
    ok('and a moderator is named no alert', ((await moderator.get('/admin/overview')).body?.alerts ?? ['?']).length === 0);

    const read = await metrics();

    ok('the metrics carry it as a series of its own', valueOf(read, 'baziche_alert{alert="backlog",level="warn",about="orders"}') === 1);
    ok('and the queue\'s oldest', valueOf(read, 'baziche_queue_oldest_seconds{queue="orders"}') >= 600);

    sql(`update shop_orders set state = 'expired' where id = ${ literal(order) }`);

    const cleared = await until(SAMPLED_WITHIN_MS, async () => !(await owner.get('/admin/overview')).body?.alerts?.some((one) => one.alert === 'backlog'));

    ok('once the queue moves the alert is gone from the overview', cleared !== null);
    loggedOk('and the server says it cleared', 'alert cleared', '"backlog"', '"orders"', 'warn');
    ok('and the metrics no longer carry it', !(await metrics()).values.has('baziche_alert{alert="backlog",level="warn",about="orders"}'));
}

async function theChainAway(owner)
{
    console.log('\nNuraChain out of reach');

    if (NODE_STOP === undefined || NODE_STOP === '')
    {
        console.log('  SKIP  QA_NODE_STOP names no command that stops the node');
        return;
    }

    execSync(NODE_STOP, { stdio: 'ignore', shell: 'cmd.exe' });

    const down = await until(UNREACHED_WITHIN_MS, async () => (await owner.get('/admin/overview')).body?.alerts?.find((one) => one.alert === 'chain-down') ?? null);

    ok('two passes that cannot reach it raise an error on the owner\'s overview', down?.level === 'error', JSON.stringify(down ?? null));
    ok('and the money on its way says it was not reached', (await owner.get('/admin/overview')).body?.payouts?.reachable === false);
    loggedOk('the server says it as an error', 'alert raised', '"chain-down"', 'error');

    const read = await metrics();

    ok('the metrics carry it, and the passes in a row', valueOf(read, 'baziche_alert{alert="chain-down",level="error"}') === 1 && valueOf(read, 'baziche_chain_unreached_passes') >= 2);
}

const main = async () =>
{
    const database = databaseName();

    console.log(`ops pass against ${ BASE }, database ${ database }`);

    if (TOKEN === '')
    {
        console.log('  QA_METRICS_TOKEN names no token: start the server with METRICS_TOKEN written and hand the pass the same');
        process.exit(1);
    }

    const owner = await signed('Pass Owner', privateKeyToAccount(OWNER_KEY));

    if ((await owner.get('/auth/me')).body?.account?.staff !== 'owner')
    {
        console.log(`  the server does not name ${ privateKeyToAccount(OWNER_KEY).address } as its owner: start it with ADMIN_WALLET_ADDRESS set to that, or hand QA_OWNER_KEY the key of the one it names`);
        process.exit(1);
    }

    const moderator = await signed('Pass Moderator');

    await owner.post('/admin/staff', { handle: moderator.handle, role: 'moderator', reason: 'The ops pass needs a moderator' });

    const host = await signed('Pass Host');
    const guest = await signed('Pass Guest');
    const watcher = await signed('Pass Watcher');

    await theEndpoint();
    await theSockets(host);
    await theSpectator(owner, host, guest, watcher);
    await theBacklog(owner, moderator, host);
    await theChainAway(owner);

    console.log(`\n${ checks - failures } of ${ checks } checks passed`);
    process.exit(failures === 0 ? 0 : 1);
};

await main();

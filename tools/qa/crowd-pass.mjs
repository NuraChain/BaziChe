/**
 * A crowd on the realtime socket: how far one server process goes toward three thousand clients,
 * measured on this machine and said as measured.
 *
 *   PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 API_RATE_MAX=20000 npm start
 *   QA_BASE=http://localhost:5300 QA_PID=<the server's pid> node tools/qa/crowd-pass.mjs
 *
 * The server runs in production, where it trusts `X-Forwarded-For` (`trustProxy`): every client
 * here is an address of its own, so neither the handshake ceiling nor the sign-in budget of one
 * address stands in for a crowd, as they would for one machine's real clients. Run it only against
 * a server on this machine and a database that is disposable: it signs in thousands of accounts.
 *
 * The clients live in processes of their own (`crowd-client.mjs`, QA_CHILDREN of them), so the
 * generator is never the limit, and each reports its own event loop to prove it. Every time is the
 * clock every process on this machine shares (`performance.timeOrigin + performance.now()`); nothing
 * subtracts a time the server wrote.
 *
 * Parts (QA_PARTS, in this order): ramp (QA_LEVELS sockets, opened QA_WAVE at a time, and when the
 * last level is the process's ceiling QA_OVER more, which it must turn away), games (QA_GAMES tables
 * of two with QA_WATCHERS watching each, QA_MOVES moves a table), crowd (one game and every other
 * socket watching it), slow (QA_SLOW sockets that stop reading, watching the crowd's game), storm (the
 * server stopped and started again by QA_RESTART under every socket, each coming back as a browser
 * does, on the browser's own backoff), soak (the games for QA_SOAK seconds).
 *
 * The clients and the server share this machine's ephemeral ports (1024 to 15000 here), and a port
 * stays taken for two minutes after its connection closes. So watchers open the table's page a few
 * dozen at a time over connections kept alive, as people arrive, and the storm is the server going
 * away, which leaves the clients' ports free; a storm the clients start themselves, or three thousand
 * pages opened in one instant, runs this machine out of ports before it asks the server anything.
 * The server's memory is read by QA_PID, and its own health (event loop, pool, sockets, failures)
 * from the admin's overview as QA_ADMIN, a fixture account the disposable database gives the admin
 * role (`insert into staff_members (user_id, role) select id, 'admin' from users where handle = ...`).
 */
import { execSync, fork, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../backend/src/db/wallet-fixtures.ts';
import { SOCKETS_MOST } from '../../backend/src/realtime/limits.ts';
import { recorder } from './seats.mjs';
import { tableBody } from './tables.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';
const LEVELS = (process.env.QA_LEVELS ?? '100,500,1000,2000,3000').split(',').map(Number);
const PARTS = new Set((process.env.QA_PARTS ?? 'ramp,games,crowd,storm,slow,soak').split(','));
const CHILDREN = Number(process.env.QA_CHILDREN ?? 4);
const WAVE = Number(process.env.QA_WAVE ?? 100);
const HOLD_MS = Number(process.env.QA_HOLD ?? 15) * 1000;
const GAMES = Number(process.env.QA_GAMES ?? 20);
const WATCHERS = Number(process.env.QA_WATCHERS ?? 10);
const MOVES = Number(process.env.QA_MOVES ?? 30);
const SOAK_MS = Number(process.env.QA_SOAK ?? 120) * 1000;
const SLOW = Number(process.env.QA_SLOW ?? 50);
const OVER = Number(process.env.QA_OVER ?? 50);
let PID = process.env.QA_PID ?? '';
const RESTART = process.env.QA_RESTART;
const ADMIN = process.env.QA_ADMIN ?? 'dana.w';
const OUT = process.env.QA_OUT ?? fileURLToPath(new URL(`./out/crowd/${ new Date().toISOString().replace(/[:.]/g, '-') }`, import.meta.url));

const { record, finish } = recorder('crowd pass');

const stamp = () => performance.timeOrigin + performance.now();

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks `check` every quarter second until it says yes or `ms` have gone. */
const until = async (ms, check) =>
{
    const end = stamp() + ms;

    while (stamp() < end)
    {
        if (await check())
        {
            return true;
        }

        await pause(250);
    }

    return false;
};

const port = Number(new URL(BASE).port || 80);

/** Whoever listens on the server's port, as this machine says. */
const listener = () => execSync('netstat -ano', { encoding: 'utf8' }).split('\n')
    .filter((line) => new RegExp(`[:.]${ port }\\s.*LISTENING`).test(line))
    .map((line) => line.trim().split(/\s+/).at(-1))
    .at(0) ?? '';

const answers = () => fetch(`${ BASE }/api/healthz`).then((answer) => answer.ok).catch(() => false);

const centile = (values, share) =>
{
    if (values.length === 0)
    {
        return null;
    }

    const sorted = [...values].sort((a, b) => a - b);

    return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))]);
};

const spread = (values) => ({ count: values.length, p50: centile(values, 0.5), p95: centile(values, 0.95), p99: centile(values, 0.99), most: centile(values, 1) });

const said = (one) => one.count === 0 ? 'none' : `p50 ${ one.p50 } ms, p95 ${ one.p95 } ms, p99 ${ one.p99 } ms, most ${ one.most } ms (${ one.count })`;

const refusals = {};

/** An address of its own for every account, so the server meters each as a client of its own. */
const addressOf = (index) => `10.${ ((index + 1) >> 16) & 255 }.${ ((index + 1) >> 8) & 255 }.${ (index + 1) & 255 }`;

const person = (index, key) => ({ index, key, address: addressOf(index), cookie: '' });

async function call(who, method, path, body)
{
    const response = await fetch(`${ BASE }/api${ path }`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': who.address, ...(who.cookie === '' ? {} : { cookie: who.cookie }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    }).catch(() => null);

    if (response === null)
    {
        refusals[`${ method } ${ path } unreached`] = (refusals[`${ method } ${ path } unreached`] ?? 0) + 1;
        return { status: 0, body: null };
    }

    for (const line of response.headers.getSetCookie?.() ?? [])
    {
        if (line.startsWith('nura.session=') || line.startsWith('__Host-nura.session='))
        {
            who.cookie = line.split(';')[0];
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

    if (response.status >= 400)
    {
        const key = `${ method } ${ path.replace(/[0-9a-f-]{36}/g, ':id') } ${ response.status } ${ parsed?.error?.code ?? '' }`;

        refusals[key] = (refusals[key] ?? 0) + 1;
    }

    return { status: response.status, body: parsed };
}

async function signIn(who)
{
    const wallet = privateKeyToAccount(who.key);
    const issued = await call(who, 'POST', '/auth/challenge', { address: wallet.address });

    if (issued.status !== 200)
    {
        throw new Error(`no challenge for client ${ who.index }: ${ issued.status }`);
    }

    const signedIn = await call(who, 'POST', '/auth/wallet', {
        address: wallet.address,
        nonce: issued.body.nonce,
        signature: await wallet.signMessage({ message: issued.body.message })
    });

    if (signedIn.status !== 200)
    {
        throw new Error(`client ${ who.index } could not sign in: ${ signedIn.status } ${ JSON.stringify(signedIn.body).slice(0, 160) }`);
    }

    who.handle = signedIn.body.account.handle;
}

/** Runs `work` over `items` with at most `width` at once. */
async function pooled(items, width, work)
{
    const queue = [...items];
    const lanes = Array.from({ length: Math.min(width, queue.length) }, async () =>
    {
        while (queue.length > 0)
        {
            await work(queue.shift());
        }
    });

    await Promise.all(lanes);
}

const memoryOf = () =>
{
    if (PID === '')
    {
        return null;
    }

    try
    {
        const line = execSync(`tasklist /FI "PID eq ${ PID }" /FO CSV /NH`, { encoding: 'utf8' }).trim();

        return Math.round(Number(line.split('","').at(-1).replace(/[^0-9]/g, '')) / 1024);
    }
    catch
    {
        return null;
    }
};

const admin = person(1_000_000, WALLET_FIXTURES.find((one) => one.handle === ADMIN)?.privateKey);

const health = async () => (await call(admin, 'GET', '/admin/overview')).body?.health ?? null;

const healthLine = (seen) => seen === null
    ? 'no health (is QA_ADMIN an admin in this database?)'
    : `rss ${ Math.round(seen.rss / 1048576) } MB, heap ${ Math.round(seen.heap / 1048576) } MB, loop busy ${ Math.round(seen.loop.busy * 100) }% stall ${ Math.round(seen.loop.stall) } ms, pool ${ seen.pool.total - seen.pool.idle }/${ seen.pool.total } waiting ${ seen.pool.waiting }, sockets ${ seen.sockets }, failed ${ seen.failed }/${ seen.requests }`;

// ----------------------------------------------------------------- the clients' processes

let asked = 0;

const children = Array.from({ length: CHILDREN }, () =>
{
    const process = fork(fileURLToPath(new URL('./crowd-client.mjs', import.meta.url)), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const child = { process, waiting: new Map() };

    process.on('message', (reply) =>
    {
        const waiting = child.waiting.get(reply.id);

        child.waiting.delete(reply.id);

        if (reply.error !== undefined)
        {
            waiting?.reject(new Error(reply.error));
        }
        else
        {
            waiting?.resolve(reply);
        }
    });

    return child;
});

const ask = (child, message) => new Promise((resolve, reject) =>
{
    asked += 1;
    child.waiting.set(asked, { resolve, reject });
    child.process.send({ id: asked, ...message });
});

const childOf = (who) => children[who.index % CHILDREN];

/** Asks each child about the people it holds, at once. */
const acrossChildren = async (people, message) =>
{
    const shares = children.map((child) => ({ child, people: people.filter((who) => childOf(who) === child) }));

    return await Promise.all(shares.filter((share) => share.people.length > 0).map((share) => ask(share.child, message(share.people))));
};

const statsOf = async (reset = false) =>
{
    const replies = await Promise.all(children.map((child) => ask(child, { do: 'stats', reset })));

    return {
        open: replies.reduce((sum, one) => sum + one.open, 0),
        frames: replies.reduce((sum, one) => sum + one.frames, 0),
        gaps: replies.reduce((sum, one) => sum + one.gaps, 0),
        repeats: replies.reduce((sum, one) => sum + one.repeats, 0),
        kinds: replies.reduce((sum, one) =>
        {
            for (const [kind, count] of Object.entries(one.kinds))
            {
                sum[kind] = (sum[kind] ?? 0) + count;
            }

            return sum;
        }, {}),
        watched: replies.flatMap((one) => one.watched),
        closes: replies.flatMap((one) => one.closes),
        lag: Math.max(...replies.map((one) => one.lag.p99)),
        rss: replies.reduce((sum, one) => sum + one.rss, 0)
    };
};

const opens = async (people) =>
{
    const results = [];

    for (let at = 0; at < people.length; at += WAVE)
    {
        const replies = await acrossChildren(people.slice(at, at + WAVE), (share) => ({ do: 'open', accounts: share.map(({ index, cookie, address }) => ({ index, cookie, address })) }));

        results.push(...replies.flatMap((reply) => reply.results));
        await pause(100);
    }

    return results;
};

const tally = (results) => results.filter((one) => !one.ok).reduce((counts, one) =>
{
    counts[one.why] = (counts[one.why] ?? 0) + 1;
    return counts;
}, {});

// ----------------------------------------------------------------- games over the api

const ROLL = { kind: 'ludo', verb: 'roll' };

/** Opens a turn-based Ludo table for two and starts it: no clock and no sweep stands anybody up. */
async function gameFor(host, guest)
{
    const made = await call(host, 'POST', '/tables/', tableBody({ game: 'ludo', seats: 2, mode: 'turns', privacy: 'public' }));

    if (made.status !== 200)
    {
        throw new Error(`no table for ${ host.index }: ${ made.status } ${ JSON.stringify(made.body).slice(0, 120) }`);
    }

    const id = made.body.id;

    for (const [who, path, body] of [[guest, 'seat'], [guest, 'ready', { ready: true }], [host, 'ready', { ready: true }], [host, 'start']])
    {
        const answer = await call(who, 'POST', `/tables/${ id }/${ path }`, body);

        if (answer.status !== 200)
        {
            throw new Error(`table ${ id }: ${ path } answered ${ answer.status } ${ answer.body?.error?.code ?? '' }`);
        }
    }

    const read = await call(host, 'GET', `/tables/${ id }`);

    if (read.body?.matchId === undefined)
    {
        throw new Error(`table ${ id } has no game: ${ read.status }`);
    }

    return { tableId: id, matchId: read.body.matchId, players: [host, guest], sent: new Map(), moves: 0 };
}

/**
 * The watchers open the table's page: it reads the table, and its two plates name the players, so the
 * page says it shows them (`see`) as a browser does, and is told when either comes, goes or looks away.
 */
async function watch(game, watchers)
{
    const read = await acrossChildren(watchers, (share) => ({ do: 'read', path: `/tables/${ game.tableId }`, indices: share.map((who) => who.index) }));

    await acrossChildren(watchers, (share) => ({ do: 'see', indices: share.map((who) => who.index), who: game.players.map((one) => one.handle) }));

    return read;
}

/** One action by whoever is on turn, timed from the moment it is asked of the server. */
async function step(game)
{
    for (const player of game.players)
    {
        const seen = await call(player, 'GET', `/matches/${ game.matchId }`);
        const view = seen.body;

        if (view === null || view.finishedAt !== undefined || view.turn !== view.mine)
        {
            continue;
        }

        const play = view.view.die === undefined ? ROLL : { kind: 'ludo', verb: 'move', piece: view.view.moves[0] };
        const at = stamp();
        const answer = await call(player, 'POST', `/matches/${ game.matchId }/play`, { key: `crowd-${ game.matchId }-${ view.rev }`, rev: view.rev, play });

        if (answer.status === 200)
        {
            game.sent.set(answer.body.match.rev, at);
            game.moves += 1;
        }

        return answer.status === 200;
    }

    return false;
}

/** Each frame a watcher was pushed, timed against its move; and what was never pushed. */
function delivery(games, watched, watchersOf)
{
    const latencies = [];
    let expected = 0;
    let missing = 0;
    let twice = 0;

    const frames = new Map();

    for (const one of watched)
    {
        const key = `${ one.match } ${ one.index } ${ one.rev }`;

        frames.set(key, [...(frames.get(key) ?? []), one.at]);
    }

    for (const game of games)
    {
        for (const [rev, at] of game.sent)
        {
            for (const index of watchersOf(game))
            {
                const got = frames.get(`${ game.matchId } ${ index } ${ rev }`) ?? [];

                expected += 1;

                if (got.length === 0)
                {
                    missing += 1;
                }
                else
                {
                    twice += got.length - 1;
                    latencies.push(got[0] - at);
                }
            }
        }
    }

    return { latency: spread(latencies), expected, missing, twice };
}

// ----------------------------------------------------------------- the run

const report = { base: BASE, children: CHILDREN, levels: [], parts: {} };
const most = Math.max(...LEVELS, 0);
const pool = Array.from({ length: most + SLOW + OVER }, (_, index) => person(index, keccak256(toHex(`nura crowd pass ${ index }`))));

try
{
    await Promise.all(children.map((child) => ask(child, { do: 'setup', base: BASE })));

    if (admin.key === undefined)
    {
        throw new Error(`no wallet fixture called ${ ADMIN }`);
    }

    await signIn(admin);
    console.log(`\n[0] ${ pool.length } accounts sign in, each from an address of its own`);

    const signing = stamp();
    let signed = 0;

    await pooled(pool, 24, async (who) =>
    {
        await signIn(who);
        signed += 1;

        if (signed % 500 === 0)
        {
            console.log(`    ${ signed } signed in`);
        }
    });

    record('every account signed in', signed === pool.length, `${ signed } in ${ ((stamp() - signing) / 1000).toFixed(1) } s`);
    console.log(`    the server before: ${ memoryOf() ?? '?' } MB; ${ healthLine(await health()) }`);

    let open = 0;

    if (PARTS.has('ramp'))
    {
        console.log('\n[1] a ramp of sockets');

        for (const level of LEVELS)
        {
            const adding = pool.slice(open, level);
            const results = await opens(adding);
            const hello = results.filter((one) => one.ok).map((one) => one.at - one.asked);

            open = level;
            await pause(HOLD_MS);

            const stats = await statsOf(true);
            const seen = await health();
            const row = { level, opened: results.filter((one) => one.ok).length, refused: tally(results), hello: spread(hello), open: stats.open, frames: stats.kinds, gaps: stats.gaps, repeats: stats.repeats, memory: memoryOf(), health: seen, generatorLag: stats.lag };

            report.levels.push(row);
            console.log(`    ${ level }: ${ stats.open } open, hello ${ said(row.hello) }; frames since the last level ${ JSON.stringify(stats.kinds) }; the server ${ row.memory ?? '?' } MB; ${ healthLine(seen) }; the generator's longest wait ${ Math.round(stats.lag) } ms`);
            const closed = stats.closes.reduce((counts, one) =>
            {
                counts[`${ one.code } ${ one.reason }`] = (counts[`${ one.code } ${ one.reason }`] ?? 0) + 1;
                return counts;
            }, {});

            record(`${ level } sockets: every one connected and stays open`, stats.open === level, `${ stats.open } open; refused ${ JSON.stringify(row.refused) }; closed ${ JSON.stringify(closed) }`);
            record(`${ level } sockets: nothing lost or handed twice`, stats.gaps === 0 && stats.repeats === 0, `${ stats.gaps } gaps, ${ stats.repeats } repeats`);
        }

        if (open === SOCKETS_MOST && OVER > 0)
        {
            const beyond = pool.slice(most + SLOW, most + SLOW + OVER);
            const tried = await opens(beyond);

            await pause(2000);

            const after = await statsOf();

            report.over = { tried: OVER, let: tried.filter((one) => one.ok).length, refused: tally(tried), open: after.open };
            console.log(`    past the ceiling of ${ SOCKETS_MOST }: ${ report.over.let } of ${ OVER } let in, refused ${ JSON.stringify(report.over.refused) }; ${ after.open } open`);
            record(`past ${ SOCKETS_MOST } sockets the process turns a newcomer away and drops nobody it holds`, report.over.let === 0 && after.open === SOCKETS_MOST, `${ report.over.let } let in; ${ after.open } open`);
        }
    }

    const connected = pool.slice(0, open);

    if (PARTS.has('games') && connected.length >= GAMES * (2 + WATCHERS))
    {
        console.log(`\n[2] ${ GAMES } games at once, ${ WATCHERS } watching each`);

        const games = [];

        for (let table = 0; table < GAMES; table += 1)
        {
            const at = table * (2 + WATCHERS);
            const game = await gameFor(connected[at], connected[at + 1]);

            game.watchers = connected.slice(at + 2, at + 2 + WATCHERS);
            games.push(game);
            await watch(game, game.watchers);
        }

        await statsOf(true);

        const started = stamp();

        for (let round = 0; round < MOVES; round += 1)
        {
            await Promise.all(games.map(async (game, nth) =>
            {
                await pause((nth * 37) % 400);
                await step(game);
            }));
        }

        await pause(1500);

        const stats = await statsOf(true);
        const seen = await health();
        const result = delivery(games, stats.watched, (game) => game.watchers.map((who) => who.index));
        const moves = games.reduce((sum, game) => sum + game.moves, 0);

        report.parts.games = { moves, seconds: (stamp() - started) / 1000, ...result, gaps: stats.gaps, repeats: stats.repeats, health: seen, memory: memoryOf() };
        console.log(`    ${ moves } moves in ${ report.parts.games.seconds.toFixed(1) } s; move to watcher ${ said(result.latency) }; ${ healthLine(seen) }`);
        record('every move reached every watcher of its game, once', result.missing === 0 && result.twice === 0, `${ result.expected } expected, ${ result.missing } missing, ${ result.twice } twice`);
        record('no frame lost or handed twice on any socket', stats.gaps === 0 && stats.repeats === 0, `${ stats.gaps } gaps, ${ stats.repeats } repeats`);
        report.games = games.map(({ tableId, matchId, moves: made }) => ({ tableId, matchId, moves: made }));
    }

    let crowd = null;

    if (PARTS.has('crowd') && connected.length > 2)
    {
        const watchers = connected.slice(2);

        console.log(`\n[3] one game, ${ watchers.length } watching it`);
        crowd = await gameFor(connected[0], connected[1]);
        crowd.watchers = watchers;

        const reading = stamp();
        const read = await watch(crowd, watchers);

        const statuses = read.reduce((all, one) =>
        {
            for (const [status, count] of Object.entries(one.statuses))
            {
                all[status] = (all[status] ?? 0) + count;
            }

            return all;
        }, {});

        console.log(`    ${ watchers.length } watchers opened the table's page in ${ ((stamp() - reading) / 1000).toFixed(1) } s: ${ JSON.stringify(statuses) }`);
        record('every watcher opened the table\'s page', statuses[200] === watchers.length, JSON.stringify(statuses));
        await statsOf(true);

        for (let round = 0; round < MOVES; round += 1)
        {
            await step(crowd);
            await pause(700);
        }

        await pause(1500);

        const stats = await statsOf(true);
        const seen = await health();
        const result = delivery([crowd], stats.watched, (game) => game.watchers.map((who) => who.index));
        const lastOf = [...crowd.sent].map(([rev, at]) =>
        {
            const arrivals = stats.watched.filter((one) => one.match === crowd.matchId && one.rev === rev).map((one) => one.at - at);

            return arrivals.length === 0 ? null : Math.max(...arrivals);
        }).filter((one) => one !== null);

        report.parts.crowd = { watchers: watchers.length, moves: crowd.moves, ...result, lastWatcher: spread(lastOf), gaps: stats.gaps, repeats: stats.repeats, bytes: stats.watched[0]?.bytes ?? null, health: seen, memory: memoryOf() };
        console.log(`    ${ crowd.moves } moves; move to watcher ${ said(result.latency) }; to the LAST watcher of each move ${ said(report.parts.crowd.lastWatcher) }; ${ report.parts.crowd.bytes ?? '?' } bytes a frame; ${ healthLine(seen) }`);
        record('every move reached every watcher in the crowd, once', result.missing === 0 && result.twice === 0, `${ result.expected } expected, ${ result.missing } missing, ${ result.twice } twice`);
        record('no frame lost or handed twice in the crowd', stats.gaps === 0 && stats.repeats === 0, `${ stats.gaps } gaps, ${ stats.repeats } repeats`);
    }

    if (PARTS.has('slow') && crowd !== null)
    {
        const slow = pool.slice(most, most + SLOW);

        console.log(`\n[4] ${ slow.length } sockets that stop reading, watching the same game`);

        const stalled = await acrossChildren(slow, (share) => ({ do: 'stall', accounts: share.map(({ index, cookie, address }) => ({ index, cookie, address })) }));

        await Promise.all(slow.map((who) => call(who, 'GET', `/tables/${ crowd.tableId }`)));

        const before = await health();
        const begun = stamp();
        const drops = [];

        await statsOf(true);

        for (let round = 0; round < MOVES; round += 1)
        {
            await step(crowd);
            await pause(700);

            const now = await health();

            drops.push({ at: Math.round((stamp() - begun) / 1000), sockets: now?.sockets ?? null });
        }

        await pause(1500);

        const stats = await statsOf(true);
        const result = delivery([{ ...crowd, sent: new Map([...crowd.sent].filter(([, at]) => at >= begun)) }], stats.watched, (game) => game.watchers.map((who) => who.index));
        const after = await health();
        const gone = before !== null && after !== null ? before.sockets - after.sockets : null;
        const stalledOpen = stalled.flatMap((one) => one.results).filter((one) => one.ok).length;

        report.parts.slow = { stalled: stalledOpen, sockets: drops, gone, latency: result.latency, missing: result.missing, health: after };
        console.log(`    ${ stalledOpen } stalled; sockets over time ${ drops.map((one) => `${ one.at }s:${ one.sockets }`).join(' ') }; everybody else ${ said(result.latency) }`);
        record('the server lets go of every socket that stopped reading', gone !== null && gone >= stalledOpen, `${ gone } gone of ${ stalledOpen }`);
        record('nobody else missed a move while they hung', result.missing === 0, `${ result.missing } missing`);
        await acrossChildren(slow, () => ({ do: 'unstall' }));
    }

    if (PARTS.has('storm') && connected.length > 0 && RESTART === undefined)
    {
        console.log('\n[5] a reconnection storm: left out, QA_RESTART is not set');
    }

    if (PARTS.has('storm') && connected.length > 0 && RESTART !== undefined)
    {
        console.log(`\n[5] a reconnection storm: the server stopped and started again under ${ connected.length } sockets`);

        await acrossChildren(connected, (share) => ({ do: 'follow', indices: share.map((who) => who.index) }));

        const begun = stamp();

        execSync(`taskkill /PID ${ listener() } /F`);
        await until(15_000, async () => !await answers());

        const down = stamp();

        spawn(RESTART, { shell: true, detached: true, stdio: 'ignore' }).unref();

        const up = await until(60_000, answers);
        const serving = stamp();

        PID = listener();
        await until(90_000, async () => (await statsOf()).open === connected.length);

        const backs = (await Promise.all(children.map((child) => ask(child, { do: 'backs' })))).flatMap((reply) => reply.backs);
        const back = backs.filter((one) => one.back > 0).map((one) => one.back - begun);
        const tries = backs.reduce((counts, one) =>
        {
            counts[one.attempts] = (counts[one.attempts] ?? 0) + 1;
            return counts;
        }, {});
        const stats = await statsOf(true);
        const after = await health();

        report.parts.storm = { sockets: connected.length, stopped: Math.round(down - begun), served: Math.round(serving - begun), back: spread(back), tries, open: stats.open, after };
        console.log(`    the server gone in ${ report.parts.storm.stopped } ms and answering again ${ report.parts.storm.served } ms after the stop; every socket's first greeting from the stop ${ said(report.parts.storm.back) }; tries a socket ${ JSON.stringify(tries) }; ${ stats.open } open; ${ healthLine(after) }`);
        record('the server came back', up);
        record('every socket came back by itself, as a browser\'s does', stats.open === connected.length && back.length === connected.length, `${ stats.open } open of ${ connected.length }, ${ back.length } greeted again`);
        record('no frame lost or handed twice on the way back', stats.gaps === 0 && stats.repeats === 0, `${ stats.gaps } gaps, ${ stats.repeats } repeats`);
    }

    if (PARTS.has('soak') && connected.length >= 2 * (2 + WATCHERS))
    {
        console.log(`\n[6] a soak: games for ${ SOAK_MS / 1000 } s`);

        const games = [];
        const tables = Math.min(GAMES, Math.floor(connected.length / (2 + WATCHERS)));

        for (let table = 0; table < tables; table += 1)
        {
            const at = table * (2 + WATCHERS);
            const game = await gameFor(connected[at], connected[at + 1]);

            game.watchers = connected.slice(at + 2, at + 2 + WATCHERS);
            games.push(game);
            await watch(game, game.watchers);
        }

        await statsOf(true);

        const begun = stamp();
        const samples = [];
        let next = begun;

        while (stamp() - begun < SOAK_MS)
        {
            await Promise.all(games.map((game) => step(game)));

            if (stamp() >= next)
            {
                const seen = await health();

                samples.push({ at: Math.round((stamp() - begun) / 1000), memory: memoryOf(), rss: seen?.rss ?? null, stall: seen?.loop.stall ?? null, busy: seen?.loop.busy ?? null });
                next += 10_000;
            }

            await pause(300);
        }

        await pause(1500);

        const stats = await statsOf(true);
        const result = delivery(games, stats.watched, (game) => game.watchers.map((who) => who.index));
        const first = samples.find((one) => one.memory !== null)?.memory ?? null;
        const last = samples.at(-1)?.memory ?? null;

        report.parts.soak = { samples, ...result, gaps: stats.gaps, repeats: stats.repeats };
        console.log(`    ${ samples.map((one) => `${ one.at }s:${ one.memory ?? '?' }MB`).join(' ') }; move to watcher ${ said(result.latency) }`);
        record('the soak lost no move and no frame', result.missing === 0 && stats.gaps === 0 && stats.repeats === 0, `${ result.missing } missing, ${ stats.gaps } gaps`);
        record('the server did not keep growing', first === null || last === null || last <= first * 1.5, `${ first } MB to ${ last } MB`);
    }

    report.refusals = refusals;
    console.log(`\n  answers that were not a 200: ${ JSON.stringify(refusals) }`);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'report.json'), `${ JSON.stringify(report, null, 4) }\n`);
    console.log(`  report: ${ join(OUT, 'report.json') }`);
}
catch (error)
{
    record('the pass ran to its end', false, String(error?.stack ?? error).slice(0, 400));
}
finally
{
    await Promise.all(children.map((child) => ask(child, { do: 'quit' }).catch(() => undefined)));
    finish();
    setTimeout(() => process.exit(), 1000);
}

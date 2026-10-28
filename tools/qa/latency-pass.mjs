import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, launch, recorder, seat } from './seats.mjs';
import { tableBody } from './tables.mjs';

const TARGET = new URL(BASE);
const SAMPLES = Number(process.env.QA_SAMPLES ?? 24);
const CPU = Number(process.env.QA_CPU ?? 1);
const OUT = process.env.QA_OUT ?? fileURLToPath(new URL(`./out/latency/${ new Date().toISOString().replace(/[:.]/g, '-') }`, import.meta.url));
const PROFILES = [
    { name: 'loopback', oneWay: 0, port: null },
    { name: '4g', oneWay: 75, port: 5410 },
    { name: '3g', oneWay: 200, port: 5411 }
].filter((one) => (process.env.QA_PROFILES ?? 'loopback,4g,3g').split(',').includes(one.name));

const { record, finish } = recorder('latency-pass');

const delayed = (port, oneWay) => new Promise((resolve) =>
{
    const sockets = new Set();
    const server = createServer((inbound) =>
    {
        const outbound = connect(Number(TARGET.port), TARGET.hostname);
        sockets.add(inbound);
        sockets.add(outbound);
        const pipe = (from, to) =>
        {
            from.on('data', (chunk) => setTimeout(() =>
            {
                if (!to.destroyed)
                {
                    to.write(chunk);
                }
            }, oneWay));
            from.on('end', () => setTimeout(() => to.end(), oneWay));
            from.on('error', () => to.destroy());
            from.on('close', () => setTimeout(() => to.destroy(), oneWay));
        };
        pipe(inbound, outbound);
        pipe(outbound, inbound);
        inbound.on('close', () => sockets.delete(inbound));
        outbound.on('close', () => sockets.delete(outbound));
    });
    server.listen(port, '127.0.0.1', () => resolve({
        close: () => new Promise((done) =>
        {
            for (const socket of sockets)
            {
                socket.destroy();
            }
            server.close(() => done());
        })
    }));
});

const INSTRUMENT = () =>
{
    const stamp = () => performance.timeOrigin + performance.now();
    window.__lat = { press: [], acks: [], syncs: [], revs: [], watched: [] };
    window.addEventListener('pointerdown', () => window.__lat.press.push(stamp()), true);
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket
    {
        constructor(...args)
        {
            super(...args);
            this.addEventListener('message', (event) =>
            {
                if (typeof event.data === 'string' && event.data.includes('"t":"watch"'))
                {
                    window.__lat.watched.push(stamp());
                }
            });
        }
    };
    window.addEventListener('keydown', () => window.__lat.press.push(stamp()), true);
    const original = window.fetch;
    window.fetch = async (...args) =>
    {
        const answer = await original(...args);
        const url = String(args[0] instanceof Request ? args[0].url : args[0]);
        if (/\/api\/matches\/[^/]+\/play/.test(url))
        {
            window.__lat.acks.push(stamp());
        }
        if (/\/api\/matches\/[^/]+\/since|\/api\/matches\/[^/?]+(\?|$)/.test(url))
        {
            window.__lat.syncs.push(stamp());
        }
        return answer;
    };
    new MutationObserver((changes) =>
    {
        for (const change of changes)
        {
            if (change.type === 'attributes' && change.attributeName === 'data-rev')
            {
                window.__lat.revs.push({ at: stamp(), rev: change.target.getAttribute('data-rev') });
            }
        }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-rev'] });
};

const quantile = (values, q) =>
{
    if (values.length === 0)
    {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
};

const firstAfter = (list, at) => list.map((one) => (typeof one === 'number' ? one : one.at)).find((one) => one > at) ?? null;

const browser = await launch();
const report = { base: BASE, samples: SAMPLES, cpu: CPU, profiles: [] };
const proxies = [];

try
{
    const reza = await seat(browser, 'reza.t');
    const leila = await seat(browser, 'leila.a');
    const omid = await seat(browser, 'omid.k');
    const players = [reza, leila];

    for (const player of [...players, omid])
    {
        await player.context.addInitScript(INSTRUMENT);
        if (CPU > 1)
        {
            const cdp = await player.context.newCDPSession(player.page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
        }
    }

    for (const player of [...players, omid])
    {
        const mine = await player.api('GET', '/tables/mine');
        for (const one of mine.body?.tables ?? [])
        {
            await player.api('POST', `/tables/${ one.id }/leave`, { forfeit: true });
        }
    }

    const made = await reza.api('POST', '/tables', tableBody({
        game: 'ludo', seats: 2, mode: 'turns', privacy: 'public', blinds: 'mid'
    }));
    record('opens a turn-based ludo table for two', made.ok, `${ made.status }`);
    const table = made.body.id;
    const took = await leila.api('POST', `/tables/${ table }/seat`);
    record('the second player sits down', took.ok, `${ took.status }`);
    await leila.api('POST', `/tables/${ table }/ready`, { ready: true });
    await reza.api('POST', `/tables/${ table }/ready`, { ready: true });
    const started = await reza.api('POST', `/tables/${ table }/start`);
    record('the match starts', started.ok, `${ started.status }`);

    for (const profile of PROFILES)
    {
        const base = profile.port === null ? BASE : `http://localhost:${ profile.port }`;
        if (profile.port !== null)
        {
            proxies.push(await delayed(profile.port, profile.oneWay));
        }

        const requests = { reza: [], leila: [], omid: [] };
        for (const [name, player] of [['reza', reza], ['leila', leila], ['omid', omid]])
        {
            player.page.removeAllListeners('request');
            player.page.on('request', (request) =>
            {
                const url = new URL(request.url());
                if (url.pathname.startsWith('/api/'))
                {
                    requests[name].push(`${ request.method() } ${ url.pathname.replace(/[0-9a-f-]{36}/g, ':id') }`);
                }
            });
            await player.page.goto(`${ base }/app/play/${ table }`, { waitUntil: 'networkidle' });
        }
        await reza.page.waitForTimeout(1500);
        requests.reza.length = 0;
        requests.leila.length = 0;
        requests.omid.length = 0;

        const own = [];
        const other = [];
        const pushed = [];
        const shown = [];
        const misses = [];

        for (let sample = 0; sample < SAMPLES; sample += 1)
        {
            let mover = null;
            let watcher = null;
            let control = null;
            const found = Date.now() + 15_000;

            while (control === null && Date.now() < found)
            {
                for (const [one, two] of [[reza, leila], [leila, reza]])
                {
                    const roll = one.page.getByRole('button', { name: 'Roll the dice', exact: true });
                    const moves = one.page.locator('.board-canvas .lp[data-movable] .lp-pawn');
                    if (await roll.count() > 0 && await roll.first().isEnabled({ timeout: 300 }).catch(() => false))
                    {
                        [mover, watcher, control] = [one, two, roll.first()];
                        break;
                    }
                    if (await moves.count() > 0)
                    {
                        [mover, watcher, control] = [one, two, moves.first()];
                        break;
                    }
                }
                if (control === null)
                {
                    await reza.page.waitForTimeout(100);
                }
            }

            if (control === null)
            {
                misses.push(`sample ${ sample }: nobody had a control to press`);
                break;
            }

            const before = await mover.page.evaluate(() => window.__lat.press.length);
            await control.click();
            const pressAt = await mover.page.evaluate((index) => window.__lat.press[index] ?? null, before);

            const settled = Date.now() + 12_000;
            let ownAt = null;
            let otherAt = null;
            let pushedAt = null;
            let shownAt = null;

            while ((ownAt === null || otherAt === null || pushedAt === null || shownAt === null) && Date.now() < settled)
            {
                const mine = await mover.page.evaluate(() => window.__lat);
                const theirs = await watcher.page.evaluate(() => window.__lat);
                const looking = await omid.page.evaluate(() => window.__lat);
                ownAt = firstAfter(mine.revs.length > 0 ? mine.revs : mine.acks, pressAt);
                otherAt = firstAfter(theirs.revs.length > 0 ? theirs.revs : theirs.syncs, pressAt);
                pushedAt = firstAfter(looking.watched, pressAt);
                shownAt = firstAfter(looking.revs, pressAt);
                if (ownAt === null || otherAt === null || pushedAt === null || shownAt === null)
                {
                    await reza.page.waitForTimeout(25);
                }
            }

            if (pressAt === null || ownAt === null || otherAt === null || pushedAt === null || shownAt === null)
            {
                misses.push(`sample ${ sample }: own ${ ownAt === null ? 'never' : 'ok' }, other ${ otherAt === null ? 'never' : 'ok' }, spectator ${ pushedAt === null ? 'never pushed' : shownAt === null ? 'never shown' : 'ok' }`);
                continue;
            }

            own.push(ownAt - pressAt);
            other.push(otherAt - pressAt);
            pushed.push(pushedAt - pressAt);
            shown.push(shownAt - pressAt);
            await reza.page.waitForTimeout(900);
        }

        const tally = (list) => list.reduce((counts, one) =>
        {
            counts[one] = (counts[one] ?? 0) + 1;
            return counts;
        }, {});

        const spread = (list) => ({ p50: quantile(list, 0.5), p95: quantile(list, 0.95), p99: quantile(list, 0.99), most: quantile(list, 1) });
        const row = {
            profile: profile.name,
            rtt: profile.oneWay * 2,
            samples: own.length,
            own: spread(own),
            other: spread(other),
            spectatorFrame: spread(pushed),
            spectatorBoard: spread(shown),
            requests: { reza: tally(requests.reza), leila: tally(requests.leila), omid: tally(requests.omid) },
            misses
        };
        report.profiles.push(row);

        const said = (one) => `p50 ${ one.p50 } ms   p95 ${ one.p95 } ms   p99 ${ one.p99 } ms   most ${ one.most } ms`;

        console.log(`\n  ${ profile.name } (rtt ${ row.rtt } ms, ${ row.samples } presses)`);
        console.log(`    press -> own board        ${ said(row.own) }`);
        console.log(`    press -> opponent board   ${ said(row.other) }`);
        console.log(`    press -> spectator frame  ${ said(row.spectatorFrame) }`);
        console.log(`    press -> spectator board  ${ said(row.spectatorBoard) }`);
        console.log(`    api requests during play: players ${ requests.reza.length + requests.leila.length }, spectator ${ requests.omid.length }`);
        record(`${ profile.name }: every press was measured on both sides and by the spectator`, misses.length === 0, misses.join('; '));
        record(`${ profile.name }: the spectator is pushed each move about as soon as the opponent sees it`, row.spectatorFrame.p95 !== null && row.spectatorFrame.p95 <= (row.other.p95 ?? 0) + 250,
            `spectator frame p95 ${ row.spectatorFrame.p95 } ms against the opponent's board at ${ row.other.p95 } ms`);
    }

    for (const player of players)
    {
        await player.api('POST', `/tables/${ table }/leave`, { forfeit: true });
    }

    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'report.json'), `${ JSON.stringify(report, null, 4) }\n`);
    console.log(`\n  report: ${ join(OUT, 'report.json') }`);
}
finally
{
    for (const proxy of proxies)
    {
        await proxy.close();
    }
    await browser.close();
    finish();
}

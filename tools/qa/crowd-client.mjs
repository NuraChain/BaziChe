/**
 * One process of the crowd pass's clients (`crowd-pass.mjs` forks a few): it holds a share of the
 * sockets, records what each is handed, and answers the pass over IPC. The clients live outside the
 * pass's own process so that the generator is never what limits the crowd: a process with three
 * thousand sockets and the pass's bookkeeping would measure its own event loop.
 *
 * Every socket keeps the ordinal of each frame it is handed (`n`, which the server stamps once a
 * frame is decided and counts by one a socket), so a frame lost or handed twice is a gap or a
 * repeat; and every `watch` frame's game, revision and arrival, on the clock every process on this
 * machine shares (`performance.timeOrigin + performance.now()`), so a move can be timed from the
 * pass's request to each watcher's screen.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const stamp = () => performance.timeOrigin + performance.now();

/** The browser's own rungs, read from its store so the two cannot drift. */
const BACKOFF_MS = JSON.parse(readFileSync(new URL('../../frontend/src/stores/realtime.store.ts', import.meta.url), 'utf8').match(/export const BACKOFF_MS = (\[[^\]]+\])/)[1]);

/** What a failure was: a socket's error and a fetch's both carry the system's code somewhere in their causes. */
const causeOf = (error) =>
{
    let at = error;

    for (let depth = 0; depth < 5 && at !== undefined && at !== null; depth += 1)
    {
        if (typeof at.code === 'string')
        {
            return at.code;
        }

        at = at.cause ?? at.error;
    }

    return 'socket error';
};

const lag = monitorEventLoopDelay({ resolution: 10 });

lag.enable();

/** index -> { account, socket, frames, last, gaps, repeats, watched, closes, opened, seeing, follow } */
const held = new Map();

const raw = [];

let base = '';

const headersOf = (account) => ({ cookie: account.cookie, origin: base, 'x-forwarded-for': account.address });

function open(account)
{
    return new Promise((resolve) =>
    {
        const one = held.get(account.index) ?? { account, socket: null, frames: 0, last: 0, gaps: 0, repeats: 0, kinds: {}, watched: [], closes: [], opened: 0, seeing: [], follow: null };
        const asked = stamp();
        let settled = false;

        const settle = (result) =>
        {
            if (!settled)
            {
                settled = true;
                clearTimeout(patience);
                resolve({ index: account.index, asked, ...result });
            }
        };

        const patience = setTimeout(() => settle({ ok: false, why: 'no hello in 20 s' }), 20_000);

        held.set(account.index, one);
        one.last = 0;

        let socket;

        try
        {
            socket = new WebSocket(`${ base.replace(/^http/, 'ws') }/ws`, { headers: headersOf(account) });
        }
        catch (error)
        {
            settle({ ok: false, why: String(error) });
            return;
        }

        one.socket = socket;

        socket.addEventListener('open', () =>
        {
            if (one.seeing.length > 0)
            {
                socket.send(JSON.stringify({ v: 1, t: 'see', who: one.seeing }));
            }
        });

        socket.addEventListener('message', (event) =>
        {
            const at = stamp();
            const text = String(event.data);
            const frame = JSON.parse(text);

            one.frames += 1;
            one.kinds[frame.t] = (one.kinds[frame.t] ?? 0) + 1;

            if (typeof frame.n === 'number')
            {
                if (frame.n <= one.last)
                {
                    one.repeats += 1;
                }
                else if (one.last !== 0 && frame.n !== one.last + 1)
                {
                    one.gaps += frame.n - one.last - 1;
                }

                one.last = Math.max(one.last, frame.n);
            }

            if (frame.t === 'hello')
            {
                one.opened = at;

                if (one.follow !== null && one.follow.back === 0)
                {
                    one.follow.back = at;
                }

                settle({ ok: true, at });
            }

            if (frame.t === 'watch')
            {
                one.watched.push({ match: frame.match.id, rev: frame.match.rev, at, bytes: text.length });
            }
        });

        socket.addEventListener('close', (event) =>
        {
            one.closes.push({ code: event.code, reason: event.reason, at: stamp() });
            settle({ ok: false, why: `closed ${ event.code } ${ event.reason }` });

            // As the browser does: a socket that closed under a page comes back on its own,
            // after the next rung of the backoff, a tenth either side.
            if (one.follow !== null && one.socket === socket)
            {
                const base = BACKOFF_MS[Math.min(one.follow.attempts, BACKOFF_MS.length - 1)];

                one.follow.attempts += 1;
                setTimeout(() => void open(account), base + base * 0.2 * (Math.random() - 0.5));
            }
        });

        socket.addEventListener('error', (event) => settle({ ok: false, why: causeOf(event) }));
    });
}

/**
 * A socket that never reads past its handshake: the slow client the outbox is there for. Node's
 * WebSocket reads whatever arrives, so this one speaks the upgrade by hand over TCP and then stops
 * reading, which leaves the server's writes to fill the kernel's buffers and then its own outbox.
 */
function stall(account)
{
    return new Promise((resolve) =>
    {
        const url = new URL(base);
        const socket = tcp(Number(url.port), url.hostname);
        let head = '';

        socket.setEncoding('latin1');
        socket.on('connect', () =>
        {
            socket.write([
                'GET /ws HTTP/1.1',
                `Host: ${ url.host }`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${ randomBytes(16).toString('base64') }`,
                'Sec-WebSocket-Version: 13',
                `Origin: ${ base }`,
                `Cookie: ${ account.cookie }`,
                `X-Forwarded-For: ${ account.address }`,
                '',
                ''
            ].join('\r\n'));
        });
        socket.on('data', (chunk) =>
        {
            head += chunk;

            if (head.includes('\r\n\r\n'))
            {
                socket.pause();
                raw.push(socket);
                resolve({ index: account.index, ok: head.startsWith('HTTP/1.1 101') });
            }
        });
        socket.on('error', () => resolve({ index: account.index, ok: false }));
    });
}

const settled = (work) => Promise.all(work);

const READERS = 32;

const commands = {
    async setup({ base: given })
    {
        base = given;
        return { ok: true };
    },

    async open({ accounts })
    {
        return { results: await settled(accounts.map((account) => open(account))) };
    },

    /** A page opening, for each of them: a few dozen at a time, as people arrive, over connections kept alive. */
    async read({ path, indices })
    {
        const statuses = {};
        const queue = [...indices];

        await settled(Array.from({ length: Math.min(READERS, queue.length) }, async () =>
        {
            while (queue.length > 0)
            {
                const one = held.get(queue.shift());
                const answer = await fetch(`${ base }/api${ path }`, { headers: headersOf(one.account) }).catch((error) => causeOf(error));
                const status = typeof answer === 'string' ? answer : answer.status;

                if (typeof answer !== 'string')
                {
                    await answer.text();
                }

                statuses[status] = (statuses[status] ?? 0) + 1;
            }
        }));

        return { statuses };
    },

    /** From now on these sockets come back by themselves when they close, as a browser's do. */
    async follow({ indices })
    {
        for (const index of indices)
        {
            held.get(index).follow = { attempts: 0, back: 0 };
        }

        return { ok: true };
    },

    /** Each followed socket: whether it is open, when it was first greeted again, and how many tries it took. */
    async backs()
    {
        return {
            backs: [...held.values()].filter((one) => one.follow !== null).map((one) => ({
                index: one.account.index,
                open: one.socket?.readyState === WebSocket.OPEN,
                back: one.follow.back,
                attempts: one.follow.attempts
            }))
        };
    },

    /** Whom each page shows, as a browser says it: once now, and again on every new connection. */
    async see({ indices, who })
    {
        for (const index of indices)
        {
            const one = held.get(index);

            one.seeing = who;

            if (one.socket?.readyState === WebSocket.OPEN)
            {
                one.socket.send(JSON.stringify({ v: 1, t: 'see', who }));
            }
        }

        return { ok: true };
    },

    async close({ indices })
    {
        await settled(indices.map((index) => new Promise((resolve) =>
        {
            const one = held.get(index);
            const socket = one?.socket;

            if (one !== undefined)
            {
                one.follow = null;
            }

            if (socket === null || socket === undefined || socket.readyState === WebSocket.CLOSED)
            {
                resolve();
                return;
            }

            socket.addEventListener('close', () => resolve(), { once: true });
            socket.close(1000, 'The crowd pass');
            setTimeout(resolve, 5000);
        })));

        return { ok: true };
    },

    async stall({ accounts })
    {
        return { results: await settled(accounts.map((account) => stall(account))) };
    },

    async unstall()
    {
        for (const socket of raw.splice(0))
        {
            socket.destroy();
        }

        return { ok: true };
    },

    async stats({ reset })
    {
        const sockets = [...held.values()];
        const open = sockets.filter((one) => one.socket?.readyState === WebSocket.OPEN).length;
        const watched = sockets.flatMap((one) => one.watched.map((seen) => ({ index: one.account.index, ...seen })));
        const closes = sockets.flatMap((one) => one.closes.map((close) => ({ index: one.account.index, ...close })));
        const result = {
            open,
            frames: sockets.reduce((sum, one) => sum + one.frames, 0),
            gaps: sockets.reduce((sum, one) => sum + one.gaps, 0),
            repeats: sockets.reduce((sum, one) => sum + one.repeats, 0),
            kinds: sockets.reduce((sum, one) =>
            {
                for (const [kind, count] of Object.entries(one.kinds))
                {
                    sum[kind] = (sum[kind] ?? 0) + count;
                }

                return sum;
            }, {}),
            watched,
            closes,
            lag: { mean: lag.mean / 1e6, p99: lag.percentile(99) / 1e6, most: lag.max / 1e6 },
            cpu: process.cpuUsage(),
            rss: process.memoryUsage().rss
        };

        if (reset)
        {
            for (const one of sockets)
            {
                one.watched = [];
                one.closes = [];
                one.kinds = {};
                one.frames = 0;
            }

            lag.reset();
        }

        return result;
    },

    async quit()
    {
        for (const one of held.values())
        {
            one.follow = null;
            one.socket?.close(1000, 'The crowd pass is done');
        }

        for (const socket of raw.splice(0))
        {
            socket.destroy();
        }

        setTimeout(() => process.exit(0), 500);
        return { ok: true };
    }
};

process.on('message', async (message) =>
{
    try
    {
        process.send({ id: message.id, ...(await commands[message.do](message)) });
    }
    catch (error)
    {
        process.send({ id: message.id, error: String(error?.stack ?? error) });
    }
});

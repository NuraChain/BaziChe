import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { pipeline } from '@azerothjs/http';

import { buildApp } from '../src/app.ts';
import type { ServerConfig } from '../src/env.ts';
import { metricsAt } from '../src/http/metrics.ts';
import { PROMETHEUS_TYPE } from '../src/ops/prometheus.ts';

const TOKEN = 'a-token-for-the-monitor-outside-0123456789';

const TEXT = '# HELP baziche_up_seconds How long this process has run.\n# TYPE baziche_up_seconds gauge\nbaziche_up_seconds 60\n';

const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => silent
} as unknown as Parameters<typeof buildApp>[0]['log'];

const config = { env: 'test', origin: 'http://localhost:3100', secret: 'test-secret', chainId: '', rpcUrl: '', servePages: false } as unknown as ServerConfig;

const app = () => buildApp({ db: { isInitialized: true, query: () => Promise.resolve([{ '?column?': 1 }]) } as unknown as DataSource, config, log: silent });

/** The server as main.ts wraps it, with the endpoint's token, counting how often the text was rendered. */
const served = (token: string) =>
{
    const rendered = { count: 0 };
    const handler = pipeline(app(), metricsAt(token, () =>
    {
        rendered.count += 1;
        return TEXT;
    }));

    return { handler, rendered };
};

/** The same server with no endpoint at all: what an address nothing is served at gets. */
const bare = () => pipeline(app());

const ask = async (handler: ReturnType<typeof bare>, path: string, init: RequestInit = {}) =>
{
    const response = await handler.handle(new Request(`http://local${ path }`, init));

    return { status: response.status, headers: [...response.headers].sort(), body: await response.text() };
};

const bearing = (token: string, method = 'GET') => ({ method, headers: { authorization: `Bearer ${ token }` } });

describe('the metrics a monitor outside reads', () =>
{
    it('answers a monitor that carries the token with the text format, never kept by a cache', async () =>
    {
        const { handler, rendered } = served(TOKEN);
        const answer = await ask(handler, '/api/metrics', bearing(TOKEN));

        expect(answer.status).toBe(200);
        expect(answer.headers).toContainEqual(['content-type', PROMETHEUS_TYPE]);
        expect(answer.headers).toContainEqual(['cache-control', 'no-store']);
        expect(answer.body).toBe(TEXT);
        expect(rendered.count).toBe(1);
    });

    it('takes the scheme in any case, as the bearer scheme is', async () =>
    {
        const { handler } = served(TOKEN);

        for (const scheme of ['bearer', 'BEARER', 'Bearer'])
        {
            expect((await ask(handler, '/api/metrics', { headers: { authorization: `${ scheme } ${ TOKEN }` } })).status, scheme).toBe(200);
        }
    });

    it('answers anybody else exactly as an address nothing is served at, and renders nothing for them', async () =>
    {
        const { handler, rendered } = served(TOKEN);
        const asked: [string, RequestInit][] = [
            ['no token', {}],
            ['another token', bearing('b'.repeat(TOKEN.length))],
            ['the token and a letter more', bearing(`${ TOKEN }x`)],
            ['the token less its last letter', bearing(TOKEN.slice(0, -1))],
            ['the token under another scheme', { headers: { authorization: `Basic ${ TOKEN }` } }],
            ['the token with nothing to name its scheme', { headers: { authorization: TOKEN } }],
            ['a post with the token', bearing(TOKEN, 'POST')],
            ['a head with the token', bearing(TOKEN, 'HEAD')]
        ];

        expect((await ask(bare(), '/api/metrics')).status, 'what they are compared with').toBe(404);

        for (const [what, init] of asked)
        {
            expect(await ask(handler, '/api/metrics', init), what).toEqual(await ask(bare(), '/api/metrics', init));
        }

        expect(rendered.count).toBe(0);
    });

    it('is off while its token is empty, for every token and for an empty one', async () =>
    {
        const { handler, rendered } = served('');

        for (const init of [bearing(TOKEN), bearing(''), { headers: { authorization: 'Bearer' } }, {}])
        {
            expect(await ask(handler, '/api/metrics', init)).toEqual(await ask(bare(), '/api/metrics', init));
        }

        expect(rendered.count).toBe(0);
    });

    it('serves the path the router routes, however it is spelled', async () =>
    {
        const { handler } = served(TOKEN);

        for (const path of ['/%61pi/metrics', '/api//metrics', '/api/metrics?scrape=1'])
        {
            expect((await ask(handler, path, bearing(TOKEN))).status, path).toBe(200);
        }
    });

    it('hands every other request on as it came, the token or not', async () =>
    {
        const { handler } = served(TOKEN);

        expect(await ask(handler, '/api/healthz', bearing(TOKEN))).toEqual(await ask(bare(), '/api/healthz', bearing(TOKEN)));
        expect(await ask(handler, '/api/metricsx', bearing(TOKEN))).toEqual(await ask(bare(), '/api/metricsx', bearing(TOKEN)));
    });
});

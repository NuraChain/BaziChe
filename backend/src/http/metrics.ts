import { createHash, timingSafeEqual } from 'node:crypto';

import type { HandlerWrapper } from '@azerothjs/http';

import { PROMETHEUS_TYPE } from '../ops/prometheus.ts';
import { routedPath } from './rate-limit.ts';

const METRICS_PATH = '/api/metrics';

const BEARER = /^bearer\s+(\S+)$/i;

const digest = (text: string) => createHash('sha256').update(text).digest();

/** Compared in constant time and over digests, so neither the token nor its length can be timed; an empty token is carried by nobody. */
const carries = (request: Request, token: string) =>
{
    const given = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];

    return token !== '' && given !== undefined && timingSafeEqual(digest(given), digest(token));
};

/**
 * The monitor's measures for a monitor outside, in the Prometheus text format.
 *
 * In front of the router rather than a route of it: a request without the token is handed on to
 * the router, which has no such route, so it is answered exactly as an address nothing is served
 * at, in either mode and whatever it accepts, and nobody can tell whether the endpoint is on.
 */
export function metricsAt(token: string, render: () => string): HandlerWrapper
{
    return (next) => ({
        handle: async (request) =>
            (request.method === 'GET' && routedPath(new URL(request.url).pathname) === METRICS_PATH && carries(request, token)
                ? new Response(render(), { headers: { 'content-type': PROMETHEUS_TYPE, 'cache-control': 'no-store' } })
                : next.handle(request))
    });
}

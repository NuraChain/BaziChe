import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import type { RequestObserver } from '@azerothjs/http';

import { FAMILIES, familyOf, type Family } from '../ops/measures.ts';
import { minuteCounts } from '../ops/rings.ts';
import { routedPath } from './rate-limit.ts';

export const MINUTE_MS = 60_000;

export const HOUR_MINUTES = 60;

export const FAILURES_KEPT = 50;

export const LOOP_TICK_MS = 20;

export interface Failure
{
    at: string;
    method: string;
    path: string;
    status: number;
}

export interface Loop
{
    busy: number;
    stall: number;
}

export interface ProcessHealth
{
    uptime: number;
    rss: number;
    heap: number;
    loop: Loop;
    requests: number;
    failed: number;
    failures: Failure[];
}

export interface OpsReader
{
    health(): ProcessHealth;
}

const NS_PER_MS = 1_000_000;

export function createOps(now: () => number = Date.now)
{
    const minutes: { minute: number; requests: number; failed: number }[] = [];
    const failures: Failure[] = [];
    const asked = minuteCounts<Family>(now);
    const failedBy = minuteCounts<Family>(now);
    const delay = monitorEventLoopDelay({ resolution: LOOP_TICK_MS });
    let since = performance.eventLoopUtilization();
    let last: Loop | null = null;

    const read = (): Loop => ({
        busy: performance.eventLoopUtilization(since).utilization,
        stall: delay.count === 0 ? 0 : Math.max(0, delay.max / NS_PER_MS - LOOP_TICK_MS)
    });

    delay.enable();

    const roll = setInterval(() =>
    {
        last = read();
        delay.reset();
        since = performance.eventLoopUtilization();
    }, MINUTE_MS);

    roll.unref();

    const completed = (request: Request, status: number) =>
    {
        const minute = Math.floor(now() / MINUTE_MS);
        const slot = minutes[minute % HOUR_MINUTES];
        const held = slot?.minute === minute ? slot : { minute, requests: 0, failed: 0 };
        const family = familyOf(routedPath(new URL(request.url).pathname));

        held.requests += 1;
        asked.add(family);

        if (status >= 500)
        {
            held.failed += 1;
            failedBy.add(family);
            failures.unshift({ at: new Date(now()).toISOString(), method: request.method, path: new URL(request.url).pathname, status });
            failures.length = Math.min(failures.length, FAILURES_KEPT);
        }

        minutes[minute % HOUR_MINUTES] = held;
    };

    return {
        observer(inner: RequestObserver): RequestObserver
        {
            return {
                onComplete(request, response, durationMs)
                {
                    completed(request, response.status);
                    inner.onComplete(request, response, durationMs);
                }
            };
        },

        health(): ProcessHealth
        {
            const since = Math.floor(now() / MINUTE_MS) - HOUR_MINUTES;
            const hour = minutes.filter((held) => held.minute > since);
            const memory = process.memoryUsage();

            return {
                uptime: Math.floor(process.uptime()),
                rss: memory.rss,
                heap: memory.heapUsed,
                loop: last ?? read(),
                requests: hour.reduce((sum, held) => sum + held.requests, 0),
                failed: hour.reduce((sum, held) => sum + held.failed, 0),
                failures: failures.map((failure) => ({ ...failure }))
            };
        },

        /** Requests and failures by route family over the last `minutes`, every family named. */
        families(minutes: number)
        {
            const requests = asked.within(minutes);
            const failed = failedBy.within(minutes);

            return FAMILIES.map((family) => ({ family, requests: requests.get(family) ?? 0, failed: failed.get(family) ?? 0 }));
        },

        familyTotals()
        {
            const requests = asked.totals();
            const failed = failedBy.totals();

            return FAMILIES.map((family) => ({ family, requests: requests.get(family) ?? 0, failed: failed.get(family) ?? 0 }));
        },

        stop()
        {
            clearInterval(roll);
            delay.disable();
        }
    };
}

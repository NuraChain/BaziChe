import { describe, expect, it } from 'vitest';

import { LIMITS, SAMPLE_MS, type AlertLevel } from '../src/ops/measures.ts';
import { createMonitor, type FamilyCount, type Sampled } from '../src/ops/monitor.ts';
import { rendered } from '../src/ops/prometheus.ts';
import { HOUR_MINUTES, MINUTE_MS } from '../src/ops/rings.ts';

const START = Date.parse('2026-10-28T22:00:00.000Z');

const quiet = (): Sampled => ({ queues: [], stuck: 0, checks: { open: 0, oldest: null } });

/** A monitor on a clock the test moves, every line it says kept in order. */
const watched = (sampled: () => Sampled = quiet, families: FamilyCount[] = []) =>
{
    const clock = { at: START };
    const lines: { level: AlertLevel; event: string; fields: Record<string, unknown> }[] = [];
    const monitor = createMonitor({
        now: () => clock.at,
        sample: async () => sampled(),
        sockets: () => 3,
        outboxes: () => ({ deepest: 2, waiting: 5 }),
        families: () => families,
        familyTotals: () => [],
        process: () => ({ uptime: 60, rss: 100, heap: 50, loop: { busy: 0.1, stall: 2 }, pool: { total: 4, idle: 3, waiting: 0 } }),
        said: (level, event, fields) => lines.push({ level, event, fields })
    });

    return { clock, lines, monitor };
};

describe('the alerts the monitor raises', () =>
{
    it('says an alert once when it crosses, keeps it standing from then, and says it once more when it clears', async () =>
    {
        const { clock, lines, monitor } = watched();

        for (let behind = 0; behind < LIMITS.socketsBehind.closed; behind += 1)
        {
            monitor.closed(4413);
        }

        await monitor.sample();
        clock.at += SAMPLE_MS;
        await monitor.sample();

        expect(lines).toEqual([{ level: 'warn', event: 'alert raised', fields: { alert: 'sockets-behind', value: 10, limit: 10 } }]);
        expect(monitor.alerts()).toEqual([expect.objectContaining({ alert: 'sockets-behind', since: START })]);

        clock.at += (LIMITS.socketsBehind.minutes + 1) * MINUTE_MS;
        await monitor.sample();

        expect(lines.map((line) => line.event)).toEqual(['alert raised', 'alert cleared']);
        expect(lines[1]).toMatchObject({ level: 'warn', fields: { alert: 'sockets-behind' } });
        expect(monitor.alerts()).toEqual([]);
    });

    it('counts an upgrade the gate never saw as one the ceiling turned away, and only that', async () =>
    {
        const { lines, monitor } = watched();

        monitor.asked();
        monitor.gated('origin');
        monitor.asked();
        monitor.gated(null);
        await monitor.sample();

        expect(lines).toEqual([]);
        expect(monitor.server().refused).toEqual({ origin: 1 });

        monitor.asked();
        await monitor.sample();

        expect(lines).toEqual([{ level: 'warn', event: 'alert raised', fields: { alert: 'sockets-full', value: 1, limit: 1 } }]);
        expect(monitor.server().refused).toEqual({ ceiling: 1, origin: 1 });
    });

    it('raises a worker failing only once the same record has failed for two minutes, at error for the payouts and warn for the rest, and forgets one that passes', async () =>
    {
        const { clock, lines, monitor } = watched();

        monitor.passed('stakes', { faults: ['escrow-1'] });
        monitor.passed('shop', { faults: ['order-1'] });
        clock.at += LIMITS.workersFailingSeconds * 1000 - 1000;
        monitor.passed('stakes', { faults: ['escrow-1', 'escrow-2'] });
        monitor.passed('shop', { faults: ['order-1'] });
        await monitor.sample();

        expect(lines).toEqual([]);

        clock.at += 1000;
        await monitor.sample();

        expect(lines).toEqual([
            { level: 'error', event: 'alert raised', fields: { alert: 'workers-failing', about: 'stakes', value: 120, limit: 120 } },
            { level: 'warn', event: 'alert raised', fields: { alert: 'workers-failing', about: 'shop', value: 120, limit: 120 } }
        ]);
        expect(monitor.money().failing).toEqual([{ worker: 'stakes', count: 2, oldest: 120 }, { worker: 'shop', count: 1, oldest: 120 }]);

        monitor.passed('stakes', { faults: ['escrow-2'] });
        await monitor.sample();

        expect(lines.at(-1)).toEqual({ level: 'error', event: 'alert cleared', fields: { alert: 'workers-failing', about: 'stakes', value: 120, limit: 120 } });
        expect(monitor.money().failing, 'the record still failing keeps the moment it first failed').toEqual([{ worker: 'stakes', count: 1, oldest: 1 }, { worker: 'shop', count: 1, oldest: 120 }]);
    });

    it('says NuraChain is out of reach after two passes in a row that could not reach it, and nothing for a pass that watches nothing', async () =>
    {
        const { lines, monitor } = watched();

        monitor.reconciled(false);
        await monitor.sample();
        monitor.reconciled(null);
        monitor.reconciled(false);
        await monitor.sample();

        expect(lines).toEqual([]);
        expect(monitor.money().reachable).toBe(true);

        monitor.reconciled(false);
        await monitor.sample();

        expect(lines).toEqual([{ level: 'error', event: 'alert raised', fields: { alert: 'chain-down', value: 2, limit: 2 } }]);
        expect(monitor.money().reachable).toBe(false);

        monitor.reconciled(true);
        await monitor.sample();

        expect(lines.at(-1)?.event).toBe('alert cleared');
    });

    it('raises the money\'s alerts from the sample, and names a queue behind by its name', async () =>
    {
        const { lines, monitor } = watched(() => ({
            queues: [
                { queue: 'orders', count: 2, oldest: LIMITS.backlogSeconds },
                { queue: 'gifts', count: 1, oldest: LIMITS.backlogSeconds - 1 },
                { queue: 'markets', count: 1, oldest: LIMITS.marketsLateSeconds }
            ],
            stuck: 1,
            checks: { open: 2, oldest: 30 }
        }));

        await monitor.sample();

        expect(lines.map((line) => [line.level, line.fields.alert, line.fields.about])).toEqual([
            ['warn', 'backlog', 'orders'],
            ['error', 'payments-stuck', undefined],
            ['error', 'markets-late', undefined],
            ['error', 'checks-open', undefined]
        ]);
        expect(monitor.alertsFor({ health: true, money: false }).map((one) => one.alert)).toEqual(['backlog']);
        expect(monitor.alertsFor({ health: false, money: true }).map((one) => one.alert)).toEqual(['payments-stuck', 'markets-late', 'checks-open']);
        expect(monitor.alertsFor({ health: false, money: false })).toEqual([]);
        expect(monitor.money()).toEqual({
            stuck: 1,
            markets: { count: 1, oldest: LIMITS.marketsLateSeconds },
            failedLocks: 0,
            failing: [],
            reachable: true,
            checks: { open: 2, oldest: 30 }
        });
    });

    it('shows nothing of the money this server does not run, and a queue that is empty with no age', async () =>
    {
        const { monitor } = watched(() => ({ queues: [{ queue: 'orders', count: 0, oldest: null }], stuck: null, checks: null }));

        expect(monitor.money(), 'before any sample').toEqual({ failedLocks: 0, failing: [], reachable: true });

        await monitor.sample();

        expect(monitor.money()).toEqual({ failedLocks: 0, failing: [], reachable: true });
        expect(monitor.server().queues).toEqual([{ queue: 'orders', count: 0 }]);
    });

    it('judges what it already holds when the database cannot be read, and lets the failure through', async () =>
    {
        let reading = true;
        const { lines, monitor } = watched(() =>
        {
            if (!reading)
            {
                throw new Error('database away');
            }

            return { ...quiet(), stuck: 1 };
        });

        await monitor.sample();
        reading = false;
        monitor.asked();

        await expect(monitor.sample()).rejects.toThrow('database away');
        expect(lines.map((line) => `${ line.event } ${ String(line.fields.alert) }`), 'the ceiling judged from memory, the stuck payment from the last read').toEqual(['alert raised payments-stuck', 'alert raised sockets-full']);
        expect(monitor.alerts().map((one) => one.alert)).toEqual(['sockets-full', 'payments-stuck']);
    });

    it('reads the database once for two samples asked for at once, and again once they are done', async () =>
    {
        let reads = 0;
        const { monitor } = watched(() =>
        {
            reads += 1;
            return quiet();
        });
        const both = [monitor.sample(), monitor.sample()];

        expect(both[0]).toBe(both[1]);
        await Promise.all(both);
        expect(reads).toBe(1);

        await monitor.sample();
        expect(reads).toBe(2);
    });

    it('raises the locks failing from the stake worker\'s own count, three in an hour, and clears it once the hour has passed', async () =>
    {
        const { clock, lines, monitor } = watched();

        monitor.passed('stakes', { faults: [], failed: 2 });
        await monitor.sample();

        expect(lines).toEqual([]);

        monitor.passed('stakes', { faults: [], failed: 1 });
        await monitor.sample();

        expect(lines).toEqual([{ level: 'warn', event: 'alert raised', fields: { alert: 'locks-failed', value: 3, limit: 3 } }]);
        expect(monitor.money().failedLocks).toBe(3);

        clock.at += HOUR_MINUTES * MINUTE_MS;
        await monitor.sample();

        expect(lines.at(-1)).toEqual({ level: 'warn', event: 'alert cleared', fields: { alert: 'locks-failed', value: 3, limit: 3 } });
        expect(monitor.money().failedLocks).toBe(0);
    });

    it('times spectator delivery over five minutes and raises it only past a second at the 95th, from fifty frames', async () =>
    {
        const { lines, monitor } = watched();

        for (let frame = 0; frame < LIMITS.watchSlow.frames - 1; frame += 1)
        {
            monitor.delivered(1500);
        }
        await monitor.sample();

        expect(lines).toEqual([]);
        expect(monitor.server().delivery).toEqual({ frames: 49, p50: 1500, p95: 1500, p99: 1500 });

        monitor.delivered(1500);
        await monitor.sample();

        expect(lines).toEqual([{ level: 'warn', event: 'alert raised', fields: { alert: 'watch-slow', value: 1500, limit: 1000 } }]);
    });
});

describe('what the monitor shows', () =>
{
    it('says the sockets of the hour by close code, the deepest outbox, the hour\'s requests by family and the market\'s moves', async () =>
    {
        const families = [
            { family: 'tables' as const, requests: 12, failed: 1 },
            { family: 'chat' as const, requests: 0, failed: 0 },
            { family: 'pages' as const, requests: 3, failed: 0 }
        ];
        const { monitor } = watched(quiet, families);

        monitor.opened();
        monitor.opened();
        monitor.closed(1001);
        monitor.closed(4999);
        monitor.passed('markets', { faults: [], moves: { settled: 2, claimed: 1 } });
        await monitor.sample();

        expect(monitor.server()).toEqual({
            opened: 2,
            closed: { 1001: 1, other: 1 },
            refused: {},
            deepest: 2,
            waiting: 5,
            families: [{ family: 'tables', requests: 12, failed: 1 }, { family: 'pages', requests: 3, failed: 0 }],
            queues: [],
            moves: { settled: 2, claimed: 1 },
            sampledAt: new Date(START).toISOString()
        });
    });

    it('shows the sockets of the last hour, and keeps their totals since the process began for a monitor outside', () =>
    {
        const { clock, monitor } = watched();

        monitor.opened();
        monitor.closed(1006);
        clock.at += HOUR_MINUTES * MINUTE_MS;
        monitor.closed(1000);

        expect(monitor.server().opened).toBe(0);
        expect(monitor.server().closed).toEqual({ 1000: 1 });
        expect(monitor.metrics()).toContain('baziche_sockets_opened_total 1\n');
        expect(monitor.metrics()).toContain('baziche_sockets_closed_total{code="1006"} 1\n');
    });

    it('escapes a label as the text format asks, and names a counter as one', () =>
    {
        expect(rendered([{ name: 'baziche_said_total', help: 'What was said.', type: 'counter', samples: [{ labels: { about: 'a"b\\c\nd' }, value: 2 }] }]))
            .toBe('# HELP baziche_said_total What was said.\n# TYPE baziche_said_total counter\nbaziche_said_total{about="a\\"b\\\\c\\nd"} 2\n');
    });

    it('writes every measure in the Prometheus text format, a standing alert as a series of its own', async () =>
    {
        const { monitor } = watched(() => ({ ...quiet(), stuck: 1 }));

        monitor.opened();
        monitor.delivered(12);
        await monitor.sample();

        const text = monitor.metrics();

        expect(text).toContain('# TYPE baziche_sockets_open gauge\nbaziche_sockets_open 3\n');
        expect(text).toContain('# TYPE baziche_sockets_opened_total counter\nbaziche_sockets_opened_total 1\n');
        expect(text).toContain('baziche_watch_delivery_ms{quantile="0.95"} 12\n');
        expect(text).toContain('baziche_db_pool_connections{state="waiting"} 0\n');
        expect(text).toContain('baziche_payments_stuck 1\n');
        expect(text).toContain('baziche_alert{alert="payments-stuck",level="error"} 1\n');
        expect(text.endsWith('\n')).toBe(true);
    });
});

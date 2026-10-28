import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SAMPLE_MS } from '../src/ops/measures.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const services = readFileSync(join(HERE, '..', 'src', 'services.ts'), 'utf8');

const between = (from: string, to: string) => main.slice(main.indexOf(from), main.indexOf(to, main.indexOf(from)));

const hub = between('const hub = createHub({', '});');

const made = between('const monitor = createMonitor({', '});');

const gateway = between('const detachRealtime = attachRealtime(', '});');

const sampling = between('const sample = () =>', 'handleShutdownSignals(');

const shutdown = between('beforeShutdown:', 'beforeExit:');

describe('what watches the server', () =>
{
    it('is one monitor, reading the hub, the request counts, the process and the database through the ports', () =>
    {
        expect(main.match(/createMonitor\(/g)).toHaveLength(1);
        expect(made).toMatch(/sample: \(\) => ports\.jobs\.sample\(\)/);
        expect(made).toMatch(/sockets: \(\) => hub\.size\(\)/);
        expect(made).toMatch(/outboxes: \(\) => hub\.outboxes\(\)/);
        expect(made).toMatch(/families: \(minutes\) => ops\.families\(minutes\)/);
        expect(made).toMatch(/familyTotals: \(\) => ops\.familyTotals\(\)/);
        expect(made).toMatch(/pool: poolOf\(dataSource\)/);
        expect(services).toMatch(/sample: sampleWork,/);
    });

    it('is what the admin\'s overview reads, beside the process\'s own health', () =>
    {
        expect(main).toMatch(/log\[level\]\(event, fields\), undefined, \{ health: \(\) => ops\.health\(\), watch: monitor \}\);/);
    });

    it('says an alert raised or cleared in the server\'s log, at the alert\'s own level', () =>
    {
        expect(made).toMatch(/said: \(level, event, fields\) => \(level === 'error' \? log\.error\(event, fields\) : log\.warn\(event, fields\)\)/);
    });

    it('is told every upgrade, what the gate decided, every socket that opened and how each closed, and how long a watcher waited for a move', () =>
    {
        expect(gateway).toMatch(/watch: monitor$/m);
        expect(hub).toMatch(/delivered: \(ms\) => monitor\.delivered\(ms\)/);
    });

    it('is told what each money worker\'s pass came to, and whether the reconciliation reached NuraChain', () =>
    {
        const pass = (worker: string, until: string) => between(`const ${ worker } = () =>`, until);

        expect(pass('sweepStakes', 'const SHOP_SWEEP_MS')).toMatch(/\.then\(\(\{ begun, closed, failed, faults \}\) =>\s+\{\s+monitor\.passed\('stakes', \{ faults: faults\.map\(\(one\) => one\.escrow\), failed \}\);/);
        expect(pass('sweepShop', 'const DONATION_SWEEP_MS')).toMatch(/\.then\(\([^)]*\) =>\s+\{\s+monitor\.passed\('shop', \{ faults: faults\.map\(\(one\) => one\.order\) \}\);/);
        expect(pass('sweepDonations', 'const MARKET_SWEEP_MS')).toMatch(/\.then\(\([^)]*\) =>\s+\{\s+monitor\.passed\('gifts', \{ faults: faults\.map\(\(one\) => one\.donation\) \}\);/);
        expect(pass('sweepMarkets', 'const RECONCILE_MS')).toMatch(/\.then\(\(\{ faults, \.\.\.moved \}\) =>\s+\{\s+monitor\.passed\('markets', \{ faults: faults\.map\(\(one\) => one\.market\), moves: moved \}\);/);
        expect(pass('reconcile', 'let sampling')).toMatch(/\.then\(\(\{ faults, reached \}\) =>\s+\{\s+monitor\.reconciled\(reached\);/);
    });

    it('samples every half a minute on a timer that never holds the process open, and says a sample that failed', () =>
    {
        expect(SAMPLE_MS).toBe(30_000);
        expect(sampling).toMatch(/void monitor\.sample\(\)\s+\.catch\(\(error: unknown\) => log\.error\('monitor sample failed', \{ error \}\)\)/);
        expect(sampling).toMatch(/\.finally\(\(\) =>\s+\{\s+if \(sampling !== null\)\s+\{\s+sampling = setTimeout\(sample, SAMPLE_MS\);\s+sampling\.unref\(\);/);
        expect(sampling).toMatch(/^sampling = setTimeout\(sample, SAMPLE_MS\);\nsampling\.unref\(\);$/m);
    });

    it('answers a monitor outside from the last wrapper round the app, inside the rate limits, with the token the operator names', () =>
    {
        const handler = between('const handler = pipeline(', '\n);');
        const served = 'metricsAt(config.metricsToken, () => monitor.metrics())';

        expect(handler.trimEnd().endsWith(served)).toBe(true);
        expect(handler.indexOf(served)).toBeGreaterThan(handler.indexOf('signInRateLimit('));
    });

    it('is stopped on the way down, before the sockets are let go', () =>
    {
        expect(shutdown).toMatch(/if \(sampling !== null\)\s+\{\s+clearTimeout\(sampling\);\s+sampling = null;/);
        expect(shutdown.indexOf('clearTimeout(sampling)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});

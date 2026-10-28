import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const sweepMarkets = () =>'), main.indexOf('handleShutdownSignals('));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what settles a market and believes a position', () =>
{
    it('is the server, every three seconds, a pass at a time, on a timer that never holds the process open', () =>
    {
        expect(main).toMatch(/^const MARKET_SWEEP_MS = 3_000;$/m);
        expect(sweep).toMatch(/void ports\.jobs\.sweepMarkets\(MARKET_SWEEP_BUDGET_MS\)/);
        expect(sweep).toMatch(/\.finally\(\(\) =>\s+\{\s+if \(marketing !== null\)\s+\{\s+marketing = setTimeout\(sweepMarkets, MARKET_SWEEP_MS\);\s+marketing\.unref\(\);/);
        expect(sweep).toMatch(/^marketing = setTimeout\(sweepMarkets, MARKET_SWEEP_MS\);\nmarketing\.unref\(\);$/m);
    });

    it('says what it moved, says a fault once for as long as it is the same one, and logs a pass that failed without throwing it', () =>
    {
        expect(sweep).toMatch(/if \(Object\.values\(moved\)\.some\(\(count\) => count > 0\)\)\s+\{\s+log\.info\('markets moved', moved\);/);
        expect(sweep).toMatch(/if \(marketsTold\.get\(market\) !== error\)\s+\{\s+log\.warn\('market step failed', \{ market, error \}\);/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('market sweep failed', \{ error \}\)\)/);
    });

    it('is stopped on the way down, before the sockets are let go', () =>
    {
        expect(shutdown).toMatch(/if \(marketing !== null\)\s+\{\s+clearTimeout\(marketing\);\s+marketing = null;/);
        expect(shutdown.indexOf('clearTimeout(marketing)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const sweepShop = () =>'), main.indexOf('handleShutdownSignals('));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what delivers a look the shop has sold', () =>
{
    it('is the server, every three seconds, a pass at a time, on a timer that never holds the process open', () =>
    {
        expect(main).toMatch(/^const SHOP_SWEEP_MS = 3_000;$/m);
        expect(sweep).toMatch(/void ports\.jobs\.sweepShop\(SHOP_SWEEP_BUDGET_MS\)/);
        expect(sweep).toMatch(/\.finally\(\(\) =>\s+\{\s+if \(shopping !== null\)\s+\{\s+shopping = setTimeout\(sweepShop, SHOP_SWEEP_MS\);\s+shopping\.unref\(\);/);
        expect(sweep).toMatch(/^shopping = setTimeout\(sweepShop, SHOP_SWEEP_MS\);\nshopping\.unref\(\);$/m);
    });

    it('says what it moved, says a fault once for as long as it is the same one, and logs a pass that failed without throwing it', () =>
    {
        expect(sweep).toMatch(/log\.info\('shop orders moved', \{ paid, refunded, failed, expired \}\)/);
        expect(sweep).toMatch(/if \(shopTold\.get\(order\) !== error\)\s+\{\s+log\.warn\('shop order step failed', \{ order, error \}\);/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('shop sweep failed', \{ error \}\)\)/);
    });

    it('is stopped on the way down, before the sockets are let go', () =>
    {
        expect(shutdown).toMatch(/if \(shopping !== null\)\s+\{\s+clearTimeout\(shopping\);\s+shopping = null;/);
        expect(shutdown.indexOf('clearTimeout(shopping)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});

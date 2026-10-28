import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const sweepDonations = () =>'), main.indexOf('handleShutdownSignals('));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what confirms a gift a watcher made', () =>
{
    it('is the server, every three seconds, a pass at a time, on a timer that never holds the process open', () =>
    {
        expect(main).toMatch(/^const DONATION_SWEEP_MS = 3_000;$/m);
        expect(sweep).toMatch(/void ports\.jobs\.sweepDonations\(DONATION_SWEEP_BUDGET_MS\)/);
        expect(sweep).toMatch(/\.finally\(\(\) =>\s+\{\s+if \(giving !== null\)\s+\{\s+giving = setTimeout\(sweepDonations, DONATION_SWEEP_MS\);\s+giving\.unref\(\);/);
        expect(sweep).toMatch(/^giving = setTimeout\(sweepDonations, DONATION_SWEEP_MS\);\ngiving\.unref\(\);$/m);
    });

    it('says what it moved, says a fault once for as long as it is the same one, and logs a pass that failed without throwing it', () =>
    {
        expect(sweep).toMatch(/log\.info\('donations moved', \{ confirmed, reverted, expired, failed \}\)/);
        expect(sweep).toMatch(/if \(givingTold\.get\(donation\) !== error\)\s+\{\s+log\.warn\('donation step failed', \{ donation, error \}\);/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('donation sweep failed', \{ error \}\)\)/);
    });

    it('is stopped on the way down, before the sockets are let go', () =>
    {
        expect(shutdown).toMatch(/if \(giving !== null\)\s+\{\s+clearTimeout\(giving\);\s+giving = null;/);
        expect(shutdown.indexOf('clearTimeout(giving)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});

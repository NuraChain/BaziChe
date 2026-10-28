import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const services = readFileSync(join(HERE, '..', 'src', 'services.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const reconcile = () =>'), main.indexOf('handleShutdownSignals('));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what checks the database against NuraChain', () =>
{
    it('is the server, a pass a minute and the first half a minute after it starts, on a timer that never holds the process open', () =>
    {
        expect(main).toMatch(/^const RECONCILE_MS = 60_000;$/m);
        expect(main).toMatch(/^const RECONCILE_FIRST_MS = 30_000;$/m);
        expect(sweep).toMatch(/void ports\.jobs\.reconcile\(RECONCILE_BUDGET_MS\)/);
        expect(sweep).toMatch(/\.finally\(\(\) =>\s+\{\s+if \(reconciling !== null\)\s+\{\s+reconciling = setTimeout\(reconcile, RECONCILE_MS\);\s+reconciling\.unref\(\);/);
        expect(sweep).toMatch(/^reconciling = setTimeout\(reconcile, RECONCILE_FIRST_MS\);\nreconciling\.unref\(\);$/m);
    });

    it('says a fault once for as long as it is the same one, and logs a pass that failed without throwing it', () =>
    {
        expect(sweep).toMatch(/if \(reconcileTold\.get\(key\) !== one\.error\)\s+\{\s+log\.warn\('reconcile step failed', \{ family: one\.family, record: one\.record, error: one\.error \}\);/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('reconcile pass failed', \{ error \}\)\)/);
    });

    it('says every disagreement found and resolved as a warning in the server\'s log', () =>
    {
        expect(main).toMatch(/\(event, fields, level = 'info'\) => log\[level\]\(event, fields\)/);
        expect(services).toMatch(/createReconciler\(db, auditors, holders, \{ said: \(event, fields\) => note\?\.\(event, fields, 'warn'\) \}\)/);
    });

    it('is stopped on the way down, before the sockets are let go', () =>
    {
        expect(shutdown).toMatch(/if \(reconciling !== null\)\s+\{\s+clearTimeout\(reconciling\);\s+reconciling = null;/);
        expect(shutdown.indexOf('clearTimeout(reconciling)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});

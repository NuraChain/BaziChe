import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const expiries ='), main.indexOf('expiries.unref();'));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what lets go of a voice file no message names', () =>
{
    it('is the server, once a minute, right after the messages that ran out are deleted', () =>
    {
        expect(sweep).toMatch(/^const expiries = setInterval\(\(\) =>$/m);
        expect(sweep.indexOf('chat.sweepExpired()')).toBeGreaterThan(-1);
        expect(sweep.indexOf('.then(() => chat.sweepVoice())')).toBeGreaterThan(sweep.indexOf('chat.sweepExpired()'));
        expect(sweep).toMatch(/^\}, 60_000\);$/m);
        expect(main).toMatch(/^expiries\.unref\(\);$/m);
    });

    it('runs whether or not the expiry sweep failed, says how many it let go, and logs its own failure without throwing it', () =>
    {
        expect(sweep.indexOf(".catch((error: unknown) => log.error('expiry sweep failed', { error }))")).toBeLessThan(sweep.indexOf('.then(() => chat.sweepVoice())'));
        expect(sweep).toMatch(/\.then\(\(gone\) => \{ if \(gone > 0\) \{ log\.info\('voice files let go', \{ gone \}\); \} \}\)/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('voice sweep failed', \{ error \}\)\);/);
    });

    it('is stopped on the way down with the other sweeps of the minute', () =>
    {
        expect(shutdown).toMatch(/clearInterval\(expiries\);/);
    });
});

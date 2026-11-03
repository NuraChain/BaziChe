import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const CALL_SWEEP_MS'), main.indexOf('calling.unref();\n\nconst STAKE_SWEEP_MS'));

const hub = main.slice(main.indexOf('const hub = createHub({'), main.indexOf('let goingDown'));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what ends a call by time', () =>
{
    it('is the server every five seconds, set again only once a sweep has finished, on a timer that never holds the process open', () =>
    {
        expect(sweep).toMatch(/^const CALL_SWEEP_MS = 5_000;$/m);
        expect(sweep).toMatch(/void ports\.jobs\.sweepCalls\(\)/);
        expect(sweep).toMatch(/\.finally\(\(\) =>\s*\{\s*if \(calling !== null\)\s*\{\s*calling = setTimeout\(sweepCalls, CALL_SWEEP_MS\);\s*calling\.unref\(\);/);
        expect(main).toMatch(/^calling = setTimeout\(sweepCalls, CALL_SWEEP_MS\);\ncalling\.unref\(\);$/m);
    });

    it('says what it ended, and logs a sweep that failed without throwing it', () =>
    {
        expect(sweep).toMatch(/log\.info\('calls ended by time', \{ missed, ended \}\)/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('call sweep failed', \{ error \}\)\)/);
    });

    it('is stopped on the way down before the sockets are let go', () =>
    {
        expect(shutdown).toMatch(/clearTimeout\(calling\);\s*calling = null;/);
        expect(shutdown.indexOf('clearTimeout(calling)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});

describe('a call\'s room, as the hub asks about it', () =>
{
    it('is a call\'s by its name and a table\'s otherwise, a table\'s carried as it always was', () =>
    {
        expect(main).toMatch(/import \{ callRoom \} from '\.\/domains\/call\/rooms\.ts';/);
        expect(hub).toMatch(/async voiceCall\(userId, room\)\s*\{\s*if \(room\.startsWith\(CALL_ROOM\)\)\s*\{\s*return await callRoom\(dataSource, userId, room\);\s*\}\s*const call = await voiceCall\(dataSource, userId, room\);\s*return call === null \? null : \{ call, held: false, lines: true, most: null \};/);
    });

    it('writes each person\'s comings and goings one after another, and logs one that failed', () =>
    {
        expect(main).toMatch(/^const moves = keyedQueue\(\);$/m);
        expect(hub).toMatch(/voiceMoved: \(userId, call, here\) =>\s*\{\s*void moves\.run\(userId, \(\) => ports\.jobs\.callMoved\(userId, call, here\)\)/);
        expect(hub).toMatch(/\.catch\(\(error: unknown\) => log\.error\('realtime failure', \{ where: 'realtime\.call', error \}\)\)/);
    });

    it('holds nobody when the server starts: everybody is let out before the first socket can come in', () =>
    {
        const emptied = main.indexOf('await ports.jobs.emptyCallRooms()');

        expect(emptied).toBeGreaterThan(main.indexOf('const ports = buildPorts('));
        expect(emptied).toBeLessThan(main.indexOf('const served = await serve('));
        expect(emptied).toBeLessThan(main.indexOf('attachRealtime('));
    });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchBuild } from '../src/http/build-watch.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const ROOT = join(HERE, '..', '..');

const main = readFileSync(join(ROOT, 'backend', 'src', 'main.ts'), 'utf8');

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

const EVERY = 5_000;

/** A marker on disk the test changes, and every time the watch read it. */
const disk = (first: string | null) =>
{
    const held = { marker: first, reads: 0 };

    const read = async () =>
    {
        held.reads += 1;

        return held.marker;
    };

    return { held, read };
};

beforeEach(() =>
{
    vi.useFakeTimers();
});

afterEach(() =>
{
    vi.useRealTimers();
});

describe('a server watching the build under it', () =>
{
    it('says nothing while the finished build is the one it started on', async () =>
    {
        const { held, read } = disk('{"id":"a"}');
        const told = vi.fn();

        watchBuild(read, told, EVERY);
        await vi.advanceTimersByTimeAsync(EVERY * 6);

        expect(told).not.toHaveBeenCalled();
        expect(held.reads, 'it stopped looking').toBe(7);
    });

    it('says nothing while a build is still being written, its marker gone with the rest', async () =>
    {
        const { held, read } = disk('{"id":"a"}');
        const told = vi.fn();

        watchBuild(read, told, EVERY);
        await vi.advanceTimersByTimeAsync(EVERY);
        held.marker = null;
        await vi.advanceTimersByTimeAsync(EVERY * 4);

        expect(told).not.toHaveBeenCalled();
    });

    it('says so once a new build is finished, and never again', async () =>
    {
        const { held, read } = disk('{"id":"a"}');
        const told = vi.fn();

        watchBuild(read, told, EVERY);
        await vi.advanceTimersByTimeAsync(EVERY);
        held.marker = null;
        await vi.advanceTimersByTimeAsync(EVERY);
        held.marker = '{"id":"b"}';
        await vi.advanceTimersByTimeAsync(EVERY);

        expect(told).toHaveBeenCalledTimes(1);

        const reads = held.reads;

        held.marker = '{"id":"c"}';
        await vi.advanceTimersByTimeAsync(EVERY * 4);

        expect(told).toHaveBeenCalledTimes(1);
        expect(held.reads, 'it went on reading after it had told').toBe(reads);
    });

    it('says so when a server started on a build with no marker sees a finished one appear', async () =>
    {
        const { held, read } = disk(null);
        const told = vi.fn();

        watchBuild(read, told, EVERY);
        await vi.advanceTimersByTimeAsync(EVERY);
        held.marker = '{"id":"a"}';
        await vi.advanceTimersByTimeAsync(EVERY);

        expect(told).toHaveBeenCalledTimes(1);
    });

    it('stops looking when it is stopped, a read in flight included', async () =>
    {
        const { held, read } = disk('{"id":"a"}');
        const told = vi.fn();
        const stop = watchBuild(read, told, EVERY);

        held.marker = '{"id":"b"}';
        stop();
        await vi.advanceTimersByTimeAsync(EVERY * 4);

        expect(told).not.toHaveBeenCalled();
        expect(held.reads).toBe(1);
    });
});

describe('the server and the build, together', () =>
{
    it('ends the build with the marker, written where the server reads it, once the build is within budget', () =>
    {
        const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        const marker = readFileSync(join(ROOT, 'tools', 'built.mjs'), 'utf8');

        expect(scripts.scripts.build).toMatch(/&& node tools\/budgets\.mjs && node tools\/built\.mjs"?$/);
        expect(marker).toContain("new URL('.vite/built.json', CLIENT)");
        expect(marker).toContain("new URL('../.dist-frontend/', import.meta.url)");
        expect(main).toContain("const BUILT = new URL('../.dist-frontend/.vite/built.json', import.meta.url);");
    });

    it('watches only while it serves the pages, and stops through its own way down, with the code a supervisor restarts on', () =>
    {
        expect(main).toMatch(/const unwatchBuild = serving\n\s+\? watchBuild\(\(\) => readFile\(BUILT, 'utf8'\)\.catch\(\(\) => null\), \(\) =>/);
        expect(main).toMatch(/rebuilt = true;\n\s+log\.error\('a new build was finished under this server/);
        expect(main).toMatch(/process\.emit\('SIGTERM'\);/);
        expect(main).toMatch(/exit: \(code\) => process\.exit\(rebuilt \? REBUILT_EXIT : code\)/);
        expect(main).toMatch(/const REBUILT_EXIT = 75;/);
        expect(shutdown).toMatch(/^\s+unwatchBuild\(\);$/m);
    });
});

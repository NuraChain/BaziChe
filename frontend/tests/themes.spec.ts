import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AURAS, FRAMES } from '../src/game/looks/frames.ts';
import { AMBIENTS, coverOf, driftOver } from '../src/game/looks/themes.ts';
import type { Point, Stream, Tune } from '../src/game/vfx/engine.ts';

interface Running
{
    host: HTMLElement;
    kind: Stream;
    at: () => Point | null;
    tune: Tune;
    ended: boolean;
}

const engine = vi.hoisted(() => ({ streams: [] as Running[], disposed: 0 }));

vi.mock('../src/game/vfx/engine.ts', () => ({
    createVfx: (host: HTMLElement) => ({
        stream(kind: Stream, at: () => Point | null, tune: Tune)
        {
            const running = { host, kind, at, tune, ended: false };
            engine.streams.push(running);
            return () =>
            {
                running.ended = true;
            };
        },
        dispose()
        {
            engine.disposed += 1;
        }
    })
}));

let band: HTMLElement;
let size: [number, number];

const playing = async () =>
{
    await vi.waitFor(() => expect(engine.streams.length).toBeGreaterThan(0));
    const running = engine.streams.at(-1)!;
    Object.defineProperty(running.host, 'clientWidth', { configurable: true, get: () => size[0] });
    Object.defineProperty(running.host, 'clientHeight', { configurable: true, get: () => size[1] });
    return running;
};

beforeEach(() =>
{
    engine.streams = [];
    engine.disposed = 0;
    size = [640, 128];
    band = document.createElement('div');
    band.append(document.createElement('img'));
    document.body.append(band);
});

afterEach(() => band.remove());

describe('a theme', () =>
{
    it('is named by a worn theme, and by nothing else', () =>
    {
        expect(coverOf('theme.inferno')).toBe('inferno');
        expect(coverOf(undefined)).toBeNull();
        expect(coverOf('')).toBeNull();
        expect(coverOf('theme.')).toBeNull();
        expect(coverOf('theme.nowhere')).toBeNull();
        expect(coverOf('decoration.inferno')).toBeNull();
    });

    it('drifts over its cover in its collection’s own light, for every collection a cover is drawn for', () =>
    {
        expect(Object.keys(AMBIENTS).sort()).toEqual([...FRAMES].sort());

        for (const collection of FRAMES)
        {
            expect(AMBIENTS[collection].tune.colors, collection).toEqual(AURAS[collection].tune.colors);
        }
    });
});

describe('a theme’s ambient', () =>
{
    it('drifts in a host laid last in the band, under whatever the header lays over it, that nothing can press', async () =>
    {
        const stop = driftOver(band, 'inferno');
        const { host, kind } = await playing();

        expect(band.lastElementChild).toBe(host);
        expect(host.dataset.ambient).toBe('inferno');
        expect(host.getAttribute('aria-hidden')).toBe('true');
        expect(host.style.position).toBe('absolute');
        expect(host.style.zIndex).toBe('0');
        expect(host.style.pointerEvents).toBe('none');
        expect(kind).toBe(AMBIENTS.inferno.stream);

        stop();
    });

    it('gives off across the whole band from its middle, and follows the band when it changes size', async () =>
    {
        const stop = driftOver(band, 'storm');
        const running = await playing();

        expect(running.at()).toEqual({ x: 320, y: 64 });
        expect(running.tune.area).toEqual({ width: 640, height: 128 });
        expect(running.tune.colors).toEqual(AMBIENTS.storm.tune.colors);

        size = [1080, 96];

        expect(running.at()).toEqual({ x: 540, y: 48 });
        expect(running.tune.area, 'the band it was started on').toEqual({ width: 1080, height: 96 });

        stop();
    });

    it('gives off nothing from a band that has no size yet', async () =>
    {
        size = [0, 0];
        const stop = driftOver(band, 'void');
        const running = await playing();

        expect(running.at()).toBeNull();

        stop();
    });

    it('lets go of its stream, its engine and its host when it is stopped', async () =>
    {
        const stop = driftOver(band, 'frost');
        const running = await playing();

        stop();

        expect(running.ended).toBe(true);
        expect(engine.disposed).toBe(1);
        expect(band.querySelector('[data-ambient]')).toBeNull();
    });
});

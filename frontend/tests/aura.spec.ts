import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { glowAround } from '../src/game/looks/aura.ts';
import { AURAS } from '../src/game/looks/frames.ts';
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

let picture: HTMLElement;
let width: number;

const sized = (element: HTMLElement, size: () => number) =>
{
    Object.defineProperty(element, 'clientWidth', { configurable: true, get: size });
    Object.defineProperty(element, 'clientHeight', { configurable: true, get: size });
};

const playing = async () =>
{
    await vi.waitFor(() => expect(engine.streams.length).toBeGreaterThan(0));
    return engine.streams[engine.streams.length - 1]!;
};

beforeEach(() =>
{
    engine.streams = [];
    engine.disposed = 0;
    width = 112;
    picture = document.createElement('span');
    picture.append(document.createElement('span'));
    sized(picture, () => width);
    document.body.append(picture);
});

afterEach(() => picture.remove());

describe('an aura round a framed picture', () =>
{
    it('is drawn in a host laid last in the picture’s box, at the frame’s own depth, that nothing can press', async () =>
    {
        const stop = glowAround(picture, 'neon');
        const { host } = await playing();

        expect(picture.lastElementChild).toBe(host);
        expect(host.dataset.aura).toBe('neon');
        expect(host.getAttribute('aria-hidden')).toBe('true');
        expect(host.style.position).toBe('absolute');
        expect(host.style.zIndex).toBe('1');
        expect(host.style.pointerEvents).toBe('none');
        expect(host.style.cssText).toContain('inset: -40%');

        stop();
    });

    it('plays the frame’s own stream in its colours, round the middle of its host, on the frame’s ring whatever the picture’s size', async () =>
    {
        const stop = glowAround(picture, 'gold');
        const running = await playing();
        sized(running.host, () => width * 1.8);

        expect(running.kind).toBe(AURAS.gold.stream);
        expect(running.tune.colors).toEqual(AURAS.gold.tune.colors);
        expect(running.at()).toEqual({ x: 100.8, y: 100.8 });
        expect(running.tune.scale).toBeCloseTo(2.1);

        width = 96;

        expect(running.at()).toEqual({ x: 86.4, y: 86.4 });
        expect(running.tune.scale, 'the ring stayed where a larger picture had put it').toBeCloseTo(1.8);

        stop();
    });

    it('waits while its host has no size, and plays once it has', async () =>
    {
        const stop = glowAround(picture, 'glow');
        const running = await playing();
        let host = 0;
        sized(running.host, () => host);

        expect(running.at()).toBeNull();

        host = 180;

        expect(running.at()).toEqual({ x: 90, y: 90 });

        stop();
    });

    it('lets the engine and its host go when stopped, and a stop that came first starts nothing', async () =>
    {
        const stop = glowAround(picture, 'shiraz');
        const running = await playing();

        stop();

        expect(running.ended).toBe(true);
        expect(engine.disposed).toBe(1);
        expect(picture.querySelector('[data-aura]')).toBeNull();

        const early = glowAround(picture, 'glow');
        early();
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(engine.streams, 'a stop that came first still started an engine').toHaveLength(1);
        expect(picture.querySelector('[data-aura]')).toBeNull();
    });
});

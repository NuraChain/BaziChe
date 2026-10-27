import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVfx, type VfxOptions } from '../src/game/vfx/engine.ts';
import { PRESETS, STREAMS, type Preset } from '../src/game/vfx/presets.ts';
import { drawParticle } from '../src/game/vfx/shapes.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';

let clock: ManualClock;
let host: HTMLElement;
let seen: 'visible' | 'hidden';

interface Counted
{
    context: CanvasRenderingContext2D;
    drawn: () => number;
    colors: Set<string>;
}

/** A 2D context that does nothing but count what it is asked to draw and with what colours. */
function counting(): Counted
{
    let drawn = 0;
    const colors = new Set<string>();
    const noop = () => undefined;
    const paint = () =>
    {
        drawn += 1;
    };

    const context = {
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        set fillStyle(value: string)
        {
            colors.add(value);
        },
        set strokeStyle(value: string)
        {
            colors.add(value);
        },
        setTransform: noop,
        clearRect: noop,
        beginPath: noop,
        arc: noop,
        moveTo: noop,
        lineTo: noop,
        quadraticCurveTo: noop,
        save: noop,
        restore: noop,
        translate: noop,
        rotate: noop,
        scale: noop,
        fill: paint,
        stroke: paint,
        fillRect: paint,
        drawImage: paint,
        createRadialGradient: () => ({ addColorStop: noop })
    };

    return { context: context as unknown as CanvasRenderingContext2D, drawn: () => drawn, colors };
}

const made = (counted: Counted, options: VfxOptions = {}) => createVfx(host, {
    frame: (run) => clock.after(16, run),
    context: () => counted.context,
    quiet: () => false,
    ...options
});

const AT = { x: 60, y: 40 };

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_000);
    setRuntime({ clock });
    host = document.createElement('div');
    document.body.append(host);
    seen = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => seen });
});

afterEach(() =>
{
    host.remove();
    resetRuntime();
});

describe('the particle engine', () =>
{
    it('lays one canvas over its host that a pointer passes through, and asks for no frame while nothing lives', () =>
    {
        made(counting());

        const canvas = host.querySelector('canvas');

        expect(canvas?.getAttribute('aria-hidden')).toBe('true');
        expect(canvas?.style.pointerEvents).toBe('none');
        expect(clock.pending()).toBe(0);
    });

    it.each(Object.keys(PRESETS) as Preset[])('plays %s to its end and then asks for no more frames', (preset) =>
    {
        const counted = counting();
        const vfx = made(counted);

        vfx.burst(preset, AT);

        expect(vfx.live()).toBeGreaterThan(0);
        expect(clock.pending()).toBe(1);

        clock.advance(4_000);

        expect(vfx.live()).toBe(0);
        expect(clock.pending(), 'a frame was still asked for with nothing left to draw').toBe(0);
        expect(counted.drawn()).toBeGreaterThan(0);
    });

    it('holds to its ceiling however much is asked of it, letting the oldest go', () =>
    {
        const vfx = made(counting(), { ceiling: 50 });

        for (let round = 0; round < 10; round += 1)
        {
            vfx.burst('confetti', AT);
        }

        expect(vfx.live()).toBe(50);
    });

    it('scales how many there are by density and intensity, and draws in the colours it is given', () =>
    {
        const counted = counting();
        const vfx = made(counted);

        vfx.burst('sparks', AT, { density: 2, colors: ['#123456'] });

        expect(vfx.live()).toBe(40);

        clock.advance(48);

        expect([...counted.colors]).toEqual(['#123456']);

        vfx.clear();
        vfx.burst('sparks', AT, { intensity: 0.5 });

        expect(vfx.live()).toBe(10);
    });

    it('lets a stream emit for as long as it runs, then drains and stops asking', () =>
    {
        const vfx = made(counting());
        const stop = vfx.stream('trail', () => AT);

        clock.advance(500);

        expect(vfx.live()).toBeGreaterThan(10);

        stop();
        clock.advance(2_000);

        expect(vfx.live()).toBe(0);
        expect(clock.pending()).toBe(0);
    });

    it('keeps its canvas the size of its host for as long as it draws', () =>
    {
        let size = [120, 80];
        Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => size[0] });
        Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => size[1] });
        const ratio = Math.min(2, devicePixelRatio);
        const vfx = made(counting());
        const stop = vfx.stream('aura', () => AT);
        const canvas = host.querySelector('canvas')!;

        clock.advance(100);

        expect([canvas.width, canvas.height]).toEqual([120 * ratio, 80 * ratio]);

        size = [200, 140];
        clock.advance(50);

        expect([canvas.width, canvas.height], 'a running stream drew on a canvas its host had outgrown').toEqual([200 * ratio, 140 * ratio]);

        stop();
    });

    it('emits nothing from a stream whose point is not there yet, and starts once it is', () =>
    {
        const vfx = made(counting());
        let at: { x: number; y: number } | null = null;
        const stop = vfx.stream('aura', () => at);

        clock.advance(500);

        expect(vfx.live()).toBe(0);

        at = AT;
        clock.advance(500);

        expect(vfx.live()).toBeGreaterThan(0);

        stop();
    });

    it('throws lightning from one point to another, with sparks where it lands', () =>
    {
        const counted = counting();
        const vfx = made(counted);

        vfx.bolt({ x: 0, y: 0 }, { x: 100, y: 20 });

        expect(vfx.live()).toBeGreaterThan(1);

        clock.advance(48);

        expect(counted.drawn()).toBeGreaterThan(0);

        clock.advance(2_000);

        expect(vfx.live()).toBe(0);
    });

    it('runs a stream’s arcs along the ring round its point, never across it', () =>
    {
        const middle = { x: 100, y: 100 };
        const radius = 60;
        const turnOf = (point: { x: number; y: number }) => Math.atan2(point.y - middle.y, point.x - middle.x);
        const short = (turn: number) => turn - Math.PI * 2 * Math.round(turn / (Math.PI * 2));

        for (let round = 0; round < 40; round += 1)
        {
            const [arc] = STREAMS.arcs.spawn(middle, { scale: radius / 30 }, 1);
            drawParticle(counting().context, arc!);
            const points = arc!.points!;
            const turns = points.map((point) => short(turnOf(point) - turnOf(points[0]!)));

            expect(points.length).toBeGreaterThan(8);
            expect(points[0]!.x).toBeCloseTo(arc!.x);
            expect(points.at(-1)!.x).toBeCloseTo(arc!.to!.x);
            for (const point of points)
            {
                expect(Math.abs(Math.hypot(point.x - middle.x, point.y - middle.y) - radius), 'an arc left its ring').toBeLessThanOrEqual(radius / 9);
            }
            expect(turns.slice(1).every((turn, index) => turn > turns[index]!), 'an arc doubled back or cut across').toBe(true);
        }
    });

    it('shows less motion one fade where a burst was, and nothing for a stream or a bolt', () =>
    {
        const vfx = made(counting(), { quiet: () => true });

        vfx.burst('sparks', AT);

        expect(vfx.live()).toBe(1);

        clock.advance(300);

        expect(vfx.live()).toBe(0);

        const stop = vfx.stream('flames', () => AT);
        clock.advance(500);

        expect(vfx.live()).toBe(0);

        stop();
        vfx.bolt({ x: 0, y: 0 }, AT);

        expect(vfx.live()).toBe(1);
    });

    it('asks for no frame in a hidden tab, and wakes when the tab is seen again', () =>
    {
        const vfx = made(counting());

        seen = 'hidden';
        vfx.burst('embers', AT);

        expect(clock.pending()).toBe(0);

        seen = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));

        expect(clock.pending()).toBe(1);

        vfx.dispose();
    });

    it('takes its canvas away and stops asking for frames once disposed', () =>
    {
        const vfx = made(counting());

        vfx.stream('arcs', () => AT);
        vfx.burst('burst', AT);
        vfx.dispose();

        expect(host.querySelector('canvas')).toBeNull();
        expect(vfx.live()).toBe(0);
        expect(clock.pending()).toBe(0);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { playAt } from '../src/game/looks/cards.ts';
import { createVfx, PAGE_CEILING, qualityOf, type Quality, type Vfx, type VfxOptions } from '../src/game/vfx/engine.ts';
import { FAMILIES, FAMILY_STREAMS, type Family, type FamilyStream } from '../src/game/vfx/families.ts';
import { make, radial, rolling, seeded, TRAIL_EVERY, type Shape } from '../src/game/vfx/presets.ts';
import { drawParticle } from '../src/game/vfx/shapes.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';

let clock: ManualClock;
let hosts: HTMLElement[];
let engines: Vfx[];

interface Recording
{
    context: CanvasRenderingContext2D;
    calls: string[];
    colors: Set<string>;
    painted: () => number;
}

/** A 2D context that writes down every call and every colour it is handed, and draws nothing. */
function recording(): Recording
{
    const calls: string[] = [];
    const colors = new Set<string>();
    const kept: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1 };
    const said = (value: unknown) => (typeof value === 'number' ? value.toFixed(3) : typeof value === 'string' ? value : 'image');
    const gradient = () => ({ addColorStop: () => undefined });

    const context = new Proxy(kept, {
        get(target, name)
        {
            if (name in target)
            {
                return target[name];
            }
            if (name === 'createLinearGradient' || name === 'createRadialGradient')
            {
                return gradient;
            }
            return (...args: unknown[]) =>
            {
                calls.push(`${ String(name) }(${ args.map(said).join(',') })`);
            };
        },
        set(target, name, value)
        {
            if ((name === 'fillStyle' || name === 'strokeStyle') && typeof value === 'string')
            {
                colors.add(value);
            }
            target[name] = value;
            return true;
        }
    });

    return {
        context: context as unknown as CanvasRenderingContext2D,
        calls,
        colors,
        painted: () => calls.filter((call) => /^(fill|stroke|fillRect|drawImage)\(/.test(call)).length
    };
}

const made = (recorded: Recording, options: VfxOptions = {}) =>
{
    const host = document.createElement('div');
    document.body.append(host);
    hosts.push(host);
    const vfx = createVfx(host, {
        frame: (run) => clock.after(16, run),
        context: () => recorded.context,
        quiet: () => false,
        quality: 'high',
        ...options
    });
    engines.push(vfx);
    return vfx;
};

/** Where every circle was drawn: what a glowing dot is in a page that cannot make its light. */
const circles = (recorded: Recording) => recorded.calls.filter((call) => call.startsWith('arc(')).map((call) =>
{
    const [x, y] = call.slice(4, -1).split(',').map(Number);
    return { x: x!, y: y! };
});

const AT = { x: 120, y: 90 };

const FAMILY_NAMES = Object.keys(FAMILIES) as Family[];

const FLOW_NAMES = Object.keys(FAMILY_STREAMS) as FamilyStream[];

const SHAPES: Shape[] = ['flame', 'shard', 'feather', 'rune', 'ribbon', 'nebula', 'shade', 'glitch', 'crack', 'ray', 'slit'];

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_000);
    setRuntime({ clock });
    hosts = [];
    engines = [];
});

afterEach(() =>
{
    engines.forEach((vfx) => vfx.dispose());
    hosts.forEach((host) => host.remove());
    vi.unstubAllGlobals();
    resetRuntime();
});

describe('the effect families', () =>
{
    it.each(FAMILY_NAMES)('plays %s to its end, draws on the way, and then asks for no more frames', (family) =>
    {
        const recorded = recording();
        const vfx = made(recorded);

        vfx.burst(family, AT);

        expect(vfx.live()).toBeGreaterThan(0);

        clock.advance(6_000);

        expect(vfx.live()).toBe(0);
        expect(clock.pending(), 'a frame was still asked for with nothing left to draw').toBe(0);
        expect(recorded.painted()).toBeGreaterThan(0);
    });

    it.each(FLOW_NAMES)('lets %s give off for as long as it runs, then drains and stops asking', (flow) =>
    {
        const recorded = recording();
        const vfx = made(recorded);
        const stop = vfx.stream(flow, () => AT);
        let most = 0;

        for (let gone = 0; gone < 2_000; gone += 16)
        {
            clock.advance(16);
            most = Math.max(most, vfx.live());
        }

        expect(most).toBeGreaterThan(0);
        expect(recorded.painted()).toBeGreaterThan(0);

        stop();
        clock.advance(8_000);

        expect(vfx.live()).toBe(0);
        expect(clock.pending()).toBe(0);
    });

    it('plays a seeded effect the same way every time, another seed its own way, and no seed a new way each time', () =>
    {
        const played = (seed?: number) =>
        {
            const recorded = recording();
            made(recorded).burst('starburst', AT, seed === undefined ? {} : { seed });
            clock.advance(400);
            return recorded.calls.join('\n');
        };

        expect(played(7)).toBe(played(7));
        expect(played(8)).not.toBe(played(7));
        expect(played()).not.toBe(played());
    });

    it('goes on from batch to batch in a seeded stream, and runs the same way again from the same seed', () =>
    {
        const run = () =>
        {
            const recorded = recording();
            const vfx = made(recorded);
            vfx.stream('glints', () => AT, { seed: 3 });
            clock.advance(1_000);
            vfx.dispose();
            return recorded.calls;
        };

        const first = run();
        const placed = new Set(first.filter((call) => call.startsWith('translate(')));

        expect(placed.size, 'every batch of a seeded stream was born in the same place').toBeGreaterThan(3);
        expect(run()).toEqual(first);
    });

    it('thins every effect by the device’s quality, and holds a weaker device to fewer particles at a lower pixel ratio', () =>
    {
        vi.stubGlobal('devicePixelRatio', 3);

        const counted = (quality: Quality) =>
        {
            const vfx = made(recording(), { quality });
            const host = hosts.at(-1)!;
            Object.defineProperty(host, 'clientWidth', { configurable: true, value: 100 });
            Object.defineProperty(host, 'clientHeight', { configurable: true, value: 50 });
            vfx.burst('discharge', AT);
            clock.advance(16);
            return { live: vfx.live(), width: host.querySelector('canvas')!.width };
        };

        expect(counted('high')).toEqual({ live: 21, width: 200 });
        expect(counted('medium')).toEqual({ live: 15, width: 150 });
        expect(counted('low')).toEqual({ live: 9, width: 100 });

        const weak = made(recording(), { quality: 'low' });
        for (let round = 0; round < 25; round += 1)
        {
            weak.burst('confetti', AT);
        }

        expect(weak.live(), 'a weak device held as many as a strong one').toBe(210);
    });

    it('thins a stream by the device’s quality as it thins a burst', () =>
    {
        const given = (quality: Quality) =>
        {
            const vfx = made(recording(), { quality });
            vfx.stream('pixels', () => AT);
            clock.advance(880);
            return vfx.live();
        };

        const strong = given('high');

        expect(strong).toBeGreaterThan(12);
        expect(given('low'), 'a weak device was given a stream as thick as a strong one').toBeLessThanOrEqual(strong * 0.6);
    });

    it('works out how much a device can draw: low under a finger, on Save-Data or four cores, medium on six, high above', () =>
    {
        const told = (coarse: boolean, saveData: boolean, cores: number) =>
        {
            vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }));
            vi.stubGlobal('navigator', { hardwareConcurrency: cores, connection: { saveData } });
            return qualityOf();
        };

        expect(told(false, false, 8)).toBe('high');
        expect(told(false, false, 6)).toBe('medium');
        expect(told(false, false, 4)).toBe('low');
        expect(told(true, false, 16)).toBe('low');
        expect(told(false, true, 16)).toBe('low');
    });

    it('plays a signature’s layers at their times and places, as one effect', () =>
    {
        const recorded = recording();
        const vfx = made(recorded);
        const later = (call: { x: number; y: number }) => Math.abs(call.x - (AT.x + 40)) < 1e-6 && Math.abs(call.y - AT.y) < 1e-6;

        vfx.signature([
            { effect: 'charge', tune: { colors: ['#00AA00'] } },
            { effect: 'starburst', after: 300, dx: 40, tune: { colors: ['#AA0000'] } }
        ], AT);

        clock.advance(240);

        expect(recorded.colors.has('#00AA00')).toBe(true);
        expect(recorded.colors.has('#AA0000'), 'a later layer showed before its time').toBe(false);
        expect(circles(recorded).some(later)).toBe(false);

        clock.advance(120);

        expect(recorded.colors.has('#AA0000')).toBe(true);
        expect(circles(recorded).some(later), 'a later layer was not drawn where its step put it').toBe(true);
    });

    it('shows less motion one soft fade for a whole signature, and nothing from a family’s stream', () =>
    {
        const vfx = made(recording(), { quiet: () => true });

        vfx.signature([{ effect: 'eruption' }, { effect: 'rift', after: 400 }], AT);

        expect(vfx.live()).toBe(1);

        clock.advance(400);
        const stop = vfx.stream('blaze', () => AT);
        clock.advance(800);

        expect(vfx.live()).toBe(0);

        stop();
    });

    it('throws a directed effect within its spray of the direction, and an undirected one every way', () =>
    {
        const angles = (direction?: number) => rolling(seeded(11), () => Array.from({ length: 400 }, () =>
        {
            const { vx, vy } = radial(100, direction === undefined ? {} : { direction });
            return Math.atan2(vy, vx);
        }));

        for (const angle of angles(Math.PI / 2))
        {
            expect(Math.abs(angle - Math.PI / 2)).toBeLessThanOrEqual(0.9 + 1e-9);
        }
        const every = angles();

        expect(every.some((angle) => angle < -Math.PI / 2)).toBe(true);
        expect(every.some((angle) => angle > Math.PI / 2)).toBe(true);
        expect(every.some((angle) => Math.abs(angle) < 0.3)).toBe(true);
    });

    it('leans the aura’s light toward the pointer, and lets it go its own way once the pointer leaves', () =>
    {
        const run = (pointer: { x: number; y: number } | null) =>
        {
            const recorded = recording();
            const vfx = made(recorded);
            vfx.lean(pointer);
            const stop = vfx.stream('aura', () => AT, { seed: 5 });
            clock.advance(900);
            stop();
            const drawn = circles(recorded);
            return drawn.reduce((sum, one) => sum + one.x, 0) / drawn.length;
        };

        const alone = run(null);

        expect(run({ x: AT.x + 400, y: AT.y }), 'the light did not lean toward the pointer').toBeGreaterThan(alone + 1);
        expect(run({ x: AT.x - 400, y: AT.y })).toBeLessThan(alone - 1);
    });

    it('lets the motes of a charge fall into its middle, and keeps a sigil’s runes on their ring', () =>
    {
        const charged = recording();
        made(charged).burst('charge', AT, { seed: 2 });
        clock.advance(16);
        const early = circles(charged);
        clock.advance(240);
        charged.calls.length = 0;
        clock.advance(16);
        const late = circles(charged);
        const from = (list: { x: number; y: number }[]) => list.reduce((sum, one) => sum + Math.hypot(one.x - AT.x, one.y - AT.y), 0) / list.length;

        expect(from(late), 'the charge did not draw its motes in').toBeLessThan(from(early) * 0.7);

        const sigil = recording();
        made(sigil).burst('sigil', AT);
        clock.advance(600);
        const runes = sigil.calls.filter((call) => call.startsWith('translate(')).map((call) => call.slice(10, -1).split(',').map(Number));

        expect(runes.length).toBeGreaterThan(8);
        for (const [x, y] of runes)
        {
            expect(Math.hypot(x! - AT.x, y! - AT.y), 'a rune left its ring').toBeCloseTo(34, 0);
        }
    });

    it.each(['tendrils', 'coil'] as const)('gives each ribbon of %s its whole length at birth, its places as far apart as the engine goes on keeping them', (flow) =>
    {
        const [ribbon] = rolling(seeded(4), () => FAMILY_STREAMS[flow].spawn(AT, {}, 1));
        const orbit = ribbon!.orbit!;
        const along = (place: { x: number; y: number }) =>
        {
            const x = place.x - orbit.x;
            const y = place.y - orbit.y;
            const across = x * Math.cos(orbit.tilt) + y * Math.sin(orbit.tilt);
            const down = -x * Math.sin(orbit.tilt) + y * Math.cos(orbit.tilt);
            return Math.atan2(down / orbit.ry, across / orbit.rx);
        };
        const steps = ribbon!.trail!.map(along).slice(1).map((angle, nth) =>
        {
            const turn = angle - along(ribbon!.trail![nth]!);
            return turn - Math.PI * 2 * Math.round(turn / (Math.PI * 2));
        });

        expect(ribbon!.trail).toHaveLength(ribbon!.tail!);
        for (const step of steps)
        {
            expect(step, 'a ribbon was born with its places another distance apart than the engine keeps them').toBeCloseTo(orbit.speed * TRAIL_EVERY / 1_000, 6);
        }
    });

    it('draws a dragon’s coil wound most of the way round its ring from the moment it is born', () =>
    {
        const [coil] = rolling(seeded(4), () => FAMILY_STREAMS.coil.spawn(AT, {}, 1));
        const angles = coil!.trail!.map((place) => Math.atan2(place.y - AT.y, place.x - AT.x));
        let swept = 0;
        for (let nth = 1; nth < angles.length; nth += 1)
        {
            const turn = angles[nth]! - angles[nth - 1]!;
            swept += turn - Math.PI * 2 * Math.round(turn / (Math.PI * 2));
        }

        expect(Math.abs(swept), 'the coil was born a stub').toBeGreaterThan(Math.PI);
        for (const place of coil!.trail!)
        {
            expect(Math.hypot((place.x - AT.x) / 31, (place.y - AT.y) / (31 * 0.92))).toBeCloseTo(1, 6);
        }
    });

    it('holds every canvas of a page to one cap between them, each letting its own oldest go', () =>
    {
        const first = made(recording(), { ceiling: 800 });
        const second = made(recording(), { ceiling: 800 });

        for (let round = 0; round < 25; round += 1)
        {
            first.burst('confetti', AT);
        }

        expect(first.live()).toBe(PAGE_CEILING - 100);

        for (let round = 0; round < 25; round += 1)
        {
            second.burst('confetti', AT);
        }

        expect(first.live(), 'one canvas took particles away from another').toBe(PAGE_CEILING - 100);
        expect(first.live() + second.live(), 'the page held more than its cap').toBe(PAGE_CEILING);
    });

    it.each(SHAPES)('draws a %s mid-life, and nothing of it before its time', (shape) =>
    {
        const recorded = recording();
        const one = make(shape, AT, {
            age: 300,
            life: 600,
            size: 6,
            width: 3,
            color: '#3366FF',
            glow: true,
            outline: [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 18, y: -6 }, { x: 26, y: 2 }],
            trail: [{ x: 0, y: 0 }, { x: 8, y: 2 }, { x: 16, y: 6 }, { x: 24, y: 12 }]
        });

        drawParticle(recorded.context, one);

        expect(recorded.painted()).toBeGreaterThan(0);

        const waiting = recording();
        drawParticle(waiting.context, { ...one, age: -40 });

        expect(waiting.calls).toEqual([]);
    });
});

describe('a stream given an area', () =>
{
    /** Where each particle was drawn across, read from the calls that place one. */
    const across = (recorded: Recording) => recorded.calls
        .map((call) => /^(drawImage|arc|translate)\(([^)]*)\)/.exec(call))
        .filter((found) => found !== null)
        .map(([, name, args]) => Number(args!.split(',')[name === 'drawImage' ? 1 : 0]))
        .filter((x) => Number.isFinite(x));

    const run = (area?: { width: number; height: number }) =>
    {
        const recorded = recording();
        const vfx = made(recorded);
        const stop = vfx.stream('cinders', () => ({ x: 300, y: 60 }), { seed: 7, ...(area === undefined ? {} : { area }) });

        clock.advance(3_000);
        stop();

        return across(recorded);
    };

    it('gives off across the area round its point, where without one it gives off from the point', () =>
    {
        const width = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

        expect(width(run())).toBeLessThan(160);
        expect(width(run({ width: 600, height: 100 }))).toBeGreaterThan(420);
    });

    it('reads an area given as a getter at every spawn, so a stream follows a host that changes size', () =>
    {
        const recorded = recording();
        const vfx = made(recorded);
        let width = 100;
        const stop = vfx.stream('comet', () => ({ x: 300, y: 60 }), {
            seed: 3,
            get area()
            {
                return { width, height: 20 };
            }
        });

        clock.advance(1_000);
        const narrow = across(recorded);

        width = 600;
        clock.advance(1_000);
        recorded.calls.length = 0;
        clock.advance(300);
        const wide = across(recorded);
        stop();

        expect(Math.max(...narrow) - Math.min(...narrow)).toBeLessThan(150);
        expect(Math.max(...wide) - Math.min(...wide), 'the area it was started with').toBeGreaterThan(400);
    });

    it('gives off across the same places with the same seed', () =>
    {
        expect(run({ width: 600, height: 100 })).toEqual(run({ width: 600, height: 100 }));
    });
});

describe('a card\'s signature, as a table plays it', () =>
{
    /** Longer than any card's signature lasts to its faintest tail, so one that lingers or streams is caught. */
    const SPENT_MS = 2_500;

    it.each([...SHOP_COLLECTIONS])('lays a card of %s with a signature that is spent within two and a half seconds, whatever its roll', (collection) =>
    {
        const { steps, at, tune } = playAt(collection, { x: 90, y: 60, width: 60, height: 85 });

        for (let seed = 1; seed <= 6; seed += 1)
        {
            const vfx = made(recording());

            vfx.signature(steps, at, { ...tune, seed });

            expect(vfx.live()).toBeGreaterThan(0);

            clock.advance(SPENT_MS);

            expect(vfx.live(), `seed ${ seed } was still drawing`).toBe(0);
        }
    });
});

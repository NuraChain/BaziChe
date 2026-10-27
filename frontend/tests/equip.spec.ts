import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { burstOver, SPENT_CHECK_MS } from '../src/game/looks/equip.ts';
import { PALETTES } from '../src/game/looks/palette.ts';
import { burstOf, lightOf, type Collection } from '../src/game/looks/table.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Effect, Point, Tune, Vfx } from '../src/game/vfx/engine.ts';

const engine = vi.hoisted(() => ({
    offline: false,
    made: [] as HTMLElement[],
    bursts: [] as { host: HTMLElement; effect: Effect; at: Point; tune: Tune }[],
    alive: 0,
    disposed: [] as HTMLElement[]
}));

// The loader is faked rather than the engine: under vitest two fetches of a mocked module in one
// turn hand the second the real module, and two presses in one turn are two fetches.
vi.mock('../src/game/vfx/lazy.ts', () => ({
    lazyVfx: (host: HTMLElement) =>
    {
        engine.made.push(host);

        const vfx = {
            burst(effect: Effect, at: Point, tune: Tune)
            {
                engine.bursts.push({ host, effect, at, tune });
            },
            live: () => engine.alive
        } as unknown as Vfx;

        return {
            async play(effect: (vfx: Vfx) => void)
            {
                await Promise.resolve();

                if (!engine.offline)
                {
                    effect(vfx);
                }
            },
            dispose()
            {
                engine.disposed.push(host);
            }
        };
    }
}));

let clock: ManualClock;
let look: HTMLElement;

const sized = (element: HTMLElement, box: { left: number; top: number; width: number; height: number }) =>
{
    element.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box }) as DOMRect;
};

const hosts = () => [...document.querySelectorAll<HTMLElement>('[data-equip]')];

const played = async (count = 1) => await vi.waitFor(() => expect(engine.bursts).toHaveLength(count));

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_000_000);
    setRuntime({ clock, seed: 7 });
    engine.offline = false;
    engine.made = [];
    engine.bursts = [];
    engine.alive = 0;
    engine.disposed = [];
    look = document.createElement('button');
    sized(look, { left: 200, top: 300, width: 96, height: 110 });
    document.body.append(look);
});

afterEach(() =>
{
    for (const host of hosts())
    {
        host.remove();
    }
    look.remove();
    resetRuntime();
});

describe('a look put on', () =>
{
    it('plays the burst of its collection from the middle of its drawing, in the collection’s light', async () =>
    {
        engine.alive = 30;
        burstOver(look, 'decoration.inferno');
        await played();

        const [host] = hosts();
        const [burst] = engine.bursts;

        expect(engine.made, 'an engine of its own, over a host of its own').toEqual([host]);
        expect(host?.dataset.equip).toBe('inferno');
        expect(burst?.host).toBe(host);
        expect(burst?.effect).toBe(burstOf('inferno').effect);
        expect(burst?.tune.colors).toEqual(lightOf('inferno'));
        expect(Number.parseFloat(host!.style.left) + burst!.at.x, 'the middle of the look across').toBe(200 + 96 / 2);
        expect(Number.parseFloat(host!.style.top) + burst!.at.y, 'and down').toBe(300 + 110 / 2);
    });

    it('reaches past the look on every side, so the burst is not cut at its edge', async () =>
    {
        engine.alive = 30;
        burstOver(look, 'dice.storm');
        await played();

        const host = hosts()[0]!;
        const left = Number.parseFloat(host.style.left);
        const top = Number.parseFloat(host.style.top);

        expect(left).toBeLessThan(200);
        expect(top).toBeLessThan(300);
        expect(left + Number.parseFloat(host.style.width)).toBeGreaterThan(200 + 96);
        expect(top + Number.parseFloat(host.style.height)).toBeGreaterThan(300 + 110);
    });

    it('grows with the look it is put on, up to a size past which its strokes would be fat', async () =>
    {
        engine.alive = 30;

        for (const width of [96, 120, 470, 940])
        {
            const drawing = document.createElement('img');
            sized(drawing, { left: 20, top: 40, width, height: width * 0.75 });
            document.body.append(drawing);
            burstOver(drawing, 'pawns.jade');
            drawing.remove();
        }
        await played(4);

        const [small, larger, large, huge] = engine.bursts.map((one) => one.tune.scale!);

        expect(larger).toBe(small! * 1.25);
        expect(large).toBeLessThan(small! * 470 / 96);
        expect(huge).toBe(large);
    });

    it('is laid over the page above any sheet, where nothing can press it and nothing reads it aloud', async () =>
    {
        engine.alive = 30;
        burstOver(look, 'back.phoenix');
        await played();

        const host = hosts()[0]!;

        expect(host.parentElement).toBe(document.body);
        expect(host.getAttribute('aria-hidden')).toBe('true');
        expect(host.style.position).toBe('fixed');
        expect(host.style.pointerEvents).toBe('none');
        expect(host.style.zIndex).toBe('calc(var(--z-overlay) + 1)');
    });

    it('plays each collection’s own burst', async () =>
    {
        const collections = Object.keys(PALETTES) as Collection[];
        engine.alive = 30;

        for (const collection of collections)
        {
            burstOver(look, `face.${ collection }`);
        }
        await played(collections.length);

        expect(engine.bursts.map((one) => one.effect)).toEqual(collections.map((one) => burstOf(one).effect));
        expect(engine.bursts.map((one) => one.tune.colors)).toEqual(collections.map((one) => lightOf(one)));
    });

    it('plays nothing for a look of no collection this build draws, and lays nothing over the page', async () =>
    {
        burstOver(look, 'dice.ember');
        burstOver(look, 'classic');
        burstOver(look, 'pawns.constructor');
        await settle();

        expect(hosts()).toEqual([]);
        expect(engine.made).toEqual([]);
    });

    it('gives each press a host of its own, so a burst pressed while another plays plays as well', async () =>
    {
        engine.alive = 30;
        burstOver(look, 'dice.neon');
        burstOver(look, 'dice.gold');
        await played(2);

        expect(hosts()).toHaveLength(2);
        expect(new Set(engine.bursts.map((one) => one.host)).size).toBe(2);
    });
});

describe('a look’s burst, spent', () =>
{
    it('lets its engine and its host go once nothing of it is alive, and not before', async () =>
    {
        engine.alive = 12;
        burstOver(look, 'decoration.void');
        await played();

        const host = hosts()[0]!;
        clock.advance(SPENT_CHECK_MS * 12);

        expect(host.isConnected, 'still drawing').toBe(true);
        expect(engine.disposed).toEqual([]);

        engine.alive = 0;
        clock.advance(SPENT_CHECK_MS);

        expect(host.isConnected).toBe(false);
        expect(engine.disposed).toEqual([host]);
        expect(clock.pending(), 'nothing left asking').toBe(0);
    });

    it('lets its host go when the engine could not be fetched', async () =>
    {
        engine.offline = true;
        burstOver(look, 'decoration.jade');

        const host = hosts()[0];

        expect(host, 'laid at the press').toBeDefined();

        await vi.waitFor(() => expect(host?.isConnected).toBe(false));

        expect(engine.bursts).toEqual([]);
        expect(engine.disposed).toEqual([host]);
        expect(clock.pending()).toBe(0);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AURAS, glowAround, REVEALS, revealAround, struckAt } from '../src/game/looks/aura.ts';
import { FRAMES } from '../src/game/looks/frames.ts';
import { FAMILIES } from '../src/game/vfx/families.ts';
import { PRESETS } from '../src/game/vfx/presets.ts';
import type { Point, Step, Stream, Tune } from '../src/game/vfx/engine.ts';

interface Running
{
    host: HTMLElement;
    kind: Stream;
    at: () => Point | null;
    tune: Tune;
    ended: boolean;
}

const engine = vi.hoisted(() => ({ made: 0, streams: [] as Running[], disposed: 0, leans: [] as (Point | null)[], signatures: [] as { host: HTMLElement; steps: readonly Step[]; at: Point; tune: Tune }[] }));

vi.mock('../src/game/vfx/engine.ts', () => ({
    createVfx: (host: HTMLElement) =>
    {
        engine.made += 1;

        return {
            stream(kind: Stream, at: () => Point | null, tune: Tune)
            {
                const running = { host, kind, at, tune, ended: false };
                engine.streams.push(running);
                return () =>
                {
                    running.ended = true;
                };
            },
            lean(at: Point | null)
            {
                engine.leans.push(at);
            },
            signature(steps: readonly Step[], at: Point, tune: Tune)
            {
                engine.signatures.push({ host, steps, at, tune });
            },
            dispose()
            {
                engine.disposed += 1;
            }
        };
    }
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
    engine.made = 0;
    engine.streams = [];
    engine.disposed = 0;
    engine.leans = [];
    engine.signatures = [];
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

    it('shows nothing of itself inside the picture’s circle, so a stream that rises is drawn round the face and never over it', async () =>
    {
        const stop = glowAround(picture, 'inferno');
        const { host } = await playing();
        const face = (0.5 / (0.5 + 0.4)) * 100;

        expect(host.style.cssText).toContain(`mask: radial-gradient(circle closest-side,transparent ${ face.toFixed(2) }%,#000 ${ (face + 1).toFixed(2) }%)`);

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

    it('leans toward a pointer over the area it is given, from its own host’s corner, and lets go when the pointer leaves', async () =>
    {
        const area = document.createElement('section');
        area.append(picture);
        document.body.append(area);
        const stop = glowAround(picture, 'gold', area);
        const { host } = await playing();
        host.getBoundingClientRect = () => ({ left: 30, top: 50 }) as DOMRect;

        area.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, clientY: 90, pointerType: 'mouse', bubbles: true }));

        expect(engine.leans).toEqual([{ x: 100, y: 40 }]);

        area.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 60, pointerType: 'touch', bubbles: true }));

        expect(engine.leans, 'the aura leaned toward a finger scrolling the page').toHaveLength(1);

        area.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));

        expect(engine.leans.at(-1)).toBeNull();

        stop();
        area.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, clientY: 90, pointerType: 'mouse', bubbles: true }));

        expect(engine.leans, 'an aura that was let go still listened to the pointer').toHaveLength(2);

        area.remove();
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

        expect(engine.made, 'a stop that came first still made an engine, which nothing lets go').toBe(1);
        expect(engine.streams).toHaveLength(1);
        expect(picture.querySelector('[data-aura]')).toBeNull();
    });
});

describe('a profile effect’s reveal', () =>
{
    const boxed = (element: HTMLElement, box: { left: number; top: number; width: number; height: number }) =>
    {
        element.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box });
    };

    let head: HTMLElement;

    beforeEach(() =>
    {
        head = document.createElement('section');
        document.body.append(head);
        boxed(head, { left: 100, top: 50, width: 640, height: 320 });
        boxed(picture, { left: 140, top: 110, width: 112, height: 112 });
    });

    afterEach(() => head.remove());

    const revealed = async () =>
    {
        await vi.waitFor(() => expect(engine.signatures.length).toBeGreaterThan(0));
        return engine.signatures.at(-1)!;
    };

    it('is a reveal for every collection a frame is drawn for, a classic one of the presets and a legendary one opening with an effect family', () =>
    {
        expect(Object.keys(REVEALS).sort()).toEqual([...FRAMES].sort());

        for (const collection of ['glow', 'shiraz', 'neon', 'gold'] as const)
        {
            expect(REVEALS[collection].every((one) => Object.hasOwn(PRESETS, one.effect)), collection).toBe(true);
            expect(REVEALS[collection].length, collection).toBeGreaterThan(1);
        }

        for (const collection of FRAMES.filter((one) => !['glow', 'shiraz', 'neon', 'gold'].includes(one)))
        {
            expect(Object.hasOwn(FAMILIES, REVEALS[collection][0].effect), collection).toBe(true);
        }

        expect(REVEALS.inferno.map((one) => one.effect)).toEqual(['cracks', 'eruption']);
    });

    it('plays its collection’s signature once, round the middle of the picture, in the collection’s light at the frame’s size', async () =>
    {
        const stop = revealAround(head, picture, 'inferno');
        const { host, steps, at, tune } = await revealed();

        expect(steps).toBe(REVEALS.inferno);
        expect(at).toEqual({ x: 96, y: 116 });
        expect(tune.colors).toEqual(AURAS.inferno.tune.colors);
        expect(tune.scale).toBeCloseTo(2.1);
        expect(host.dataset.reveal).toBe('inferno');
        expect(engine.signatures).toHaveLength(1);

        stop();
    });

    it('is drawn across the whole head, over what is in it, that nothing can press, and never over the face', async () =>
    {
        const stop = revealAround(head, picture, 'storm');
        const { host } = await revealed();

        expect(head.lastElementChild).toBe(host);
        expect(host.getAttribute('aria-hidden')).toBe('true');
        expect(host.style.cssText).toContain('inset: 0');
        expect(host.style.zIndex).toBe('1');
        expect(host.style.pointerEvents).toBe('none');
        expect(host.style.cssText).toContain('mask: radial-gradient(circle at 96px 116px, transparent 56px, #000 57px)');

        stop();
    });

    it('plays nothing round a picture that has no size', async () =>
    {
        boxed(picture, { left: 0, top: 0, width: 0, height: 0 });
        const stop = revealAround(head, picture, 'oni');

        await vi.waitFor(() => expect(engine.made).toBe(1));
        await Promise.resolve();

        expect(engine.signatures).toEqual([]);

        stop();
    });

    it('lets go of its engine and its host when stopped', async () =>
    {
        const stop = revealAround(head, picture, 'jade');
        await revealed();

        stop();

        expect(engine.disposed).toBe(1);
        expect(head.querySelector('[data-reveal]')).toBeNull();
    });

    describe('of a profile worn whole', () =>
    {
        let sigil: HTMLElement;

        beforeEach(() =>
        {
            sigil = document.createElement('img');
            picture.append(sigil);
            boxed(sigil, { left: 179, top: 86, width: 34, height: 34 });
        });

        it('ends by striking the set’s sigil once the reveal has bloomed: a ring and the reveal’s last layer again, smaller, from the sigil', async () =>
        {
            const stop = revealAround(head, picture, 'storm', sigil);
            const { steps, tune } = await revealed();
            const reveal: readonly Step[] = REVEALS.storm;
            const strike = steps.slice(reveal.length);
            const scale = tune.scale!;

            expect(steps.slice(0, reveal.length)).toEqual([...reveal]);
            expect(strike.map((one) => one.effect)).toEqual(['shockwave', 'discharge']);

            for (const one of strike)
            {
                expect(one.after).toBe(struckAt('storm'));
                expect(one.after).toBeGreaterThan(Math.max(...reveal.map((step) => step.after ?? 0)));
                expect(196 + one.dx! * scale, 'from the sigil across').toBeCloseTo(196);
                expect(166 + one.dy! * scale, 'and down').toBeCloseTo(103);
                expect(one.tune?.scale).toBeLessThan(scale);
            }

            stop();
        });

        it('strikes with something besides a second ring, an echo of each collection’s own reveal', async () =>
        {
            for (const [nth, collection] of FRAMES.entries())
            {
                const stop = revealAround(head, picture, collection, sigil);
                await vi.waitFor(() => expect(engine.signatures).toHaveLength(nth + 1));

                const reveal: readonly Step[] = REVEALS[collection];
                const [ring, echo] = engine.signatures[nth]!.steps.slice(reveal.length);

                expect(ring?.effect, collection).toBe('shockwave');
                expect(echo?.effect, collection).not.toBe('shockwave');
                expect(reveal.some((step) => step.effect === echo?.effect), `${ collection }: an echo of its own reveal`).toBe(true);

                stop();
            }
        });

        it('marks the sigil struck at that moment, in the collection’s light, for the stylesheet to strike it', async () =>
        {
            const stop = revealAround(head, picture, 'phoenix', sigil);

            expect(sigil.dataset.struck, 'struck before the reveal played').toBeUndefined();

            await revealed();

            expect(sigil.dataset.struck).toBe('');
            expect(sigil.style.getPropertyValue('--struck')).toBe(`${ struckAt('phoenix') }ms`);
            expect(sigil.style.getPropertyValue('--sigil-glow')).toBe(AURAS.phoenix.tune.colors[1]);

            stop();
        });

        it('strikes nothing round a picture that has no size', async () =>
        {
            boxed(picture, { left: 0, top: 0, width: 0, height: 0 });
            const stop = revealAround(head, picture, 'oni', sigil);

            await vi.waitFor(() => expect(engine.made).toBe(1));
            await Promise.resolve();

            expect(engine.signatures).toEqual([]);
            expect(sigil.dataset.struck).toBeUndefined();

            stop();
        });
    });
});

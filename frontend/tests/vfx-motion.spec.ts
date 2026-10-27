import { describe, expect, it } from 'vitest';

import { move } from '../src/game/vfx/motion.ts';
import { make, TRAIL_EVERY, type Particle, type Point } from '../src/game/vfx/presets.ts';

/** Lives `particle` for `ms` in frames of `frame` ms, as the engine does: its age counted, then the move. */
function live(particle: Particle, ms: number, frame: number, pointer: Point | null = null)
{
    for (let gone = 0; gone < ms; gone += frame)
    {
        const step = Math.min(frame, ms - gone);
        particle.age += step;
        move(particle, step, pointer);
    }
    return particle;
}

const still = (fields: Partial<Particle> = {}) => make('dot', { x: 0, y: 0 }, { life: 10_000, ...fields });

const ribbon = (fields: Partial<Particle> = {}) => make('ribbon', { x: 100, y: 0 }, {
    orbit: { x: 0, y: 0, rx: 100, ry: 100, tilt: 0, angle: 0, speed: 2 },
    trail: [],
    tail: 40,
    life: 10_000,
    ...fields
});

describe('how a particle moves', () =>
{
    it('carries an orbiting particle round its ellipse at its speed, turned by its tilt, whatever its velocity says', () =>
    {
        const one = live(make('star', { x: 0, y: 0 }, { vx: 500, orbit: { x: 10, y: 20, rx: 100, ry: 50, tilt: Math.PI / 2, angle: 0, speed: 1 } }), 1_000, 16);
        const x = Math.cos(1) * 100;
        const y = Math.sin(1) * 50;

        expect(one.x).toBeCloseTo(10 - y, 6);
        expect(one.y).toBeCloseTo(20 + x, 6);
    });

    it('pulls a particle into its well, and pushes one away from a well below nought', () =>
    {
        const pulled = live(still({ x: 100, well: { x: 0, y: 0, pull: 400 } }), 200, 16);
        const pushed = live(still({ x: 100, well: { x: 0, y: 0, pull: -400 } }), 200, 16);

        expect(pulled.x).toBeLessThan(100);
        expect(pulled.vx).toBeLessThan(0);
        expect(pushed.x).toBeGreaterThan(100);
        expect(pulled.y).toBe(0);
    });

    it('leans a particle that answers the pointer toward it, and leaves alone one that does not, or when there is none', () =>
    {
        const leaning = live(still({ pointer: 100 }), 300, 16, { x: 0, y: 50 });
        const deaf = live(still(), 300, 16, { x: 0, y: 50 });
        const alone = live(still({ pointer: 100 }), 300, 16, null);

        expect(leaning.y).toBeGreaterThan(0);
        expect(leaning.x).toBeCloseTo(0, 6);
        expect([deaf.x, deaf.y]).toEqual([0, 0]);
        expect([alone.x, alone.y]).toEqual([0, 0]);
    });

    it('stirs a particle in eddies, so one at rest drifts and two that start apart part ways', () =>
    {
        const stirred = live(still({ swirl: 200 }), 500, 16);
        const other = live(still({ x: 60, y: 40, swirl: 200 }), 500, 16);
        const calm = live(still(), 500, 16);

        expect(Math.hypot(stirred.x, stirred.y)).toBeGreaterThan(1);
        expect([calm.x, calm.y]).toEqual([0, 0]);
        expect(Math.hypot(other.vx - stirred.vx, other.vy - stirred.vy)).toBeGreaterThan(1);
    });

    it('slows by its drag, falls by its gravity, and turns by its spin', () =>
    {
        const one = live(still({ vx: 100, drag: 1, gravity: 100, spin: 2 }), 100, 100);

        expect(one.vx).toBeCloseTo(90, 6);
        expect(one.vy).toBeCloseTo(10, 6);
        expect(one.turn).toBeCloseTo(0.2, 6);
    });

    it('keeps a ribbon’s places one TRAIL_EVERY of its life apart, the same at 25 frames a second as at 125', () =>
    {
        const fast = live(ribbon(), 640, 8);
        const slow = live(ribbon(), 640, 40);

        expect(fast.trail).toHaveLength(40);
        expect(slow.trail, 'a slow frame lost the places it skipped').toHaveLength(40);

        fast.trail!.forEach((place, nth) =>
        {
            const age = (nth + 1) * TRAIL_EVERY;
            const angle = 2 * age / 1_000;

            expect(place.x, `place ${ nth } at ${ age } ms`).toBeCloseTo(Math.cos(angle) * 100, 0);
            expect(place.y).toBeCloseTo(Math.sin(angle) * 100, 0);
            expect(slow.trail![nth]!.x, `place ${ nth } of the slow ribbon`).toBeCloseTo(place.x, 0);
            expect(slow.trail![nth]!.y).toBeCloseTo(place.y, 0);
        });
    });

    it('begins a ribbon where it is born and holds it to its tail, its newest place where it is now', () =>
    {
        const young = live(ribbon({ tail: 200 }), 32, 16);

        expect(young.trail![0]).toEqual({ x: 100, y: 0 });
        expect(young.trail).toHaveLength(3);

        const old = live(ribbon({ tail: 12 }), 2_000, 16);

        expect(old.trail).toHaveLength(12);
        expect(old.trail!.at(-1)!.x).toBeCloseTo(old.x, 6);
        expect(old.trail!.at(-1)!.y).toBeCloseTo(old.y, 6);
    });

    it('keeps no places for a particle that has no trail', () =>
    {
        const one = live(still({ vx: 10 }), 200, 16);

        expect(one.trail).toBeUndefined();
        expect(one.kept).toBeUndefined();
    });
});

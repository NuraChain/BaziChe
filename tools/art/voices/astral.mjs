/**
 * Astral Rift's voice: bells struck in a bright Lydian, glitter falling through a long hall, and a
 * pad that drifts as slowly as an orbit, the rift drawing in before the stars pour out.
 */
import { between, bell, BELL, GLASS, mix, reverb, shape, silence, step, strike, tone } from './dsp.mjs';
import { boom, chime, inhale, pad, sparkle, whoosh } from './parts.mjs';

const ROOT = 587.33;

/** D Lydian: its raised fourth is what makes it sound like light. */
const LYDIAN = [0, 2, 4, 6, 7, 9, 11].map((steps) => step(ROOT, steps));

const STAR = [LYDIAN[0] * 2, LYDIAN[2] * 2, LYDIAN[4] * 2, LYDIAN[6] * 2];

/** Two sines a few hertz apart, which beat against each other as two bodies in orbit would pull. */
const orbit = (random, hz, seconds) =>
{
    const out = silence(seconds);

    mix(out, tone({ seconds, freq: hz }), 0, 0.5);
    mix(out, tone({ seconds, freq: hz + between(random, 4, 7) }), 0, 0.5);

    return shape(out, strike(0.004, seconds * 0.35));
};

export const voice = {
    equip(random)
    {
        const out = silence(1.2);

        mix(out, inhale({ seconds: 0.32, random, low: 1500, high: 9000 }), 0, 0.7);
        mix(out, chime({ notes: STAR, seconds: 1.1, partials: GLASS, decay: 0.7, spread: 0.035 }), 0.32, 1);
        mix(out, sparkle({ seconds: 0.5, random, count: 12, low: 3000, high: 9000 }), 0.34, 0.7);

        return reverb(out, { size: 0.85, wet: 0.3, tail: 0.8 });
    },

    reveal(random)
    {
        const out = silence(2.6);
        const rift = shape(pad({ notes: [ROOT / 4, ROOT * 3 / 8], seconds: 0.6, random, open: [200, 900], attack: 0.4, release: 0.15 }), (t) => 1 + t);

        mix(out, rift, 0, 0.8);
        mix(out, whoosh({ seconds: 0.5, from: 2400, to: 260, random, q: 1.1, rise: 0.8 }), 0, 0.5);
        mix(out, chime({ notes: STAR, seconds: 1.6, partials: BELL, decay: 1.1, spread: 0.018 }), 0.5, 1);
        mix(out, sparkle({ seconds: 0.9, random, count: 26, low: 2800, high: 10000, early: 1.8 }), 0.5, 0.8);
        mix(out, pad({ notes: [LYDIAN[0], LYDIAN[4], LYDIAN[1] * 2], seconds: 1.9, random, open: [500, 2600], attack: 0.5, release: 1 }), 0.6, 0.45);

        return reverb(out, { size: 0.9, damp: 0.3, wet: 0.32, tail: 1 });
    },

    strike(random)
    {
        const out = silence(1.1);

        mix(out, chime({ notes: [LYDIAN[2] * 2, LYDIAN[6] * 2, LYDIAN[2] * 4], seconds: 1.1, partials: GLASS, decay: 0.75, spread: 0.01 }), 0, 1);
        mix(out, sparkle({ seconds: 0.4, random, count: 10, low: 4000, high: 10000 }), 0.02, 0.6);

        return reverb(out, { size: 0.85, wet: 0.3, tail: 0.7 });
    },

    die(random)
    {
        const out = silence(0.4);

        mix(out, bell({ freq: between(random, 2600, 3100), seconds: 0.4, partials: GLASS, decay: 0.18 }), 0, 0.5);
        mix(out, sparkle({ seconds: 0.12, random, count: 4, low: 5000, high: 10000 }), 0.01, 0.4);

        return reverb(out, { size: 0.7, wet: 0.22, tail: 0.3 });
    },

    card(random)
    {
        const out = silence(0.36);

        mix(out, sparkle({ seconds: 0.22, random, count: 8, low: 3500, high: 9500, early: 0.6 }), 0, 1);
        mix(out, whoosh({ seconds: 0.25, from: 3000, to: 7000, random, q: 1.6 }), 0, 0.3);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.32);

        mix(out, orbit(random, between(random, 1250, 1450), 0.3), 0, 0.8);

        return reverb(out, { size: 0.6, wet: 0.18, tail: 0.25 });
    },

    spawn(random)
    {
        const out = silence(0.75);

        mix(out, inhale({ seconds: 0.25, random, low: 2000, high: 9000 }), 0, 0.5);
        mix(out, chime({ notes: [LYDIAN[0] * 2, LYDIAN[4] * 2], seconds: 0.5, partials: GLASS, decay: 0.35, spread: 0.06 }), 0.24, 0.8);
        mix(out, sparkle({ seconds: 0.3, random, count: 7, low: 3500, high: 9000 }), 0.25, 0.5);

        return reverb(out, { size: 0.8, wet: 0.25, tail: 0.4 });
    },

    capture(random)
    {
        const out = silence(1);

        mix(out, boom({ seconds: 0.5, from: 90, to: 50, tau: 0.16, warmth: 1.6 }), 0, 0.3);
        mix(out, chime({ notes: STAR, seconds: 0.9, partials: BELL, decay: 0.55, spread: 0.008 }), 0, 1);
        mix(out, sparkle({ seconds: 0.45, random, count: 16, low: 3000, high: 10000, early: 2 }), 0.01, 0.7);

        return reverb(out, { size: 0.85, wet: 0.28, tail: 0.6 });
    }
};

/**
 * Nura Glow's voice: the brand's own light, struck on glass in a C major seventh, with white-gold
 * glitter falling round it and a soft pulse under the brightest of it.
 */
import { between, bell, GLASS, mix, ramp, reverb, shape, silence, step, swell, tone } from './dsp.mjs';
import { chime, sparkle } from './parts.mjs';

const ROOT = 1046.5;

/** C, E, G and B: a major seventh, warm and unresolved, as a light left on. */
const SEVENTH = [0, 4, 7, 11, 12].map((steps) => step(ROOT, steps));

/** A soft pulse of light: a low sine swelling up a fifth and fading. */
const pulse = (seconds) => shape(tone({ seconds, freq: ramp([[0, 196], [seconds, 294]]) }), swell(seconds * 0.3, seconds * 0.4, seconds * 0.6));

export const voice = {
    equip(random)
    {
        const out = silence(1);

        SEVENTH.slice(0, 4).forEach((hz, at) => mix(out, bell({ freq: hz, seconds: 0.8, partials: GLASS, decay: 0.45 }), at * 0.05, 0.3));
        mix(out, sparkle({ seconds: 0.4, random, count: 10, low: 3500, high: 9500 }), 0.15, 0.6);

        return reverb(out, { size: 0.75, damp: 0.3, wet: 0.26, tail: 0.5 });
    },

    reveal(random)
    {
        const out = silence(1.9);

        mix(out, pulse(0.6), 0, 0.35);
        mix(out, chime({ notes: SEVENTH.slice(0, 4), seconds: 1.4, partials: GLASS, decay: 0.85, spread: 0.03 }), 0.12, 0.9);
        mix(out, sparkle({ seconds: 1, random, count: 28, low: 3000, high: 10000, early: 1.5 }), 0.12, 0.75);

        return reverb(out, { size: 0.8, damp: 0.3, wet: 0.28, tail: 0.6 });
    },

    strike(random)
    {
        const out = silence(0.9);

        mix(out, chime({ notes: [SEVENTH[4], SEVENTH[2] * 2], seconds: 0.9, partials: GLASS, decay: 0.5, spread: 0.01 }), 0, 1);
        mix(out, sparkle({ seconds: 0.35, random, count: 12, low: 4000, high: 10000, early: 2 }), 0.01, 0.6);

        return reverb(out, { size: 0.75, damp: 0.3, wet: 0.24, tail: 0.5 });
    },

    die(random)
    {
        const out = silence(0.32);

        mix(out, bell({ freq: between(random, 2100, 2600), seconds: 0.3, partials: GLASS, decay: 0.08 }), 0, 0.5);
        mix(out, sparkle({ seconds: 0.1, random, count: 3, low: 5000, high: 9000 }), 0.02, 0.4);

        return out;
    },

    card(random)
    {
        const out = silence(0.32);

        mix(out, sparkle({ seconds: 0.2, random, count: 7, low: 3000, high: 9000, early: 0.7 }), 0, 1);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.26);

        mix(out, bell({ freq: between(random, 1500, 1800), seconds: 0.25, partials: GLASS, decay: 0.06 }), 0, 0.6);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.65);

        [0, 1, 2, 4].forEach((note, at) => mix(out, bell({ freq: SEVENTH[note], seconds: 0.4, partials: GLASS, decay: 0.2 }), at * 0.055, 0.28));
        mix(out, sparkle({ seconds: 0.25, random, count: 5, low: 4500, high: 9500 }), 0.2, 0.4);

        return reverb(out, { size: 0.7, damp: 0.3, wet: 0.2, tail: 0.3 });
    },

    capture(random)
    {
        const out = silence(0.85);

        mix(out, pulse(0.35), 0, 0.3);
        mix(out, chime({ notes: [SEVENTH[0], SEVENTH[2], SEVENTH[4]], seconds: 0.75, partials: GLASS, decay: 0.4, spread: 0.008 }), 0, 0.9);
        mix(out, sparkle({ seconds: 0.4, random, count: 14, low: 3500, high: 10000, early: 2 }), 0.01, 0.6);

        return reverb(out, { size: 0.75, damp: 0.3, wet: 0.22, tail: 0.4 });
    },

    victory(random)
    {
        const out = silence(2.4);

        mix(out, pulse(0.9), 0, 0.35);
        SEVENTH.forEach((hz, at) => mix(out, bell({ freq: hz, seconds: 1.2, partials: GLASS, decay: 0.6 }), at * 0.07, 0.3));
        mix(out, chime({ notes: [SEVENTH[0] * 2, SEVENTH[2] * 2, SEVENTH[4] * 2], seconds: 1.6, partials: GLASS, decay: 1, spread: 0.02 }), 0.42, 0.85);
        mix(out, sparkle({ seconds: 1.4, random, count: 40, low: 3000, high: 10000, early: 1.2 }), 0.3, 0.75);

        return reverb(out, { size: 0.85, damp: 0.3, wet: 0.3, tail: 0.7 });
    }
};

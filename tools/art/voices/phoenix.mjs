/**
 * Solar Phoenix's voice: wings beating, a flare climbing on a rush of bright fire, and a sunburst
 * of bells in G major; soaring and radiant, and reborn on every rise.
 */
import { BELL, between, crackle, mix, reverb, shape, silence, step, strike, swell } from './dsp.mjs';
import { boom, chime, flutter, sparkle, tap, whoosh } from './parts.mjs';

const ROOT = 392;

/** G major across two octaves: the sunburst's chord. */
const SUN = [0, 4, 7, 12, 16, 19].map((steps) => step(ROOT, steps));

/** A flare: fire rushing up from `from` to `to` hertz, crackling at its edge. */
const flare = (random, seconds, from, to) =>
{
    const out = silence(seconds);

    mix(out, whoosh({ seconds, from, to, random, q: 1.1, rise: 0.55 }), 0, 1);
    mix(out, shape(crackle({ seconds, random, rate: 45, low: 2500, high: 9000 }), swell(seconds * 0.4, seconds * 0.6, seconds * 0.4)), 0, 0.35);

    return out;
};

export const voice = {
    equip(random)
    {
        const out = silence(1.1);

        mix(out, flutter({ seconds: 0.3, random, rate: 9, low: 500, high: 3500 }), 0, 0.7);
        mix(out, flare(random, 0.45, 500, 5200), 0.18, 0.8);
        mix(out, chime({ notes: [SUN[2], SUN[3], SUN[4]], seconds: 0.8, partials: BELL, decay: 0.5, spread: 0.03 }), 0.45, 0.9);

        return reverb(out, { size: 0.7, damp: 0.35, wet: 0.22, tail: 0.5 });
    },

    reveal(random)
    {
        const out = silence(2.4);

        mix(out, flutter({ seconds: 0.5, random, rate: 7, low: 400, high: 3000 }), 0, 0.9);
        mix(out, flare(random, 0.55, 350, 6000), 0.45, 1);
        mix(out, boom({ seconds: 0.6, from: 100, to: 50, tau: 0.2, warmth: 1.8 }), 0.55, 0.25);
        mix(out, chime({ notes: SUN, seconds: 1.6, partials: BELL, decay: 0.9, spread: 0.022 }), 0.55, 1);
        mix(out, sparkle({ seconds: 0.8, random, count: 18, low: 3000, high: 9000, early: 1.6 }), 0.56, 0.6);

        return reverb(out, { size: 0.75, damp: 0.35, wet: 0.24, tail: 0.6 });
    },

    strike(random)
    {
        const out = silence(1);

        mix(out, chime({ notes: [SUN[3], SUN[4], SUN[5]], seconds: 1, partials: BELL, decay: 0.55, spread: 0.012 }), 0, 1);
        mix(out, flare(random, 0.35, 900, 6000), 0, 0.5);

        return reverb(out, { size: 0.7, damp: 0.35, wet: 0.22, tail: 0.5 });
    },

    die(random)
    {
        const out = silence(0.3);

        mix(out, tap({ freq: between(random, 820, 960), random, q: 5, tau: 0.03, body: 0.3 }), 0, 0.7);
        mix(out, flare(random, 0.2, 1500, 4500), 0, 0.45);

        return out;
    },

    card(random)
    {
        const out = silence(0.3);

        mix(out, flutter({ seconds: 0.24, random, rate: 22, low: 900, high: 5000 }), 0, 1);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.26);

        mix(out, tap({ freq: between(random, 680, 780), random, q: 5, tau: 0.03, body: 0.35 }), 0, 0.8);
        mix(out, shape(crackle({ seconds: 0.15, random, rate: 60, low: 2500, high: 7000 }), strike(0.003, 0.05)), 0, 0.3);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.75);

        mix(out, flare(random, 0.45, 300, 4800), 0, 0.9);
        mix(out, chime({ notes: [SUN[3]], seconds: 0.4, partials: BELL, decay: 0.3 }), 0.4, 0.6);

        return reverb(out, { size: 0.6, damp: 0.35, wet: 0.18, tail: 0.3 });
    },

    capture(random)
    {
        const out = silence(1);

        mix(out, flare(random, 0.5, 2800, 700), 0, 0.9);
        mix(out, chime({ notes: [SUN[0], SUN[2], SUN[3]], seconds: 0.8, partials: BELL, decay: 0.45, spread: 0.006 }), 0, 0.8);
        mix(out, boom({ seconds: 0.5, from: 120, to: 50, tau: 0.15, warmth: 2 }), 0, 0.3);

        return reverb(out, { size: 0.7, damp: 0.35, wet: 0.2, tail: 0.4 });
    },

    victory(random)
    {
        const out = silence(2.5);

        mix(out, flutter({ seconds: 0.6, random, rate: 8, low: 400, high: 3200 }), 0, 0.85);
        mix(out, flare(random, 0.7, 300, 6500), 0.4, 1);
        mix(out, boom({ seconds: 0.7, from: 110, to: 46, tau: 0.24, warmth: 2 }), 0.55, 0.28);
        mix(out, chime({ notes: SUN, seconds: 1.7, partials: BELL, decay: 1, spread: 0.028 }), 0.6, 1);
        mix(out, sparkle({ seconds: 1, random, count: 26, low: 3000, high: 9500, early: 1.5 }), 0.62, 0.65);

        return reverb(out, { size: 0.75, damp: 0.35, wet: 0.24, tail: 0.6 });
    }
};

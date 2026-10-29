/**
 * Infernal Sovereign's voice: fire catching and crackling over a blow from under the ground, its
 * metal a forge's, the cracks of its reveal smouldering until it erupts.
 */
import { between, bell, crackle, filter, METAL, mix, noise, reverb, shape, silence, strike, swell } from './dsp.mjs';
import { boom, tap, whoosh } from './parts.mjs';

/** A fire catching: air drawn up through it, from `from` to `to` hertz, and the crackle of what it burns. */
const flame = (random, seconds, from, to, crackling = 60) =>
{
    const out = silence(seconds);

    mix(out, whoosh({ seconds, from, to, random, q: 0.9, rise: 0.3 }), 0, 0.9);
    mix(out, shape(crackle({ seconds, random, rate: crackling, low: 1400, high: 7500 }), swell(seconds * 0.15, seconds * 0.5, seconds * 0.5)), 0, 0.5);

    return out;
};

/** A hiss of steam off something hot: bright noise dying fast. */
const sizzle = (random, seconds) => shape(filter(noise({ seconds, random }), { type: 'highpass', freq: 3200 }), strike(0.004, seconds * 0.3));

export const voice = {
    equip(random)
    {
        const out = silence(1.1);

        mix(out, boom({ seconds: 0.6, from: between(random, 100, 120), to: 44, tau: 0.18 }), 0, 0.3);
        mix(out, flame(random, 0.9, 380, 2600), 0.02, 1);

        return reverb(out, { size: 0.5, wet: 0.18, tail: 0.4 });
    },

    reveal(random)
    {
        const out = silence(2.4);
        const smoulder = shape(filter(noise({ seconds: 0.4, random, color: 'brown' }), { type: 'lowpass', freq: 380 }), swell(0.32, 0.36, 0.05));

        mix(out, smoulder, 0, 0.55);
        mix(out, shape(crackle({ seconds: 0.4, random, rate: 45, low: 900, high: 4200 }), swell(0.3, 0.38, 0.03)), 0, 0.5);
        mix(out, boom({ seconds: 1, from: 120, to: 38, tau: 0.32, warmth: 3 }), 0.35, 0.4);
        mix(out, flame(random, 1.5, 300, 3400, 90), 0.35, 1);
        mix(out, shape(crackle({ seconds: 1.4, random, rate: 18, low: 2000, high: 8000 }), strike(0.05, 0.5)), 0.9, 0.45);

        return reverb(out, { size: 0.7, wet: 0.22, tail: 0.6 });
    },

    strike(random)
    {
        const out = silence(0.9);

        mix(out, bell({ freq: between(random, 640, 700), seconds: 0.9, partials: METAL, decay: 0.45 }), 0, 0.3);
        mix(out, flame(random, 0.55, 700, 2600, 70), 0.01, 0.8);
        mix(out, sizzle(random, 0.5), 0.02, 0.25);

        return reverb(out, { size: 0.55, wet: 0.2, tail: 0.4 });
    },

    die(random)
    {
        const out = silence(0.32);

        mix(out, tap({ freq: between(random, 520, 620), random, q: 5, tau: 0.025 }), 0, 0.9);
        mix(out, sizzle(random, 0.28), 0.004, 0.35);
        mix(out, crackle({ seconds: 0.25, random, rate: 40, low: 1500, high: 6000 }), 0.01, 0.3);

        return out;
    },

    card(random)
    {
        const out = silence(0.34);

        mix(out, flame(random, 0.3, 900, 2800, 50), 0, 1);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.3);

        mix(out, tap({ freq: between(random, 720, 860), random, q: 4, tau: 0.035, body: 0.25 }), 0, 0.8);
        mix(out, crackle({ seconds: 0.25, random, rate: 50, low: 1200, high: 5000 }), 0.005, 0.5);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.7);

        mix(out, flame(random, 0.6, 260, 2400, 70), 0, 1);
        mix(out, boom({ seconds: 0.4, from: 90, to: 50, tau: 0.12 }), 0, 0.4);

        return out;
    },

    capture(random)
    {
        const out = silence(0.9);

        mix(out, boom({ seconds: 0.7, from: 130, to: 40, tau: 0.2, warmth: 3 }), 0, 0.35);
        mix(out, flame(random, 0.7, 2400, 500, 110), 0, 1);
        mix(out, sizzle(random, 0.4), 0.05, 0.25);

        return reverb(out, { size: 0.55, wet: 0.16, tail: 0.3 });
    },

    victory(random)
    {
        const out = silence(2.4);

        mix(out, boom({ seconds: 1.1, from: 130, to: 36, tau: 0.36, warmth: 3 }), 0, 0.45);
        mix(out, flame(random, 1.6, 260, 3800, 110), 0.02, 1);
        mix(out, bell({ freq: between(random, 196, 220), seconds: 1.4, partials: METAL, decay: 0.7 }), 0.1, 0.18);
        mix(out, shape(crackle({ seconds: 1.4, random, rate: 24, low: 1800, high: 8000 }), strike(0.05, 0.6)), 0.7, 0.5);
        mix(out, sizzle(random, 0.5), 1.1, 0.25);

        return reverb(out, { size: 0.7, wet: 0.22, tail: 0.6 });
    }
};

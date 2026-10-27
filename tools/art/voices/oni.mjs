/**
 * Neon Oni's voice: a holographic mask booting up, a scanline sweeping, its signal stuttering into
 * glitches and synth stabs in A minor, everything through a few bits; digital and stuttering.
 */
import { between, crush, filter, mix, noise, ramp, reverb, shape, silence, step, strike, swell, tone } from './dsp.mjs';
import { boom, glitch, stab, tap } from './parts.mjs';

const ROOT = 110;

const MINOR = [0, 3, 7, 12, 15].map((steps) => step(ROOT, steps));

/** A scanline: a buzz swept through a narrow band from `from` to `to` hertz, read through a few bits. */
const scan = (seconds, from, to) =>
{
    const buzzing = tone({ seconds, wave: 'saw', freq: 96 });
    const swept = filter(buzzing, { type: 'bandpass', freq: ramp([[0, from], [seconds, to]]), q: 6 });

    return crush(shape(swept, swell(seconds * 0.15, seconds * 0.85, seconds * 0.15)), { bits: 7, hold: 2 });
};

/** A blip: a square falling from `from` to `to` hertz over a few tens of milliseconds. */
const blip = (seconds, from, to) => crush(shape(tone({ seconds, wave: 'square', freq: ramp([[0, from], [seconds, to]]), width: 0.3 }), strike(0.001, seconds * 0.4)), { bits: 6, hold: 3 });

export const voice = {
    equip(random)
    {
        const out = silence(0.9);

        mix(out, glitch({ seconds: 0.3, random, count: 9, low: 300, high: 3000 }), 0, 0.7);
        mix(out, crush(stab({ notes: [MINOR[3], MINOR[4], MINOR[2] * 2], seconds: 0.6, random, tau: 0.1 }), { bits: 6, hold: 2 }), 0.18, 0.8);

        return reverb(out, { size: 0.5, damp: 0.5, wet: 0.14, tail: 0.3 });
    },

    reveal(random)
    {
        const out = silence(1.9);

        mix(out, scan(0.24, 300, 4500), 0, 0.9);
        mix(out, glitch({ seconds: 0.32, random, count: 14, low: 200, high: 3600 }), 0.22, 0.8);
        mix(out, crush(stab({ notes: [MINOR[0] * 2, MINOR[2] * 2, MINOR[3] * 2, MINOR[4] * 2], seconds: 0.7, random, tau: 0.13 }), { bits: 6, hold: 2 }), 0.22, 0.75);
        mix(out, boom({ seconds: 0.4, from: 110, to: 50, tau: 0.12, warmth: 3 }), 0.22, 0.3);
        mix(out, glitch({ seconds: 0.36, random, count: 11, low: 300, high: 4000 }), 0.62, 0.7);
        mix(out, blip(0.06, 2400, 900), 0.98, 0.4);

        return reverb(out, { size: 0.55, damp: 0.5, wet: 0.16, tail: 0.35 });
    },

    strike(random)
    {
        const out = silence(0.9);

        mix(out, crush(stab({ notes: [MINOR[0] * 2, MINOR[1] * 2, MINOR[2] * 2], seconds: 0.7, random, tau: 0.14, bright: 6500 }), { bits: 5, hold: 2 }), 0, 0.9);
        mix(out, glitch({ seconds: 0.35, random, count: 7, low: 500, high: 4000 }), 0.12, 0.5);

        return reverb(out, { size: 0.5, damp: 0.5, wet: 0.14, tail: 0.3 });
    },

    die(random)
    {
        const out = silence(0.22);

        mix(out, blip(0.05, between(random, 1600, 2000), 700), 0, 0.8);
        mix(out, crush(tap({ freq: 1200, random, q: 6, tau: 0.02, body: 0.2 }), { bits: 6, hold: 3 }), 0, 0.5);

        return out;
    },

    card(random)
    {
        const out = silence(0.25);
        const slice = shape(filter(noise({ seconds: 0.016, random }), { type: 'bandpass', freq: between(random, 1500, 3000), q: 2 }), swell(0.001, 0.013, 0.002));

        [0, 0.018, 0.036, 0.07].forEach((at, nth) => mix(out, slice, at, nth === 3 ? 0.5 : 0.8));

        return crush(out, { bits: 6, hold: 2 });
    },

    pawn(random)
    {
        const out = silence(0.2);

        mix(out, crush(tap({ freq: between(random, 1300, 1500), random, q: 7, tau: 0.02, body: 0.25 }), { bits: 6, hold: 3 }), 0, 0.9);

        return out;
    },

    spawn()
    {
        const out = silence(0.6);

        mix(out, scan(0.4, 260, 5000), 0, 0.9);
        mix(out, blip(0.05, 1800, 2400), 0.4, 0.5);

        return out;
    },

    capture(random)
    {
        const out = silence(0.95);

        mix(out, glitch({ seconds: 0.45, random, count: 16, low: 150, high: 3600 }), 0, 0.8);
        mix(out, crush(stab({ notes: [MINOR[0], MINOR[2], MINOR[3]], seconds: 0.6, random, tau: 0.12 }), { bits: 5, hold: 2 }), 0, 0.8);
        mix(out, boom({ seconds: 0.45, from: 120, to: 45, tau: 0.14, warmth: 3 }), 0, 0.35);

        return reverb(out, { size: 0.5, damp: 0.5, wet: 0.14, tail: 0.3 });
    }
};

/**
 * Midnight Neon's voice: a synth powering up in A minor, zaps and bleeps, a laser fired down the
 * street and the hum of a sign just switched on, with an echo off the wet walls.
 */
import { between, crackle, echo, filter, mix, ramp, reverb, shape, silence, step, strike, swell, tone } from './dsp.mjs';
import { buzz, stab, zap } from './parts.mjs';

const ROOT = 440;

const MINOR = [0, 3, 7, 12, 15, 19].map((steps) => step(ROOT, steps));

/** A square note through a filter that rings: the bleep a machine answers with. */
const bleep = (hz, seconds = 0.09) => filter(shape(tone({ seconds, wave: 'square', freq: hz, width: 0.4 }), strike(0.002, seconds * 0.45)), { type: 'lowpass', freq: hz * 5, q: 3 });

/** A sign switching on: a saw's hum with its buzz, the filter opening as the gas lights. */
const hum = (random, seconds) =>
{
    const out = silence(seconds);

    mix(out, filter(tone({ seconds, wave: 'saw', freq: 110 }), { type: 'lowpass', freq: ramp([[0, 200], [seconds, 3200]]), q: 4 }), 0, 0.6);
    mix(out, buzz({ seconds, freq: 220, random, index: 3, hiss: 0.15 }), 0, 0.2);

    return shape(out, swell(seconds * 0.6, seconds * 0.8, seconds * 0.2));
};

export const voice = {
    equip(random)
    {
        const out = silence(0.8);

        [0, 1, 2, 3].forEach((note, at) => mix(out, bleep(MINOR[note]), at * 0.045, 0.6));
        mix(out, zap({ seconds: 0.25, from: 400, to: 2400, wave: 'saw', bright: 7000, dark: 1500, tau: 0.12 }), 0.18, 0.5);

        return echo(out, { time: 0.11, feedback: 0.3, level: 0.3, tail: 0.4 });
    },

    reveal(random)
    {
        const out = silence(1.5);

        mix(out, hum(random, 0.3), 0, 0.8);
        mix(out, shape(crackle({ seconds: 0.5, random, rate: 90, low: 2500, high: 9000 }), strike(0.02, 0.2)), 0.1, 0.5);
        [0.12, 0.2, 0.31].forEach((at) => mix(out, zap({ seconds: 0.12, from: between(random, 1800, 3200), to: 600, wave: 'square', tau: 0.05 }), at, 0.35));
        mix(out, zap({ seconds: 0.45, from: 2400, to: 160, wave: 'saw', bright: 8000, dark: 400, tau: 0.16 }), 0.18, 0.9);

        return reverb(echo(out, { time: 0.13, feedback: 0.35, level: 0.32, tail: 0.5 }), { size: 0.5, damp: 0.5, wet: 0.12, tail: 0.3 });
    },

    strike(random)
    {
        const out = silence(0.8);

        mix(out, stab({ notes: [MINOR[0] / 2, MINOR[1] / 2, MINOR[2] / 2, MINOR[0]], seconds: 0.7, random, tau: 0.13, bright: 7000 }), 0, 1);

        return echo(out, { time: 0.12, feedback: 0.32, level: 0.3, tail: 0.4 });
    },

    die(random)
    {
        const out = silence(0.22);

        mix(out, zap({ seconds: 0.07, from: between(random, 1100, 1300), to: 380, wave: 'square', bright: 5000, dark: 1200, tau: 0.03 }), 0, 0.9);

        return out;
    },

    card(random)
    {
        const out = silence(0.26);

        mix(out, zap({ seconds: 0.06, from: between(random, 1900, 2300), to: 800, wave: 'saw', bright: 8000, dark: 2000, tau: 0.025 }), 0, 0.8);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.2);

        mix(out, bleep(MINOR[3] * between(random, 0.98, 1.02), 0.07), 0, 0.8);

        return out;
    },

    spawn()
    {
        const out = silence(0.55);
        const sweep = filter(tone({ seconds: 0.4, wave: 'saw', freq: ramp([[0, 200], [0.4, 1600]]) }), { type: 'lowpass', freq: ramp([[0, 400], [0.4, 5000]]), q: 6 });

        mix(out, shape(sweep, swell(0.05, 0.35, 0.05)), 0, 0.7);
        mix(out, bleep(MINOR[5], 0.08), 0.4, 0.5);

        return out;
    },

    capture(random)
    {
        const out = silence(0.8);

        mix(out, zap({ seconds: 0.4, from: 1600, to: 100, wave: 'saw', bright: 7000, dark: 300, tau: 0.14 }), 0, 1);
        mix(out, shape(filter(crackle({ seconds: 0.2, random, rate: 200, low: 2000, high: 9000 }), { type: 'highpass', freq: 1500 }), strike(0.002, 0.06)), 0, 0.5);

        return echo(out, { time: 0.12, feedback: 0.3, level: 0.28, tail: 0.35 });
    },

    victory(random)
    {
        const out = silence(2.2);

        mix(out, hum(random, 0.5), 0, 0.4);
        [0, 1, 2, 3, 4, 5, 3, 5].forEach((note, at) => mix(out, bleep(MINOR[note], 0.12), 0.2 + at * 0.07, 0.55));
        mix(out, stab({ notes: [MINOR[3], MINOR[4], MINOR[5]], seconds: 0.9, random, bright: 6500, dark: 600, tau: 0.25 }), 0.78, 0.7);
        mix(out, zap({ seconds: 0.4, from: 300, to: 3200, wave: 'saw', bright: 7500, dark: 1200, tau: 0.16 }), 0.76, 0.4);

        return echo(out, { time: 0.12, feedback: 0.32, level: 0.32, tail: 0.5 });
    }
};

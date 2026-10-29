/**
 * Jade Dragon Dynasty's voice: a guzheng in the pentatonic, its notes bent up into place as a
 * player's finger presses the string, a gong blooming low, bamboo knocked, chimes in the wind;
 * serene, and sinuous as the dragon's coil.
 */
import { between, bell, GONG, METAL, mix, pluck, RATE, reverb, silence, step } from './dsp.mjs';
import { tap } from './parts.mjs';

const ROOT = 293.66;

/** The pentatonic on D, over two octaves. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24].map((steps) => step(ROOT, steps));

/** `signal` read faster as it goes, from `from` of its pitch up to its own over `seconds`: a string pressed up into its note. */
const bend = (signal, from, seconds) =>
{
    const out = new Float32Array(signal.length);
    let at = 0;

    for (let n = 0; n < out.length && at < signal.length - 1; n += 1)
    {
        const low = Math.floor(at);
        const share = at - low;
        out[n] = signal[low] * (1 - share) + signal[low + 1] * share;
        at += from + (1 - from) * Math.min(1, n / (seconds * RATE));
    }

    return out;
};

/** A guzheng's string plucked at `hz`, bent up into its note from `from` of its pitch. */
const zheng = (random, hz, seconds = 0.9, from = 0.97) => bend(pluck({ freq: hz, seconds, random, damping: 0.997, bright: 0.62 }), from, 0.07);

/** A gong at `hz`, its partials crowding and beating as it blooms and dies. */
const gong = (hz, seconds, decay = 1.4) => bell({ freq: hz, seconds, partials: GONG, decay, attack: 0.025 });

/** Bamboo knocked: a hollow tube ringing at `hz` and the overtone a tube adds. */
const bamboo = (random, hz) =>
{
    const out = silence(0.3);

    mix(out, tap({ freq: hz, random, q: 12, tau: 0.04, body: 0.15 }), 0, 0.9);
    mix(out, tap({ freq: hz * 2.68, random, q: 10, tau: 0.02, body: 0 }), 0, 0.35);

    return out;
};

/** Chimes stirred by wind: a few small bells from the high pentatonic. */
const chimes = (random, seconds, count) =>
{
    const out = silence(seconds + 0.8);

    for (let n = 0; n < count; n += 1)
    {
        const hz = SCALE[5 + Math.floor(random() * 6)] * 4;
        mix(out, bell({ freq: hz, seconds: 0.8, partials: METAL, decay: 0.3 }), random() * seconds, between(random, 0.1, 0.22));
    }

    return out;
};

export const voice = {
    equip(random)
    {
        const out = silence(1.3);

        [0, 1, 2, 3, 4, 5].forEach((note, at) => mix(out, zheng(random, SCALE[note + 2], 0.9, at === 5 ? 0.94 : 0.99), at * 0.045, 0.55));
        mix(out, chimes(random, 0.25, 3), 0.27, 0.8);

        return reverb(out, { size: 0.7, damp: 0.45, wet: 0.24, tail: 0.6 });
    },

    reveal(random)
    {
        const out = silence(2.5);

        mix(out, gong(ROOT / 2, 2.2), 0, 0.7);
        mix(out, bell({ freq: SCALE[10] * 2, seconds: 1.4, partials: METAL, decay: 0.6 }), 0.02, 0.12);
        [[4, 0], [5, 0.16], [6, 0.32], [7, 0.5], [6, 0.74]].forEach(([note, at], nth) =>
        {
            mix(out, zheng(random, SCALE[note], 1.1, nth === 3 ? 0.93 : 0.985), 0.4 + at, 0.7);
        });
        mix(out, chimes(random, 1, 5), 0.45, 0.8);

        return reverb(out, { size: 0.75, damp: 0.45, wet: 0.26, tail: 0.6 });
    },

    strike(random)
    {
        const out = silence(1.3);

        mix(out, gong(ROOT, 1.3, 0.9), 0, 0.6);
        mix(out, bell({ freq: SCALE[8] * 2, seconds: 1, partials: METAL, decay: 0.4 }), 0, 0.2);
        mix(out, bell({ freq: SCALE[10] * 2, seconds: 1, partials: METAL, decay: 0.35 }), 0.03, 0.15);

        return reverb(out, { size: 0.7, damp: 0.45, wet: 0.24, tail: 0.5 });
    },

    die(random)
    {
        return bamboo(random, between(random, 560, 680));
    },

    card(random)
    {
        const out = silence(0.5);

        mix(out, zheng(random, SCALE[5 + Math.floor(random() * 4)], 0.5, 0.97), 0, 0.8);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.28);

        mix(out, tap({ freq: between(random, 2000, 2400), random, q: 14, tau: 0.02, body: 0 }), 0, 0.7);
        mix(out, bamboo(random, between(random, 820, 900)), 0, 0.4);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.75);

        mix(out, zheng(random, SCALE[4], 0.6, 0.98), 0, 0.6);
        mix(out, zheng(random, SCALE[5], 0.6, 0.92), 0.12, 0.75);

        return reverb(out, { size: 0.6, damp: 0.45, wet: 0.2, tail: 0.3 });
    },

    capture(random)
    {
        const out = silence(1);

        mix(out, gong(ROOT * 0.75, 0.95, 0.6), 0, 0.65);
        mix(out, bamboo(random, between(random, 480, 540)), 0, 0.7);
        mix(out, chimes(random, 0.2, 3), 0.03, 0.7);

        return reverb(out, { size: 0.7, damp: 0.45, wet: 0.2, tail: 0.4 });
    },

    victory(random)
    {
        const out = silence(2.6);

        mix(out, gong(ROOT / 2, 2.4, 1.6), 0, 0.5);
        [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((note, at) => mix(out, zheng(random, SCALE[note + 2], 1, at % 3 === 2 ? 0.94 : 0.99), 0.12 + at * 0.06, 0.5));
        mix(out, bamboo(random, between(random, 620, 700)), 0.12, 0.5);
        mix(out, chimes(random, 1, 7), 0.6, 0.85);

        return reverb(out, { size: 0.75, damp: 0.45, wet: 0.26, tail: 0.7 });
    }
};

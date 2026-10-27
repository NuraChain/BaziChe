/**
 * Void Emperor's voice: what it does it does twice, drawing everything in and then letting it go;
 * breaths played backwards, a dark body struck low, whispers, and violet glass that fractures.
 */
import { between, bell, BELL, filter, fm, mix, noise, reverb, shape, silence, strike, swell } from './dsp.mjs';
import { boom, crack, inhale, whoosh } from './parts.mjs';

/** A dark struck body: an inharmonic FM tone, low and slow to die, its brightness gone almost at once. */
const dark = (random, seconds, hz) =>
{
    const body = fm({ seconds, carrier: hz, ratio: 1.37, index: (t) => 3.2 * Math.exp(-t * 9) + 0.4 });

    return filter(shape(body, strike(0.003, seconds * 0.3)), { type: 'lowpass', freq: 2200 });
};

/** A whisper: breath through a narrow band, swelling and dying. */
const whisper = (random, seconds, hz) => shape(filter(noise({ seconds, random, color: 'pink' }), { type: 'bandpass', freq: hz, q: 3 }), swell(seconds * 0.4, seconds * 0.5, seconds * 0.5));

export const voice = {
    equip(random)
    {
        const out = silence(1.1);

        mix(out, inhale({ seconds: 0.45, random, low: 250, high: 3500 }), 0, 0.9);
        mix(out, dark(random, 0.6, between(random, 98, 112)), 0.45, 0.8);
        mix(out, boom({ seconds: 0.4, from: 80, to: 40, tau: 0.14, warmth: 1.8 }), 0.45, 0.3);
        mix(out, whisper(random, 0.5, 900), 0.48, 0.3);

        return reverb(out, { size: 0.8, damp: 0.6, wet: 0.24, tail: 0.5 });
    },

    reveal(random)
    {
        const out = silence(2.4);

        mix(out, inhale({ seconds: 0.6, random, low: 200, high: 3000 }), 0, 1);
        mix(out, shape(whoosh({ seconds: 0.6, from: 3200, to: 200, random, q: 1, rise: 0.95 }), (t) => t / 0.6), 0, 0.5);
        mix(out, crack({ random, seconds: 0.5, low: 2200, high: 7000, shards: 6, bright: 2000 }), 0.6, 0.8);
        mix(out, bell({ freq: 330, seconds: 1.2, partials: BELL, decay: 0.5 }), 0.6, 0.12);
        mix(out, whoosh({ seconds: 1.3, from: 260, to: 2600, random, q: 0.9, rise: 0.12 }), 0.9, 0.85);
        mix(out, dark(random, 1.4, 82), 0.9, 0.7);
        mix(out, whisper(random, 1.2, 700), 1, 0.35);

        return reverb(out, { size: 0.85, damp: 0.55, wet: 0.28, tail: 0.7 });
    },

    strike(random)
    {
        const out = silence(1);

        mix(out, dark(random, 0.9, 123), 0, 0.9);
        mix(out, crack({ random, seconds: 0.4, low: 2600, high: 8000, shards: 4 }), 0.004, 0.45);
        mix(out, whisper(random, 0.6, 1100), 0.02, 0.3);

        return reverb(out, { size: 0.8, damp: 0.6, wet: 0.24, tail: 0.5 });
    },

    die(random)
    {
        const out = silence(0.32);

        mix(out, dark(random, 0.28, between(random, 230, 270)), 0, 0.8);
        mix(out, shape(filter(noise({ seconds: 0.05, random }), { type: 'bandpass', freq: 1600, q: 2 }), strike(0.0005, 0.008)), 0, 0.6);

        return out;
    },

    card(random)
    {
        const out = silence(0.3);

        mix(out, whisper(random, 0.26, between(random, 900, 1300)), 0, 1);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.28);

        mix(out, dark(random, 0.24, between(random, 190, 220)), 0, 0.8);
        mix(out, shape(filter(noise({ seconds: 0.04, random }), { type: 'bandpass', freq: 1200, q: 2 }), strike(0.0005, 0.006)), 0, 0.5);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.6);

        mix(out, inhale({ seconds: 0.36, random, low: 400, high: 4000 }), 0, 0.9);
        mix(out, dark(random, 0.24, 165), 0.36, 0.6);

        return out;
    },

    capture(random)
    {
        const out = silence(0.95);

        mix(out, inhale({ seconds: 0.22, random, low: 300, high: 3000 }), 0, 0.7);
        mix(out, crack({ random, seconds: 0.5, low: 2000, high: 7500, shards: 5 }), 0.22, 0.8);
        mix(out, dark(random, 0.7, 98), 0.22, 0.8);
        mix(out, boom({ seconds: 0.4, from: 90, to: 40, tau: 0.14 }), 0.22, 0.25);

        return reverb(out, { size: 0.75, damp: 0.6, wet: 0.2, tail: 0.4 });
    }
};

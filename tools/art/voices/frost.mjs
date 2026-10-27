/**
 * Frost Revenant's voice: crystals forming faster and higher until they hold, ice that cracks and
 * shatters into shards that fall and bounce, and the cold wind behind it all; brittle and still.
 */
import { between, bell, filter, GLASS, mix, noise, ramp, reverb, shape, silence, strike, swell, tone } from './dsp.mjs';
import { boom, crack, tap } from './parts.mjs';

/** Crystals forming: pings coming faster and climbing from `low` to `high` hertz over `seconds`. */
const forming = (random, seconds, count, low, high) =>
{
    const out = silence(seconds + 0.5);

    for (let n = 0; n < count; n += 1)
    {
        const share = Math.pow(n / count, 0.6);
        const hz = low * Math.pow(high / low, share) * between(random, 0.94, 1.06);

        mix(out, bell({ freq: hz, seconds: 0.5, partials: GLASS, decay: between(random, 0.05, 0.12) }), share * seconds, between(random, 0.12, 0.3));
    }

    return out;
};

/** Shards falling: pings bouncing closer and closer together, each softer than the last. */
const shards = (random, count, low, high) =>
{
    const out = silence(1.4);
    let at = 0;
    let gap = between(random, 0.07, 0.1);

    for (let n = 0; n < count; n += 1)
    {
        mix(out, bell({ freq: low * Math.pow(high / low, random()), seconds: 0.4, partials: GLASS, decay: 0.06 }), at, 0.35 * Math.pow(0.84, n));
        at += gap;
        gap *= between(random, 0.72, 0.86);
    }

    return out;
};

/** Cold wind: bright noise rising and falling in a slow wave. */
const wind = (random, seconds) => shape(filter(filter(noise({ seconds, random, color: 'pink' }), { type: 'highpass', freq: 2500 }), { type: 'lowpass', freq: 9000 }), (t) => swell(seconds * 0.3, seconds * 0.6, seconds * 0.4)(t) * (0.6 + 0.4 * Math.sin(t * 5.5)));

export const voice = {
    equip(random)
    {
        const out = silence(1);

        mix(out, forming(random, 0.38, 11, 2200, 6400), 0, 1);
        mix(out, crack({ random, seconds: 0.5, low: 3000, high: 9000, shards: 4, bright: 3500 }), 0.4, 0.55);
        mix(out, bell({ freq: 1760, seconds: 0.6, partials: GLASS, decay: 0.3 }), 0.4, 0.2);

        return reverb(out, { size: 0.75, damp: 0.25, wet: 0.24, tail: 0.5 });
    },

    reveal(random)
    {
        const out = silence(2.4);
        const glassy = shape(tone({ seconds: 0.7, freq: ramp([[0, 1100], [0.7, 2350]]) }), (t) => swell(0.6, 0.69, 0.01)(t) * (0.75 + 0.25 * Math.sin(t * 60)));

        mix(out, wind(random, 2.2), 0, 0.35);
        mix(out, forming(random, 0.68, 20, 1800, 7200), 0, 1);
        mix(out, glassy, 0, 0.1);
        mix(out, crack({ random, seconds: 0.7, low: 2400, high: 9500, shards: 8, bright: 2500 }), 0.7, 0.9);
        mix(out, boom({ seconds: 0.35, from: 140, to: 60, tau: 0.08, warmth: 1.6 }), 0.7, 0.2);
        mix(out, shards(random, 12, 2600, 8800), 0.76, 1);

        return reverb(out, { size: 0.8, damp: 0.25, wet: 0.26, tail: 0.6 });
    },

    strike(random)
    {
        const out = silence(1);

        mix(out, bell({ freq: 1760, seconds: 0.9, partials: GLASS, decay: 0.45 }), 0, 0.35);
        mix(out, bell({ freq: 2637, seconds: 0.9, partials: GLASS, decay: 0.38 }), 0.01, 0.25);
        mix(out, crack({ random, seconds: 0.4, low: 3500, high: 9500, shards: 3 }), 0, 0.45);

        return reverb(out, { size: 0.75, damp: 0.25, wet: 0.24, tail: 0.5 });
    },

    die(random)
    {
        const out = silence(0.3);

        mix(out, bell({ freq: between(random, 3000, 3800), seconds: 0.28, partials: GLASS, decay: 0.07 }), 0, 0.45);
        mix(out, crack({ random, seconds: 0.2, low: 4000, high: 9000, shards: 2, bright: 4000 }), 0, 0.4);

        return out;
    },

    card(random)
    {
        const out = silence(0.32);

        mix(out, shape(filter(noise({ seconds: 0.28, random }), { type: 'highpass', freq: 5000 }), swell(0.06, 0.12, 0.16)), 0, 0.55);
        mix(out, bell({ freq: between(random, 4200, 5200), seconds: 0.25, partials: GLASS, decay: 0.05 }), 0.05, 0.3);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.26);

        mix(out, tap({ freq: between(random, 2400, 2800), random, q: 16, tau: 0.025, body: 0 }), 0, 0.8);
        mix(out, bell({ freq: between(random, 3300, 3900), seconds: 0.24, partials: GLASS, decay: 0.05 }), 0.002, 0.25);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.7);

        mix(out, forming(random, 0.4, 8, 2400, 7000), 0, 1);

        return reverb(out, { size: 0.7, damp: 0.25, wet: 0.2, tail: 0.3 });
    },

    capture(random)
    {
        const out = silence(1);

        mix(out, crack({ random, seconds: 0.6, low: 2200, high: 9000, shards: 7, bright: 2200 }), 0, 1);
        mix(out, shards(random, 9, 2500, 8500), 0.05, 0.9);
        mix(out, boom({ seconds: 0.3, from: 150, to: 70, tau: 0.07, warmth: 1.5 }), 0, 0.2);

        return reverb(out, { size: 0.75, damp: 0.25, wet: 0.22, tail: 0.4 });
    }
};

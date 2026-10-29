/**
 * Shiraz Garden's voice: a santur hammered in dastgah Shur, its second a quarter-tone flat (the
 * koron) as only Persian music bends it, over the clink of glazed tile and a dust of gold.
 */
import { between, bell, cents, mix, pluck, reverb, silence } from './dsp.mjs';
import { sparkle } from './parts.mjs';

const ROOT = 293.66;

/** Shur on D: D, E koron (150 cents up), F, G, A, B flat, C, over two octaves. */
const SHUR = [0, 150, 300, 500, 700, 800, 1000, 1200, 1350, 1500, 1700, 1900].map((by) => cents(ROOT, by));

/** A fired tile's partials: a clay plate glazed hard, short and bright. */
const TILE = [[1, 1, 1], [2.08, 0.55, 0.45], [3.81, 0.32, 0.28], [5.9, 0.2, 0.18], [8.4, 0.12, 0.1]];

/**
 * A santur's course: four strings to a note, hammered; two of them drawn here a few cents apart,
 * which is what gives a santur its shimmer.
 */
const santur = (random, hz, seconds = 1.1) =>
{
    const out = silence(seconds);

    mix(out, pluck({ freq: hz, seconds, random, damping: 0.998, bright: 0.75, hammer: true }), 0, 0.55);
    mix(out, pluck({ freq: cents(hz, between(random, 4, 9)), seconds, random, damping: 0.998, bright: 0.72, hammer: true }), 0.0015, 0.45);

    return out;
};

/** A glazed tile tapped, at `hz`. */
const clink = (hz, seconds = 0.3, decay = 0.09) => bell({ freq: hz, seconds, partials: TILE, decay });

export const voice = {
    equip(random)
    {
        const out = silence(1.2);

        [7, 8, 9, 10, 11].forEach((note, at) => mix(out, santur(random, SHUR[note], 0.9), at * 0.07, 0.55));
        mix(out, clink(between(random, 1900, 2200), 0.4, 0.12), 0.32, 0.25);

        return reverb(out, { size: 0.65, damp: 0.4, wet: 0.22, tail: 0.5 });
    },

    reveal(random)
    {
        const out = silence(2.3);

        mix(out, santur(random, SHUR[0], 1.6), 0, 0.7);
        mix(out, santur(random, SHUR[4], 1.6), 0.004, 0.55);
        mix(out, clink(1300, 0.6, 0.16), 0, 0.25);
        [[11, 0], [10, 0.11], [9, 0.22], [8, 0.33], [9, 0.46], [7, 0.62]].forEach(([note, at]) =>
        {
            mix(out, santur(random, SHUR[note], 1), 0.12 + at, 0.5);
        });
        mix(out, sparkle({ seconds: 0.9, random, count: 16, low: 3200, high: 8000 }), 0.16, 0.45);

        return reverb(out, { size: 0.7, damp: 0.4, wet: 0.24, tail: 0.6 });
    },

    strike(random)
    {
        const out = silence(1);

        mix(out, santur(random, SHUR[7], 1), 0, 0.6);
        mix(out, santur(random, SHUR[11], 1), 0.003, 0.5);
        mix(out, clink(between(random, 2000, 2300), 0.5, 0.14), 0, 0.3);

        return reverb(out, { size: 0.65, damp: 0.4, wet: 0.22, tail: 0.5 });
    },

    die(random)
    {
        const out = silence(0.3);

        mix(out, clink(between(random, 1300, 1550)), 0, 0.6);

        return out;
    },

    card(random)
    {
        const out = silence(0.5);

        mix(out, santur(random, SHUR[7 + Math.floor(random() * 5)], 0.5), 0, 0.7);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.28);

        mix(out, clink(between(random, 900, 1050), 0.26, 0.06), 0, 0.6);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.7);

        mix(out, santur(random, SHUR[8], 0.6), 0, 0.5);
        mix(out, santur(random, SHUR[9], 0.6), 0.09, 0.6);

        return reverb(out, { size: 0.6, damp: 0.4, wet: 0.18, tail: 0.3 });
    },

    capture(random)
    {
        const out = silence(0.9);

        for (const note of [0, 4, 7])
        {
            mix(out, santur(random, SHUR[note], 0.85), note * 0.0008, 0.5);
        }
        mix(out, clink(between(random, 1600, 1800), 0.5, 0.12), 0, 0.35);

        return reverb(out, { size: 0.65, damp: 0.4, wet: 0.2, tail: 0.4 });
    },

    victory(random)
    {
        const out = silence(2.4);

        [0, 2, 3, 4, 5, 7, 9, 11].forEach((note, at) => mix(out, santur(random, SHUR[note], 1), at * 0.085, 0.5));
        [7, 9, 11].forEach((note) => mix(out, santur(random, SHUR[note], 1.6), 0.8, 0.45));
        mix(out, clink(between(random, 2000, 2300), 0.5, 0.15), 0.8, 0.3);
        mix(out, sparkle({ seconds: 0.9, random, count: 20, low: 3000, high: 8500 }), 0.8, 0.5);

        return reverb(out, { size: 0.75, damp: 0.35, wet: 0.24, tail: 0.6 });
    }
};

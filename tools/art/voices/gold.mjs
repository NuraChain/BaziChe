/**
 * Royal Gold's voice: coins spilling and ringing, a court's bell in C, and brass swelling under
 * the brightest of it; polished, heavy and regal.
 */
import { BELL, between, bell, mix, reverb, silence, step } from './dsp.mjs';
import { clink, pad, sparkle } from './parts.mjs';

const ROOT = 523.25;

const MAJOR = [0, 4, 7, 12, 16, 19].map((steps) => step(ROOT, steps));

/** Coins spilling: `count` clinks, each a little after and a little higher than the last. */
const coins = (random, count, low, high, apart = 0.045) =>
{
    const out = silence(count * apart + 0.6);

    for (let n = 0; n < count; n += 1)
    {
        const hz = low + (high - low) * (n / Math.max(1, count - 1)) * between(random, 0.9, 1.1);
        mix(out, clink({ freq: hz, random, seconds: 0.5, decay: between(random, 0.12, 0.2) }), n * apart * between(random, 0.8, 1.2), between(random, 0.5, 0.9));
    }

    return out;
};

export const voice = {
    equip(random)
    {
        const out = silence(1);

        mix(out, coins(random, 5, 2600, 4200), 0, 0.8);
        mix(out, bell({ freq: MAJOR[3], seconds: 0.9, partials: BELL, decay: 0.55 }), 0.2, 0.12);

        return reverb(out, { size: 0.65, damp: 0.4, wet: 0.2, tail: 0.5 });
    },

    reveal(random)
    {
        const out = silence(2.2);

        mix(out, bell({ freq: ROOT / 2, seconds: 1.8, partials: BELL, decay: 1.1 }), 0, 0.2);
        mix(out, bell({ freq: ROOT, seconds: 1.6, partials: BELL, decay: 0.9 }), 0.006, 0.14);
        mix(out, pad({ notes: [ROOT / 4, ROOT * 3 / 8, ROOT / 2, ROOT * 5 / 8], seconds: 1.6, random, open: [300, 2800], attack: 0.18, release: 0.8 }), 0, 0.5);
        mix(out, coins(random, 8, 2400, 4800, 0.035), 0.08, 0.75);
        mix(out, sparkle({ seconds: 0.8, random, count: 16, low: 3000, high: 8000 }), 0.26, 0.5);

        return reverb(out, { size: 0.75, damp: 0.4, wet: 0.24, tail: 0.6 });
    },

    strike(random)
    {
        const out = silence(1.1);

        mix(out, bell({ freq: MAJOR[3], seconds: 1.1, partials: BELL, decay: 0.6 }), 0, 0.2);
        mix(out, bell({ freq: MAJOR[5], seconds: 1.1, partials: BELL, decay: 0.5 }), 0.01, 0.14);
        mix(out, clink({ freq: between(random, 3200, 3600), random, seconds: 0.5, decay: 0.18 }), 0, 0.5);

        return reverb(out, { size: 0.7, damp: 0.4, wet: 0.22, tail: 0.5 });
    },

    die(random)
    {
        const out = silence(0.36);

        mix(out, clink({ freq: between(random, 2800, 3200), random, seconds: 0.3, decay: 0.09 }), 0, 0.8);
        mix(out, clink({ freq: between(random, 3000, 3400), random, seconds: 0.2, decay: 0.05 }), 0.075, 0.35);

        return out;
    },

    card(random)
    {
        const out = silence(0.26);

        mix(out, clink({ freq: between(random, 4200, 4800), random, seconds: 0.22, decay: 0.05 }), 0, 0.6);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.32);

        mix(out, clink({ freq: between(random, 1300, 1500), random, seconds: 0.3, decay: 0.08 }), 0, 0.8);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.7);

        mix(out, coins(random, 4, 2200, 4400, 0.06), 0, 0.8);

        return reverb(out, { size: 0.6, damp: 0.4, wet: 0.18, tail: 0.3 });
    },

    capture(random)
    {
        const out = silence(0.9);

        mix(out, coins(random, 4, 2600, 3400, 0.012), 0, 0.9);
        mix(out, bell({ freq: MAJOR[0], seconds: 0.8, partials: BELL, decay: 0.45 }), 0, 0.18);

        return reverb(out, { size: 0.65, damp: 0.4, wet: 0.2, tail: 0.4 });
    }
};

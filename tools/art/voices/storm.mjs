/**
 * Stormforged Monarch's voice: charged steel humming as it builds, the crack of a strike and the
 * static of what it leaves, jagged and staccato.
 */
import { between, crackle, filter, mix, noise, ramp, reverb, shape, silence, strike, swell, tone } from './dsp.mjs';
import { boom, buzz, tap, thunder } from './parts.mjs';

/** A charge building: a buzz and a whine both rising from `low` to `high` over `seconds`. */
const charge = (random, seconds, low, high) =>
{
    const out = silence(seconds);
    const whine = shape(tone({ seconds, freq: ramp([[0, low * 4], [seconds, high * 4]]) }), swell(seconds * 0.8, seconds - 0.012, 0.012));
    const hum = shape(buzz({ seconds, freq: ramp([[0, low], [seconds, high]]), random, index: 7 }), swell(seconds * 0.9, seconds - 0.012, 0.012));

    mix(out, hum, 0, 0.6);
    mix(out, whine, 0, 0.12);

    return out;
};

/** A spark jumping: a snap of bright noise and a short buzz behind it. */
const zapped = (random, seconds, hz) =>
{
    const out = silence(seconds);

    mix(out, shape(filter(noise({ seconds: 0.05, random }), { type: 'highpass', freq: 2200 }), strike(0.0004, 0.008)), 0, 1);
    mix(out, shape(buzz({ seconds, freq: hz, random, index: 9, hiss: 0.5 }), strike(0.002, seconds * 0.25)), 0.002, 0.8);

    return out;
};

export const voice = {
    equip(random)
    {
        const out = silence(1);

        mix(out, charge(random, 0.38, 70, 210), 0, 0.9);
        mix(out, zapped(random, 0.45, between(random, 150, 180)), 0.38, 1);
        mix(out, shape(crackle({ seconds: 0.5, random, rate: 70, low: 2500, high: 9000 }), strike(0.01, 0.16)), 0.4, 0.4);

        return reverb(out, { size: 0.45, wet: 0.14, tail: 0.3 });
    },

    reveal(random)
    {
        const out = silence(2.3);

        mix(out, charge(random, 0.7, 55, 260), 0, 0.9);
        mix(out, thunder({ seconds: 1.4, random, crack: 0.9 }), 0.7, 0.75);
        mix(out, zapped(random, 0.4, 190), 0.7, 0.8);
        mix(out, shape(crackle({ seconds: 1.3, random, rate: 85, low: 2000, high: 9500 }), strike(0.02, 0.45)), 0.76, 0.5);
        mix(out, boom({ seconds: 0.9, from: 100, to: 40, tau: 0.3 }), 0.7, 0.3);

        return reverb(out, { size: 0.7, wet: 0.2, tail: 0.5 });
    },

    strike(random)
    {
        const out = silence(1);

        mix(out, zapped(random, 0.4, 220), 0, 1);
        mix(out, thunder({ seconds: 0.9, random, crack: 0.5 }), 0.03, 0.45);

        return reverb(out, { size: 0.5, wet: 0.16, tail: 0.3 });
    },

    die(random)
    {
        const out = silence(0.28);

        mix(out, tap({ freq: between(random, 900, 1100), random, q: 6, tau: 0.02, body: 0.2 }), 0, 0.7);
        mix(out, shape(crackle({ seconds: 0.2, random, rate: 160, low: 3000, high: 10000 }), strike(0.002, 0.05)), 0.003, 0.6);

        return out;
    },

    card(random)
    {
        const out = silence(0.26);

        mix(out, zapped(random, 0.16, between(random, 260, 320)), 0, 0.8);

        return out;
    },

    pawn(random)
    {
        const out = silence(0.24);

        mix(out, tap({ freq: between(random, 760, 900), random, q: 5, tau: 0.025, body: 0.2 }), 0, 0.7);
        mix(out, shape(crackle({ seconds: 0.15, random, rate: 120, low: 3000, high: 9000 }), strike(0.002, 0.04)), 0.004, 0.45);

        return out;
    },

    spawn(random)
    {
        const out = silence(0.6);

        mix(out, charge(random, 0.42, 120, 420), 0, 0.9);
        mix(out, zapped(random, 0.15, 300), 0.42, 0.6);

        return out;
    },

    capture(random)
    {
        const out = silence(0.95);

        mix(out, zapped(random, 0.5, 140), 0, 1);
        mix(out, thunder({ seconds: 0.85, random, crack: 0.6 }), 0.02, 0.6);
        mix(out, boom({ seconds: 0.6, from: 110, to: 45, tau: 0.18 }), 0, 0.25);

        return reverb(out, { size: 0.55, wet: 0.16, tail: 0.3 });
    }
};

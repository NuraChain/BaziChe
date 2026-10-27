/**
 * The sounds the collections' voices are built from, each a few of the instruments in `dsp.mjs`
 * put together: air rushing past, a blow, glitter, a synth's zap, struck bells and metal, thunder,
 * a machine's glitch, a pad, wings, a knock. A collection gives each its own pitches and colours.
 */
import { BELL, between, bell, crush, drive, fade, filter, fm, GLASS, METAL, mix, noise, ramp, RATE, reverb, reverse, shape, silence, strike, swell, tone } from './dsp.mjs';

/** Air rushing past: noise through a band moving from `from` to `to` hertz, rising for `rise` of its length and dying after. */
export function whoosh({ seconds, from, to, random, q = 1.4, rise = 0.4, color = 'pink' })
{
    const air = noise({ seconds, random, color });
    const swept = filter(air, { type: 'bandpass', freq: ramp([[0, from], [seconds, to]]), q });

    return shape(swept, swell(seconds * rise, seconds * rise, seconds * (1 - rise)));
}

/**
 * A blow felt as much as heard: a sine falling from `from` to `to` hertz, dying over `tau`, warmed
 * by a soft clip so the harmonics carry it on a phone's speaker, which plays nothing so low.
 */
export function boom({ seconds, from = 110, to = 42, tau = 0.22, warmth = 2.4 })
{
    const body = tone({ seconds, freq: ramp([[0, from], [Math.min(seconds, 0.3), to]]) });

    return fade(drive(shape(body, strike(0.003, tau)), warmth), 0, 0.03);
}

/** Glitter: `count` short pings at random moments over `seconds`, each between `low` and `high` hertz, the later ones softer. */
export function sparkle({ seconds, random, count = 14, low = 2400, high = 7200, tau = 0.07, partials = GLASS, early = 1.3 })
{
    const out = silence(seconds + tau * 8);

    for (let n = 0; n < count; n += 1)
    {
        const share = Math.pow(random(), early);
        const hz = low * Math.pow(high / low, random());
        const ping = bell({ freq: hz, seconds: tau * 8, partials, decay: tau * between(random, 0.6, 1.5) });

        mix(out, ping, share * seconds, between(random, 0.3, 1) * (1 - share * 0.5) / partials.length);
    }

    return out;
}

/** A synth's zap: a wave falling from `from` to `to` hertz over `seconds`, through a filter closing from bright to dark. */
export function zap({ seconds, from, to, wave = 'saw', bright = 6000, dark = 600, tau = 0.08 })
{
    const body = tone({ seconds, wave, freq: ramp([[0, from], [seconds, to]]) });
    const darker = filter(body, { type: 'lowpass', freq: ramp([[0, bright], [seconds, dark]]), q: 1.6 });

    return fade(shape(darker, strike(0.002, tau)), 0, 0.02);
}

/** Notes struck together as bells, each a little after the last by `spread` seconds, at `level`. */
export function chime({ notes, seconds, partials = BELL, decay = 1, spread = 0.012, level = 1 })
{
    const out = silence(seconds);

    notes.forEach((hz, at) =>
    {
        mix(out, bell({ freq: hz, seconds, partials, decay }), at * spread, level / Math.sqrt(notes.length) / partials.length * 3);
    });

    return out;
}

/** Two pieces of metal meeting: the same plate twice a few cents apart, a hair apart in time. */
export function clink({ freq, random, seconds = 0.5, decay = 0.35 })
{
    const out = silence(seconds);
    const offset = between(random, 0.004, 0.012);

    mix(out, bell({ freq, seconds, partials: METAL, decay }), 0, 0.5);
    mix(out, bell({ freq: freq * between(random, 1.012, 1.03), seconds, partials: METAL, decay: decay * 0.8 }), offset, 0.35);

    return filter(out, { type: 'highpass', freq: freq * 0.6 });
}

/** Thunder: a crack of bright noise, then a rumble that rolls in waves as it dies. */
export function thunder({ seconds, random, crack = 0.5 })
{
    const out = silence(seconds);
    const snap = shape(filter(noise({ seconds: 0.25, random }), { type: 'highpass', freq: 1800 }), strike(0.001, 0.03));
    const roll = filter(noise({ seconds, random, color: 'brown' }), { type: 'lowpass', freq: 420, q: 0.9 });
    const waves = Array.from({ length: 5 }, () => [between(random, 0.05, seconds * 0.8), between(random, 0.5, 1)]);
    const rumble = shape(roll, (t) => swell(0.04, 0.12, seconds - 0.12)(t) * (0.55 + 0.45 * waves.reduce((most, [at, size]) => Math.max(most, size * Math.exp(-((t - at) ** 2) / 0.008)), 0)));

    mix(out, snap, 0, crack);
    mix(out, rumble, 0.01, 1.4);

    return out;
}

/**
 * A machine's glitch: `count` slices of square tones and crushed noise at random pitches and
 * moments, some repeated as a buffer stutters, all through a few bits.
 */
export function glitch({ seconds, random, count = 10, low = 220, high = 2600, bits = 5 })
{
    const out = silence(seconds);

    for (let n = 0; n < count; n += 1)
    {
        const at = random() * seconds * 0.85;
        const size = between(random, 0.012, 0.06);
        const hz = low * Math.pow(high / low, random());
        const slice = random() < 0.65
            ? tone({ seconds: size, freq: hz, wave: 'square', width: between(random, 0.2, 0.5) })
            : filter(noise({ seconds: size, random }), { type: 'bandpass', freq: hz * 2, q: 3 });
        const repeats = random() < 0.4 ? 2 + Math.floor(random() * 3) : 1;

        for (let again = 0; again < repeats; again += 1)
        {
            mix(out, shape(slice, swell(0.001, size - 0.003, 0.002)), at + again * size * 1.05, between(random, 0.35, 0.8));
        }
    }

    return crush(out, { bits, hold: 3 });
}

/** A pad: each note as two saws a few cents apart, through a filter opening from `open[0]` to `open[1]` hertz, swelling and dying. */
export function pad({ notes, seconds, random, open = [400, 2400], attack = 0.25, release = 0.6 })
{
    const out = silence(seconds);

    for (const hz of notes)
    {
        for (const detune of [-7, 7])
        {
            const wobble = between(random, 0, 1);
            const voice = tone({ seconds, wave: 'saw', freq: (t) => hz * Math.pow(2, (detune + Math.sin(t * 5 + wobble * 6) * 3) / 1200), phase: random() });
            mix(out, voice, 0, 0.5 / notes.length);
        }
    }

    const opened = filter(out, { type: 'lowpass', freq: ramp([[0, open[0]], [seconds * 0.6, open[1]], [seconds, open[0] * 1.5]]), q: 1.1 });

    return shape(opened, swell(attack, seconds - release, release));
}

/** Wings: noise that beats `rate` times a second, in a band between `low` and `high` hertz, each beat soft at its edges. */
export function flutter({ seconds, random, rate = 16, low = 600, high = 3200 })
{
    const air = filter(filter(noise({ seconds, random, color: 'pink' }), { type: 'highpass', freq: low }), { type: 'lowpass', freq: high });

    return shape(air, (t) => (0.5 - 0.5 * Math.cos(Math.PI * 2 * rate * t)) ** 1.5 * swell(0.05, seconds * 0.6, seconds * 0.4)(t));
}

/**
 * Something brittle breaking: a sharp crack of bright noise and a few shards ringing high, each
 * falling in pitch as it flies, between `low` and `high` hertz.
 */
export function crack({ random, seconds = 0.6, low = 2400, high = 9000, shards = 5, bright = 2500 })
{
    const out = silence(seconds);
    const snap = shape(filter(noise({ seconds: 0.08, random }), { type: 'highpass', freq: bright }), strike(0.0004, 0.012));

    mix(out, snap, 0, 1.2);

    for (let n = 0; n < shards; n += 1)
    {
        const hz = low * Math.pow(high / low, random());
        const at = between(random, 0, seconds * 0.25);
        const ring = shape(tone({ seconds: seconds - at, freq: ramp([[0, hz], [seconds - at, hz * between(random, 0.82, 0.95)]]) }), strike(0.001, between(random, 0.03, 0.09)));

        mix(out, fade(ring, 0, 0.02), at, between(random, 0.15, 0.4));
    }

    return out;
}

/** A synth's stab: each note as three saws a few cents apart, through a filter that opens at once and closes over `tau`. */
export function stab({ notes, seconds = 0.6, random, bright = 5200, dark = 500, tau = 0.12 })
{
    const out = silence(seconds);

    for (const hz of notes)
    {
        for (const detune of [-11, 0, 11])
        {
            mix(out, tone({ seconds, wave: 'saw', freq: hz * Math.pow(2, detune / 1200), phase: random() }), 0, 0.4 / notes.length);
        }
    }

    const closing = filter(out, { type: 'lowpass', freq: (t) => dark + (bright - dark) * Math.exp(-t / tau), q: 2.2 });

    return fade(shape(closing, strike(0.002, tau * 2.4)), 0, 0.03);
}

/** Electricity: a sine bent hard by another a little faster than half again its pitch, buzzing at `freq`, with `hiss` of noise riding it. */
export function buzz({ seconds, freq, random, index = 6, hiss = 0.3 })
{
    const hum = fm({ seconds, carrier: freq, ratio: 1.41, index });
    const air = filter(noise({ seconds, random }), { type: 'bandpass', freq: 3000, q: 0.8 });
    const out = silence(seconds);

    mix(out, hum, 0, 0.7);
    mix(out, shape(air, (t) => 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 47)), 0, hiss);

    return fade(out, 0, 0.02);
}

/** A breath drawn in: noise through a band, rung in a room and played backwards, so it swells into the moment it ends on. */
export function inhale({ seconds, random, low = 300, high = 4000 })
{
    const burst = shape(filter(filter(noise({ seconds: 0.06, random }), { type: 'highpass', freq: low }), { type: 'lowpass', freq: high }), strike(0.001, 0.02));
    const room = reverb(burst, { size: 0.9, damp: 0.3, wet: 1, tail: seconds });

    return fade(reverse(room).slice(Math.max(0, room.length - Math.round(seconds * RATE))), 0.05, 0.004);
}

/** A knock on something: a few milliseconds of noise ringing at `freq` hertz as the thing it strikes would. */
export function tap({ freq, random, seconds = 0.14, q = 7, tau = 0.03, body = 0.6 })
{
    const out = silence(seconds);
    const hit = shape(noise({ seconds, random }), strike(0.0005, 0.004));
    const ring = shape(filter(hit, { type: 'bandpass', freq, q }), strike(0.0008, tau));

    mix(out, ring, 0, 4);
    mix(out, shape(tone({ seconds, freq: freq * 0.5 }), strike(0.001, tau * 0.8)), 0, body);

    return fade(out, 0, 0.02);
}

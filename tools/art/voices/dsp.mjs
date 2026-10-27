/**
 * The instruments every collection's voice is played on, drawn sample by sample at 44.1 kHz into
 * Float32Arrays: oscillators and FM, noise through swept filters, plucked strings, bells, crackle,
 * a reverb and the envelopes that shape them. Everything random is drawn from a seed the caller
 * hands in, so a build writes the same bytes every time.
 */

export const RATE = 44100;

const TAU = Math.PI * 2;

/** A stream of numbers in [0, 1) from a seed: mulberry32. */
export function seeded(seed)
{
    let state = seed >>> 0;

    return () =>
    {
        state = (state + 0x6D2B79F5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/** A number between `from` and `to`, drawn from `random`. */
export const between = (random, from, to) => from + random() * (to - from);

/** The frequency `cents` above `hz`. */
export const cents = (hz, by) => hz * Math.pow(2, by / 1200);

/** The frequency of the note `steps` semitones above `hz`. */
export const step = (hz, steps) => hz * Math.pow(2, steps / 12);

export const db = (decibels) => Math.pow(10, decibels / 20);

/** An empty take `seconds` long. */
export const silence = (seconds) => new Float32Array(Math.max(1, Math.ceil(seconds * RATE)));

/**
 * `signal` added into `into` from `at` seconds on, at `gain`. Whatever runs past the end is let
 * go, faded out over the 12 ms before the end, and a signal that ends while it still sounds is
 * faded over its last 6 ms: cut while it sounded, either would click.
 */
export function mix(into, signal, at = 0, gain = 1)
{
    const start = Math.round(at * RATE);
    const kept = Math.min(signal.length, into.length - start);
    const sounding = Math.abs(signal[signal.length - 1] ?? 0) > 1e-4;
    const tail = Math.min(Math.round((kept < signal.length ? 0.012 : sounding ? 0.006 : 0) * RATE), Math.max(0, kept));

    for (let n = Math.max(0, -start); n < kept; n += 1)
    {
        const ending = tail > 0 && n >= kept - tail ? (kept - n) / tail : 1;

        into[start + n] += signal[n] * gain * ending;
    }

    return into;
}

/** A value that moves through [seconds, value] points: by an exponential where both ends are above nought, otherwise straight. */
export function ramp(points)
{
    return (t) =>
    {
        if (t <= points[0][0])
        {
            return points[0][1];
        }

        for (let at = 1; at < points.length; at += 1)
        {
            const [t1, v1] = points[at];

            if (t <= t1)
            {
                const [t0, v0] = points[at - 1];
                const share = (t - t0) / Math.max(1e-9, t1 - t0);

                return v0 > 0 && v1 > 0 ? v0 * Math.pow(v1 / v0, share) : v0 + (v1 - v0) * share;
            }
        }

        return points[points.length - 1][1];
    };
}

const constant = (value) => typeof value === 'function' ? value : () => value;

/** The correction a polyBLEP adds round a step in a wave, so a saw or a square does not alias. */
const blep = (phase, increment) =>
{
    if (phase < increment)
    {
        const x = phase / increment;
        return x + x - x * x - 1;
    }

    if (phase > 1 - increment)
    {
        const x = (phase - 1) / increment;
        return x * x + x + x + 1;
    }

    return 0;
};

/**
 * A tone `seconds` long at `freq` (hertz, or a function of the time), its wave a sine, a
 * triangle, a saw or a square; the saw and the square are band-limited, so a sweep does not alias.
 */
export function tone({ seconds, freq, wave = 'sine', phase = 0, width = 0.5 })
{
    const out = silence(seconds);
    const pitch = constant(freq);
    let cycle = phase;
    let triangle = 0;

    for (let n = 0; n < out.length; n += 1)
    {
        const increment = Math.min(0.49, pitch(n / RATE) / RATE);

        if (wave === 'sine')
        {
            out[n] = Math.sin(TAU * cycle);
        }
        else if (wave === 'saw')
        {
            out[n] = 2 * cycle - 1 - blep(cycle, increment);
        }
        else
        {
            let square = (cycle < width ? 1 : -1) + blep(cycle, increment) - blep((cycle + 1 - width) % 1, increment);

            if (wave === 'triangle')
            {
                triangle = increment * 4 * square + (1 - increment * 0.05) * triangle;
                square = triangle;
            }

            out[n] = square;
        }

        cycle = (cycle + increment) % 1;
    }

    return out;
}

/** Frequency modulation: a sine carrier at `carrier` hertz bent by a sine `ratio` times as fast, as far as `index` says, each a number or a function of the time. */
export function fm({ seconds, carrier, ratio = 2, index = 1 })
{
    const out = silence(seconds);
    const pitch = constant(carrier);
    const depth = constant(index);
    const times = constant(ratio);
    let outer = 0;
    let inner = 0;

    for (let n = 0; n < out.length; n += 1)
    {
        const t = n / RATE;
        const hz = pitch(t);

        out[n] = Math.sin(TAU * outer + depth(t) * Math.sin(TAU * inner));
        outer = (outer + hz / RATE) % 1;
        inner = (inner + hz * times(t) / RATE) % 1;
    }

    return out;
}

/** Noise `seconds` long: white, pink (Paul Kellet's three-pole filter) or brown (white, integrated and kept from wandering). */
export function noise({ seconds, random, color = 'white' })
{
    const out = silence(seconds);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let brown = 0;

    for (let n = 0; n < out.length; n += 1)
    {
        const white = random() * 2 - 1;

        if (color === 'pink')
        {
            b0 = 0.99765 * b0 + white * 0.099046;
            b1 = 0.963 * b1 + white * 0.2965164;
            b2 = 0.57 * b2 + white * 1.0526913;
            out[n] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
        }
        else if (color === 'brown')
        {
            brown = (brown + white * 0.02) * 0.998;
            out[n] = brown * 3.5;
        }
        else
        {
            out[n] = white;
        }
    }

    return out;
}

/**
 * `signal` through a biquad (Robert Bristow-Johnson's cookbook): a low pass, a high pass, a band
 * pass, a notch or a peak, its frequency (and gain, for a peak) a number or a function of the time,
 * worked out again every 16 samples so a sweep is smooth.
 */
export function filter(signal, { type = 'lowpass', freq, q = 0.707, gain = 0 })
{
    const out = new Float32Array(signal.length);
    const at = constant(freq);
    const lift = constant(gain);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let a1 = 0;
    let a2 = 0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let n = 0; n < signal.length; n += 1)
    {
        if (n % 16 === 0)
        {
            const t = n / RATE;
            const w = TAU * Math.min(RATE * 0.45, Math.max(10, at(t))) / RATE;
            const cos = Math.cos(w);
            const alpha = Math.sin(w) / (2 * q);
            const amp = Math.pow(10, lift(t) / 40);
            let c = [0, 0, 0, 1, 0, 0];

            if (type === 'lowpass')
            {
                c = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
            }
            else if (type === 'highpass')
            {
                c = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
            }
            else if (type === 'bandpass')
            {
                c = [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha];
            }
            else if (type === 'notch')
            {
                c = [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha];
            }
            else if (type === 'peak')
            {
                c = [1 + alpha * amp, -2 * cos, 1 - alpha * amp, 1 + alpha / amp, -2 * cos, 1 - alpha / amp];
            }

            b0 = c[0] / c[3];
            b1 = c[1] / c[3];
            b2 = c[2] / c[3];
            a1 = c[4] / c[3];
            a2 = c[5] / c[3];
        }

        const x = signal[n];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[n] = y;
    }

    return out;
}

/** `signal` multiplied by `envelope`, a function of the time in seconds. */
export function shape(signal, envelope)
{
    const out = new Float32Array(signal.length);

    for (let n = 0; n < signal.length; n += 1)
    {
        out[n] = signal[n] * envelope(n / RATE);
    }

    return out;
}

/** A rise over `attack` seconds, then a fall by e every `tau` seconds. */
export const strike = (attack, tau) => (t) => t < attack ? t / Math.max(1e-9, attack) : Math.exp(-(t - attack) / tau);

/** A rise over `attack`, a level held to `hold`, and a fall to nothing over `release`. */
export const swell = (attack, hold, release) => (t) =>
{
    if (t < attack)
    {
        return Math.sin((t / Math.max(1e-9, attack)) * Math.PI / 2) ** 2;
    }

    if (t < hold)
    {
        return 1;
    }

    return Math.max(0, Math.cos(Math.min(1, (t - hold) / Math.max(1e-9, release)) * Math.PI / 2)) ** 2;
};

/**
 * A plucked string (Karplus-Strong): a burst of noise round a loop as long as one period, softened
 * each time round by `damping` and an average whose weight is `bright`, so the high harmonics die
 * first as a string's do. A hammered string (a santur's) gets a brighter burst.
 */
export function pluck({ freq, seconds, random, damping = 0.996, bright = 0.5, hammer = false })
{
    const out = silence(seconds);
    const period = RATE / freq;
    const length = Math.max(2, Math.floor(period));
    const fraction = period - length;
    const loop = new Float32Array(length + 2);

    for (let n = 0; n < loop.length; n += 1)
    {
        const burst = random() * 2 - 1;
        loop[n] = hammer ? burst * (n < length * 0.5 ? 1 : 0.35) : burst;
    }

    let head = 0;
    let last = 0;

    for (let n = 0; n < out.length; n += 1)
    {
        const here = loop[head];
        const next = loop[(head + 1) % length];
        const blended = here + (next - here) * fraction;
        const averaged = damping * (bright * blended + (1 - bright) * last);

        out[n] = here;
        last = blended;
        loop[head] = averaged;
        head = (head + 1) % length;
    }

    return fade(filter(out, { type: 'highpass', freq: 30 }), 0, 0.03);
}

/** Risset's bell: partials at these ratios and levels, each dying in its share of the whole. */
export const BELL = [[0.56, 1, 1], [0.56 * 1.0017, 0.67, 0.9], [0.92, 1, 0.65], [0.92 * 1.0019, 1.8, 0.55], [1.19, 2.67, 0.325], [1.7, 1.67, 0.35], [2, 1.46, 0.25], [2.74, 1.33, 0.2], [3, 1.33, 0.15], [3.76, 1, 0.1], [4.07, 1.33, 0.075]];

/** A glass bowl's partials: fewer, purer and further apart than a bell's. */
export const GLASS = [[1, 1, 1], [2.32, 0.5, 0.6], [4.25, 0.3, 0.38], [6.63, 0.18, 0.24], [9.38, 0.1, 0.16]];

/** A struck bar or coin: a fundamental and the bright inharmonic partials a metal plate rings with. */
export const METAL = [[1, 1, 1], [2.756, 0.6, 0.5], [5.404, 0.4, 0.3], [8.933, 0.25, 0.2], [13.344, 0.15, 0.12]];

/** A gong: low partials crowded close, which beat against each other as it dies. */
export const GONG = [[1, 1, 1], [1.02, 0.7, 0.95], [1.69, 0.6, 0.8], [2.3, 0.5, 0.7], [2.52, 0.45, 0.6], [3.33, 0.3, 0.5], [4.1, 0.2, 0.35]];

/** An inharmonic struck instrument at `freq`: each partial a sine at its ratio and level, dying over its share of `decay` seconds. */
export function bell({ freq, seconds, partials = BELL, decay = 1.2, attack = 0.002 })
{
    const out = silence(seconds);

    for (const [ratio, level, share] of partials)
    {
        const hz = freq * ratio;

        if (hz >= RATE * 0.45)
        {
            continue;
        }

        const tau = decay * share;

        for (let n = 0; n < out.length; n += 1)
        {
            const t = n / RATE;
            const envelope = t < attack ? t / attack : Math.exp(-(t - attack) / tau);
            out[n] += level * envelope * Math.sin(TAU * hz * t);
        }
    }

    return fade(out, 0, 0.03);
}

/**
 * Crackle: `rate` clicks a second on average at random moments, each a few milliseconds of noise
 * through a band between `low` and `high` hertz at a random level, as fire or static crackles.
 */
export function crackle({ seconds, random, rate = 40, low = 1200, high = 6000, length = 0.004 })
{
    const out = silence(seconds);
    let t = -Math.log(1 - random()) / rate;

    while (t < seconds)
    {
        const hz = low * Math.pow(high / low, random());
        const size = Math.round(length * RATE * between(random, 0.5, 1.6));
        const level = Math.pow(random(), 1.6);
        const click = new Float32Array(size);

        for (let n = 0; n < size; n += 1)
        {
            click[n] = (random() * 2 - 1) * Math.exp(-n / (size * 0.3));
        }

        mix(out, filter(click, { type: 'bandpass', freq: hz, q: 2.5 }), t, level * 3);
        t += -Math.log(1 - random()) / rate;
    }

    return out;
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];

const PASSES = [556, 441, 341, 225];

/**
 * A room round `signal`, Jezar's Freeverb in mono: eight combs whose feedback is darkened by
 * `damp`, then four allpasses. `size` is how long the room rings, from 0 to 1, `wet` how much of
 * it is heard, and `tail` seconds are added for it to ring out in.
 */
export function reverb(signal, { size = 0.75, damp = 0.4, wet = 0.3, tail = 1 })
{
    const length = signal.length + Math.round(tail * RATE);
    const input = new Float32Array(length);
    input.set(signal);
    const feedback = 0.7 + size * 0.28;
    const room = new Float32Array(length);

    for (const comb of COMBS)
    {
        const line = new Float32Array(comb);
        let at = 0;
        let held = 0;

        for (let n = 0; n < length; n += 1)
        {
            const out = line[at];
            held = out * (1 - damp) + held * damp;
            line[at] = input[n] * 0.015 + held * feedback;
            room[n] += out;
            at = (at + 1) % comb;
        }
    }

    for (const pass of PASSES)
    {
        const line = new Float32Array(pass);
        let at = 0;

        for (let n = 0; n < length; n += 1)
        {
            const held = line[at];
            const out = -room[n] + held;
            line[at] = room[n] + held * 0.5;
            room[n] = out;
            at = (at + 1) % pass;
        }
    }

    const out = new Float32Array(length);

    for (let n = 0; n < length; n += 1)
    {
        out[n] = input[n] * (1 - wet * 0.5) + room[n] * wet;
    }

    return out;
}

/** An echo `time` seconds after the sound, each one `feedback` of the one before, mixed in at `level`. */
export function echo(signal, { time = 0.12, feedback = 0.35, level = 0.4, tail = 0.6 })
{
    const out = new Float32Array(signal.length + Math.round(tail * RATE));
    const line = new Float32Array(out.length);
    const gap = Math.round(time * RATE);

    for (let n = 0; n < out.length; n += 1)
    {
        const dry = signal[n] ?? 0;
        const delayed = n >= gap ? line[n - gap] : 0;

        line[n] = dry + delayed * feedback;
        out[n] = dry + delayed * level;
    }

    return out;
}

/** `signal` warmed by a soft clip: `amount` 1 barely touches it, 6 saturates it. */
export function drive(signal, amount = 2)
{
    const out = new Float32Array(signal.length);
    const norm = Math.tanh(amount);

    for (let n = 0; n < signal.length; n += 1)
    {
        out[n] = Math.tanh(signal[n] * amount) / norm;
    }

    return out;
}

/** `signal` with its bits and its rate brought down, the sound of an old machine: `bits` of depth, each value held for `hold` samples. */
export function crush(signal, { bits = 6, hold = 4 })
{
    const out = new Float32Array(signal.length);
    const steps = Math.pow(2, bits - 1);
    let held = 0;

    for (let n = 0; n < signal.length; n += 1)
    {
        if (n % hold === 0)
        {
            held = Math.round(signal[n] * steps) / steps;
        }

        out[n] = held;
    }

    return out;
}

export const reverse = (signal) => Float32Array.from(signal).reverse();

/** `signal` slowed to `rate` of its speed and so lowered, read between its samples. */
export function stretch(signal, rate)
{
    const out = new Float32Array(Math.floor(signal.length / rate));

    for (let n = 0; n < out.length; n += 1)
    {
        const at = n * rate;
        const low = Math.floor(at);
        const share = at - low;
        out[n] = (signal[low] ?? 0) * (1 - share) + (signal[low + 1] ?? 0) * share;
    }

    return out;
}

/** The loudest sample of `signal`, as a level. */
export const peakOf = (signal) => signal.reduce((most, value) => Math.max(most, Math.abs(value)), 0);

/**
 * How loud the loudest 10 ms of `signal` is in the band a phone's speaker plays, 300 Hz to 4 kHz,
 * in decibels of full scale: what `sound-levels.mjs` calls `phone`, the measure every take of
 * every pack is levelled by.
 */
export function phoneLevel(signal)
{
    let band = signal;

    for (const [type, freq] of [['highpass', 300], ['highpass', 300], ['lowpass', 4000], ['lowpass', 4000]])
    {
        band = filter(band, { type, freq });
    }

    const frame = Math.round(RATE * 0.01);
    let most = 0;

    for (let at = 0; at + frame <= band.length; at += frame)
    {
        let sum = 0;

        for (let n = 0; n < frame; n += 1)
        {
            sum += band[at + n] ** 2;
        }

        most = Math.max(most, sum / frame);
    }

    return 10 * Math.log10(Math.max(most, 1e-12));
}

/** `signal` brought to `peak` at its loudest sample. */
export function normalize(signal, peak = db(-1))
{
    const most = peakOf(signal);
    const out = new Float32Array(signal.length);

    for (let n = 0; n < signal.length; n += 1)
    {
        out[n] = most > 0 ? signal[n] * peak / most : 0;
    }

    return out;
}

/** `signal` faded in over `begin` seconds and out over its last `end`, so it neither clicks on nor off. */
export function fade(signal, begin = 0.002, end = 0.02)
{
    const out = Float32Array.from(signal);
    const rise = Math.max(1, Math.round(begin * RATE));
    const fall = Math.max(1, Math.round(end * RATE));

    for (let n = 0; n < Math.min(rise, out.length); n += 1)
    {
        out[n] *= n / rise;
    }

    for (let n = 0; n < Math.min(fall, out.length); n += 1)
    {
        out[out.length - 1 - n] *= n / fall;
    }

    return out;
}

/** `signal` without the silence after its last sound louder than `floor`, kept to `most` seconds at the longest. */
export function trim(signal, floor = db(-60), most = 4)
{
    let end = signal.length;

    while (end > 1 && Math.abs(signal[end - 1]) < floor)
    {
        end -= 1;
    }

    return signal.slice(0, Math.min(end + Math.round(0.01 * RATE), signal.length, Math.round(most * RATE)));
}

/** A WAV file holding `signal` as 16-bit mono at the sample rate here. */
export function wav(signal)
{
    const data = Buffer.alloc(signal.length * 2);

    for (let n = 0; n < signal.length; n += 1)
    {
        data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, signal[n])) * 32767), n * 2);
    }

    const head = Buffer.alloc(44);
    head.write('RIFF', 0, 'ascii');
    head.writeUInt32LE(36 + data.length, 4);
    head.write('WAVE', 8, 'ascii');
    head.write('fmt ', 12, 'ascii');
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(1, 22);
    head.writeUInt32LE(RATE, 24);
    head.writeUInt32LE(RATE * 2, 28);
    head.writeUInt16LE(2, 32);
    head.writeUInt16LE(16, 34);
    head.write('data', 36, 'ascii');
    head.writeUInt32LE(data.length, 40);

    return Buffer.concat([head, data]);
}

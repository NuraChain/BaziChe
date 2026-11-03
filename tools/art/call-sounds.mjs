import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CUES } from '../../frontend/src/game/sound-files.ts';
import { bell, filter, mix, noise, reverb, seeded, shape, silence, step, strike, swell, tone } from './voices/dsp.mjs';
import { clickLevel, encoded, seedOf, shaped, writePack } from './voices/pack.mjs';

/**
 * A call's sounds, drawn here from code and written as one pack, `calls.cues`, as the looks' voices
 * are: the ring a call makes on the pages of whoever it rings for, the ringback whoever rang hears
 * while it rings there, and the tone a call ends with. One take each, seeded, so a build writes the
 * same bytes every time, and levelled by `shaped` (`voices/pack.mjs`): `below` is how many decibels
 * under the chess click it sits, `most` its longest, `kbps` its bit rate.
 *
 * The ring and the ringback keep a telephone's double ring, two of 0.4 seconds 0.2 apart, so either
 * reads as ringing wherever it is heard, the ring on a marimba and the ringback as the line's own
 * tone. The engine lays each at the start of a loop three seconds long (`RINGS` in
 * `frontend/src/game/sound.ts`), so neither may run longer.
 */
const MADE = {
    'ring': { below: 0, most: 2.6, kbps: 96, make: ring },
    'ringback': { below: 9, most: 1.2, kbps: 64, make: ringback },
    'call-end': { below: 5, most: 0.9, kbps: 64, make: ended }
};

/** When each of a double ring's two rings starts. */
const DOUBLE = [0, 0.6];

/** The notes the ring trills between and the end falls through: C#6 and E6 over A5. */
const HOME = 880;
const THIRD = step(HOME, 4);
const FIFTH = step(HOME, 7);

/** A marimba bar's modes: its fundamental, the one tuned two octaves up and the one past three, which die in that order. */
const BAR = [[1, 1, 1], [3.99, 0.3, 0.28], [9.6, 0.08, 0.09]];

/** How fast a stilled bar dies, in seconds a fall by e. */
const STILLED = 0.045;

/** How long each of the double ring's two rings goes on, from its first strike to the hand on the bars. */
const RINGING = 0.47;

/** A marimba's bar struck at `freq`, with the knock of its mallet, and stilled `damped` seconds on as a hand on the bar stills it. */
function marimba({ freq, random, seconds = 0.9, decay = 0.24, knock = 0.12, damped = seconds })
{
    const bar = bell({ freq, seconds, partials: BAR, decay, attack: 0.0015 });
    const mallet = filter(shape(noise({ seconds: 0.012, random }), strike(0.0005, 0.003)), { type: 'lowpass', freq: 2600 });

    return shape(mix(bar, mallet, 0, knock), (t) => (t < damped ? 1 : Math.exp(-(t - damped) / STILLED)));
}

/** The ring: each of the double ring's two a trill of six between C#6 and E6, the octave under them softer, stilled together as it ends. */
function ring(random)
{
    const out = silence(2.6);

    for (const at of DOUBLE)
    {
        for (let note = 0; note < 6; note += 1)
        {
            const freq = note % 2 === 0 ? THIRD : FIFTH;
            const level = note === 0 ? 1 : 0.82 + random() * 0.08;
            const when = at + note * 0.072;

            const damped = at + RINGING - when;

            mix(out, marimba({ freq, random, damped }), when, level);
            mix(out, marimba({ freq: freq / 2, random, decay: 0.3, knock: 0.05, damped }), when, 0.24 * level);
        }
    }

    return reverb(filter(out, { type: 'lowpass', freq: 7000 }), { size: 0.45, damp: 0.5, wet: 0.16, tail: 0.6 });
}

/** The ringback: the double ring as a line's own tone, 400 and 450 Hz together. */
function ringback()
{
    const out = silence(1.1);

    for (const at of DOUBLE)
    {
        const pair = mix(tone({ seconds: 0.4, freq: 400 }), tone({ seconds: 0.4, freq: 450 }));

        mix(out, shape(pair, swell(0.025, 0.375, 0.025)), at, 0.5);
    }

    return out;
}

/** The end: E6, C#6 and A5, falling, struck softer and dying sooner than the ring. */
function ended(random)
{
    const out = silence(1.2);

    [FIFTH, THIRD, HOME].forEach((freq, note) => mix(out, marimba({ freq, random, decay: 0.2, knock: 0.08 }), note * 0.11, 1 - note * 0.12));

    return reverb(filter(out, { type: 'lowpass', freq: 5000 }), { size: 0.4, damp: 0.55, wet: 0.14, tail: 0.4 });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SOUND = join(HERE, '..', '..', 'frontend', 'src', 'game', 'sound');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const scratch = mkdtempSync(join(tmpdir(), 'nura-calls-'));

try
{
    const click = clickLevel(SOUND, scratch, FFMPEG);
    const takes = CUES.calls.map((cue) =>
    {
        const made = MADE[cue];

        return [cue, encoded(shaped(made.make(seeded(seedOf(`call.${ cue }`))), made, click), made.kbps, scratch, cue, FFMPEG)];
    });
    const wrote = writePack(join(SOUND, 'calls.cues'), takes);

    console.log(`calls.cues ${ wrote.size } bytes, ${ wrote.takes } takes of ${ wrote.cues } cues`);
}
finally
{
    rmSync(scratch, { recursive: true, force: true });
}

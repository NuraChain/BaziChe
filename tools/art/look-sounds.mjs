import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { MOMENTS } from '../../frontend/src/game/sound-files.ts';
import { db, fade, filter, normalize, peakOf, phoneLevel, RATE, seeded, trim, wav } from './voices/dsp.mjs';
import { VOICES } from './voices/index.mjs';

/**
 * The looks' voices, drawn here from nothing but code (`voices/`) and written as a pack a place for
 * each collection: what its looks sound like on a profile, and at a table. Every take is seeded from
 * its collection, its moment and its number, so a build writes the same bytes every time.
 *
 * Each take is levelled as `sound-levels.mjs` measures, by its loudest 10 ms in the band a phone's
 * speaker plays, against the chess click as it sits in its pack: `below` is how many decibels under
 * the click it sits. A table's moment lies over the table's own foley, which it never replaces, so
 * it sits further under. A take whose peak would pass -1 dBFS at that level is softened by up to
 * 3 dB and brought down for the rest. `most` is its longest, the rest faded out; `kbps` its bit rate.
 */
const MADE = {
    equip: { takes: 2, below: 3, most: 1.2, kbps: 64 },
    reveal: { takes: 1, below: 5, most: 2.6, kbps: 64 },
    strike: { takes: 1, below: 3, most: 1.3, kbps: 64 },
    die: { takes: 2, below: 6, most: 0.45, kbps: 64 },
    card: { takes: 2, below: 6, most: 0.45, kbps: 64 },
    pawn: { takes: 2, below: 6, most: 0.45, kbps: 64 },
    spawn: { takes: 2, below: 5, most: 0.8, kbps: 64 },
    capture: { takes: 2, below: 3, most: 1.1, kbps: 64 }
};

const HERE = dirname(fileURLToPath(import.meta.url));
const SOUND = join(HERE, '..', '..', 'frontend', 'src', 'game', 'sound');
const OUT = join(SOUND, 'looks');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const CEILING = -1;
const SOFTEST = 3;

/** The seed a take is drawn from: FNV-1a over its collection, its moment and its number. */
const seedOf = (text) =>
{
    let hash = 0x811C9DC5;

    for (const char of text)
    {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash;
};

/** The chess click as it sits in its pack, decoded, which every take is levelled against. */
const clickLevel = (scratch) =>
{
    const pack = readFileSync(join(SOUND, 'chess.cues'));
    const start = 8 + pack.readUInt32LE(4);
    const [offset, size] = JSON.parse(pack.subarray(8, start).toString('utf8'))['piece-move'][0];
    const file = join(scratch, 'click.mp3');

    writeFileSync(file, pack.subarray(start + offset, start + offset + size));
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);

    return phoneLevel(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
};

/** One take, made and shaped: cleared of what no speaker plays, kept to its longest, levelled and held under the ceiling. */
function shaped(made, { below, most }, click)
{
    let signal = trim(filter(made, { type: 'highpass', freq: 50 }));

    if (signal.length > most * RATE)
    {
        signal = fade(signal.slice(0, Math.round(most * RATE)), 0, most * 0.25);
    }

    signal = fade(normalize(signal, 1), 0.002, 0.03);
    signal = normalize(signal, db(click - below - phoneLevel(signal)));

    const over = 20 * Math.log10(peakOf(signal)) - CEILING;

    if (over > SOFTEST)
    {
        signal = normalize(signal, db(CEILING + SOFTEST));
    }

    if (over > 0)
    {
        const ceiling = db(CEILING);
        signal = signal.map((value) => ceiling * Math.tanh(value / ceiling));
    }

    return signal;
}

const scratch = mkdtempSync(join(tmpdir(), 'nura-voices-'));

try
{
    const click = clickLevel(scratch);
    mkdirSync(OUT, { recursive: true });

    for (const collection of SHOP_COLLECTIONS)
    {
        for (const [place, moments] of Object.entries(MOMENTS))
        {
            const index = {};
            const bodies = [];
            let offset = 0;

            for (const moment of moments)
            {
                const made = MADE[moment];

                for (let take = 0; take < made.takes; take += 1)
                {
                    const random = seeded(seedOf(`${ collection }.${ moment }.${ take }`));
                    const signal = shaped(VOICES[collection][moment](random), made, click);
                    const source = join(scratch, `${ collection }.${ moment }.${ take }.wav`);
                    const target = join(scratch, `${ collection }.${ moment }.${ take }.mp3`);

                    writeFileSync(source, wav(signal));
                    execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', source, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', `${ made.kbps }k`, target]);

                    const body = readFileSync(target);
                    const cue = `${ collection }.${ moment }`;

                    index[cue] = [...(index[cue] ?? []), [offset, body.length]];
                    bodies.push(body);
                    offset += body.length;
                }
            }

            const header = Buffer.from(JSON.stringify(index), 'utf8');
            const lead = Buffer.alloc(8);

            lead.write('NCUE', 0, 'ascii');
            lead.writeUInt32LE(header.length, 4);
            writeFileSync(join(OUT, `${ collection }-${ place }.cues`), Buffer.concat([lead, header, ...bodies]));

            console.log(`voices ${ collection }-${ place }.cues ${ 8 + header.length + offset } bytes, ${ bodies.length } takes of ${ Object.keys(index).length } cues`);
        }
    }
}
finally
{
    rmSync(scratch, { recursive: true, force: true });
}

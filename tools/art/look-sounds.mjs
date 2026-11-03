import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { MOMENTS } from '../../frontend/src/game/sound-files.ts';
import { seeded } from './voices/dsp.mjs';
import { VOICES } from './voices/index.mjs';
import { clickLevel, encoded, seedOf, shaped, writePack } from './voices/pack.mjs';

/**
 * The looks' voices, drawn here from nothing but code (`voices/`) and written as a pack a place for
 * each collection: what its looks sound like on a profile, and at a table. Every take is seeded from
 * its collection, its moment and its number, so a build writes the same bytes every time.
 *
 * Each take is levelled by `shaped` in `voices/pack.mjs`: `below` is how many decibels under the
 * chess click it sits. A table's moment lies over the table's own foley, which it never replaces, so
 * it sits further under. `most` is its longest, the rest faded out; `kbps` its bit rate.
 */
const MADE = {
    equip: { takes: 2, below: 3, most: 1.2, kbps: 64 },
    reveal: { takes: 1, below: 5, most: 2.6, kbps: 64 },
    strike: { takes: 1, below: 3, most: 1.3, kbps: 64 },
    die: { takes: 2, below: 6, most: 0.45, kbps: 64 },
    card: { takes: 2, below: 6, most: 0.45, kbps: 64 },
    pawn: { takes: 2, below: 6, most: 0.45, kbps: 64 },
    spawn: { takes: 2, below: 5, most: 0.8, kbps: 64 },
    capture: { takes: 2, below: 3, most: 1.1, kbps: 64 },
    victory: { takes: 1, below: 4, most: 2.6, kbps: 64 }
};

const HERE = dirname(fileURLToPath(import.meta.url));
const SOUND = join(HERE, '..', '..', 'frontend', 'src', 'game', 'sound');
const OUT = join(SOUND, 'looks');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const scratch = mkdtempSync(join(tmpdir(), 'nura-voices-'));

try
{
    const click = clickLevel(SOUND, scratch, FFMPEG);
    mkdirSync(OUT, { recursive: true });

    for (const collection of SHOP_COLLECTIONS)
    {
        for (const [place, moments] of Object.entries(MOMENTS))
        {
            const takes = moments.flatMap((moment) => Array.from({ length: MADE[moment].takes }, (_, take) =>
            {
                const name = `${ collection }.${ moment }.${ take }`;
                const signal = shaped(VOICES[collection][moment](seeded(seedOf(name))), MADE[moment], click);

                return [`${ collection }.${ moment }`, encoded(signal, MADE[moment].kbps, scratch, name, FFMPEG)];
            }));
            const file = `${ collection }-${ place }.cues`;
            const wrote = writePack(join(OUT, file), takes);

            console.log(`voices ${ file } ${ wrote.size } bytes, ${ wrote.takes } takes of ${ wrote.cues } cues`);
        }
    }
}
finally
{
    rmSync(scratch, { recursive: true, force: true });
}

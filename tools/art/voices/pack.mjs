import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { db, fade, filter, normalize, peakOf, phoneLevel, RATE, trim, wav } from './dsp.mjs';

/*
 * What a take drawn by code goes through before a pack holds it, the looks' voices and a call's
 * sounds alike: levelled against the chess click, encoded, and written as a pack the engine unpacks
 * (`unpack` in `frontend/src/game/sound-files.ts`).
 */

const CEILING = -1;
const SOFTEST = 3;

/** The seed a take is drawn from: FNV-1a over what names it. */
export function seedOf(text)
{
    let hash = 0x811C9DC5;

    for (const char of text)
    {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash;
}

/** The chess click as it sits in its pack in `sound`, decoded and measured as `phoneLevel` measures: what every take is levelled against. */
export function clickLevel(sound, scratch, ffmpeg)
{
    const pack = readFileSync(join(sound, 'chess.cues'));
    const start = 8 + pack.readUInt32LE(4);
    const [offset, size] = JSON.parse(pack.subarray(8, start).toString('utf8'))['piece-move'][0];
    const file = join(scratch, 'click.mp3');

    writeFileSync(file, pack.subarray(start + offset, start + offset + size));
    const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);

    return phoneLevel(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
}

/**
 * One take, made and shaped: cleared of what no speaker plays, kept to `most` seconds (the rest
 * faded out), and levelled `below` decibels under the click by its loudest 10 ms in a phone
 * speaker's band, as `sound-levels.mjs` measures every pack. A take whose peak would pass -1 dBFS
 * at that level is softened by up to 3 dB and brought down for the rest.
 */
export function shaped(made, { below, most }, click)
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

/** A take as a pack keeps it: MP3, mono, 44.1 kHz, at `kbps`. */
export function encoded(signal, kbps, scratch, name, ffmpeg)
{
    const source = join(scratch, `${ name }.wav`);
    const target = join(scratch, `${ name }.mp3`);

    writeFileSync(source, wav(signal));
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', source, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', `${ kbps }k`, target]);

    return readFileSync(target);
}

/**
 * A pack written to `path` from `[cue, take]` pairs in order: `NCUE`, the length of its index, the
 * index of each cue's takes by offset and size, then the takes. Answers what it wrote.
 */
export function writePack(path, takes)
{
    const index = {};
    const bodies = [];
    let offset = 0;

    for (const [cue, body] of takes)
    {
        index[cue] = [...(index[cue] ?? []), [offset, body.length]];
        bodies.push(body);
        offset += body.length;
    }

    const header = Buffer.from(JSON.stringify(index), 'utf8');
    const lead = Buffer.alloc(8);

    lead.write('NCUE', 0, 'ascii');
    lead.writeUInt32LE(header.length, 4);
    writeFileSync(path, Buffer.concat([lead, header, ...bodies]));

    return { size: 8 + header.length + offset, takes: bodies.length, cues: Object.keys(index).length };
}

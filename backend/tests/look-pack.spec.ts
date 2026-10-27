import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { MOMENTS, PLACE_OF, VOICE_PACKS, voicesOf, type Place } from '../../frontend/src/game/sound-files.ts';

const looks = new URL('../../frontend/src/game/sound/looks/', import.meta.url);

const places = Object.keys(MOMENTS) as Place[];

const read = (name: string) =>
{
    const bytes = readFileSync(new URL(name, looks));
    const header = bytes.readUInt32LE(4);

    return { bytes, header, index: JSON.parse(bytes.subarray(8, 8 + header).toString('utf8')) as Record<string, [number, number][]> };
};

/** Whether `body` opens as an MP3 does: an ID3 tag, or a frame's sync. */
const mp3 = (body: Buffer) => body.subarray(0, 3).toString('latin1') === 'ID3' || (body[0] === 0xFF && (body[1] & 0xE0) === 0xE0);

const builder = readFileSync(new URL('../../tools/art/look-sounds.mjs', import.meta.url), 'utf8');

const voices = (name: string) => readFileSync(new URL(`../../tools/art/voices/${ name }.mjs`, import.meta.url), 'utf8');

/** The collections the voices' index names, by the keys of its table. */
const indexed = () => (/export const VOICES = \{([^}]*)\}/.exec(voices('index'))?.[1] ?? '').split(',').map((entry) => entry.split(':')[0]!.trim());

/** The moments a collection's voice draws, by the methods of its `voice`. */
const drawn = (collection: string) => [...voices(collection).matchAll(/^ {4}(\w+)\((?:random)?\)$/gm)].map(([, moment]) => moment);

describe('the looks\' voices', () =>
{
    it('are a pack a place for every collection, and nothing else', () =>
    {
        const wanted = SHOP_COLLECTIONS.flatMap((collection) => places.map((place) => `${ collection }-${ place }.cues`));

        expect(readdirSync(looks).sort()).toEqual(wanted.sort());
    });

    it.each([...SHOP_COLLECTIONS])('of %s hold every moment of each place in takes that are MP3s, and no other cue', (collection) =>
    {
        for (const place of places)
        {
            const { bytes, header, index } = read(`${ collection }-${ place }.cues`);

            expect(bytes.subarray(0, 4).toString('ascii')).toBe('NCUE');
            expect(Object.keys(index).sort(), place).toEqual(voicesOf(collection, place).sort());

            for (const [cue, takes] of Object.entries(index))
            {
                expect(takes.length, cue).toBeGreaterThan(0);

                for (const [offset, size] of takes)
                {
                    expect(size, cue).toBeGreaterThan(0);
                    expect(8 + header + offset + size, cue).toBeLessThanOrEqual(bytes.length);
                    expect(mp3(bytes.subarray(8 + header + offset, 8 + header + offset + size)), cue).toBe(true);
                }
            }

            expect(statSync(new URL(`${ collection }-${ place }.cues`, looks)).size, `${ collection }-${ place }`).toBeLessThanOrEqual(64 * 1024);
        }
    });

    it('are each fetched from their own file', () =>
    {
        for (const collection of SHOP_COLLECTIONS)
        {
            for (const place of places)
            {
                const address = VOICE_PACKS[collection][place];

                expect(new URL(address).pathname.endsWith(`/sound/looks/${ collection }-${ place }.cues`), `${ collection } at ${ place }`).toBe(true);
                expect(existsSync(new URL(address)), address).toBe(true);
            }
        }
    });

    it('are drawn by a module for every collection, with a take for every moment', () =>
    {
        expect(indexed().sort()).toEqual([...SHOP_COLLECTIONS].sort());

        for (const collection of SHOP_COLLECTIONS)
        {
            expect(drawn(collection).sort(), collection).toEqual(Object.keys(PLACE_OF).sort());
        }
    });

    it('are made by a builder that says how to make every moment', () =>
    {
        const made = [...builder.matchAll(/^ {4}(\w+): \{ takes: \d+, below: [\d.]+, most: [\d.]+, kbps: \d+ \},?$/gm)].map(([, moment]) => moment);

        expect(made.sort()).toEqual(Object.keys(PLACE_OF).sort());
    });

    it('are credited as drawn here, under the licence of every other sound', () =>
    {
        const credits = readFileSync(new URL('../../tools/art/sound-src/LICENSE.txt', import.meta.url), 'utf8');

        expect(credits).toContain('frontend/src/game/sound/looks/');
        expect(credits).toContain('tools/art/look-sounds.mjs');
        expect(credits).toContain('CC0 1.0 Universal');
    });
});

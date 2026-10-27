import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BUNDLES, LOOKS, SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { PALETTES, SEAT_RAMPS } from '../../frontend/src/game/looks/palette.ts';

const channel = (value: number) =>
{
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) =>
{
    const [r, g, b] = [1, 3, 5].map((at) => channel(Number.parseInt(hex.slice(at, at + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (one: string, other: string) =>
{
    const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
};

describe('the collections\' palettes', () =>
{
    it.each([...SHOP_COLLECTIONS])('%s writes its words at 4.5:1 or more against every stop of its surfaces', (collection) =>
    {
        const palette = PALETTES[collection];

        for (const stop of palette.surface)
        {
            expect(contrast(palette.ink, stop), `${ palette.ink } on ${ stop }`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each([...SHOP_COLLECTIONS])('%s dots its dice at 4.5:1 or more against every stop of their faces', (collection) =>
    {
        const palette = PALETTES[collection];

        for (const stop of palette.die.face)
        {
            expect(contrast(palette.die.pip, stop), `${ palette.die.pip } on ${ stop }`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each([...SHOP_COLLECTIONS])('%s keeps the two sides of a set far apart in light', (collection) =>
    {
        const palette = PALETTES[collection];

        expect(contrast(palette.pale[1], palette.deep[1])).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps two sides of different collections apart too, so two sets on one board still read as two sides', () =>
    {
        for (const one of SHOP_COLLECTIONS)
        {
            for (const other of SHOP_COLLECTIONS)
            {
                expect(contrast(PALETTES[one].pale[1], PALETTES[other].deep[1]), `${ one } light beside ${ other } dark`).toBeGreaterThanOrEqual(3);
            }
        }
    });

    it('paints pawns in the Ludo board\'s own seat colours', () =>
    {
        const board = readFileSync(new URL('../../tools/art/boards.mjs', import.meta.url), 'utf8');
        const paint = Object.fromEntries([...board.matchAll(/(\w+): \{ fill: '(#\w+)', light: '(#\w+)', dark: '(#\w+)'/g)].map(([, seat, fill, light, dark]) => [seat, [light, fill, dark]]));

        expect(SEAT_RAMPS).toEqual(paint);
    });
});

describe('what a profile wears', () =>
{
    const read = (path: string) => readFileSync(new URL(`../../frontend/public/${ path }`, import.meta.url), 'utf8');

    const FOLDERS: [string, string[]][] = [
        ['frames', SHOP_COLLECTIONS.flatMap((collection) => [`${ collection }.svg`, `${ collection }-still.svg`])],
        ['plates', SHOP_COLLECTIONS.map((collection) => `${ collection }.svg`)],
        ['covers', SHOP_COLLECTIONS.map((collection) => `${ collection }.svg`)]
    ];

    it.each(FOLDERS)('draws the %s of every collection and nothing else', (folder, names) =>
    {
        expect(readdirSync(new URL(`../../frontend/public/${ folder }/`, import.meta.url)).sort()).toEqual([...names].sort());
    });

    it.each([...SHOP_COLLECTIONS])('lays a name on %s\'s plate over the surface whose ink is held to 4.5:1 above', (collection) =>
    {
        const plate = read(`plates/${ collection }.svg`);

        for (const stop of PALETTES[collection].surface)
        {
            expect(plate).toContain(`stop-color="${ stop }"`);
        }
    });

    it.each([...SHOP_COLLECTIONS])('moves %s\'s frame only in the drawing that moves', (collection) =>
    {
        expect(read(`frames/${ collection }.svg`)).toMatch(/<animate/);
        expect(read(`frames/${ collection }-still.svg`)).not.toMatch(/<animate|<set\b/);
    });
});

describe('the drawings', () =>
{
    it('draws every look and every bundle, and nothing the shop does not sell', () =>
    {
        const drawn = readdirSync(new URL('../../frontend/public/looks/', import.meta.url)).sort();

        expect(drawn).toEqual([...LOOKS, ...BUNDLES].map((item) => `${ item.id }.svg`).sort());
    });
});

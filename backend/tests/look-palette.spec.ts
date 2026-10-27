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

describe('what a table wears', () =>
{
    const SEATS = Object.keys(SEAT_RAMPS) as (keyof typeof SEAT_RAMPS)[];

    const shape = readFileSync(new URL('../../tools/art/pawn-shape.mjs', import.meta.url), 'utf8');

    const outline = (part: string) => new RegExp(`${ part }: '([^']+)'`).exec(shape)![1]!;

    it('draws a pawn of every collection in every seat’s colour, and nothing else', () =>
    {
        const drawn = readdirSync(new URL('../../frontend/public/pawns/', import.meta.url)).sort();

        expect(drawn).toEqual(SHOP_COLLECTIONS.flatMap((collection) => SEATS.map((seat) => `${ collection }-${ seat }.svg`)).sort());
    });

    it.each(SHOP_COLLECTIONS.flatMap((collection) => SEATS.map((seat) => [collection, seat] as const)))('stands %s’s %s pawn on the board’s own pawn, in its seat’s colour', (collection, seat) =>
    {
        const pawn = readFileSync(new URL(`../../frontend/public/pawns/${ collection }-${ seat }.svg`, import.meta.url), 'utf8');

        expect(pawn).toContain('viewBox="0 0 256 256"');
        expect(pawn).toContain(`d="${ outline('body') }"`);
        expect(pawn).toContain(`<circle ${ outline('head') }`);
        expect(pawn, 'a pawn that does not say whose it is').toContain(SEAT_RAMPS[seat][1]);
    });

    it.each(['decks', 'backs'])('draws the %s of every collection and nothing else', (folder) =>
    {
        expect(readdirSync(new URL(`../../frontend/public/${ folder }/`, import.meta.url)).sort()).toEqual(SHOP_COLLECTIONS.map((collection) => `${ collection }.svg`).sort());
    });

    it.each([...SHOP_COLLECTIONS])('deals %s’s deck as the classic one is laid out, every index at 4.5:1 or more on its paper', (collection) =>
    {
        const drawn = readFileSync(new URL(`../../frontend/public/decks/${ collection }.svg`, import.meta.url), 'utf8');
        const classic = readFileSync(new URL('../../frontend/public/board/deck.svg', import.meta.url), 'utf8');
        const paper = /<linearGradient id="paper"[^>]*><stop offset="0" stop-color="(#\w+)"\/><stop offset="1" stop-color="(#\w+)"\/>/.exec(drawn)!.slice(1);
        const inks = new Set([...drawn.matchAll(/<text [^>]*fill="(#\w+)"/g)].map(([, ink]) => ink!));

        expect(drawn).toContain(classic.slice(0, classic.indexOf('<defs>')));
        expect([...drawn.matchAll(/<text /g)]).toHaveLength([...classic.matchAll(/<text /g)].length);
        expect(inks.size).toBe(2);

        for (const ink of inks)
        {
            for (const stop of paper)
            {
                expect(contrast(ink, stop!), `${ ink } on ${ stop }`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it.each([...SHOP_COLLECTIONS])('backs %s’s cards at the classic back’s size', (collection) =>
    {
        expect(readFileSync(new URL(`../../frontend/public/backs/${ collection }.svg`, import.meta.url), 'utf8')).toContain('viewBox="0 0 204 288"');
    });
});

describe('the legendary collections\' art', () =>
{
    const CLASSIC = ['sparkle', 'girih', 'grid', 'filigree'];

    const art = async () =>
    {
        const { LEGENDARY, lineOf } = await import(new URL('../../tools/art/legendary/index.mjs', import.meta.url).href);
        const { motif } = await import(new URL('../../tools/art/look-parts.mjs', import.meta.url).href);
        return { LEGENDARY, lineOf, motif };
    };

    it('draws every pattern the tools do not draw themselves from a module of its own collection, and no module for nothing', async () =>
    {
        const { LEGENDARY, lineOf } = await art();
        const drawn = SHOP_COLLECTIONS.filter((collection) => !CLASSIC.includes(PALETTES[collection].pattern));

        expect(Object.keys(LEGENDARY).sort()).toEqual([...drawn].sort());
        for (const collection of drawn)
        {
            expect(lineOf(PALETTES[collection]), collection).toBe(LEGENDARY[collection]);
            expect(LEGENDARY[collection].pattern).toBe(PALETTES[collection].pattern);
        }
        for (const collection of SHOP_COLLECTIONS.filter((one) => !drawn.includes(one)))
        {
            expect(lineOf(PALETTES[collection]), collection).toBeUndefined();
        }
    });

    it.each(SHOP_COLLECTIONS.filter((collection) => !['glow', 'shiraz', 'neon', 'gold'].includes(collection)))('gives %s every part its looks are drawn from', async (collection) =>
    {
        const { LEGENDARY, motif } = await art();
        const line = LEGENDARY[collection];
        const palette = PALETTES[collection];
        const tile = line.tile(palette);

        expect(tile.size).toBeGreaterThan(0);
        expect(motif('pattern', palette)).toContain(tile.body);
        for (const part of [line.emblem(palette, 50, 50, 40), line.crest(palette), line.frame(palette, false), line.cover(palette), line.back.emblem(palette, 204, 288)])
        {
            expect(part.defs).toBeInstanceOf(Array);
            expect(part.body.join('')).toMatch(/<(path|circle|rect|ellipse|g)\b/);
        }
        expect(line.frame(palette, false).body.join('')).toMatch(/<animate/);
        expect(line.frame(palette, true).body.join('')).not.toMatch(/<animate|<set\b/);
        expect(line.dress.paper).toHaveLength(2);
        expect(line.dress.suits.map((suit: { name: string }) => suit.name)).toEqual(['club', 'diamond', 'heart', 'spade']);
        expect(line.ornament(204, 288)).toMatch(/^</);
        expect(line.back.border).toMatch(/^#[0-9A-F]{6}$/i);
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

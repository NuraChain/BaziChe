/**
 * Draws what a table shows of its owner's looks, from each collection's palette, on the board's own
 * pieces so a look stands exactly where the classic one does: a ludo pawn in every collection for
 * every seat's colour (`public/pawns/<collection>-<colour>.svg`), the seat's colour kept wherever a
 * board is read for whose pawn it is. `npm run looks` runs it.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { PALETTES, SEAT_RAMPS } from '../../frontend/src/game/looks/palette.ts';
import { gloss, octagram, radial, sparkle } from './look-parts.mjs';
import { PAWN, outlined } from './pawn-shape.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public', 'pawns');

const vertical = (id, stops) =>
    `<linearGradient id="${ id }" x1="0" y1="0" x2="0" y2="1">${ stops.map(([at, colour]) => `<stop offset="${ at }" stop-color="${ colour }"/>`).join('') }</linearGradient>`;

const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs>
${ defs.join('\n') }
</defs>
${ body.join('\n') }
</svg>
`;

/** Where every pawn is shaded and catches the light, whatever it is made of. */
const lighting = (shade, lit, strength) => [
    `<path d="${ PAWN.shade }" fill="${ shade }" opacity="${ 0.5 * strength }"/>`,
    `<path d="${ PAWN.lit }" stroke="${ lit }" stroke-width="11" stroke-linecap="round" fill="none" opacity="${ strength }"/>`,
    `<path d="${ PAWN.crown }" fill="${ shade }" opacity="${ 0.45 * strength }"/>`,
    `<path d="${ PAWN.gleam }" stroke="${ lit }" stroke-width="12" stroke-linecap="round" fill="none" opacity="${ strength }"/>`,
    `<ellipse ${ PAWN.glint }/>`,
    `<path d="${ PAWN.rim }" stroke="${ lit }" stroke-width="6" stroke-linecap="round" fill="none" opacity="${ 0.8 * strength }"/>`
];

/** The pawn's outline drawn wide and soft in `colour`, a light it gives off. */
const halo = (colour, opacity) =>
    `<g fill="none" stroke="${ colour }" stroke-width="16" stroke-linejoin="round" filter="url(#halo)" opacity="${ opacity }"><ellipse ${ PAWN.foot }/><path d="${ PAWN.body }"/><circle ${ PAWN.head }/></g>`;

const HALO = '<filter id="halo" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="5"/></filter>';

/** Nura Glow: the seat's colour as lit glass in a pale light, a rim inside its head, white and gold sparkles. */
function glow(seat)
{
    const [light, fill, dark] = SEAT_RAMPS[seat];
    const { glint, edge } = PALETTES.glow;

    return svg([
        vertical('glass', [[0, light], [0.5, fill], [1, dark]]),
        radial('bulb', [light, fill, dark], [0.38, 0.3, 0.85]),
        gloss('sheen', 0.7, [0.32, 0.2, 0.6]),
        HALO
    ], [
        halo(edge, 0.85),
        outlined({ foot: dark, base: 'url(#glass)', body: 'url(#glass)', collar: dark, head: 'url(#bulb)' }),
        '<circle cx="128" cy="62" r="46" fill="none" stroke="#FFFFFF" stroke-opacity="0.34" stroke-width="4"/>',
        ...lighting(dark, '#FFFFFF', 0.8),
        `<circle ${ PAWN.head } fill="url(#sheen)"/>`,
        `<path d="${ sparkle(152, 36, 16) }" fill="#FFFFFF"/>`,
        `<path d="${ sparkle(170, 154, 12) }" fill="${ glint }"/>`,
        `<path d="${ sparkle(98, 172, 7) }" fill="#FFFFFF" opacity="0.9"/>`,
        `<path d="${ sparkle(164, 86, 5) }" fill="${ edge }"/>`
    ]);
}

/** Shiraz Garden: the seat's colour glazed, gold at its foot and collar, a girih star on its front. */
function shiraz(seat)
{
    const [light, fill, dark] = SEAT_RAMPS[seat];
    const { edge, glint, piece } = PALETTES.shiraz;

    return svg([
        vertical('glaze', [[0, light], [0.45, fill], [1, dark]]),
        radial('dome', [light, fill, dark], [0.4, 0.32, 0.85]),
        vertical('gold', [[0, glint], [0.5, edge], [1, '#9A6B1E']])
    ], [
        outlined({ foot: 'url(#gold)', base: 'url(#gold)', body: 'url(#glaze)', collar: 'url(#gold)', head: 'url(#dome)' }),
        ...lighting(dark, '#FFFFFF', 0.6),
        `<path d="${ octagram(128, 160, 25) }" fill="${ piece[1] }" stroke="${ edge }" stroke-width="4" stroke-linejoin="round"/>`,
        `<circle cx="128" cy="160" r="7.5" fill="${ glint }" stroke="${ edge }" stroke-width="2.5"/>`,
        `<path d="M150 22L156 36L170 40M156 36L152 50" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<path d="M84 74A46 46 0 0 0 108 104" stroke="${ edge }" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.85"/>`
    ]);
}

/** Midnight Neon: obsidian outlined in the seat's colour as a lit tube, its head lit from inside. */
function neon(seat)
{
    const [light, fill] = SEAT_RAMPS[seat];
    const { piece, glint } = PALETTES.neon;

    return svg([
        vertical('obsidian', [[0, piece[0]], [0.45, piece[1]], [1, piece[2]]]),
        `<radialGradient id="core" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ fill }" stop-opacity="0.95"/><stop offset="0.55" stop-color="${ fill }" stop-opacity="0.38"/><stop offset="1" stop-color="${ fill }" stop-opacity="0"/></radialGradient>`,
        HALO
    ], [
        halo(fill, 0.8),
        outlined({ foot: piece[2], base: 'url(#obsidian)', body: 'url(#obsidian)', collar: piece[2], head: 'url(#obsidian)' }, fill),
        '<circle cx="128" cy="62" r="42" fill="url(#core)"/>',
        `<circle cx="128" cy="62" r="27" fill="none" stroke="${ glint }" stroke-width="6" filter="url(#halo)"/>`,
        `<circle cx="128" cy="62" r="27" fill="none" stroke="${ glint }" stroke-width="3.5"/>`,
        ...lighting('#000000', light, 0.75)
    ]);
}

/** Royal Gold: the seat's colour in enamel, set in polished gold at its foot, collar and head. */
function gold(seat)
{
    const [light, fill, dark] = SEAT_RAMPS[seat];
    const { piece, glint } = PALETTES.gold;

    return svg([
        vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        radial('dome', [light, fill, dark], [0.4, 0.32, 0.85]),
        vertical('gold', [[0, piece[0]], [0.45, piece[1]], [1, piece[2]]])
    ], [
        outlined({ foot: 'url(#gold)', base: 'url(#gold)', body: 'url(#enamel)', collar: 'url(#gold)', head: 'url(#dome)' }),
        '<circle cx="128" cy="62" r="49" fill="none" stroke="url(#gold)" stroke-width="7"/>',
        ...lighting(dark, '#FFFFFF', 0.6),
        '<path d="M128 134C114 142 111 158 123 162C133 165 138 154 130 150M128 134C142 142 145 158 133 162" stroke="url(#gold)" stroke-width="5" fill="none" stroke-linecap="round"/>',
        `<path d="${ sparkle(152, 30, 10) }" fill="${ glint }"/>`
    ]);
}

const DRAW = { glow, shiraz, neon, gold };

mkdirSync(OUT, { recursive: true });

for (const name of readdirSync(OUT))
{
    rmSync(join(OUT, name));
}

for (const collection of SHOP_COLLECTIONS)
{
    for (const seat of Object.keys(SEAT_RAMPS))
    {
        writeFileSync(join(OUT, `${ collection }-${ seat }.svg`), DRAW[collection](seat));
    }
}

console.log(`table looks: ${ readdirSync(OUT).length } pawns`);

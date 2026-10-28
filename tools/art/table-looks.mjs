/**
 * Draws what a table shows of its owner's looks, from each collection's palette, on the board's own
 * pieces so a look stands exactly where the classic one does: a ludo pawn in every collection for
 * every seat's colour (`public/pawns/<collection>-<colour>.svg`), the seat's colour kept wherever a
 * board is read for whose pawn it is; every collection's deck (`public/decks/`, the classic cards
 * in its dress, the standard indices kept) and card back (`public/backs/`); and its yard
 * (`public/yards/`), laid over its owner's corner of the Ludo board. `npm run looks` runs it.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { PALETTES, SEAT_RAMPS } from '../../frontend/src/game/looks/palette.ts';
import { cardBack, HALO } from './card-back.mjs';
import { H, W, deck } from './card-parts.mjs';
import { LEGENDARY } from './legendary/index.mjs';
import { gloss, motif, octagram, polygon, radial, sparkle, starOf } from './look-parts.mjs';
import { PAWN, outlined } from './pawn-shape.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public');

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

/**
 * Each collection's deck: its paper, its suits' inks (red kept warm and black kept cool, each index
 * at 4.5:1 or more on both stops of its paper) and the metal of its courts.
 */
const DRESSES = {
    glow: {
        paper: ['#FFFFFF', '#E9F1FF'],
        suits: [
            { name: 'club', ink: '#14205A', tint: '#E8EFFF', accent: '#1B3480' },
            { name: 'diamond', ink: '#C81E3A', tint: '#FDECEF', accent: '#9E1630' },
            { name: 'heart', ink: '#C81E3A', tint: '#FDECEF', accent: '#9E1630' },
            { name: 'spade', ink: '#14205A', tint: '#E8EFFF', accent: '#1B3480' }
        ],
        metal: { band: '#FBE7A6', line: '#B08A2E', frame: '#9CC2FF', crown: '#FBE7A6', jewel: '#FFFFFF' }
    },
    shiraz: {
        paper: ['#FFFBEB', '#F3E9CF'],
        suits: [
            { name: 'club', ink: '#0A3F63', tint: '#E2F5F1', accent: '#0D5B7C' },
            { name: 'diamond', ink: '#B3263A', tint: '#FBEAE6', accent: '#8E1A2C' },
            { name: 'heart', ink: '#B3263A', tint: '#FBEAE6', accent: '#8E1A2C' },
            { name: 'spade', ink: '#0A3F63', tint: '#E2F5F1', accent: '#0D5B7C' }
        ],
        metal: { band: '#E7BE63', line: '#8C6A1C', frame: '#18A8A0', crown: '#E7BE63', jewel: '#FFF4D6' }
    },
    neon: {
        paper: ['#1B1333', '#0C0719'],
        suits: [
            { name: 'club', ink: '#38E8FF', tint: '#1E1640', accent: '#16B7D6' },
            { name: 'diamond', ink: '#FF5FD8', tint: '#2A1236', accent: '#E040B8' },
            { name: 'heart', ink: '#FF5FD8', tint: '#2A1236', accent: '#E040B8' },
            { name: 'spade', ink: '#38E8FF', tint: '#1E1640', accent: '#16B7D6' }
        ],
        metal: { band: '#FF46D2', line: '#7A1E6A', frame: '#38E8FF', crown: '#FF46D2', jewel: '#FFFFFF' }
    },
    gold: {
        paper: ['#1E180D', '#0D0A05'],
        suits: [
            { name: 'club', ink: '#E9C565', tint: '#2A2213', accent: '#B8902E' },
            { name: 'diamond', ink: '#F26B57', tint: '#2E1610', accent: '#C84A38' },
            { name: 'heart', ink: '#F26B57', tint: '#2E1610', accent: '#C84A38' },
            { name: 'spade', ink: '#E9C565', tint: '#2A2213', accent: '#B8902E' }
        ],
        metal: { band: '#E9C565', line: '#7C5913', frame: '#D9B044', crown: '#FFF3BF', jewel: '#FFFAE6' }
    }
};

/** What every card of a collection's deck wears on its paper, in the corners its indices leave free. */
const ORNAMENTS = {
    glow: `<path d="${ sparkle(W - 26, 26, 9) }" fill="#9CC2FF" opacity="0.55"/><path d="${ sparkle(26, H - 26, 9) }" fill="#9CC2FF" opacity="0.55"/>`,
    shiraz: `<path d="${ octagram(W - 26, 26, 9) }" fill="none" stroke="#18A8A0" stroke-opacity="0.5" stroke-width="1.6"/><path d="${ octagram(26, H - 26, 9) }" fill="none" stroke="#18A8A0" stroke-opacity="0.5" stroke-width="1.6"/>`,
    neon: `<rect x="7" y="7" width="${ W - 14 }" height="${ H - 14 }" rx="9" fill="none" stroke="#38E8FF" stroke-opacity="0.4" stroke-width="1.5"/>`,
    gold: `<rect x="8" y="8" width="${ W - 16 }" height="${ H - 16 }" rx="8" fill="none" stroke="#D9B044" stroke-opacity="0.55" stroke-width="1.5"/>`
};

/** Each collection's back: its border, and the emblem at its middle. */
const BACKS = {
    glow: {
        border: '#F2F7FF',
        emblem: (palette) => `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="46" fill="${ palette.surface[2] }" stroke="${ palette.edge }" stroke-width="3"/><path d="${ sparkle(W / 2, H / 2, 34) }" fill="${ palette.glint }"/><path d="${ sparkle(W / 2 + 24, H / 2 - 22, 8) }" fill="#FFFFFF"/>`
    },
    shiraz: {
        border: '#FFFBEB',
        emblem: (palette) => `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="46" fill="${ palette.surface[2] }" stroke="${ palette.edge }" stroke-width="3"/><path d="${ starOf(W / 2, H / 2, 36, 18, 8) }" fill="${ palette.edge }" stroke="${ palette.glint }" stroke-width="1.2"/><circle cx="${ W / 2 }" cy="${ H / 2 }" r="9" fill="${ palette.piece[1] }" stroke="${ palette.glint }" stroke-width="2"/>`
    },
    neon: {
        border: '#0A0616',
        emblem: (palette) => `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="40" fill="none" stroke="${ palette.glint }" stroke-width="7" filter="url(#halo)"/><circle cx="${ W / 2 }" cy="${ H / 2 }" r="40" fill="none" stroke="${ palette.glint }" stroke-width="3"/><path d="M${ W / 2 } ${ H / 2 - 22 }L${ W / 2 + 22 } ${ H / 2 }L${ W / 2 } ${ H / 2 + 22 }L${ W / 2 - 22 } ${ H / 2 }Z" fill="none" stroke="${ palette.edge }" stroke-width="3" filter="url(#halo)"/><path d="M${ W / 2 } ${ H / 2 - 22 }L${ W / 2 + 22 } ${ H / 2 }L${ W / 2 } ${ H / 2 + 22 }L${ W / 2 - 22 } ${ H / 2 }Z" fill="none" stroke="${ palette.edge }" stroke-width="2"/>`
    },
    gold: {
        border: '#0D0A05',
        emblem: (palette) => `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="none" stroke="${ palette.edge }" stroke-width="3"/><circle cx="${ W / 2 }" cy="${ H / 2 }" r="41" fill="none" stroke="${ palette.edge }" stroke-opacity="0.5" stroke-width="1.2"/><path d="${ starOf(W / 2, H / 2, 32, 14, 12) }" fill="${ palette.edge }" stroke="${ palette.piece[2] }" stroke-width="1"/><circle cx="${ W / 2 }" cy="${ H / 2 }" r="6" fill="${ palette.surface[2] }" stroke="${ palette.glint }" stroke-width="2"/>`
    }
};

/** A collection's card back: its own module's border and emblem, or the one drawn here. */
function back(collection)
{
    const palette = PALETTES[collection];
    const { border, emblem } = LEGENDARY[collection]?.back ?? BACKS[collection];

    return cardBack(palette, border, emblem(palette, W, H));
}

/** Empties `folder` under public/ and writes what `draw` gives for each name. */
const write = (folder, entries) =>
{
    const into = join(PUBLIC, folder);

    mkdirSync(into, { recursive: true });

    for (const name of readdirSync(into))
    {
        rmSync(join(into, name));
    }

    for (const [name, drawing] of entries)
    {
        writeFileSync(join(into, `${ name }.svg`), drawing);
    }

    return entries.length;
};

/** What a legendary collection's pawn is drawn with: the pawn's own shapes and light, and every palette. */
const KIT = { svg, vertical, radial, outlined, lighting, SEAT_RAMPS, PALETTES };

const pawnOf = (collection, seat) => LEGENDARY[collection]?.pawn(seat, KIT) ?? DRAW[collection](seat);

/** A collection's deck; a legendary one's corner ornament is drawn once and used on every card. */
const deckOf = (collection) =>
{
    const line = LEGENDARY[collection];
    return line === undefined
        ? deck(DRESSES[collection], { ornament: ORNAMENTS[collection] })
        : deck(line.dress, { ornament: '<use href="#ornament"/>', defs: `<g id="ornament">${ line.ornament(W, H) }</g>` });
};

/** A yard's square on the board (`public/board/ludo-board.svg`): this many across, its corners this round, its nest this far out from its middle. */
const YARD = { size: 334, round: 33.28, nest: 104 };

/** The ink every line of the board is drawn in, under a yard's own lines so they read on any seat's colour. */
const BOARD_INK = '#2A1E5C';

/** The sign a classic collection's yard wears in its nest, as the shop's drawing of it does. */
const SIGNS = {
    glow: (palette, mid) => `<path d="${ sparkle(mid, mid, 24) }" fill="${ palette.glint }" stroke="${ BOARD_INK }" stroke-width="2.5" stroke-linejoin="round"/><path d="${ sparkle(mid + 20, mid - 18, 7) }" fill="${ palette.edge }"/>`,
    shiraz: (palette, mid) => `<path d="${ starOf(mid, mid, 25, 11, 8) }" fill="${ palette.edge }" stroke="${ BOARD_INK }" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${ mid }" cy="${ mid }" r="5" fill="${ palette.glint }"/>`,
    neon: (palette, mid) => `<path d="${ polygon(mid, mid, 22, 4, 0) }" fill="${ palette.surface[1] }" stroke="${ palette.glint }" stroke-width="4" stroke-linejoin="round"/><path d="${ polygon(mid, mid, 11, 4, 0) }" fill="none" stroke="${ palette.edge }" stroke-width="3"/>`,
    gold: (palette, mid) => `<circle cx="${ mid }" cy="${ mid }" r="20" fill="none" stroke="${ BOARD_INK }" stroke-width="6"/><circle cx="${ mid }" cy="${ mid }" r="20" fill="none" stroke="${ palette.edge }" stroke-width="3.5"/><circle cx="${ mid }" cy="${ mid }" r="8" fill="${ palette.edge }" stroke="${ BOARD_INK }" stroke-width="2"/>`
};

/**
 * A collection's yard, laid over its owner's corner of the board: its motif over the seat's colour,
 * which shows through, a frame inside the yard's edge and a ring round the nest, each drawn in the
 * board's ink under the collection's edge so it reads on red, green, yellow and blue alike, and its
 * sign in the nest's middle, where no pawn stands. The nest and its four wells are left as the
 * board draws them.
 */
function yard(collection)
{
    const palette = PALETTES[collection];
    const { size, round, nest } = YARD;
    const mid = size / 2;
    const sign = LEGENDARY[collection]?.emblem(palette, mid, mid, 68, 'yard-sign') ?? { defs: [], body: [SIGNS[collection](palette, mid)] };
    const frame = (inset, width, colour, opacity) => `<rect x="${ inset }" y="${ inset }" width="${ size - inset * 2 }" height="${ size - inset * 2 }" rx="${ round - inset * 0.8 }" fill="none" stroke="${ colour }" stroke-width="${ width }" stroke-opacity="${ opacity }"/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ size } ${ size }" width="${ size }" height="${ size }">
<defs>
    ${ motif('motif', palette, 2.1) }
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.72"><stop offset="0.55" stop-color="${ palette.surface[2] }" stop-opacity="0"/><stop offset="1" stop-color="${ palette.surface[2] }" stop-opacity="0.34"/></radialGradient>
    <mask id="ground"><rect width="${ size }" height="${ size }" fill="#FFFFFF"/><circle cx="${ mid }" cy="${ mid }" r="${ nest + 9 }" fill="#000000"/></mask>
    <clipPath id="square"><rect width="${ size }" height="${ size }" rx="${ round }"/></clipPath>
    ${ sign.defs.join('') }
</defs>
<g clip-path="url(#square)">
    <rect width="${ size }" height="${ size }" fill="url(#vignette)" mask="url(#ground)"/>
    <rect width="${ size }" height="${ size }" fill="url(#motif)" opacity="0.9" mask="url(#ground)"/>
    ${ frame(12, 6, BOARD_INK, 0.35) }
    ${ frame(12, 3, palette.edge, 0.95) }
    ${ frame(20, 1.4, palette.edge, 0.55) }
</g>
<circle cx="${ mid }" cy="${ mid }" r="${ nest + 6 }" fill="none" stroke="${ BOARD_INK }" stroke-width="6" stroke-opacity="0.45"/>
<circle cx="${ mid }" cy="${ mid }" r="${ nest + 6 }" fill="none" stroke="${ palette.edge }" stroke-width="3.5"/>
${ sign.body.join('') }
</svg>
`;
}

const pawns = write('pawns', SHOP_COLLECTIONS.flatMap((collection) => Object.keys(SEAT_RAMPS).map((seat) => [`${ collection }-${ seat }`, pawnOf(collection, seat)])));
const decks = write('decks', SHOP_COLLECTIONS.map((collection) => [collection, deckOf(collection)]));
const backs = write('backs', SHOP_COLLECTIONS.map((collection) => [collection, back(collection)]));
const yards = write('yards', SHOP_COLLECTIONS.map((collection) => [collection, yard(collection)]));

console.log(`table looks: ${ pawns } pawns, ${ decks } decks, ${ backs } backs, ${ yards } yards`);

/**
 * Draws what a table shows of its owner's looks, from each collection's palette, on the board's own
 * pieces so a look stands exactly where the classic one does: a ludo pawn in every collection for
 * every seat's colour (`public/pawns/<collection>-<colour>.svg`), the seat's colour kept wherever a
 * board is read for whose pawn it is; every collection's deck (`public/decks/`, the classic cards
 * in its dress, the standard indices kept) and card back (`public/backs/`); its yard
 * (`public/yards/`), laid over its owner's corner of the Ludo board; its felt (`public/felts/`),
 * the mat in front of its owner's seat at Hokm and poker; its backgammon checkers for either side of
 * a board (`public/checkers/<collection>-<light|dark>.svg`), on the board's own checker; its
 * home board (`public/homes/`), the six points of its owner's home on the board's own points; and
 * its chess set (`public/pieces/<collection>-<w|b><kind>.svg`, drawn by `chess-looks.mjs`) on the
 * classic set's footprint. `npm run looks` runs it.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { MIDDLE, POINT_HEIGHT, POINT_WIDTH, TOP } from '../../frontend/src/game/backgammon-layout.ts';
import { PALETTES, SEAT_RAMPS } from '../../frontend/src/game/looks/palette.ts';
import { cardBack, HALO } from './card-back.mjs';
import { H, W, deck } from './card-parts.mjs';
import { KINDS, piece } from './chess-looks.mjs';
import { LEGENDARY } from './legendary/index.mjs';
import { clothOf, gloss, motif, octagram, polygon, r2, radial, sparkle, starOf } from './look-parts.mjs';
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

/** A felt's mat across, its edge, and the ring engraved in it, which the stylesheet's light runs round at 84% of its radius. */
const MAT = { size: 400, rim: 186, ring: 168 };

/** The ink a felt's lines are cut in, a shadow under each line. */
const ENGRAVE = '#050A08';

/**
 * A collection's felt: the mat a card table's cloth shows in front of its owner's seat. It is
 * round, so the same mat lies under a seat on any side of a table, and the table shows what of it
 * is on its cloth. Its cloth with the cloth's grain, its motif embroidered thick round its border
 * and fading toward its middle, which the owner's plate covers; an engraved ring in its edge with
 * a dashed line inside it and studs of its glint round it, a fine line at its rim and a shadow
 * outside it, where it lies on the table's own cloth.
 */
function mat(collection)
{
    const palette = PALETTES[collection];
    const cloth = clothOf(palette);
    const { size, rim, ring } = MAT;
    const mid = size / 2;
    const at = (radius) => radius / (size / 2);
    const circle = (r, rest) => `<circle cx="${ mid }" cy="${ mid }" r="${ r }" ${ rest }/>`;
    const studs = Array.from({ length: 16 }, (_, step) =>
    {
        const turn = step * 22.5;
        const angle = turn * Math.PI / 180;

        return `<path d="${ polygon(r2(mid + ring * Math.cos(angle)), r2(mid + ring * Math.sin(angle)), step % 2 === 0 ? 7.5 : 4.5, 4, turn) }" fill="${ palette.glint }" stroke="${ ENGRAVE }" stroke-width="1.6" stroke-linejoin="round"/>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ size } ${ size }" width="${ size }" height="${ size }">
<defs>
    ${ motif('motif', palette, 1.7) }
    <radialGradient id="shadow"><stop offset="${ r2(at(rim) - 0.02) }" stop-color="#000000" stop-opacity="0.5"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>
    <radialGradient id="ground"><stop offset="0" stop-color="${ cloth[0] }"/><stop offset="0.42" stop-color="${ cloth[1] }"/><stop offset="1" stop-color="${ cloth[2] }"/></radialGradient>
    <radialGradient id="border"><stop offset="0.38" stop-color="#000000"/><stop offset="0.74" stop-color="#5A5A5A"/><stop offset="${ r2(at(ring) + 0.02) }" stop-color="#FFFFFF"/><stop offset="${ r2(at(rim) - 0.01) }" stop-color="#FFFFFF"/><stop offset="${ r2(at(rim)) }" stop-color="#000000"/></radialGradient>
    <radialGradient id="lit"><stop offset="${ r2(at(ring) - 0.07) }" stop-color="${ palette.glint }" stop-opacity="0"/><stop offset="${ r2(at(ring)) }" stop-color="${ palette.glint }" stop-opacity="0.2"/><stop offset="${ r2(at(ring) + 0.06) }" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>
    <mask id="weave">${ circle(rim, 'fill="url(#border)"') }</mask>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.42" numOctaves="2" seed="7" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.16 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
</defs>
${ circle(mid, 'fill="url(#shadow)"') }
${ circle(rim, 'fill="url(#ground)"') }
${ circle(rim, 'fill="url(#ground)" filter="url(#grain)"') }
${ circle(rim, 'fill="url(#motif)" mask="url(#weave)"') }
${ circle(rim, 'fill="url(#lit)"') }
${ circle(ring - 16, `fill="none" stroke="${ palette.edge }" stroke-width="1.4" stroke-dasharray="2.5 5.5" stroke-opacity="0.75"`) }
${ circle(ring, `fill="none" stroke="${ ENGRAVE }" stroke-width="7.5" stroke-opacity="0.5"`) }
${ circle(ring, `fill="none" stroke="${ palette.edge }" stroke-width="3.2"`) }
${ circle(rim - 4, `fill="none" stroke="${ ENGRAVE }" stroke-width="3.5" stroke-opacity="0.4"`) }
${ circle(rim - 4, `fill="none" stroke="${ palette.edge }" stroke-width="1.3" stroke-opacity="0.6"`) }
${ studs.join('\n') }
</svg>
`;
}

/**
 * What the collections the shop opened with draw at a backgammon table, as a legendary
 * collection's module does (`board`): the two tones its home board's points take by turns, a
 * checker's rim and the sign in its middle (a legendary collection's is its emblem), what runs
 * down a point and the ornament at its tip. Each sign is the one on the collection's sigil, cut
 * in the dark of its set under its own colours so it reads on a light checker and a dark one.
 */
const BOARDS = {
    glow: {
        sign: (palette, cx, cy, size) => ({
            defs: [`<radialGradient id="sign-halo"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.55"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>`],
            body: [
                `<circle cx="${ cx }" cy="${ cy }" r="${ r2(size * 0.95) }" fill="url(#sign-halo)"/>`,
                `<path d="${ sparkle(cx, cy, size) }" fill="${ palette.glint }" stroke="${ palette.deep[1] }" stroke-width="1.4" stroke-linejoin="round"/>`,
                `<path d="${ sparkle(cx + size * 0.9, cy - size * 0.85, size * 0.32) }" fill="#FFFFFF" stroke="${ palette.deep[1] }" stroke-width="0.8" stroke-linejoin="round"/>`,
                `<path d="${ sparkle(cx - size * 0.8, cy + size * 0.9, size * 0.24) }" fill="${ palette.edge }"/>`
            ]
        }),
        tones: [['#3A62C8', '#2448A8', '#0A1640'], ['#6A9AF0', '#4A7FE8', '#1B3480']],
        rim: (round, light, palette) => Array.from({ length: 8 }, (_, nth) =>
        {
            const [x, y] = round(60.2, nth * 45);
            return `<path d="${ sparkle(x, y, nth % 2 === 0 ? 3 : 2) }" fill="${ light ? palette.glint : '#FFFFFF' }"/>`;
        }).join(''),
        vein: ({ x, top, bottom }, palette) => [[0.2, 4], [0.46, 3], [0.7, 2.2]].map(([along, size], nth) =>
            `<path d="${ sparkle(x, bottom - (bottom - top) * along, size) }" fill="${ nth === 0 ? palette.glint : '#FFFFFF' }" opacity="0.9"/>`).join(''),
        tip: (x, y, palette) => `<path d="${ sparkle(x, y - 12, 12) }" fill="${ palette.glint }" stroke="${ BOARD_INK }" stroke-width="1.2" stroke-linejoin="round"/><path d="${ sparkle(x + 9, y - 22, 4) }" fill="#FFFFFF"/>`
    },
    shiraz: {
        sign: (palette, cx, cy, size) => ({
            defs: [],
            body: [
                `<path d="${ starOf(cx, cy, size, size * 0.45, 8) }" fill="${ palette.surface[2] }" stroke="${ palette.edge }" stroke-width="1.8" stroke-linejoin="round"/>`,
                `<path d="${ octagram(cx, cy, size * 0.52) }" fill="none" stroke="${ palette.edge }" stroke-width="1.1"/>`,
                `<circle cx="${ cx }" cy="${ cy }" r="${ r2(size * 0.17) }" fill="${ palette.glint }"/>`
            ]
        }),
        tones: [['#2FC4BA', '#14A098', '#0B4F63'], ['#2A92C2', '#156E9C', '#06284A']],
        rim: (round, light, palette) => Array.from({ length: 12 }, (_, nth) =>
        {
            const [x, y] = round(60.2, nth * 30);
            return `<path d="${ octagram(x, y, 2.2) }" fill="${ light ? palette.edge : palette.deep[1] }"/>`;
        }).join(''),
        vein: ({ x, top, bottom }, palette) => [0.2, 0.44, 0.66].map((along, nth) =>
            `<path d="${ octagram(x, bottom - (bottom - top) * along, 5 - nth * 1.1) }" fill="none" stroke="${ palette.edge }" stroke-width="1" stroke-linejoin="round" opacity="0.9"/>`).join(''),
        tip: (x, y, palette) => `<path d="${ starOf(x, y - 12, 11, 5, 8) }" fill="${ palette.edge }" stroke="${ BOARD_INK }" stroke-width="1.2" stroke-linejoin="round"/><circle cx="${ r2(x) }" cy="${ r2(y - 12) }" r="2.4" fill="${ palette.glint }"/>`
    },
    neon: {
        sign: (palette, cx, cy, size) => ({
            defs: [],
            body: [
                `<g fill="none" filter="url(#bg-glow)" opacity="0.8"><path d="${ polygon(cx, cy, size, 4, 0) }" stroke="${ palette.edge }" stroke-width="3.4"/><path d="${ polygon(cx, cy, size * 0.6, 4, 0) }" stroke="${ palette.glint }" stroke-width="2.6"/></g>`,
                `<path d="${ polygon(cx, cy, size, 4, 0) }" fill="${ palette.surface[1] }" stroke="${ palette.edge }" stroke-width="2.4" stroke-linejoin="round"/>`,
                `<path d="${ polygon(cx, cy, size * 0.6, 4, 0) }" fill="none" stroke="${ palette.glint }" stroke-width="2" stroke-linejoin="round"/>`
            ]
        }),
        tones: [['#32245A', '#160E2B', '#07040F'], ['#32245A', '#160E2B', '#07040F']],
        edges: ['#FF46D2', '#38E8FF'],
        glowing: true,
        rim: (round, light, palette) => `<circle cx="64" cy="64" r="60.2" fill="none" stroke="${ light ? palette.glint : '#FFFFFF' }" stroke-width="${ light ? 1.4 : 1 }" opacity="0.85"/>`,
        vein: ({ x, top, bottom, half }, palette, nth) =>
        {
            const colour = nth % 2 === 0 ? palette.glint : palette.edge;
            const inset = (y) => half(y) * 0.5;
            return `<path d="M${ r2(x - inset(bottom - 10)) } ${ r2(bottom - 10) }L${ r2(x) } ${ r2(top + 30) }L${ r2(x + inset(bottom - 10)) } ${ r2(bottom - 10) }" fill="none" stroke="${ colour }" stroke-width="1.3" stroke-linejoin="round" opacity="0.8"/>`;
        },
        tip: (x, y, palette, nth) => `<path d="${ polygon(x, y - 12, 8, 4, 90) }" fill="none" stroke="${ nth % 2 === 0 ? palette.edge : palette.glint }" stroke-width="3" filter="url(#bg-glow)"/><path d="${ polygon(x, y - 12, 8, 4, 90) }" fill="${ palette.surface[1] }" stroke="${ nth % 2 === 0 ? palette.edge : palette.glint }" stroke-width="1.6"/>`
    },
    gold: {
        sign: (palette, cx, cy, size) =>
        {
            const leaf = `M${ cx } ${ r2(cy - size) }C${ r2(cx + size * 0.5) } ${ r2(cy - size * 0.5) } ${ r2(cx + size * 0.5) } ${ r2(cy + size * 0.5) } ${ cx } ${ r2(cy + size) }C${ r2(cx - size * 0.5) } ${ r2(cy + size * 0.5) } ${ r2(cx - size * 0.5) } ${ r2(cy - size * 0.5) } ${ cx } ${ r2(cy - size) }ZM${ r2(cx - size) } ${ cy }C${ r2(cx - size * 0.4) } ${ r2(cy - size * 0.35) } ${ r2(cx + size * 0.4) } ${ r2(cy - size * 0.35) } ${ r2(cx + size) } ${ cy }C${ r2(cx + size * 0.4) } ${ r2(cy + size * 0.35) } ${ r2(cx - size * 0.4) } ${ r2(cy + size * 0.35) } ${ r2(cx - size) } ${ cy }Z`;
            const ring = `<circle cx="${ cx }" cy="${ cy }" r="${ r2(size * 0.55) }"/>`;
            return {
                defs: [],
                body: [
                    `<g fill="none" stroke="${ palette.deep[1] }" stroke-width="4" stroke-linejoin="round"><path d="${ leaf }"/>${ ring }</g>`,
                    `<g fill="none" stroke="${ palette.edge }" stroke-width="2" stroke-linejoin="round"><path d="${ leaf }"/>${ ring }</g>`,
                    `<circle cx="${ cx }" cy="${ cy }" r="${ r2(size * 0.2) }" fill="${ palette.glint }" stroke="${ palette.deep[1] }" stroke-width="1.2"/>`
                ]
            };
        },
        tones: [['#FFF3BF', '#D9B044', '#7C5913'], ['#3A3020', '#1A140B', '#070503']],
        rim: (round, light, palette) => Array.from({ length: 28 }, (_, nth) =>
        {
            const [x, y] = round(60.2, nth * 360 / 28);
            return `<ellipse cx="${ x }" cy="${ y }" rx="1.9" ry="0.8" fill="${ light ? palette.edge : palette.deep[2] }" opacity="0.8" transform="rotate(${ r2(nth * 360 / 28 + 45) } ${ x } ${ y })"/>`;
        }).join(''),
        vein: ({ x, top, bottom }, palette, nth) =>
        {
            const ink = nth % 2 === 0 ? palette.piece[2] : palette.edge;
            const curl = (y, side) => `M${ r2(x) } ${ r2(y) }c${ r2(side * 6) } -3 ${ r2(side * 7) } -10 ${ r2(side * 2) } -12c${ r2(side * -3) } -1 ${ r2(side * -4) } 2 ${ r2(side * -2) } 4`;
            return `<path d="M${ r2(x) } ${ r2(bottom - 12) }V${ r2(top + 36) }${ [0.24, 0.5].map((along, step) => curl(bottom - (bottom - top) * along, step % 2 === 0 ? 1 : -1)).join('') }" fill="none" stroke="${ ink }" stroke-width="1.2" stroke-linecap="round" opacity="0.85"/>`;
        },
        tip: (x, y, palette) => `<path d="M${ r2(x) } ${ r2(y - 26) }C${ r2(x + 7) } ${ r2(y - 15) } ${ r2(x + 6) } ${ r2(y - 6) } ${ r2(x) } ${ r2(y - 5) }C${ r2(x - 6) } ${ r2(y - 6) } ${ r2(x - 7) } ${ r2(y - 15) } ${ r2(x) } ${ r2(y - 26) }Z" fill="${ palette.edge }" stroke="${ BOARD_INK }" stroke-width="1.2"/><circle cx="${ r2(x) }" cy="${ r2(y - 11) }" r="2.2" fill="${ palette.surface[2] }"/>`
    }
};

/** A collection's backgammon art: its module's, or the one drawn here. */
const boardOf = (collection) => LEGENDARY[collection]?.board ?? BOARDS[collection];

/** A point round a checker's middle, `r` out and a turn of 0 at the top, going clockwise. */
const round = (r, turn) =>
{
    const angle = (turn - 90) * Math.PI / 180;
    return [r2(64 + r * Math.cos(angle)), r2(64 + r * Math.sin(angle))];
};

/** `share` of the way from one colour to another. */
const toward = (one, other, share) => `#${ [1, 3, 5].map((at) => Math.round(Number.parseInt(one.slice(at, at + 2), 16) * (1 - share) + Number.parseInt(other.slice(at, at + 2), 16) * share).toString(16).padStart(2, '0')).join('').toUpperCase() }`;

/** A checker in a 128 square, which the board's checker fills: its rim, its face, the groove inlaid in it and its sign, as wide as a legendary emblem's `size` or a classic sign's reach. */
const DISC = { size: 128, rim: 63.5, face: 56.5, groove: 41, emblem: 46, sign: 22 };

/**
 * A collection's checker, light or dark as its owner's side is: its face in the collection's pale or
 * deep material under its pattern, a bevelled rim in the colour that stands out from it (the deep
 * one round a light checker, the edge round a dark one) with the collection's own work on it, a
 * groove inlaid round the middle, and its sign there in its own colours, lifted off the face by a
 * soft shadow and, on a dark checker, lit from behind.
 */
function checker(collection, tone)
{
    const palette = PALETTES[collection];
    const light = tone === 'light';
    const ramp = light ? palette.pale : palette.deep;
    const ring = light ? palette.deep[1] : palette.edge;
    const style = boardOf(collection);
    const { size, rim, face, groove } = DISC;
    const mid = size / 2;
    const sign = LEGENDARY[collection]?.emblem(palette, mid, mid, DISC.emblem, 'sign') ?? style.sign(palette, mid, mid, DISC.sign);
    const circle = (r, rest) => `<circle cx="${ mid }" cy="${ mid }" r="${ r }" ${ rest }/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ size } ${ size }" width="${ size }" height="${ size }">
<defs>
    ${ radial('face', ramp, [0.36, 0.3, 0.78]) }
    <linearGradient id="rim" x1="0.15" y1="0.1" x2="0.85" y2="0.9"><stop offset="0" stop-color="${ toward(ring, '#FFFFFF', 0.42) }"/><stop offset="0.5" stop-color="${ ring }"/><stop offset="1" stop-color="${ toward(ring, '#000000', 0.45) }"/></linearGradient>
    ${ motif('motif', palette, 0.9) }
    ${ gloss('gloss', light ? 0.55 : 0.32, [0.32, 0.24, 0.6]) }
    <radialGradient id="lit"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.42"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#000000" flood-opacity="${ light ? 0.3 : 0.55 }"/></filter>
    <filter id="bg-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>
    ${ (style.defs?.(palette) ?? []).join('') }
    ${ sign.defs.join('') }
</defs>
${ circle(rim, 'fill="url(#rim)"') }
${ style.rim(round, light, palette) }
${ circle(face, 'fill="url(#face)"') }
${ circle(face, `fill="url(#motif)" opacity="${ light ? 0.22 : 0.4 }"`) }
${ circle(face, `fill="none" stroke="${ toward(ring, '#000000', 0.55) }" stroke-width="1.4" opacity="0.7"`) }
${ circle(rim - 0.5, `fill="none" stroke="${ toward(ring, '#000000', 0.6) }" stroke-width="1"`) }
${ circle(groove + 1.4, 'fill="none" stroke="#FFFFFF" stroke-width="0.9" opacity="0.35"') }
${ circle(groove, `fill="none" stroke="${ ring }" stroke-width="2.6" opacity="0.8"`) }
${ light ? '' : circle(34, 'fill="url(#lit)"') }
<g filter="url(#lift)">${ sign.body.join('') }</g>
${ circle(face, 'fill="url(#gloss)"') }
</svg>
`;
}

/** A home board, laid over its owner's quarter of the field: six points as wide and as tall as the board's own (`game/backgammon-layout.ts`). */
const QUARTER = { wide: POINT_WIDTH * 6, high: MIDDLE - TOP, point: POINT_HEIGHT };

/** The ink a home board's lines are cut in, under the collection's edge, so they read on the board's cream field. */
const POINT_INK = '#120A06';

/**
 * A collection's home board: the six points of its owner's home, each exactly where the board's own
 * point lies (drawn as the owner sees it, bottom right, the 6 point by the bar), in its two tones by
 * turns under its pattern, a bevel of light down one side and shade down the other, its work down
 * the middle, its edge cut in the board's ink under the collection's colour, and its ornament at the
 * tip; a band of the edge where the points stand. The field between them is the board's.
 */
function home(collection)
{
    const palette = PALETTES[collection];
    const style = boardOf(collection);
    const { wide, high, point } = QUARTER;
    const tip = high - point;
    const edges = style.edges ?? [palette.edge, palette.edge];
    const half = (y) => (y - tip) / point * (POINT_WIDTH / 2);

    const points = Array.from({ length: 6 }, (_, nth) =>
    {
        const left = nth * POINT_WIDTH;
        const x = left + POINT_WIDTH / 2;
        const shade = nth % 2;
        const outline = `${ r2(left) },${ r2(high) } ${ r2(left + POINT_WIDTH) },${ r2(high) } ${ r2(x) },${ r2(tip) }`;
        const edge = edges[shade];

        return [
            `<polygon points="${ outline }" fill="url(#tone-${ shade })"/>`,
            `<polygon points="${ outline }" fill="url(#motif)" opacity="${ shade === 0 ? 0.42 : 0.32 }"/>`,
            `<path d="M${ r2(left + 4) } ${ r2(high - 2) }L${ r2(x - 0.6) } ${ r2(tip + 16) }" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.22"/>`,
            `<path d="M${ r2(left + POINT_WIDTH - 4) } ${ r2(high - 2) }L${ r2(x + 0.6) } ${ r2(tip + 16) }" stroke="#000000" stroke-width="1.8" stroke-linecap="round" opacity="0.3"/>`,
            style.vein({ x, top: tip, bottom: high, half }, palette, nth),
            style.glowing === true ? `<polygon points="${ outline }" fill="none" stroke="${ edge }" stroke-width="4.5" stroke-linejoin="round" filter="url(#bg-glow)" opacity="0.75"/>` : '',
            `<polygon points="${ outline }" fill="none" stroke="${ POINT_INK }" stroke-width="4.6" stroke-linejoin="round" stroke-opacity="0.55"/>`,
            `<polygon points="${ outline }" fill="none" stroke="${ edge }" stroke-width="2" stroke-linejoin="round"/>`,
            style.tip(x, tip, palette, nth)
        ].join('');
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ r2(wide) } ${ r2(high) }" width="${ r2(wide) }" height="${ r2(high) }">
<defs>
    ${ style.tones.map((tone, shade) => `<linearGradient id="tone-${ shade }" x1="0" y1="0.2" x2="1" y2="0.6"><stop offset="0" stop-color="${ tone[0] }"/><stop offset="0.5" stop-color="${ tone[1] }"/><stop offset="1" stop-color="${ tone[2] }"/></linearGradient>`).join('\n    ') }
    ${ motif('motif', palette, 1.2) }
    <filter id="bg-glow" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="2.6"/></filter>
    ${ (style.defs?.(palette) ?? []).join('') }
</defs>
${ points.join('\n') }
<rect x="0" y="${ r2(high - 4.4) }" width="${ r2(wide) }" height="4.4" fill="${ POINT_INK }" opacity="0.5"/>
<rect x="0" y="${ r2(high - 3.4) }" width="${ r2(wide) }" height="3.4" fill="${ edges[0] }"/>
</svg>
`;
}

const pawns = write('pawns', SHOP_COLLECTIONS.flatMap((collection) => Object.keys(SEAT_RAMPS).map((seat) => [`${ collection }-${ seat }`, pawnOf(collection, seat)])));
const decks = write('decks', SHOP_COLLECTIONS.map((collection) => [collection, deckOf(collection)]));
const backs = write('backs', SHOP_COLLECTIONS.map((collection) => [collection, back(collection)]));
const yards = write('yards', SHOP_COLLECTIONS.map((collection) => [collection, yard(collection)]));
const felts = write('felts', SHOP_COLLECTIONS.map((collection) => [collection, mat(collection)]));
const checkers = write('checkers', SHOP_COLLECTIONS.flatMap((collection) => ['light', 'dark'].map((tone) => [`${ collection }-${ tone }`, checker(collection, tone)])));
const homes = write('homes', SHOP_COLLECTIONS.map((collection) => [collection, home(collection)]));
const pieces = write('pieces', SHOP_COLLECTIONS.flatMap((collection) => ['w', 'b'].flatMap((colour) => KINDS.map((kind) => [`${ collection }-${ colour }${ kind }`, piece(collection, colour, kind)]))));

console.log(`table looks: ${ pawns } pawns, ${ decks } decks, ${ backs } backs, ${ yards } yards, ${ felts } felts, ${ checkers } checkers, ${ homes } home boards, ${ pieces } chess pieces`);

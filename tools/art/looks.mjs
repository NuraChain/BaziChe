/**
 * Every look the shop sells, drawn from its collection's palette (`game/looks/palette.ts`) into
 * `frontend/public/looks/<id>.svg`: layered vector shapes under one light from the upper left, a
 * rim of light on each body, a cast shadow and the collection's own pattern behind it. Nothing is
 * taken from anybody else's art. `npm run looks` writes them; the build refuses a look without one.
 * A legendary collection's looks are drawn from its own art (`legendary/`): its frame round the
 * picture, its cover, its emblem, its pawns' crest and its real card back. Each collection's sigil,
 * its emblem in a medallion of its own light, goes to `frontend/public/sigils/<collection>.svg`.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLES, LOOKS, SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { PALETTES, SEAT_RAMPS } from '../../frontend/src/game/looks/palette.ts';
import { cardBack as backArt } from './card-back.mjs';
import { H as CARD_H, W as CARD_W } from './card-parts.mjs';
import { pieceShapes } from './chess-set.mjs';
import { lineOf } from './legendary/index.mjs';
import { SUIT_PATH } from './suits.mjs';
import { gloss, linear, motif, neon, octagram, polygon, r2, radial, sparkle, starOf } from './look-parts.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public', 'looks');

const SIGILS = join(OUT, '..', 'sigils');

const W = 160;
const H = 120;

/** A drawing's ids and every reference to one, given a prefix, so a part drawn on its own can lie inside another drawing. */
const prefixed = (prefix, text) => text.replace(/id="([^"]+)"/g, `id="${ prefix }-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${ prefix }-$1)`);

/** The pawn's crest drawn in the board's 256 square, laid on the shop's own pawn, whose head is a circle of 8.4 at (0, -15.6). */
const ONTO_PAWN = 'translate(0 -15.6) scale(0.15) translate(-128 -62)';

/** What every drawing of a look shares: its ground, its pattern, the light, the shadow's blur and the neon glow. */
function stage(palette)
{
    const defs = [
        radial('ground', palette.ground, [0.5, 0.36, 0.85]),
        motif('motif', palette),
        `<radialGradient id="spot" cx="0.42" cy="0.12" r="0.78"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.2"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>`,
        '<radialGradient id="vignette" cx="0.5" cy="0.45" r="0.72"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/></radialGradient>',
        '<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>',
        '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8" result="soft"/><feMerge><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
        '<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="11" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.12 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>'
    ];

    const body = [
        `<rect width="${ W }" height="${ H }" fill="url(#ground)"/>`,
        `<rect width="${ W }" height="${ H }" fill="url(#motif)" opacity="0.13"/>`,
        `<rect width="${ W }" height="${ H }" fill="url(#spot)"/>`
    ];

    return { defs, body, over: `<rect width="${ W }" height="${ H }" fill="url(#vignette)"/>` };
}

const shadow = (cx, cy, rx, ry, opacity = 0.5) =>
    `<ellipse cx="${ cx }" cy="${ cy }" rx="${ rx }" ry="${ ry }" fill="#000000" opacity="${ opacity }" filter="url(#blur)"/>`;

// ---------------------------------------------------------------- dice

const PIPS = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
};

function die(palette, id, x, y, size, turn, value)
{
    const half = size / 2;
    const step = size * 0.27;
    const pip = size * 0.085;
    const glowing = neon(palette) ? ' filter="url(#glow)"' : '';

    const defs = [
        linear(`${ id }-face`, palette.die.face),
        `<linearGradient id="${ id }-side" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ palette.die.face[1] }"/><stop offset="1" stop-color="${ palette.die.face[2] }"/></linearGradient>`,
        gloss(`${ id }-gloss`, neon(palette) ? 0.18 : 0.55),
        `<radialGradient id="${ id }-pip" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="${ palette.die.pip }" stop-opacity="0.72"/><stop offset="1" stop-color="${ palette.die.pip }"/></radialGradient>`
    ];

    const pips = PIPS[value].map(([px, py]) =>
        `<circle cx="${ r2(px * step) }" cy="${ r2(py * step) }" r="${ r2(pip) }" fill="url(#${ id }-pip)"${ glowing }/>`).join('');

    const body = [
        shadow(x + 3, y + half + 3, half * 1.05, size * 0.12),
        `<g transform="translate(${ x } ${ y }) rotate(${ turn })">`,
        `<rect x="${ -half + 2.6 }" y="${ -half + 3.2 }" width="${ size }" height="${ size }" rx="${ r2(size * 0.22) }" fill="url(#${ id }-side)"/>`,
        `<rect x="${ -half }" y="${ -half }" width="${ size }" height="${ size }" rx="${ r2(size * 0.22) }" fill="url(#${ id }-face)" stroke="${ palette.edge }" stroke-width="${ neon(palette) ? 1.6 : 1.1 }"${ glowing }/>`,
        `<rect x="${ -half + 2.4 }" y="${ -half + 2.4 }" width="${ size - 4.8 }" height="${ size - 4.8 }" rx="${ r2(size * 0.17) }" fill="none" stroke="#FFFFFF" stroke-opacity="${ neon(palette) ? 0.12 : 0.45 }" stroke-width="0.9"/>`,
        pips,
        `<rect x="${ -half }" y="${ -half }" width="${ size }" height="${ size }" rx="${ r2(size * 0.22) }" fill="url(#${ id }-gloss)"/>`,
        '</g>'
    ];

    return { defs, body };
}

function dice(palette)
{
    const back = die(palette, 'b', 98, 56, 40, 14, 3);
    const front = die(palette, 'a', 62, 64, 46, -9, 5);

    return { defs: [...back.defs, ...front.defs], body: [...back.body, ...front.body] };
}

// ---------------------------------------------------------------- pawns

const PAWN = {
    base: 'M-14.6 17.6C-14.6 14.2-8.4 12-0 12C8.4 12 14.6 14.2 14.6 17.6C14.6 21-8.4 23.4 0 23.4C-8.4 23.4-14.6 21-14.6 17.6Z',
    body: 'M-11.2 16.4C-10.4 7-6.6 -0.6-5.2 -6.6L5.2 -6.6C6.6 -0.6 10.4 7 11.2 16.4C7.6 18.4-7.6 18.4-11.2 16.4Z',
    collar: 'M-8 -7.2C-8 -9 8 -9 8 -7.2C8 -5.4-8 -5.4-8 -7.2Z'
};

function pawn(palette, id, seat, x, y, scale)
{
    const tone = SEAT_RAMPS[seat];
    const metal = palette.pattern === 'filigree' || palette.pattern === 'girih';
    const fill = neon(palette) ? `url(#${ id }-dark)` : `url(#${ id }-body)`;
    const rim = neon(palette) ? tone[1] : palette.pattern === 'sparkle' ? '#FFFFFF' : '#00000040';
    const glowing = neon(palette) ? ' filter="url(#glow)"' : '';

    const defs = [
        linear(`${ id }-body`, tone),
        linear(`${ id }-dark`, palette.piece),
        linear(`${ id }-metal`, palette.pattern === 'filigree' ? palette.piece : [palette.glint, palette.edge, palette.edge]),
        gloss(`${ id }-gloss`, palette.pattern === 'sparkle' ? 0.75 : 0.5, [0.32, 0.18, 0.6])
    ];

    const head = '<circle cx="0" cy="-15.6" r="8.4"/>';
    const collar = `<path d="${ PAWN.collar }" fill="${ metal ? `url(#${ id }-metal)` : fill }"/>`;
    const base = `<path d="${ PAWN.base }" fill="${ metal ? `url(#${ id }-metal)` : fill }"/>`;
    const crested = lineOf(palette) !== undefined;
    const extra = crested
        ? `<use href="#crest-front" transform="${ ONTO_PAWN }"/>`
        : palette.pattern === 'sparkle'
            ? `<path d="${ sparkle(-3.2, -18.6, 3.6) }" fill="#FFFFFF" opacity="0.95"/><path d="${ sparkle(4.8, 6, 2) }" fill="${ palette.glint }"/>`
            : palette.pattern === 'girih'
                ? `<path d="${ octagram(0, 5, 3.6) }" fill="none" stroke="${ palette.edge }" stroke-width="0.8"/>`
                : neon(palette)
                    ? `<circle cx="0" cy="-15.6" r="4.2" fill="none" stroke="${ palette.glint }" stroke-width="1.1"${ glowing }/>`
                    : `<circle cx="0" cy="-15.6" r="8.4" fill="none" stroke="url(#${ id }-metal)" stroke-width="1.6"/>`;

    const body = [
        shadow(x + 2, y + 22 * scale, 15 * scale, 4 * scale, 0.55),
        `<g transform="translate(${ x } ${ y }) scale(${ scale })">`,
        crested ? `<use href="#crest-back" transform="${ ONTO_PAWN }"/>` : '',
        base,
        `<g fill="${ fill }" stroke="${ rim }" stroke-width="${ neon(palette) ? 1.5 : 0.9 }" stroke-opacity="${ neon(palette) ? 1 : 0.55 }"${ glowing }><path d="${ PAWN.body }"/>${ head }</g>`,
        collar,
        extra,
        `<g fill="url(#${ id }-gloss)"><path d="${ PAWN.body }"/>${ head }</g>`,
        '</g>'
    ];

    return { defs, body };
}

/** A legendary collection's crest, drawn once for every pawn of a drawing to wear (`#crest-front`, and `#crest-back` behind the head). */
const crestDefs = (palette) =>
{
    const crest = lineOf(palette)?.crest(palette, 'crest');
    return crest === undefined ? [] : [...crest.defs, `<g id="crest-front">${ crest.body.join('') }</g>`, `<g id="crest-back">${ (crest.back ?? []).join('') }</g>`];
};

function pawns(palette)
{
    const set = [['yellow', 50, 44, 0.86], ['blue', 108, 44, 0.86], ['red', 66, 66, 1.08], ['green', 96, 68, 1.08]];
    const drawn = set.map(([seat, x, y, scale], index) => pawn(palette, `p${ index }`, seat, x, y, scale));

    return { defs: [...crestDefs(palette), ...drawn.flatMap((one) => one.defs)], body: drawn.flatMap((one) => one.body) };
}

// ---------------------------------------------------------------- the yard

function yard(palette)
{
    const tone = SEAT_RAMPS.red;
    const defs = [
        linear('y-body', tone),
        linear('y-well', [tone[0], tone[1], tone[2]], [0.3, 0.2, 0.7, 0.9]),
        motif('y-motif', palette, 0.8),
        gloss('y-gloss', 0.35, [0.25, 0.15, 0.8])
    ];

    const wells = [[62, 42], [98, 42], [62, 78], [98, 78]].map(([cx, cy]) =>
        `<circle cx="${ cx }" cy="${ cy }" r="9.6" fill="#FFFFFF" opacity="0.92"/><circle cx="${ cx }" cy="${ cy }" r="7.4" fill="url(#y-well)" stroke="${ palette.edge }" stroke-width="1.4"/>`).join('');

    const sign = lineOf(palette)?.emblem(palette, 80, 60, 18, 'y-sign');
    const centre = sign !== undefined
        ? sign.body.join('')
        : palette.pattern === 'sparkle'
            ? `<path d="${ sparkle(80, 60, 7.5) }" fill="${ palette.glint }"/>`
            : palette.pattern === 'girih'
                ? `<path d="${ starOf(80, 60, 8, 3.6, 8) }" fill="${ palette.edge }"/>`
                : neon(palette)
                    ? `<path d="${ polygon(80, 60, 7, 4, 0) }" fill="none" stroke="${ palette.glint }" stroke-width="1.6" filter="url(#glow)"/>`
                    : `<circle cx="80" cy="60" r="6" fill="none" stroke="${ palette.edge }" stroke-width="1.6"/><circle cx="80" cy="60" r="2.4" fill="${ palette.edge }"/>`;

    defs.push(...(sign?.defs ?? []));

    const body = [
        shadow(82, 106, 50, 6),
        `<rect x="34" y="14" width="92" height="92" rx="12" fill="url(#y-body)" stroke="${ palette.edge }" stroke-width="${ neon(palette) ? 2 : 1.4 }"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`,
        '<rect x="34" y="14" width="92" height="92" rx="12" fill="url(#y-motif)" opacity="0.38"/>',
        `<rect x="47" y="27" width="66" height="66" rx="9" fill="#FFFFFF" opacity="0.18" stroke="${ palette.edge }" stroke-width="1.1"/>`,
        wells,
        centre,
        '<rect x="34" y="14" width="92" height="92" rx="12" fill="url(#y-gloss)"/>'
    ];

    return { defs, body };
}

// ---------------------------------------------------------------- cards

function emblem(palette, id, cx, cy, size)
{
    if (palette.pattern === 'sparkle')
    {
        return `<circle cx="${ cx }" cy="${ cy }" r="${ size * 0.95 }" fill="url(#${ id }-halo)"/><path d="${ sparkle(cx, cy, size) }" fill="${ palette.glint }"/><path d="${ sparkle(cx + size * 0.9, cy - size * 0.85, size * 0.32) }" fill="#FFFFFF"/><path d="${ sparkle(cx - size * 0.8, cy + size * 0.9, size * 0.24) }" fill="${ palette.edge }"/>`;
    }

    if (palette.pattern === 'girih')
    {
        return `<path d="${ starOf(cx, cy, size, size * 0.45, 8) }" fill="${ palette.surface[2] }" stroke="${ palette.edge }" stroke-width="1.3" stroke-linejoin="round"/><path d="${ octagram(cx, cy, size * 0.52) }" fill="none" stroke="${ palette.edge }" stroke-width="0.8"/><circle cx="${ cx }" cy="${ cy }" r="${ size * 0.16 }" fill="${ palette.glint }"/>`;
    }

    if (neon(palette))
    {
        return `<g fill="none" filter="url(#glow)"><path d="${ polygon(cx, cy, size, 4, 0) }" stroke="${ palette.edge }" stroke-width="1.8"/><path d="${ polygon(cx, cy, size * 0.6, 4, 0) }" stroke="${ palette.glint }" stroke-width="1.4"/></g>`;
    }

    return `<g fill="none" stroke="${ palette.edge }" stroke-width="1.2" stroke-linecap="round"><circle cx="${ cx }" cy="${ cy }" r="${ size * 0.55 }"/><path d="M${ cx } ${ cy - size }C${ cx + size * 0.5 } ${ cy - size * 0.5 } ${ cx + size * 0.5 } ${ cy + size * 0.5 } ${ cx } ${ cy + size }C${ cx - size * 0.5 } ${ cy + size * 0.5 } ${ cx - size * 0.5 } ${ cy - size * 0.5 } ${ cx } ${ cy - size }Z"/><path d="M${ cx - size } ${ cy }C${ cx - size * 0.4 } ${ cy - size * 0.35 } ${ cx + size * 0.4 } ${ cy - size * 0.35 } ${ cx + size } ${ cy }C${ cx + size * 0.4 } ${ cy + size * 0.35 } ${ cx - size * 0.4 } ${ cy + size * 0.35 } ${ cx - size } ${ cy }Z"/></g><circle cx="${ cx }" cy="${ cy }" r="${ size * 0.18 }" fill="${ palette.glint }"/>`;
}

/**
 * A collection's sigil: its emblem in a medallion of its surface, ringed in its light, drawn at a
 * size that keeps a legendary emblem's flames, horns and whiskers inside the inner ring.
 */
function sigil(palette)
{
    const sign = lineOf(palette)?.emblem(palette, 32, 32, 35, 's');
    const defs = [
        `<radialGradient id="disc" cx="0.4" cy="0.32" r="0.78"><stop offset="0" stop-color="${ palette.surface[0] }"/><stop offset="0.62" stop-color="${ palette.surface[1] }"/><stop offset="1" stop-color="${ palette.surface[2] }"/></radialGradient>`,
        `<linearGradient id="rim" x1="0.15" y1="0.1" x2="0.85" y2="0.95"><stop offset="0" stop-color="${ palette.glint }"/><stop offset="0.45" stop-color="${ palette.edge }"/><stop offset="1" stop-color="${ palette.deep[1] }"/></linearGradient>`,
        `<radialGradient id="sigil-halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.45"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>`,
        '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4" result="soft"/><feMerge><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
        ...(sign?.defs ?? [])
    ];
    const body = [
        '<circle cx="32" cy="32" r="30.5" fill="url(#disc)"/>',
        '<circle cx="32" cy="32" r="29.3" fill="none" stroke="url(#rim)" stroke-width="2.4"/>',
        `<circle cx="32" cy="32" r="25.6" fill="none" stroke="${ palette.edge }" stroke-opacity="0.45" stroke-width="0.7"/>`,
        ...(sign?.body ?? [emblem(palette, 'sigil', 32, 32, 14)]),
        '<path d="M9.5 24A23.5 23.5 0 0 1 40 8.6" fill="none" stroke="#FFFFFF" stroke-opacity="0.2" stroke-width="1.6" stroke-linecap="round"/>'
    ];

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs>${ defs.join('') }</defs>${ body.join('') }</svg>`;
}

function cardBack(palette, id, x, y, turn)
{
    const defs = [
        linear(`${ id }-surface`, palette.surface),
        motif(`${ id }-motif`, palette, 0.62),
        gloss(`${ id }-gloss`, 0.32, [0.2, 0.08, 0.9]),
        `<radialGradient id="${ id }-halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.45"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>`
    ];

    const body = [
        shadow(x + 3, y + 46, 30, 5),
        `<g transform="translate(${ x } ${ y }) rotate(${ turn })">`,
        '<rect x="-30" y="-42" width="60" height="84" rx="6" fill="#0A0A10" opacity="0.35" transform="translate(1.6 2.2)"/>',
        `<rect x="-30" y="-42" width="60" height="84" rx="6" fill="url(#${ id }-surface)" stroke="${ palette.edge }" stroke-width="${ neon(palette) ? 1.5 : 0.9 }"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`,
        `<rect x="-25.5" y="-37.5" width="51" height="75" rx="3.6" fill="none" stroke="${ palette.edge }" stroke-width="1"/>`,
        `<rect x="-22" y="-34" width="44" height="68" rx="2.4" fill="url(#${ id }-motif)" opacity="0.75"/>`,
        emblem(palette, id, 0, 0, 13),
        `<rect x="-30" y="-42" width="60" height="84" rx="6" fill="url(#${ id }-gloss)"/>`,
        '</g>'
    ];

    return { defs, body };
}

/** A legendary collection's real card back (`public/backs/`), drawn once for every card of a drawing to show (`#real-back`). */
const realBackDefs = (palette) =>
{
    const line = lineOf(palette);

    return line === undefined ? [] : [
        gloss('real-gloss', 0.32, [0.2, 0.08, 0.9]),
        '<clipPath id="real-round"><rect x="-30" y="-42" width="60" height="84" rx="6"/></clipPath>',
        prefixed('rb', backArt(palette, line.back.border, line.back.emblem(palette, CARD_W, CARD_H)))
            .replace(/<svg [^>]*>/, `<svg id="real-back" x="-30" y="-42" width="60" height="84" viewBox="0 0 ${ CARD_W } ${ CARD_H }" preserveAspectRatio="none">`)
    ];
};

/** The real back laid as one of the drawing's cards, tilted, with its shadow and its sheen. */
const realBack = (palette, x, y, turn) => ({
    defs: [],
    body: [
        shadow(x + 3, y + 46, 30, 5),
        `<g transform="translate(${ x } ${ y }) rotate(${ turn })">`,
        '<rect x="-30" y="-42" width="60" height="84" rx="6" fill="#0A0A10" opacity="0.35" transform="translate(1.6 2.2)"/>',
        '<g clip-path="url(#real-round)"><use href="#real-back"/></g>',
        `<rect x="-30" y="-42" width="60" height="84" rx="6" fill="none" stroke="${ palette.edge }" stroke-width="0.9"/>`,
        '<rect x="-30" y="-42" width="60" height="84" rx="6" fill="url(#real-gloss)"/>',
        '</g>'
    ]
});

/** A card back as the drawing lays one: a legendary collection's real back, or one drawn here. */
const backCard = (palette, id, x, y, turn) => (lineOf(palette) === undefined ? cardBack(palette, id, x, y, turn) : realBack(palette, x, y, turn));

function backs(palette)
{
    const behind = backCard(palette, 'k', 94, 58, 11);
    const front = backCard(palette, 'c', 68, 62, -8);

    return { defs: [...realBackDefs(palette), ...behind.defs, ...front.defs], body: [...behind.body, ...front.body] };
}

/** The letter A for a card's index, drawn as strokes so no font is asked for. */
const LETTER_A = 'M-4.4 6L0 -6L4.4 6M-2.8 1.6H2.8';

function cardFace(palette, id, x, y, turn, suit, red)
{
    const dress = lineOf(palette)?.dress;
    const inked = dress?.suits.find((one) => one.name === suit);
    const ink = inked?.ink ?? (red ? '#C2263A' : '#151821');
    const paper = dress?.paper ?? ['#FFFFFF', '#EEF2F7'];
    const defs = [
        `<linearGradient id="${ id }-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ paper[0] }"/><stop offset="1" stop-color="${ paper[1] }"/></linearGradient>`,
        linear(`${ id }-pip`, inked === undefined ? (red ? ['#F25C6E', '#C2263A', '#8F1527'] : palette.piece) : [inked.ink, inked.ink, inked.accent]),
        gloss(`${ id }-gloss`, 0.4, [0.2, 0.06, 0.9])
    ];

    const big = neon(palette) && !red
        ? `<path d="${ SUIT_PATH[suit] }" transform="scale(1.25)" fill="url(#${ id }-pip)" stroke="${ palette.edge }" stroke-width="0.9" filter="url(#glow)"/>`
        : `<path d="${ SUIT_PATH[suit] }" transform="scale(1.25)" fill="url(#${ id }-pip)" stroke="${ palette.pattern === 'girih' || palette.pattern === 'filigree' ? palette.edge : 'none' }" stroke-width="0.9"/>`;

    const flourish = palette.pattern === 'sparkle'
        ? `<path d="${ sparkle(8, -10, 3.4) }" fill="${ palette.glint }"/>`
        : palette.pattern === 'girih'
            ? `<path d="${ octagram(0, 0, 4) }" fill="none" stroke="${ palette.glint }" stroke-width="0.7"/>`
            : '';

    const body = [
        shadow(x + 3, y + 46, 30, 5),
        `<g transform="translate(${ x } ${ y }) rotate(${ turn })">`,
        `<rect x="-30" y="-42" width="60" height="84" rx="6" fill="url(#${ id }-paper)" stroke="#CBD5E1" stroke-width="0.6"/>`,
        `<rect x="-26.5" y="-38.5" width="53" height="77" rx="3.8" fill="none" stroke="${ palette.edge }" stroke-width="${ neon(palette) ? 1.2 : 1 }"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`,
        palette.pattern === 'girih' ? `<rect x="-24.5" y="-36.5" width="49" height="73" rx="2.8" fill="none" stroke="${ palette.piece[1] }" stroke-width="0.7"/>` : '',
        `<g transform="translate(-19.5 -27.5)" stroke="${ ink }" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${ LETTER_A }"/></g>`,
        `<path d="${ SUIT_PATH[suit] }" transform="translate(-19.5 -15) scale(0.32)" fill="${ ink }"/>`,
        `<g transform="rotate(180) translate(-19.5 -27.5)" stroke="${ ink }" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${ LETTER_A }"/></g>`,
        `<path d="${ SUIT_PATH[suit] }" transform="rotate(180) translate(-19.5 -15) scale(0.32)" fill="${ ink }"/>`,
        big,
        flourish,
        `<rect x="-30" y="-42" width="60" height="84" rx="6" fill="url(#${ id }-gloss)"/>`,
        '</g>'
    ];

    return { defs, body };
}

function faces(palette)
{
    const behind = cardFace(palette, 'h', 96, 56, 11, 'heart', true);
    const front = cardFace(palette, 's', 66, 62, -7, 'spade', false);

    return { defs: [...behind.defs, ...front.defs], body: [...behind.body, ...front.body] };
}

// ---------------------------------------------------------------- the felt

function felt(palette)
{
    const cloth = neon(palette) ? palette.surface : palette.pattern === 'filigree' ? ['#1E3B2C', '#10261B', '#07140E'] : palette.pattern === 'girih' ? palette.piece : palette.surface;
    const defs = [
        radial('f-cloth', [cloth[0], cloth[1], cloth[2]], [0.5, 0.38, 0.75]),
        motif('f-motif', palette, 1.1),
        linear('f-rail', [palette.edge, palette.pattern === 'filigree' ? palette.piece[2] : palette.surface[2], palette.edge], [0, 0, 0, 1]),
        `<radialGradient id="f-alive" cx="0.5" cy="0.5" r="0.5"><stop offset="0.7" stop-color="${ palette.glint }" stop-opacity="0"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0.55"/></radialGradient>`,
        `<radialGradient id="f-halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.4"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>`
    ];

    const body = [
        shadow(80, 104, 70, 7, 0.6),
        '<rect x="8" y="16" width="144" height="86" rx="43" fill="url(#f-rail)"/>',
        '<rect x="14" y="22" width="132" height="74" rx="37" fill="url(#f-cloth)"/>',
        '<rect x="14" y="22" width="132" height="74" rx="37" fill="url(#f-cloth)" filter="url(#grain)"/>',
        '<rect x="14" y="22" width="132" height="74" rx="37" fill="url(#f-motif)" opacity="0.22"/>',
        `<rect x="18" y="26" width="124" height="66" rx="33" fill="none" stroke="${ palette.edge }" stroke-width="0.8" stroke-dasharray="1.6 3.2" opacity="0.7"/>`,
        '<rect x="14" y="22" width="132" height="74" rx="37" fill="url(#f-alive)"/>'
    ];
    const sign = lineOf(palette)?.emblem(palette, 80, 59, 24, 'f-sign');

    return sign === undefined
        ? { defs, body: [...body, emblem(palette, 'f', 80, 59, 9)] }
        : { defs: [...defs, ...sign.defs], body: [...body, ...sign.body] };
}

// ---------------------------------------------------------------- chips

function chip(palette, id, x, y, top)
{
    const tone = lineOf(palette) !== undefined
        ? [palette.glint, palette.edge, palette.deep[1]]
        : palette.pattern === 'sparkle' || palette.pattern === 'girih' ? palette.piece : palette.surface;
    const stripe = neon(palette) ? palette.glint : palette.pattern === 'filigree' ? palette.edge : '#FFFFFF';
    const side = `<path d="M${ x - 21 } ${ y }V${ y + 5 }C${ x - 21 } ${ y + 9.4 } ${ x + 21 } ${ y + 9.4 } ${ x + 21 } ${ y + 5 }V${ y }Z" fill="url(#${ id }-side)"/>`;
    const dashes = [-15, -6, 6, 15].map((dx) => `<rect x="${ x + dx - 2 }" y="${ y + 2 + Math.abs(dx) * 0.03 }" width="4" height="${ 5.6 - Math.abs(dx) * 0.07 }" fill="${ stripe }" opacity="0.92"/>`).join('');
    const face = top
        ? `<ellipse cx="${ x }" cy="${ y }" rx="21" ry="7" fill="url(#${ id }-top)"/><ellipse cx="${ x }" cy="${ y }" rx="15.4" ry="5" fill="none" stroke="${ stripe }" stroke-width="1.1" stroke-dasharray="3 2.4"/><ellipse cx="${ x }" cy="${ y }" rx="9" ry="2.9" fill="${ palette.edge }" opacity="0.85"/><ellipse cx="${ x }" cy="${ y - 0.4 }" rx="5.4" ry="1.7" fill="${ palette.glint }" opacity="0.7"/>`
        : `<ellipse cx="${ x }" cy="${ y }" rx="21" ry="7" fill="url(#${ id }-top)"/>`;

    return {
        defs: [
            `<linearGradient id="${ id }-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ tone[2] }"/><stop offset="0.4" stop-color="${ tone[1] }"/><stop offset="1" stop-color="${ tone[2] }"/></linearGradient>`,
            linear(`${ id }-top`, tone, [0.2, 0, 0.8, 1])
        ],
        body: [side, dashes, face]
    };
}

function chips(palette)
{
    const parts = [];
    const stack = (key, x, y, count) =>
    {
        parts.push({ defs: [], body: [shadow(x + 2, y + 10, 24, 4, 0.55)] });

        for (let level = 0; level < count; level += 1)
        {
            parts.push(chip(palette, `${ key }${ level }`, x, y - level * 6, level === count - 1));
        }
    };

    stack('a', 108, 86, 3);
    stack('b', 62, 84, 6);

    return { defs: parts.flatMap((one) => one.defs), body: parts.flatMap((one) => one.body) };
}

// ---------------------------------------------------------------- checkers and the home board

function checker(palette, id, x, y, side, size = 1)
{
    const rx = 18 * size;
    const ry = 7 * size;
    const band = 4.6 * size;
    const tone = side === 'pale' ? palette.pale : palette.deep;
    const ring = side === 'pale' ? palette.deep[1] : palette.edge;

    return {
        defs: [
            `<linearGradient id="${ id }-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ tone[2] }"/><stop offset="0.38" stop-color="${ tone[1] }"/><stop offset="1" stop-color="${ tone[2] }"/></linearGradient>`,
            radial(`${ id }-top`, tone, [0.36, 0.3, 0.8]),
            gloss(`${ id }-gloss`, 0.5, [0.32, 0.22, 0.6])
        ],
        body: [
            `<path d="M${ x - rx } ${ y }V${ y + band }C${ x - rx } ${ y + band + ry * 0.62 } ${ x + rx } ${ y + band + ry * 0.62 } ${ x + rx } ${ y + band }V${ y }Z" fill="url(#${ id }-side)"/>`,
            `<ellipse cx="${ x }" cy="${ y }" rx="${ rx }" ry="${ ry }" fill="url(#${ id }-top)" stroke="${ ring }" stroke-width="${ neon(palette) ? 1.3 : 0.8 }"${ neon(palette) && side === 'deep' ? ' filter="url(#glow)"' : '' }/>`,
            `<ellipse cx="${ x }" cy="${ y }" rx="${ r2(rx * 0.69) }" ry="${ r2(ry * 0.66) }" fill="none" stroke="${ ring }" stroke-width="0.9" opacity="0.8"/>`,
            palette.pattern === 'girih' ? `<path d="${ octagram(x, y, 3.6 * size) }" fill="none" stroke="${ ring }" stroke-width="0.7"/>` : `<ellipse cx="${ x }" cy="${ y }" rx="${ r2(rx * 0.31) }" ry="${ r2(ry * 0.29) }" fill="none" stroke="${ ring }" stroke-width="0.8" opacity="0.7"/>`,
            `<ellipse cx="${ x }" cy="${ y }" rx="${ rx }" ry="${ ry }" fill="url(#${ id }-gloss)"/>`
        ]
    };
}

function checkers(palette)
{
    const parts = [
        { defs: [], body: [shadow(56, 98, 30, 5, 0.55), shadow(110, 96, 30, 5, 0.55)] },
        checker(palette, 'd0', 56, 84, 'deep', 1.45),
        checker(palette, 'd1', 56, 77, 'deep', 1.45),
        checker(palette, 'd2', 56, 70, 'deep', 1.45),
        checker(palette, 'l0', 110, 82, 'pale', 1.45),
        checker(palette, 'l1', 110, 75, 'pale', 1.45)
    ];

    return { defs: parts.flatMap((one) => one.defs), body: parts.flatMap((one) => one.body) };
}

function home(palette)
{
    const defs = [
        linear('h-board', palette.surface),
        linear('h-one', palette.deep, [0.5, 1, 0.5, 0]),
        linear('h-two', palette.pale, [0.5, 1, 0.5, 0]),
        motif('h-motif', palette, 0.7)
    ];

    const points = Array.from({ length: 6 }, (_, index) =>
    {
        const left = 18 + index * 21;
        const fill = index % 2 === 0 ? 'url(#h-one)' : 'url(#h-two)';
        return `<path d="M${ left } 98L${ left + 10.5 } 34L${ left + 21 } 98Z" fill="${ fill }" stroke="${ palette.edge }" stroke-width="${ neon(palette) ? 1.1 : 0.7 }" stroke-linejoin="round"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`;
    }).join('');

    const sitting = checker(palette, 'h-c', 49.5, 90, 'deep');

    return {
        defs: [...defs, ...sitting.defs],
        body: [
            shadow(80, 108, 70, 6),
            `<rect x="10" y="20" width="140" height="86" rx="7" fill="url(#h-board)" stroke="${ palette.edge }" stroke-width="1.4"/>`,
            '<rect x="10" y="20" width="140" height="86" rx="7" fill="url(#h-motif)" opacity="0.2"/>',
            `<rect x="14" y="24" width="132" height="78" rx="4" fill="none" stroke="${ palette.edge }" stroke-width="0.7" opacity="0.6"/>`,
            points,
            ...sitting.body
        ]
    };
}

// ---------------------------------------------------------------- chess

function pieces(palette)
{
    const outline = (side) => (side === 'pale' ? palette.deep[2] : palette.edge);
    const piece = (key, kind, side, x, y, scale) => [
        `<g transform="translate(${ x } ${ y }) scale(${ scale })">`,
        `<g fill="url(#${ key }-body)" stroke="${ outline(side) }" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"${ neon(palette) && side === 'deep' ? ' filter="url(#glow)"' : '' }>${ pieceShapes(kind) }</g>`,
        `<g fill="url(#${ key }-gloss)">${ pieceShapes(kind) }</g>`,
        '</g>'
    ].join('');

    return {
        defs: [linear('n-body', palette.pale), linear('k-body', palette.deep), gloss('n-gloss', 0.6, [0.32, 0.22, 0.62]), gloss('k-gloss', 0.32, [0.32, 0.22, 0.62])],
        body: [
            shadow(58, 102, 26, 5),
            shadow(104, 104, 26, 5),
            piece('k', 'k', 'deep', 64, 2, 0.98),
            piece('n', 'n', 'pale', 14, 14, 0.86)
        ]
    };
}

// ---------------------------------------------------------------- the profile

const PERSON = '<circle cx="80" cy="53" r="9.4" fill="#94A3B8"/><path d="M62.6 80.4C64.4 69.6 71.4 64.4 80 64.4C88.6 64.4 95.6 69.6 97.4 80.4C92.6 84.6 86.6 86.6 80 86.6C73.4 86.6 67.4 84.6 62.6 80.4Z" fill="#94A3B8"/>';

function picture(cx = 80, cy = 60, r = 25)
{
    return [
        `<circle cx="${ cx }" cy="${ cy }" r="${ r }" fill="url(#avatar)"/>`,
        `<g transform="translate(${ cx - 80 } ${ cy - 60 }) translate(80 60) scale(${ r / 25 }) translate(-80 -60)"><clipPath id="avatar-clip"><circle cx="80" cy="60" r="25"/></clipPath><g clip-path="url(#avatar-clip)">${ PERSON }</g></g>`
    ].join('');
}

const AVATAR = '<linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A4A66"/><stop offset="1" stop-color="#1B2436"/></linearGradient>';

function decoration(palette)
{
    const defs = [AVATAR, linear('d-ring', palette.piece, [0, 0, 1, 1]), motif('d-motif', palette, 0.5)];
    let frame;

    if (palette.pattern === 'sparkle')
    {
        frame = [
            `<circle cx="80" cy="60" r="31" fill="none" stroke="${ palette.edge }" stroke-width="6" opacity="0.35" filter="url(#blur)"/>`,
            '<circle cx="80" cy="60" r="30.5" fill="none" stroke="url(#d-ring)" stroke-width="4.4"/>',
            `<circle cx="80" cy="60" r="30.5" fill="none" stroke="#FFFFFF" stroke-width="0.8" stroke-dasharray="2 9" opacity="0.8"/>`,
            ...[[-45, 6.8], [40, 4.6], [150, 5.4], [-140, 3.6], [100, 3]].map(([turn, size]) =>
            {
                const angle = turn * Math.PI / 180;
                return `<path d="${ sparkle(80 + 31 * Math.cos(angle), 60 + 31 * Math.sin(angle), size) }" fill="${ palette.glint }"/>`;
            })
        ];
    }
    else if (palette.pattern === 'girih')
    {
        frame = [
            ...Array.from({ length: 12 }, (_, index) =>
            {
                const from = (index * 30 - 90) * Math.PI / 180;
                const to = ((index + 1) * 30 - 90 - 3) * Math.PI / 180;
                const tone = index % 2 === 0 ? palette.piece[1] : palette.deep[1];
                return `<path d="M${ r2(80 + 30.5 * Math.cos(from)) } ${ r2(60 + 30.5 * Math.sin(from)) }A30.5 30.5 0 0 1 ${ r2(80 + 30.5 * Math.cos(to)) } ${ r2(60 + 30.5 * Math.sin(to)) }" fill="none" stroke="${ tone }" stroke-width="5.4"/>`;
            }),
            `<circle cx="80" cy="60" r="33.6" fill="none" stroke="${ palette.edge }" stroke-width="1"/>`,
            `<circle cx="80" cy="60" r="27.4" fill="none" stroke="${ palette.edge }" stroke-width="1"/>`,
            ...[0, 90, 180, 270].map((turn) =>
            {
                const angle = (turn - 90) * Math.PI / 180;
                return `<path d="${ starOf(80 + 30.5 * Math.cos(angle), 60 + 30.5 * Math.sin(angle), 5.2, 2.4, 8) }" fill="${ palette.edge }"/>`;
            })
        ];
    }
    else if (neon(palette))
    {
        frame = [
            `<circle cx="80" cy="60" r="30" fill="none" stroke="${ palette.edge }" stroke-width="2.4" filter="url(#glow)"/>`,
            `<path d="M80 25.4A34.6 34.6 0 1 1 51.4 40.6" fill="none" stroke="${ palette.glint }" stroke-width="1.6" stroke-linecap="round" filter="url(#glow)"/>`,
            `<circle cx="51.4" cy="40.6" r="1.8" fill="${ palette.glint }" filter="url(#glow)"/>`
        ];
    }
    else
    {
        const leaf = (turn, side) =>
        {
            const angle = turn * Math.PI / 180;
            const x = 80 + 31 * Math.cos(angle);
            const y = 60 + 31 * Math.sin(angle);
            return `<ellipse cx="${ r2(x) }" cy="${ r2(y) }" rx="5.2" ry="2.2" transform="rotate(${ r2(turn + 90 + side * 35) } ${ r2(x) } ${ r2(y) })" fill="url(#d-ring)" stroke="${ palette.piece[2] }" stroke-width="0.4"/>`;
        };

        frame = [
            `<path d="M80 91A31 31 0 0 1 49 60M80 91A31 31 0 0 0 111 60" fill="none" stroke="${ palette.piece[2] }" stroke-width="1.2"/>`,
            ...[110, 130, 150, 170, 190, 210, 230].map((turn) => leaf(turn, 1)),
            ...[70, 50, 30, 10, -10, -30, -50].map((turn) => leaf(turn, -1)),
            `<path d="${ starOf(80, 27.6, 5.4, 2.4, 5) }" fill="url(#d-ring)" stroke="${ palette.piece[2] }" stroke-width="0.5"/>`
        ];
    }

    return { defs, body: [shadow(80, 98, 30, 4), picture(), ...frame] };
}

function card(palette)
{
    return [
        '<rect x="30" y="16" width="100" height="92" rx="9" fill="#0F172A" stroke="#334155" stroke-width="0.8"/>',
        '<rect x="30" y="16" width="100" height="30" rx="9" fill="#1E293B"/>',
        '<rect x="30" y="37" width="100" height="9" fill="#1E293B"/>',
        '<rect x="44" y="70" width="44" height="6" rx="3" fill="#CBD5E1" opacity="0.75"/>',
        '<rect x="44" y="81" width="64" height="4" rx="2" fill="#64748B" opacity="0.7"/>',
        '<rect x="44" y="90" width="52" height="4" rx="2" fill="#64748B" opacity="0.55"/>',
        `<circle cx="56" cy="47" r="12" fill="url(#avatar)" stroke="#0F172A" stroke-width="2.4"/>`
    ].join('');
}

function effect(palette)
{
    const defs = [AVATAR, `<linearGradient id="e-beam" x1="0.5" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.7"/><stop offset="1" stop-color="${ palette.edge }" stop-opacity="0"/></linearGradient>`];
    let particles;

    if (palette.pattern === 'sparkle')
    {
        particles = [[44, 30, 5.4], [110, 26, 7], [96, 52, 3.6], [64, 58, 4.4], [120, 76, 5], [40, 86, 3.2], [86, 90, 4], [74, 22, 2.6], [130, 46, 2.8]]
            .map(([x, y, size], index) => `<path d="${ sparkle(x, y, size) }" fill="${ index % 3 === 0 ? '#FFFFFF' : palette.glint }" opacity="${ 0.65 + (index % 3) * 0.15 }"/>`);
    }
    else if (palette.pattern === 'girih')
    {
        const petal = (x, y, turn) => `<path d="M0 -5C3.4 -3.2 3.4 2.6 0 5C-3.4 2.6-3.4 -3.2 0 -5Z" transform="translate(${ x } ${ y }) rotate(${ turn })" fill="#C2263A" stroke="#7F1424" stroke-width="0.5"/>`;
        particles = [
            petal(46, 30, 20), petal(108, 24, -30), petal(122, 62, 45), petal(70, 56, -10), petal(40, 82, 60), petal(98, 88, 15),
            ...[[60, 36], [116, 44], [88, 70], [50, 100], [128, 90]].map(([x, y]) => `<path d="${ starOf(x, y, 3.4, 1.5, 8) }" fill="${ palette.edge }"/>`)
        ];
    }
    else if (neon(palette))
    {
        particles = [[36, 30, 64, 18], [96, 22, 130, 40], [40, 70, 72, 52], [92, 88, 128, 68], [56, 100, 90, 82]]
            .map(([x1, y1, x2, y2], index) => `<path d="M${ x1 } ${ y1 }L${ x2 } ${ y2 }" stroke="${ index % 2 === 0 ? palette.edge : palette.glint }" stroke-width="1.8" stroke-linecap="round" filter="url(#glow)"/>`);
    }
    else
    {
        particles = [
            '<path d="M70 16L52 108H108L90 16Z" fill="url(#e-beam)" opacity="0.5"/>',
            ...Array.from({ length: 22 }, (_, index) =>
            {
                const x = 34 + ((index * 37) % 96);
                const y = 20 + ((index * 53) % 84);
                return `<circle cx="${ x }" cy="${ y }" r="${ 0.8 + (index % 4) * 0.45 }" fill="${ index % 3 === 0 ? palette.glint : palette.edge }" opacity="${ 0.55 + (index % 3) * 0.15 }"/>`;
            })
        ];
    }

    return { defs, body: [shadow(80, 112, 50, 4, 0.45), card(palette), ...particles] };
}

function theme(palette)
{
    const defs = [AVATAR, linear('t-cover', palette.surface, [0, 0, 1, 1]), motif('t-motif', palette, 0.7), linear('t-ring', palette.piece)];

    return {
        defs,
        body: [
            shadow(80, 112, 50, 4, 0.45),
            '<rect x="30" y="16" width="100" height="92" rx="9" fill="#0F172A" stroke="#334155" stroke-width="0.8"/>',
            '<clipPath id="t-top"><rect x="30" y="16" width="100" height="36" rx="9"/><rect x="30" y="40" width="100" height="12"/></clipPath>',
            '<g clip-path="url(#t-top)"><rect x="30" y="16" width="100" height="36" fill="url(#t-cover)"/><rect x="30" y="16" width="100" height="36" fill="url(#t-motif)" opacity="0.55"/></g>',
            `<rect x="30" y="51" width="100" height="1.6" fill="${ palette.edge }"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`,
            `<rect x="30" y="52.6" width="100" height="55.4" rx="0" fill="${ palette.ground[1] }" opacity="0.55"/>`,
            '<circle cx="56" cy="53" r="13" fill="url(#avatar)"/>',
            `<circle cx="56" cy="53" r="13" fill="none" stroke="url(#t-ring)" stroke-width="2.6"/>`,
            `<rect x="44" y="74" width="46" height="6" rx="3" fill="${ palette.ink }" opacity="0.9"/>`,
            `<rect x="44" y="85" width="64" height="4" rx="2" fill="${ palette.edge }" opacity="0.55"/>`,
            `<rect x="44" y="94" width="50" height="4" rx="2" fill="${ palette.edge }" opacity="0.35"/>`
        ]
    };
}

function nameplate(palette)
{
    const defs = [AVATAR, linear('n-plate', palette.surface, [0, 0, 1, 0.4]), motif('n-motif', palette, 0.6), linear('n-edge', [palette.edge, palette.glint, palette.edge], [0, 0, 1, 0])];

    return {
        defs,
        body: [
            '<rect x="12" y="18" width="136" height="86" rx="10" fill="#111827" stroke="#1F2937" stroke-width="0.8"/>',
            '<clipPath id="n-row"><rect x="18" y="26" width="124" height="32" rx="9"/></clipPath>',
            '<g clip-path="url(#n-row)"><rect x="18" y="26" width="124" height="32" fill="url(#n-plate)"/><rect x="18" y="26" width="124" height="32" fill="url(#n-motif)" opacity="0.6"/></g>',
            `<rect x="18" y="26" width="124" height="32" rx="9" fill="none" stroke="url(#n-edge)" stroke-width="1.4"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`,
            '<circle cx="34" cy="42" r="10" fill="url(#avatar)"/>',
            `<rect x="50" y="36" width="52" height="6" rx="3" fill="${ palette.ink }"/>`,
            `<rect x="50" y="46" width="32" height="3.6" rx="1.8" fill="${ palette.ink }" opacity="0.6"/>`,
            '<rect x="18" y="68" width="124" height="0.8" fill="#1F2937"/>',
            '<circle cx="34" cy="86" r="10" fill="url(#avatar)" opacity="0.8"/>',
            '<rect x="50" y="80" width="44" height="6" rx="3" fill="#94A3B8" opacity="0.6"/>',
            '<rect x="50" y="90" width="28" height="3.6" rx="1.8" fill="#64748B" opacity="0.6"/>'
        ]
    };
}

// ---------------------------------------------------------------- the celebration

/** Sixteen rays of light from the middle of a win. */
const burst = (palette) => Array.from({ length: 16 }, (_, index) =>
{
    const from = (index * 22.5 - 4) * Math.PI / 180;
    const to = (index * 22.5 + 4) * Math.PI / 180;
    return `<path d="M80 62L${ r2(80 + 90 * Math.cos(from)) } ${ r2(62 + 90 * Math.sin(from)) }L${ r2(80 + 90 * Math.cos(to)) } ${ r2(62 + 90 * Math.sin(to)) }Z" fill="${ index % 2 === 0 ? palette.glint : palette.edge }" opacity="${ index % 2 === 0 ? 0.16 : 0.1 }"/>`;
}).join('');

function celebration(palette)
{
    const rays = burst(palette);

    const confetti = [[34, 30, 20, 'edge'], [124, 26, -30, 'glint'], [44, 92, 60, 'seat'], [128, 88, -15, 'edge'], [60, 20, 45, 'seat'], [104, 100, 30, 'glint'], [24, 62, -40, 'glint'], [138, 58, 15, 'seat']]
        .map(([x, y, turn, tone], index) =>
        {
            const fill = tone === 'seat' ? Object.values(SEAT_RAMPS)[index % 4][1] : palette[tone];
            return palette.pattern === 'sparkle'
                ? `<path d="${ sparkle(x, y, 3.6) }" fill="${ fill }"/>`
                : `<rect x="${ x - 2.2 }" y="${ y - 4 }" width="4.4" height="8" rx="1" transform="rotate(${ turn } ${ x } ${ y })" fill="${ fill }"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`;
        }).join('');

    return {
        defs: [linear('w-cup', palette.pattern === 'filigree' ? palette.piece : palette.pale, [0.2, 0, 0.8, 1]), gloss('w-gloss', 0.55, [0.3, 0.2, 0.6])],
        body: [
            rays,
            confetti,
            shadow(80, 98, 22, 4),
            '<g transform="translate(80 60)">',
            `<path d="M-15 -20H15V-10C15 4 8 11 0 11C-8 11-15 4-15 -10Z" fill="url(#w-cup)" stroke="${ palette.edge }" stroke-width="1.2" stroke-linejoin="round"${ neon(palette) ? ' filter="url(#glow)"' : '' }/>`,
            `<path d="M-15 -15C-24 -15-24 -2-11 0M15 -15C24 -15 24 -2 11 0" fill="none" stroke="${ palette.edge }" stroke-width="2.4" stroke-linecap="round"/>`,
            `<path d="M-3.4 11H3.4V20H-3.4Z" fill="url(#w-cup)" stroke="${ palette.edge }" stroke-width="0.8"/>`,
            `<path d="M-12 20H12L14 27H-14Z" fill="url(#w-cup)" stroke="${ palette.edge }" stroke-width="1" stroke-linejoin="round"/>`,
            palette.pattern === 'girih' ? `<path d="${ starOf(0, -6, 6, 2.6, 8) }" fill="${ palette.edge }"/>` : `<path d="${ sparkle(0, -6, 6) }" fill="${ palette.pattern === 'filigree' ? palette.surface[2] : palette.edge }"/>`,
            '<path d="M-15 -20H15V-10C15 4 8 11 0 11C-8 11-15 4-15 -10Z" fill="url(#w-gloss)"/>',
            '</g>'
        ]
    };
}

// ---------------------------------------------------------------- a legendary collection's own

/** Its frame, still, round the picture. */
function decorationOf(palette, line)
{
    const drawn = line.frame(palette, true);

    return {
        defs: [AVATAR, ...drawn.defs.map((one) => prefixed('d', one))],
        body: [shadow(80, 98, 30, 4), picture(), `<g transform="translate(80 60) scale(0.59) translate(-60 -60)">${ prefixed('d', drawn.body.join('')) }</g>`]
    };
}

/** A cover's drawing without what a theme's card draws under half a pixel: its motes and stars, its scanlines, and lines thinner than a unit. */
const coarse = (text) => text
    .replace(/<circle [^>]*\br="([\d.]+)"[^>]*\/>/g, (whole, r) => (Number(r) < 2 ? '' : whole))
    .replace(/<rect [^>]*\bheight="1"[^>]*\/>/g, '')
    .replace(/<path [^>]*\bstroke-width="([\d.]+)"[^>]*\/>/g, (whole, width) => (Number(width) < 1 && !/\bfill="(?!none")/.test(whole) ? '' : whole));

/** Its cover across the band of a profile's card, from the scene to the medallion at its end. */
function themeOf(palette, line)
{
    const cover = line.cover(palette);
    const drawn = { defs: cover.defs, body: cover.body.map(coarse) };

    return {
        defs: [AVATAR, ...drawn.defs.map((one) => prefixed('t', one))],
        body: [
            shadow(80, 112, 50, 4, 0.45),
            '<rect x="30" y="16" width="100" height="92" rx="9" fill="#0F172A" stroke="#334155" stroke-width="0.8"/>',
            '<clipPath id="t-top"><rect x="30" y="16" width="100" height="36" rx="9"/><rect x="30" y="40" width="100" height="12"/></clipPath>',
            `<g clip-path="url(#t-top)"><g transform="translate(-2 16) scale(0.15)">${ prefixed('t', drawn.body.join('')) }</g></g>`,
            `<rect x="30" y="51" width="100" height="1.6" fill="${ palette.edge }"/>`,
            `<rect x="30" y="52.6" width="100" height="55.4" fill="${ palette.ground[1] }" opacity="0.55"/>`,
            '<circle cx="56" cy="53" r="13" fill="url(#avatar)"/>',
            `<circle cx="56" cy="53" r="13" fill="none" stroke="${ palette.edge }" stroke-width="2.2"/>`,
            `<rect x="44" y="74" width="46" height="6" rx="3" fill="${ palette.ink }" opacity="0.9"/>`,
            `<rect x="44" y="85" width="64" height="4" rx="2" fill="${ palette.edge }" opacity="0.55"/>`,
            `<rect x="44" y="94" width="50" height="4" rx="2" fill="${ palette.edge }" opacity="0.35"/>`
        ]
    };
}

/** Its effect over a profile: its emblem rising from the card in its light, glints round it. */
function effectOf(palette, line)
{
    const sign = line.emblem(palette, 80, 54, 44, 'e-sign');
    const glints = [[40, 28, 3.6], [120, 24, 4.6], [128, 66, 3], [34, 80, 2.8], [108, 98, 3.4], [56, 102, 2.6], [92, 22, 2.2]]
        .map(([x, y, size], index) => `<path d="${ sparkle(x, y, size) }" fill="${ index % 2 === 0 ? palette.glint : palette.edge }" opacity="0.9"/>`);

    return {
        defs: [AVATAR, `<radialGradient id="e-light" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.55"/><stop offset="1" stop-color="${ palette.edge }" stop-opacity="0"/></radialGradient>`, ...sign.defs],
        body: [shadow(80, 112, 50, 4, 0.45), card(palette), '<circle cx="80" cy="54" r="42" fill="url(#e-light)"/>', ...sign.body, ...glints]
    };
}

/** Its celebration: its emblem raised in a burst of its light, confetti in its colours round it. */
function celebrationOf(palette, line)
{
    const sign = line.emblem(palette, 80, 60, 50, 'w-sign');
    const tones = [palette.edge, palette.glint, palette.pale[1], palette.piece[0]];
    const confetti = [[34, 30, 20], [124, 26, -30], [44, 92, 60], [128, 88, -15], [60, 20, 45], [104, 100, 30], [24, 62, -40], [138, 58, 15]]
        .map(([x, y, turn], index) => `<rect x="${ x - 2.2 }" y="${ y - 4 }" width="4.4" height="8" rx="1" transform="rotate(${ turn } ${ x } ${ y })" fill="${ tones[index % 4] }"/>`).join('');

    return {
        defs: [`<radialGradient id="w-light" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.6"/><stop offset="1" stop-color="${ palette.edge }" stop-opacity="0"/></radialGradient>`, ...sign.defs],
        body: [burst(palette), confetti, '<circle cx="80" cy="60" r="40" fill="url(#w-light)"/>', ...sign.body]
    };
}

/** The kinds a legendary collection draws from its own art; every other kind is drawn from its palette. */
const OWN = { decoration: decorationOf, effect: effectOf, theme: themeOf, celebration: celebrationOf };

// ---------------------------------------------------------------- bundles

function bundle(palette)
{
    const back = backCard(palette, 'c', 58, 60, -10);
    const thrown = die(palette, 'a', 112, 80, 32, 14, 6);
    const pawned = pawn(palette, 'p', 'blue', 114, 44, 0.78);

    return {
        defs: [...realBackDefs(palette), ...crestDefs(palette), ...back.defs, ...thrown.defs, ...pawned.defs],
        body: [...back.body, ...pawned.body, ...thrown.body]
    };
}

const DRAW = {
    decoration,
    effect,
    theme,
    nameplate,
    dice,
    pawns,
    yard,
    back: backs,
    face: faces,
    felt,
    chips,
    checkers,
    home,
    pieces,
    celebration
};

function file(palette, drawn)
{
    const scene = stage(palette);

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W } ${ H }" width="${ W }" height="${ H }">`,
        `<defs>${ [...scene.defs, ...drawn.defs].join('') }</defs>`,
        ...scene.body,
        ...drawn.body,
        scene.over,
        '</svg>'
    ].join('');
}

mkdirSync(OUT, { recursive: true });

for (const name of readdirSync(OUT))
{
    rmSync(join(OUT, name));
}

/** A look's drawing: from its collection's own art for a kind that is its identity, from its palette otherwise. */
const drawingOf = (kind, palette) =>
{
    const line = lineOf(palette);
    return line !== undefined && Object.hasOwn(OWN, kind) ? OWN[kind](palette, line) : DRAW[kind](palette);
};

for (const look of LOOKS)
{
    writeFileSync(join(OUT, `${ look.id }.svg`), file(PALETTES[look.collection], drawingOf(look.kind, PALETTES[look.collection])));
}

for (const one of BUNDLES)
{
    writeFileSync(join(OUT, `${ one.id }.svg`), file(PALETTES[one.collection], bundle(PALETTES[one.collection])));
}

mkdirSync(SIGILS, { recursive: true });

for (const name of readdirSync(SIGILS))
{
    rmSync(join(SIGILS, name));
}

for (const collection of SHOP_COLLECTIONS)
{
    writeFileSync(join(SIGILS, `${ collection }.svg`), sigil(PALETTES[collection]));
}

console.log(`looks: ${ LOOKS.length } looks and ${ BUNDLES.length } bundles in ${ OUT }, and ${ SHOP_COLLECTIONS.length } sigils in ${ SIGILS }`);

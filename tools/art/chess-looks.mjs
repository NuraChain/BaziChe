/**
 * Every collection's chess set, as `table-looks.mjs` writes it (`public/pieces/<collection>-<w|b>
 * <kind>.svg`): the classic set's twelve Staunton pieces (`chess-set.mjs`) on their own footprint,
 * so a piece stands where the classic one does and reads as its kind at a glance, made of the
 * collection's two sides (its pale and its deep, far apart in light) under its pattern, a shade and
 * a rim of its light, trimmed in its metal, and crowned in its own language: the king's cross cast
 * in that metal with a stone at its heart, the queen's coronet and the bishop's mitre tipped with
 * its motif (a flame, a spire, an orb, a wisp, a pearl, a shard, a feather, a horn, a sparkle, a
 * star, a neon diamond, a jewel), the pawn wearing the crest a Ludo pawn of the collection wears,
 * the rook its emblem as a cameo, and the knight its motif down its mane. Every piece is outlined in
 * an ink that, with its body, stands out from both colours of the board's squares.
 */

import { PALETTES } from '../../frontend/src/game/looks/palette.ts';
import { FOOTPRINT, KINDS, shapeOf } from './chess-set.mjs';
import { LEGENDARY } from './legendary/index.mjs';
import { motif, octagram, polygon, r2, sparkle, starOf } from './look-parts.mjs';
import { turned } from './svg-parts.mjs';

export { KINDS };

/** Where the classic set stands its pieces in their 100-unit box, every set's too. */
const STAND = 'translate(50 52) scale(1.08) translate(-50 -52)';

/** A colour taken `share` of the way toward another. */
const toward = (hex, other, share) =>
{
    const channel = (value, at) => Number.parseInt(value.slice(at, at + 2), 16);
    return `#${ [1, 3, 5].map((at) => Math.round(channel(hex, at) + (channel(other, at) - channel(hex, at)) * share).toString(16).padStart(2, '0')).join('').toUpperCase() }`;
};

/**
 * The four collections the shop opened with, as a legendary collection's module draws its set
 * (`chess`): the motif that tips a crown, the crest a pawn wears on its head (in the Ludo pawn's
 * own 256 units, its head at (128, 62) with a radius of 56), the sign on a rook's cameo and the
 * metal of the trims. Each is the collection's own: Nura Glow's sparkles, Shiraz Garden's girih
 * star in gold, Midnight Neon's lit diamond, Royal Gold's jewels.
 */
const HOUSE = {
    glow: {
        metal: ['#FFFFFF', '#FBE7A6', '#C9A24A'],
        accent: (palette, x, y, size, turn, id) => ({
            defs: [`<radialGradient id="${ id }-halo"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.6"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0"/></radialGradient>`],
            body: turned([
                `<circle cx="${ r2(x) }" cy="${ r2(y) }" r="${ r2(size * 1.25) }" fill="url(#${ id }-halo)"/>`,
                `<path d="${ sparkle(x, y, size * 1.15) }" fill="${ palette.glint }" stroke="${ palette.deep[1] }" stroke-width="${ r2(size * 0.16) }" stroke-linejoin="round"/>`,
                `<path d="${ sparkle(x, y, size * 0.45) }" fill="#FFFFFF"/>`
            ].join(''), x, y, turn)
        }),
        crest: (palette) => ({
            defs: [],
            body: [
                '<circle cx="128" cy="62" r="46" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="5"/>',
                `<path d="${ sparkle(150, 30, 24) }" fill="${ palette.glint }" stroke="${ palette.deep[1] }" stroke-width="4" stroke-linejoin="round"/>`,
                `<path d="${ sparkle(150, 30, 9) }" fill="#FFFFFF"/>`,
                `<path d="${ sparkle(104, 18, 11) }" fill="#FFFFFF" stroke="${ palette.deep[1] }" stroke-width="3" stroke-linejoin="round"/>`,
                `<path d="${ sparkle(176, 58, 8) }" fill="${ palette.edge }"/>`
            ]
        }),
        sign: (palette, cx, cy, size) => ({
            defs: [],
            body: [
                `<path d="${ sparkle(cx, cy, size * 0.42) }" fill="${ palette.glint }" stroke="${ palette.deep[2] }" stroke-width="${ r2(size * 0.04) }" stroke-linejoin="round"/>`,
                `<path d="${ sparkle(cx, cy, size * 0.16) }" fill="#FFFFFF"/>`,
                `<path d="${ sparkle(cx + size * 0.3, cy - size * 0.28, size * 0.12) }" fill="#FFFFFF"/>`
            ]
        })
    },
    shiraz: {
        metal: ['#FFF4D6', '#E7BE63', '#9A6B1E'],
        accent: (palette, x, y, size, turn) => ({
            defs: [],
            body: turned([
                `<path d="${ starOf(x, y, size * 1.1, size * 0.5, 8) }" fill="${ palette.edge }" stroke="${ palette.surface[2] }" stroke-width="${ r2(size * 0.16) }" stroke-linejoin="round"/>`,
                `<path d="${ octagram(x, y, size * 0.48) }" fill="none" stroke="${ palette.surface[2] }" stroke-width="${ r2(size * 0.08) }"/>`,
                `<circle cx="${ r2(x) }" cy="${ r2(y) }" r="${ r2(size * 0.26) }" fill="${ palette.piece[1] }" stroke="${ palette.surface[2] }" stroke-width="${ r2(size * 0.08) }"/>`
            ].join(''), x, y, turn)
        }),
        crest: (palette) => ({
            defs: [],
            body: [
                `<path d="M82 50C100 41 156 41 174 50" stroke="${ palette.surface[2] }" stroke-width="12" stroke-linecap="round" fill="none"/>`,
                `<path d="M82 50C100 41 156 41 174 50" stroke="${ palette.edge }" stroke-width="7" stroke-linecap="round" fill="none"/>`,
                `<path d="${ starOf(128, 30, 22, 10, 8) }" fill="${ palette.edge }" stroke="${ palette.surface[2] }" stroke-width="4" stroke-linejoin="round"/>`,
                `<circle cx="128" cy="30" r="7" fill="${ palette.piece[1] }" stroke="${ palette.surface[2] }" stroke-width="3"/>`,
                ...[100, 156].map((x) => `<path d="${ octagram(x, 45, 6) }" fill="${ palette.glint }" stroke="${ palette.surface[2] }" stroke-width="2"/>`)
            ]
        }),
        sign: (palette, cx, cy, size) => ({
            defs: [],
            body: [
                `<path d="${ starOf(cx, cy, size * 0.44, size * 0.2, 8) }" fill="${ palette.surface[2] }" stroke="${ palette.edge }" stroke-width="${ r2(size * 0.06) }" stroke-linejoin="round"/>`,
                `<path d="${ octagram(cx, cy, size * 0.23) }" fill="none" stroke="${ palette.edge }" stroke-width="${ r2(size * 0.04) }"/>`,
                `<circle cx="${ r2(cx) }" cy="${ r2(cy) }" r="${ r2(size * 0.07) }" fill="${ palette.glint }"/>`
            ]
        })
    },
    neon: {
        metal: ['#FFD6F4', '#FF46D2', '#9A1784'],
        glowing: true,
        accent: (palette, x, y, size, turn, id) => ({
            defs: [`<filter id="${ id }-neon" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${ r2(size * 0.3) }"/></filter>`],
            body: turned([
                `<path d="${ polygon(x, y, size, 4, 0) }" fill="none" stroke="${ palette.glint }" stroke-width="${ r2(size * 0.5) }" filter="url(#${ id }-neon)"/>`,
                `<path d="${ polygon(x, y, size, 4, 0) }" fill="${ palette.surface[1] }" stroke="${ palette.glint }" stroke-width="${ r2(size * 0.26) }" stroke-linejoin="round"/>`,
                `<path d="${ polygon(x, y, size * 0.36, 4, 0) }" fill="${ palette.edge }"/>`
            ].join(''), x, y, turn)
        }),
        crest: (palette) => ({
            defs: ['<filter id="crest-neon" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>'],
            body: [
                `<circle cx="128" cy="62" r="30" fill="none" stroke="${ palette.glint }" stroke-width="9" filter="url(#crest-neon)"/>`,
                `<circle cx="128" cy="62" r="30" fill="none" stroke="${ palette.glint }" stroke-width="4.5"/>`,
                `<circle cx="128" cy="62" r="30" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.8"/>`,
                `<path d="${ polygon(128, 62, 11, 4, 0) }" fill="${ palette.edge }" filter="url(#crest-neon)"/>`,
                `<path d="${ polygon(128, 62, 11, 4, 0) }" fill="${ palette.edge }"/>`
            ]
        }),
        sign: (palette, cx, cy, size) => ({
            defs: [],
            body: [
                `<path d="${ polygon(cx, cy, size * 0.38, 4, 0) }" fill="${ palette.surface[1] }" stroke="${ palette.edge }" stroke-width="${ r2(size * 0.07) }" stroke-linejoin="round"/>`,
                `<path d="${ polygon(cx, cy, size * 0.22, 4, 0) }" fill="none" stroke="${ palette.glint }" stroke-width="${ r2(size * 0.06) }" stroke-linejoin="round"/>`
            ]
        })
    },
    gold: {
        metal: ['#FFFAE6', '#E9C565', '#8A6414'],
        accent: (palette, x, y, size, turn, id) => ({
            defs: [`<radialGradient id="${ id }-gem" cx="0.36" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="#E8344A"/><stop offset="1" stop-color="#6A0A18"/></radialGradient>`],
            body: turned([
                `<path d="M${ r2(x) } ${ r2(y - size * 1.4) }C${ r2(x + size * 0.85) } ${ r2(y - size * 0.6) } ${ r2(x + size * 0.8) } ${ r2(y + size * 0.55) } ${ r2(x) } ${ r2(y + size * 0.62) }C${ r2(x - size * 0.8) } ${ r2(y + size * 0.55) } ${ r2(x - size * 0.85) } ${ r2(y - size * 0.6) } ${ r2(x) } ${ r2(y - size * 1.4) }Z" fill="${ palette.edge }" stroke="${ palette.deep[2] }" stroke-width="${ r2(size * 0.16) }" stroke-linejoin="round"/>`,
                `<circle cx="${ r2(x) }" cy="${ r2(y - size * 0.1) }" r="${ r2(size * 0.42) }" fill="url(#${ id }-gem)" stroke="${ palette.deep[2] }" stroke-width="${ r2(size * 0.08) }"/>`
            ].join(''), x, y, turn)
        }),
        crest: (palette) => ({
            defs: ['<radialGradient id="crest-gem" cx="0.36" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="#E8344A"/><stop offset="1" stop-color="#6A0A18"/></radialGradient>'],
            body: [
                `<path d="M84 50L92 24L108 40L128 14L148 40L164 24L172 50C152 44 104 44 84 50Z" fill="${ palette.edge }" stroke="${ palette.deep[2] }" stroke-width="5" stroke-linejoin="round"/>`,
                `<path d="M84 50C104 44 152 44 172 50" stroke="${ palette.deep[2] }" stroke-width="12" stroke-linecap="round" fill="none"/>`,
                `<path d="M84 50C104 44 152 44 172 50" stroke="${ palette.edge }" stroke-width="7" stroke-linecap="round" fill="none"/>`,
                '<circle cx="128" cy="30" r="8" fill="url(#crest-gem)" stroke="#2A1F08" stroke-width="3"/>',
                ...[92, 164].map((x) => `<circle cx="${ x }" cy="24" r="5" fill="${ palette.glint }" stroke="#2A1F08" stroke-width="2.5"/>`)
            ]
        }),
        sign: (palette, cx, cy, size) => ({
            defs: [],
            body: [
                `<path d="M${ r2(cx) } ${ r2(cy - size * 0.42) }C${ r2(cx + size * 0.2) } ${ r2(cy - size * 0.2) } ${ r2(cx + size * 0.2) } ${ r2(cy + size * 0.2) } ${ r2(cx) } ${ r2(cy + size * 0.42) }C${ r2(cx - size * 0.2) } ${ r2(cy + size * 0.2) } ${ r2(cx - size * 0.2) } ${ r2(cy - size * 0.2) } ${ r2(cx) } ${ r2(cy - size * 0.42) }ZM${ r2(cx - size * 0.42) } ${ r2(cy) }C${ r2(cx - size * 0.16) } ${ r2(cy - size * 0.14) } ${ r2(cx + size * 0.16) } ${ r2(cy - size * 0.14) } ${ r2(cx + size * 0.42) } ${ r2(cy) }C${ r2(cx + size * 0.16) } ${ r2(cy + size * 0.14) } ${ r2(cx - size * 0.16) } ${ r2(cy + size * 0.14) } ${ r2(cx - size * 0.42) } ${ r2(cy) }Z" fill="none" stroke="${ palette.edge }" stroke-width="${ r2(size * 0.07) }" stroke-linejoin="round"/>`,
                `<circle cx="${ r2(cx) }" cy="${ r2(cy) }" r="${ r2(size * 0.1) }" fill="${ palette.glint }"/>`
            ]
        })
    }
};

/** A collection's set: its module's, or the one drawn here. */
const setOf = (collection) =>
{
    const line = LEGENDARY[collection];
    return line === undefined
        ? HOUSE[collection]
        : { ...line.chess, crest: line.crest, sign: (palette, cx, cy, size) => line.emblem(palette, cx, cy, size, 'sign') };
};

/**
 * What a side of a set is made of: its body in the collection's pale or deep, the ink round it
 * (the deep's darkest round a light piece, darker still round a dark one), how much of its pattern
 * shows and how bright its gloss is.
 */
export function sideOf(collection, colour)
{
    const palette = PALETTES[collection];
    const light = colour === 'w';
    const set = setOf(collection);

    return {
        body: light ? palette.pale : palette.deep,
        line: light ? palette.deep[2] : (set.glowing ? palette.edge : toward(palette.deep[2], '#000000', 0.55)),
        pattern: light ? 0.26 : 0.42,
        gloss: light ? 0.6 : 0.3
    };
}

/** The shapes of a kind the set keeps; the king's cross, the queen's balls and the bishop's are its own. */
const keptOf = (kind) =>
{
    const own = FOOTPRINT.pieces[kind].filter((shape) => shape.kind !== 'line' && shape.kind !== 'dot');
    const kept = kind === 'k' ? own.filter((_, at) => at !== 3) : (kind === 'q' || kind === 'b' ? own.filter((shape) => shape.kind !== 'circle') : own);
    return [...FOOTPRINT.base, ...kept];
};

/** Where a crown's motifs stand: the queen's five points turned out from her crown, and the bishop's one. */
const TIPS = {
    q: FOOTPRINT.pieces.q.filter((shape) => shape.kind === 'circle').map((ball) => ({ x: ball.cx, y: ball.cy, size: ball.r * 1.05, turn: Math.atan2(ball.cx - 50, 44 - ball.cy) * 180 / Math.PI })),
    b: FOOTPRINT.pieces.b.filter((shape) => shape.kind === 'circle').map((ball) => ({ x: ball.cx, y: ball.cy - 1, size: ball.r * 1.15, turn: 0 }))
};

/** The knight's motifs down the back of his neck, a crest of them over his mane. */
const MANE = [{ x: 62.6, y: 20, size: 4.2, turn: 38 }, { x: 68.8, y: 30.4, size: 3.7, turn: 62 }, { x: 71, y: 43.2, size: 3.2, turn: 82 }];

/** How a Ludo pawn's crest (its 256 units, the head at (128, 62)) sits on the chess pawn's head, a little wider than the head itself. */
const CREST = 'translate(50 37) scale(0.235) translate(-128 -62)';

/**
 * The light that catches a piece's edge from the upper left: a band just inside its outline, its
 * whole silhouette and never the seams between its parts, fading as it turns away from the light.
 */
const rimOf = (colour) => [
    `<filter id="rim" x="-5%" y="-5%" width="110%" height="110%"><feMorphology in="SourceAlpha" operator="erode" radius="1.1" result="outer"/><feMorphology in="SourceAlpha" operator="erode" radius="2.5" result="core"/><feComposite in="outer" in2="core" operator="out" result="band"/><feFlood flood-color="${ colour }"/><feComposite in2="band" operator="in"/><feGaussianBlur stdDeviation="0.35"/></filter>`,
    '<linearGradient id="rim-side" x1="0" y1="0" x2="1" y2="1"><stop offset="0.15" stop-color="#FFFFFF"/><stop offset="0.62" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>',
    '<mask id="lit" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="url(#rim-side)"/></mask>'
];

/** The bands a set's metal trims: round the top of the plinth, and each collar. */
const trimsOf = (kind) =>
{
    const collar = FOOTPRINT.pieces[kind].find((shape) => shape.kind === 'ellipse');
    return [
        'M28.4 80.2C38.4 78.9 61.6 78.9 71.6 80.2',
        ...(collar === undefined ? [] : [`M${ r2(collar.cx - collar.rx) } ${ r2(collar.cy) }A${ collar.rx } ${ collar.ry } 0 0 0 ${ r2(collar.cx + collar.rx) } ${ r2(collar.cy) }`]),
        ...(kind === 'r' ? ['M31.4 46.4H68.6', 'M31.4 38.2H68.6'] : []),
        ...(kind === 'k' ? ['M40.4 40.2C45.8 38.4 54.2 38.4 59.6 40.2'] : [])
    ];
};

/** One piece of a collection's set, as a file of its own. */
export function piece(collection, colour, kind)
{
    const palette = PALETTES[collection];
    const set = setOf(collection);
    const side = sideOf(collection, colour);
    const light = colour === 'w';
    const bodies = keptOf(kind);
    const shapes = bodies.map((shape) => shapeOf(shape, '')).join('');
    const [lit, mid, dark] = side.body;
    const metal = set.metal;
    const defs = [
        `<linearGradient id="body" x1="0.18" y1="0" x2="0.82" y2="1"><stop offset="0" stop-color="${ lit }"/><stop offset="0.55" stop-color="${ mid }"/><stop offset="1" stop-color="${ dark }"/></linearGradient>`,
        `<linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ metal[0] }"/><stop offset="0.5" stop-color="${ metal[1] }"/><stop offset="1" stop-color="${ metal[2] }"/></linearGradient>`,
        '<linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.35" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.32"/></linearGradient>',
        `<radialGradient id="gloss" cx="0.32" cy="0.22" r="0.62"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${ side.gloss }"/><stop offset="0.7" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`,
        motif('pattern', palette, 0.42),
        `<clipPath id="shape">${ shapes }</clipPath>`,
        ...rimOf(light ? '#FFFFFF' : metal[1]),
        ...(set.glowing ? ['<filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter>'] : [])
    ];
    const over = [];
    const under = [];
    const ink = `stroke="${ side.line }" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

    const accent = (at, nth) =>
    {
        const one = set.accent(palette, at.x, at.y, at.size, at.turn, `a${ nth }`);
        defs.push(...one.defs);
        over.push(one.body);
    };

    if (kind === 'q' || kind === 'b')
    {
        TIPS[kind].forEach(accent);
    }

    if (kind === 'n')
    {
        MANE.forEach((at, nth) => accent({ ...at, size: at.size }, nth));
    }

    if (kind === 'k')
    {
        const cross = FOOTPRINT.pieces.k[3];
        over.push(`<path d="${ cross.d }" fill="url(#metal)" ${ ink }/>`);
        over.push(`<path d="M49 9.2V28.2M43.6 15H48.4" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round" opacity="0.55"/>`);
        accent({ x: 50, y: 16.2, size: 2.6, turn: 0 }, 0);
    }

    if (kind === 'p')
    {
        const crest = set.crest(palette, 'crest');
        defs.push(...crest.defs);
        under.push(...(crest.back ?? []).map((part) => `<g transform="${ CREST }">${ part }</g>`));
        over.push(`<g transform="${ CREST }">${ crest.body.join('') }</g>`);
    }

    if (kind === 'r')
    {
        const sign = set.sign(palette, 50, 63.4, 17);
        defs.push(...sign.defs);
        over.push(`<circle cx="50" cy="63.4" r="9.6" fill="${ light ? palette.deep[1] : toward(palette.deep[2], '#000000', 0.3) }" stroke="url(#metal)" stroke-width="1.6"/>`);
        over.push(`<circle cx="50" cy="63.4" r="7.9" fill="none" stroke="${ side.line }" stroke-width="0.6" opacity="0.7"/>`);
        over.push(...sign.body);
    }

    const details = FOOTPRINT.pieces[kind].filter((shape) => shape.kind === 'line' || shape.kind === 'dot').filter((shape) => !(kind === 'r' || kind === 'k'));
    const detailed = details.map((shape) =>
    {
        if (shape.kind === 'dot')
        {
            return `<circle cx="${ shape.cx }" cy="${ shape.cy }" r="${ shape.r }" fill="${ side.line }"/>${ shape.r > 2 ? `<circle cx="${ r2(shape.cx - 0.7) }" cy="${ r2(shape.cy - 0.7) }" r="0.75" fill="${ palette.glint }"/>` : '' }`;
        }

        return `<path d="${ shape.d }" fill="none" stroke="${ side.line }" stroke-width="3" stroke-linecap="round" opacity="0.75"/><path d="${ shape.d }" fill="none" stroke="url(#metal)" stroke-width="1.5" stroke-linecap="round"/>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs>
${ defs.join('\n') }
</defs>
<g transform="${ STAND }">
${ under.join('\n') }
${ set.glowing && !light ? `<g fill="none" stroke="${ palette.edge }" stroke-width="3.4" stroke-linejoin="round" filter="url(#edge-glow)" opacity="0.75">${ shapes }</g>` : '' }
<g fill="url(#body)" ${ ink }>${ shapes }</g>
<g clip-path="url(#shape)">
<rect x="0" y="0" width="100" height="100" fill="url(#pattern)" opacity="${ side.pattern }"/>
<rect x="0" y="0" width="100" height="100" fill="url(#shade)"/>
</g>
<g fill="#000000" filter="url(#rim)" mask="url(#lit)" opacity="${ light ? 0.8 : 0.9 }">${ shapes }</g>
<g fill="none" stroke="url(#metal)" stroke-width="1.5" stroke-linecap="round">${ trimsOf(kind).map((d) => `<path d="${ d }"/>`).join('') }</g>
${ detailed.join('\n') }
<g fill="url(#gloss)">${ shapes }</g>
${ over.join('\n') }
</g>
</svg>
`;
}

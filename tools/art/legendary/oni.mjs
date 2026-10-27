/**
 * Neon Oni: holographic film over black chrome, circuit traces and a hex grid, and the horned mask.
 * Digital: it stutters, glitches and is crossed by scanlines.
 */
import { at, C, linear, r2, RING, seeded } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'circuits';

const CHROME = '#07080D';
const CRIMSON = '#FF2E4D';
const CYAN = '#20E6FF';
const VIOLET = '#7C5CFF';

/** A neon line: a soft haze of its colour, its body, and a white core. */
const neon = (path, colour, width) => `<path d="${ path }" fill="none" stroke="${ colour }" stroke-width="${ r2(width * 3) }" stroke-linejoin="round" stroke-linecap="round" opacity="0.3"/><path d="${ path }" fill="none" stroke="${ colour }" stroke-width="${ r2(width) }" stroke-linejoin="round" stroke-linecap="round"/><path d="${ path }" fill="none" stroke="#FFFFFF" stroke-width="${ r2(width * 0.35) }" stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/>`;

/** Circuit traces with their pads, a tile 32 across whose traces meet their neighbours'. */
export const tile = (palette) => ({
    size: 32,
    body: `<path d="M0 8H10L14 12V20H22L26 16H32M14 20V32M22 20V26L26 30H32M0 26H6L8 24" fill="none" stroke="${ palette.edge }" stroke-width="0.8" stroke-linejoin="round" opacity="0.85"/><circle cx="14" cy="12" r="1.3" fill="none" stroke="${ palette.glint }" stroke-width="0.7"/><circle cx="8" cy="24" r="1.1" fill="${ palette.glint }"/><circle cx="26" cy="16" r="1.1" fill="${ palette.edge }"/>`
});

/** An oni's mask, `size` across at (cx, cy): angular plates, two horns, slit eyes and fangs, in neon on chrome. */
const mask = (cx, cy, size) =>
{
    const s = size / 50;
    const p = (x, y) => `${ r2(cx + x * s) } ${ r2(cy + y * s) }`;
    return {
        face: `M${ p(-16, -10) }L${ p(-8, -16) }L${ p(8, -16) }L${ p(16, -10) }L${ p(18, 4) }L${ p(10, 16) }L${ p(0, 20) }L${ p(-10, 16) }L${ p(-18, 4) }Z`,
        horns: `M${ p(-11, -14) }L${ p(-20, -30) }L${ p(-6, -16) }M${ p(11, -14) }L${ p(20, -30) }L${ p(6, -16) }`,
        eyes: `M${ p(-12, -3) }L${ p(-4, 0) }M${ p(12, -3) }L${ p(4, 0) }`,
        mouth: `M${ p(-8, 9) }L${ p(-4, 12) }L${ p(-2, 9) }L${ p(2, 9) }L${ p(4, 12) }L${ p(8, 9) }`,
        brow: `M${ p(-7, -10) }L${ p(0, -7) }L${ p(7, -10) }`
    };
};

/** The collection's sign: the oni's mask in crimson neon with cyan eyes, in a hexagon. */
export function emblem(palette, cx, cy, size, id = 'oni')
{
    const s = size / 50;
    const one = mask(cx, cy + 4 * s, size * 0.9);
    const hex = Array.from({ length: 6 }, (_, side) =>
    {
        const angle = side * Math.PI / 3;
        return `${ r2(cx + Math.cos(angle) * 25 * s) } ${ r2(cy + Math.sin(angle) * 25 * s) }`;
    }).join('L');

    return {
        defs: [`<linearGradient id="${ id }-chrome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A2E3E"/><stop offset="0.5" stop-color="#11131C"/><stop offset="1" stop-color="${ CHROME }"/></linearGradient>`],
        body: [
            `<path d="M${ hex }Z" fill="none" stroke="${ VIOLET }" stroke-width="${ r2(1 * s) }" opacity="0.8"/>`,
            `<path d="${ one.face }" fill="url(#${ id }-chrome)"/>`,
            neon(one.face, CRIMSON, 1.3 * s),
            neon(one.horns, CRIMSON, 1.3 * s),
            neon(one.brow, CRIMSON, 0.9 * s),
            neon(one.eyes, CYAN, 1.6 * s),
            neon(one.mouth, CYAN, 0.9 * s)
        ]
    };
}

/** The horned mask on the pawn's head (centre (128, 62), radius 56): two chrome horns edged in crimson neon and a cyan visor. */
export function crest(palette, id = 'crest')
{
    const horn = (side) => `M${ 128 + side * 26 } 22L${ 128 + side * 50 } -2L${ 128 + side * 44 } 30Z`;

    return {
        defs: [`<linearGradient id="${ id }" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A3F52"/><stop offset="0.6" stop-color="#11131C"/><stop offset="1" stop-color="${ CHROME }"/></linearGradient>`],
        body: [
            ...[-1, 1].map((side) => `<path d="${ horn(side) }" fill="url(#${ id })" stroke="${ CHROME }" stroke-width="6" stroke-linejoin="round"/>`),
            ...[-1, 1].map((side) => neon(horn(side), CRIMSON, 2.4)),
            `<path d="M82 60L102 52H154L174 60L166 72H90Z" fill="${ CHROME }" stroke="${ CHROME }" stroke-width="5" stroke-linejoin="round"/>`,
            neon('M92 62H164', CYAN, 4),
            neon('M100 76L110 82L118 76M138 76L146 82L156 76', CRIMSON, 2)
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/** A trace along the band from `from` to `to`, stepping out and in again like a circuit's. */
const trace = (from, to, inner) =>
{
    const r = RING + (inner ? -1.6 : 1.6);
    const out = RING + (inner ? 1.2 : -1.2);
    const mid = (from + to) / 2;
    return `M${ at(r, from).join(' ') }L${ at(r, mid - 4).join(' ') }L${ at(out, mid - 2).join(' ') }L${ at(out, mid + 2).join(' ') }L${ at(r, mid + 4).join(' ') }L${ at(r, to).join(' ') }`;
};

/**
 * Neon Oni's frame: a band of black chrome with crimson and cyan traces running round it, a
 * horned mask at its top whose eyes stutter, glitch blocks that jump, and a scanline that sweeps.
 */
export function frame(palette, still)
{
    const stutter = still ? '' : '<animate attributeName="opacity" values="1;0.2;1;1;0.4;1;1" keyTimes="0;0.08;0.16;0.6;0.66;0.72;1" calcMode="discrete" dur="2.6s" repeatCount="indefinite"/>';
    const jump = (offset) => (still ? '' : `<animateTransform attributeName="transform" type="translate" values="0 0;1.6 0;0 0;-1.2 0;0 0" keyTimes="0;0.1;0.2;0.3;1" calcMode="discrete" dur="${ r2(1.8 + offset) }s" repeatCount="indefinite"/>`);
    const sweep = still ? '' : `<animateTransform attributeName="transform" type="rotate" values="0 ${ C } ${ C };360 ${ C } ${ C }" dur="4s" repeatCount="indefinite"/>`;

    const traces = [[24, 74, true, CYAN], [96, 150, false, CRIMSON], [168, 222, true, CYAN], [240, 300, false, CRIMSON], [312, 340, true, VIOLET]].map(([from, to, inner, colour]) => neon(trace(from, to, inner), colour, 0.45)).join('');

    const pads = [24, 74, 96, 150, 168, 222, 240, 300].map((turn) =>
    {
        const [x, y] = at(RING, turn);
        return `<rect x="${ r2(x - 1) }" y="${ r2(y - 1) }" width="2" height="2" fill="${ CHROME }" stroke="${ palette.glint }" stroke-width="0.4"/>`;
    }).join('');

    const glitches = [[60, 3.4, 1.2, CYAN], [200, 4.2, 1, CRIMSON], [280, 2.8, 1.2, VIOLET]].map(([turn, wide, tall, colour], index) =>
    {
        const [x, y] = at(RING + 4.8, turn);
        return `<g>${ jump(index * 0.4) }<rect x="${ r2(x - wide / 2) }" y="${ r2(y - tall / 2) }" width="${ wide }" height="${ tall }" fill="${ colour }" opacity="0.85"/></g>`;
    }).join('');

    const face = mask(C, 10, 20);

    return {
        defs: [
            '<linearGradient id="chrome" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#3A3F52"/><stop offset="0.45" stop-color="#14161F"/><stop offset="1" stop-color="#030305"/></linearGradient>',
            `<linearGradient id="film" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ CRIMSON }" stop-opacity="0.35"/><stop offset="0.5" stop-color="${ VIOLET }" stop-opacity="0.15"/><stop offset="1" stop-color="${ CYAN }" stop-opacity="0.35"/></linearGradient>`,
            '<filter id="buzz" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.8"/></filter>'
        ],
        body: [
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ CRIMSON }" stroke-width="9" opacity="0.25" filter="url(#buzz)"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="#000000" stroke-width="8.2"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#chrome)" stroke-width="6.6"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#film)" stroke-width="6.6"/>`,
            traces,
            pads,
            glitches,
            `<g opacity="${ still ? 0 : 0.8 }">${ sweep }<path d="M${ at(RING - 3.2, -6).join(' ') }L${ at(RING + 3.2, -6).join(' ') }" stroke="${ CYAN }" stroke-width="1.4" stroke-linecap="round"/></g>`,
            `<path d="${ face.face }" fill="#000000"/>`,
            neon(face.face, CRIMSON, 0.55),
            neon(face.horns, CRIMSON, 0.55),
            `<g>${ stutter }${ neon(face.eyes, CYAN, 0.75) }</g>`,
            neon(face.mouth, CYAN, 0.4)
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** Neon Oni's cover: a hex grid on black chrome, circuit traces, scanlines, glitch blocks, and the mask. */
export function cover(palette)
{
    const next = seeded(37);
    const hexes = Array.from({ length: 13 }, (_, column) => Array.from({ length: 5 }, (_, row) =>
    {
        const x = column * 52 + (row % 2 === 0 ? 0 : 26);
        const y = row * 46 + 12;
        const points = Array.from({ length: 6 }, (_, side) => `${ r2(x + Math.cos(side * Math.PI / 3 + Math.PI / 6) * 26) } ${ r2(y + Math.sin(side * Math.PI / 3 + Math.PI / 6) * 26) }`).join('L');
        return `<path d="M${ points }Z" fill="none" stroke="${ VIOLET }" stroke-width="0.8" opacity="${ r2(0.12 + next() * 0.2) }"/>`;
    }).join('')).join('');
    const glitch = Array.from({ length: 26 }, () => `<rect x="${ r2(next() * 640) }" y="${ r2(next() * 240) }" width="${ r2(10 + next() * 60) }" height="${ r2(2 + next() * 6) }" fill="${ next() < 0.5 ? CRIMSON : CYAN }" opacity="${ r2(0.2 + next() * 0.5) }"/>`).join('');
    const scan = Array.from({ length: 60 }, (_, row) => `<rect y="${ row * 4 }" width="960" height="1" fill="#FFFFFF" opacity="0.03"/>`).join('');
    const sign = emblem(palette, 760, 120, 96, 'sign');

    return {
        defs: [
            linear('ground', ['#16101E', '#0A0810', CHROME], [0, 0, 1, 1]),
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            hexes,
            neon('M0 60H140L170 90H320L350 60H520', CRIMSON, 1.2),
            neon('M0 190H90L120 160H260L290 190H470L500 160H600', CYAN, 1.2),
            glitch,
            scan,
            `<circle cx="760" cy="120" r="80" fill="#000000" opacity="0.92"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="${ CRIMSON }" stroke-width="2.4"/>`,
            `<circle cx="760" cy="120" r="73" fill="none" stroke="${ CYAN }" stroke-width="0.8" opacity="0.7"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.2" fill="${ CRIMSON }" opacity="0.6"/><rect y="230.8" width="960" height="1.2" fill="${ CYAN }" opacity="0.6"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: black chrome paper, cyan and crimson neon inks (each at 4.5:1 or more on both stops), courts edged in neon. */
export const dress = {
    paper: ['#160B12', '#0A0508'],
    suits: [
        { name: 'club', ink: CYAN, tint: '#0E1A22', accent: '#14A8C0' },
        { name: 'diamond', ink: '#FF4D6A', tint: '#26080F', accent: '#D0243E' },
        { name: 'heart', ink: '#FF4D6A', tint: '#26080F', accent: '#D0243E' },
        { name: 'spade', ink: CYAN, tint: '#0E1A22', accent: '#14A8C0' }
    ],
    metal: { band: CRIMSON, line: '#5A0A1A', frame: CYAN, crown: CRIMSON, jewel: '#FFFFFF' }
};

/** What every card wears in the corners its indices leave free: a circuit trace and its pad. */
export const ornament = (W, H) => `<path d="M${ W - 40 } 14H${ W - 24 }L${ W - 16 } 22V36" fill="none" stroke="${ CYAN }" stroke-width="1.6" stroke-linejoin="round" opacity="0.5"/><circle cx="${ W - 16 }" cy="38" r="2.4" fill="none" stroke="${ CYAN }" stroke-width="1.4" opacity="0.5"/><path d="M40 ${ H - 14 }H24L16 ${ H - 22 }V${ H - 36 }" fill="none" stroke="${ CYAN }" stroke-width="1.6" stroke-linejoin="round" opacity="0.5"/><circle cx="16" cy="${ H - 38 }" r="2.4" fill="none" stroke="${ CYAN }" stroke-width="1.4" opacity="0.5"/>`;

/** Its card back's border, and the emblem at its middle: the mask in its hexagon. */
export const back = {
    border: CHROME,
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2, 80, 'back');
        return { defs: sign.defs, body: sign.body };
    }
};

// ---------------------------------------------------------------- the pawn

/** A pawn: the seat's colour in enamel set in black chrome traced with neon at its foot and collar, horned, with a visor. */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.oni;
    const horns = crest(palette, 'horns');

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('chrome', [[0, '#3A3F52'], [0.45, '#14161F'], [1, '#030305']]),
        ...horns.defs
    ], [
        kit.outlined({ foot: 'url(#chrome)', base: 'url(#chrome)', body: 'url(#enamel)', collar: 'url(#chrome)', head: 'url(#dome)' }, CHROME),
        neon('M72 192H96L104 198H152L160 192H184', CYAN, 2.6),
        neon('M96 108H112L118 104H138L144 108H160', CRIMSON, 2),
        ...kit.lighting(dark, '#FFFFFF', 0.5),
        ...horns.body
    ]);
}

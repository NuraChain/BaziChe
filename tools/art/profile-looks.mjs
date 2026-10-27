/**
 * What a profile wears, drawn from each collection's palette (`game/looks/palette.ts`):
 *
 * - `frontend/public/frames/<collection>.svg`, a ring round a picture of any size, its motion in
 *   the drawing, and `<collection>-still.svg`, the same at rest for somebody who asked for less;
 * - `frontend/public/plates/<collection>.svg`, the ground a name sits on;
 * - `frontend/public/covers/<collection>.svg`, a profile's banner.
 *
 * A frame is 120 units square with the picture a circle of radius 48 at its middle, so the page
 * lays it a quarter of the picture's width wider than the picture and the ring falls round it.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';
import { linear, motif, octagram, r2, sparkle, starOf } from './look-parts.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public');

const C = 60;
const RING = 52.5;

/** A point on a circle round the frame's middle, a turn of 0 at the top and going clockwise. */
const at = (r, turn) =>
{
    const angle = (turn - 90) * Math.PI / 180;
    return [r2(C + r * Math.cos(angle)), r2(C + r * Math.sin(angle))];
};

const arc = (r, from, to) =>
{
    const [x1, y1] = at(r, from);
    const [x2, y2] = at(r, to);
    return `M${ x1 } ${ y1 }A${ r } ${ r } 0 ${ to - from > 180 ? 1 : 0 } 1 ${ x2 } ${ y2 }`;
};

const ring = (r, stroke, width, extra = '') => `<circle cx="${ C }" cy="${ C }" r="${ r }" fill="none" stroke="${ stroke }" stroke-width="${ width }"${ extra }/>`;

/** A seeded sequence, so every drawing comes out the same each time it is drawn. */
const seeded = (seed) =>
{
    let state = seed;
    return () =>
    {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
};

const SOFT = '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>';
const GLOW = '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.5" result="soft"/><feMerge><feMergeNode in="soft"/><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';

const EASE = 'calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"';

// ---------------------------------------------------------------- frames

/** The motions of a frame, written only into the drawing that moves. */
const motion = (still) => ({
    spin: (seconds, back = false) => (still ? '' : `<animateTransform attributeName="transform" type="rotate" from="0 ${ C } ${ C }" to="${ back ? -360 : 360 } ${ C } ${ C }" dur="${ seconds }s" repeatCount="indefinite"/>`),
    breathe: (low, high, seconds, offset = 0) => (still ? '' : `<animate attributeName="opacity" values="${ high };${ low };${ high }" keyTimes="0;0.5;1" ${ EASE } dur="${ seconds }s" begin="${ -offset }s" repeatCount="indefinite"/>`)
});

function frameGlow(palette, still)
{
    const move = motion(still);
    const defs = [
        linear('ring', palette.piece, [0, 0, 1, 1]),
        `<radialGradient id="core"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="${ palette.glint }"/></radialGradient>`,
        SOFT
    ];

    const sparkles = [[300, 7, 0], [38, 5.2, 0.8], [148, 6, 1.6], [214, 4, 0.4], [96, 3.4, 1.2]].map(([turn, size, offset]) =>
    {
        const [x, y] = at(52, turn);
        return `<g>${ move.breathe(0.35, 1, 2.6, offset) }<path d="${ sparkle(x, y, size) }" fill="${ palette.glint }"/><path d="${ sparkle(x, y, size * 0.45) }" fill="url(#core)"/></g>`;
    }).join('');

    return {
        defs,
        body: [
            ring(53.6, palette.edge, 7, ' opacity="0.3" filter="url(#soft)"'),
            ring(RING, 'url(#ring)', 6),
            ring(55.5, palette.piece[2], 0.9),
            ring(49.5, '#FFFFFF', 0.8, ' opacity="0.5"'),
            `<path d="${ arc(RING, 290, 340) }" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" opacity="0.75"/>`,
            `<g>${ move.spin(26, true) }${ ring(RING, '#FFFFFF', 1.1, ' stroke-dasharray="0.1 6.6" stroke-linecap="round" opacity="0.9"') }</g>`,
            `<g>${ move.spin(16) }${ sparkles }</g>`
        ]
    };
}

function frameShiraz(palette, still)
{
    const move = motion(still);
    const defs = [
        linear('tile', palette.piece, [0, 0, 1, 1]),
        linear('lapis', palette.deep, [0, 0, 1, 1]),
        linear('gilt', [palette.glint, palette.edge, '#9A7424'], [0, 0, 1, 1])
    ];

    const tiles = Array.from({ length: 16 }, (_, index) =>
    {
        const from = index * 22.5 + 1.2;
        const to = (index + 1) * 22.5 - 1.2;
        return [
            `<path d="${ arc(RING, from, to) }" fill="none" stroke="url(#${ index % 2 === 0 ? 'tile' : 'lapis' })" stroke-width="7.6"/>`,
            `<path d="${ arc(RING + 2.6, from + 2, to - 2) }" fill="none" stroke="#FFFFFF" stroke-width="0.8" opacity="0.4" stroke-linecap="round"/>`
        ].join('');
    }).join('');

    const stars = [0, 90, 180, 270].map((turn) =>
    {
        const [x, y] = at(RING, turn);
        return `<path d="${ starOf(x, y, 6.4, 3, 8) }" fill="url(#gilt)" stroke="#7A5A16" stroke-width="0.5"/><circle cx="${ x }" cy="${ y }" r="1.5" fill="${ palette.glint }"/>`;
    }).join('');

    return {
        defs,
        body: [
            ring(RING, palette.edge, 9.4),
            tiles,
            ring(47.8, palette.edge, 1.2),
            ring(57.3, palette.edge, 1.2),
            ring(48.9, '#000000', 1, ' opacity="0.3"'),
            `<g>${ move.spin(11) }<path d="${ arc(RING, 0, 46) }" fill="none" stroke="#FFFFFF" stroke-width="7.6" opacity="${ still ? 0 : 0.16 }"/><path d="${ arc(RING, 16, 34) }" fill="none" stroke="#FFFFFF" stroke-width="7.6" opacity="${ still ? 0 : 0.18 }"/></g>`,
            `<g>${ move.breathe(0.82, 1, 3.2) }${ stars }</g>`
        ]
    };
}

function frameNeon(palette, still)
{
    const move = motion(still);
    const defs = [linear('glass', palette.piece, [0, 0, 1, 1]), GLOW];

    const ticks = Array.from({ length: 24 }, (_, index) =>
    {
        const [x1, y1] = at(50.4, index * 15);
        const [x2, y2] = at(54.6, index * 15);
        return `M${ x1 } ${ y1 }L${ x2 } ${ y2 }`;
    }).join('');

    const [hx, hy] = at(RING, 72);

    return {
        defs,
        body: [
            ring(RING, 'url(#glass)', 8.6),
            ring(RING + 2.6, '#FFFFFF', 0.6, ' opacity="0.14"'),
            `<path d="${ ticks }" stroke="${ palette.glint }" stroke-width="0.7" opacity="0.35"/>`,
            `<g filter="url(#glow)">${ move.breathe(0.62, 1, 2.8) }${ ring(56.4, palette.edge, 1.8) }</g>`,
            `<g filter="url(#glow)">${ ring(48.8, palette.glint, 1.3) }</g>`,
            `<g>${ move.spin(4.4) }`
                + `<path d="${ arc(RING, 0, 72) }" fill="none" stroke="${ palette.glint }" stroke-width="2.4" opacity="0.14" stroke-linecap="round"/>`
                + `<path d="${ arc(RING, 34, 72) }" fill="none" stroke="${ palette.glint }" stroke-width="2.4" opacity="0.36" stroke-linecap="round"/>`
                + `<path d="${ arc(RING, 56, 72) }" fill="none" stroke="${ palette.glint }" stroke-width="2.4" opacity="0.72" stroke-linecap="round" filter="url(#glow)"/>`
                + `<circle cx="${ hx }" cy="${ hy }" r="2" fill="#FFFFFF" filter="url(#glow)"/></g>`
        ]
    };
}

function frameGold(palette, still)
{
    const defs = [
        linear('gold', palette.piece, [0, 0, 1, 1]),
        linear('bevel', [palette.glint, palette.pale[1], palette.piece[2]], [0, 0, 0, 1])
    ];

    const curls = Array.from({ length: 12 }, (_, index) =>
    {
        const turn = index * 30 + 15;
        const [x, y] = at(RING, turn);
        return `<path d="M-3.4 0.6C-3.4 -1.8 -0.9 -2.4 0 -0.8C0.9 0.8 3.4 0.4 3.4 -1.8" transform="translate(${ x } ${ y }) rotate(${ turn })" fill="none" stroke="${ palette.glint }" stroke-width="0.7" stroke-linecap="round" opacity="0.85"/>`;
    }).join('');

    const gems = [120, 240].map((turn) =>
    {
        const [x, y] = at(RING, turn);
        return `<circle cx="${ x }" cy="${ y }" r="2.9" fill="url(#bevel)" stroke="#5E430E" stroke-width="0.5"/><circle cx="${ r2(x - 0.9) }" cy="${ r2(y - 0.9) }" r="0.8" fill="#FFFFFF" opacity="0.9"/>`;
    }).join('');

    const [sx, sy] = at(RING, 0);
    const sweep = still ? '' : [
        `<animateTransform attributeName="transform" type="rotate" values="-60 ${ C } ${ C };240 ${ C } ${ C };240 ${ C } ${ C }" keyTimes="0;0.55;1" calcMode="spline" keySplines="0.42 0 0.2 1;0 0 1 1" dur="5.6s" repeatCount="indefinite"/>`,
        '<animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.08;0.47;0.55;1" dur="5.6s" repeatCount="indefinite"/>'
    ].join('');

    return {
        defs,
        body: [
            ring(RING, palette.piece[2], 7.4),
            ring(RING, 'url(#gold)', 5.8),
            ring(RING - 1.9, '#FFFFFF', 0.5, ' opacity="0.5"'),
            ring(48.3, palette.piece[1], 0.9),
            ring(56.7, palette.piece[1], 0.9),
            curls,
            gems,
            `<path d="${ starOf(sx, sy, 6.2, 2.6, 5) }" fill="url(#bevel)" stroke="#5E430E" stroke-width="0.5"/>`,
            `<circle cx="${ sx }" cy="${ r2(sy - 1) }" r="1" fill="#FFFFFF"/>`,
            still ? '' : `<g opacity="0">${ sweep }<path d="${ arc(RING, -22, 22) }" fill="none" stroke="#FFFFFF" stroke-width="4.6" stroke-linecap="round" opacity="0.55"/></g>`
        ]
    };
}

const FRAMES = { sparkle: frameGlow, girih: frameShiraz, grid: frameNeon, filigree: frameGold };

const frame = (palette, still) =>
{
    const drawn = FRAMES[palette.pattern](palette, still);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><defs>${ drawn.defs.join('') }</defs>${ drawn.body.join('') }</svg>`;
};

// ---------------------------------------------------------------- plates

function plate(palette)
{
    const edges = palette.pattern === 'grid'
        ? `<rect y="38.4" width="240" height="1.6" fill="${ palette.edge }" opacity="0.95"/><rect width="240" height="0.9" fill="${ palette.glint }" opacity="0.6"/>`
        : '';

    const grain = palette.pattern === 'filigree'
        ? Array.from({ length: 9 }, (_, index) => `<rect y="${ 3 + index * 4 }" width="240" height="0.6" fill="#FFFFFF" opacity="${ 0.03 + (index % 3) * 0.02 }"/>`).join('')
        : '';

    return [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40" width="240" height="40" preserveAspectRatio="xMidYMid slice">',
        `<defs>${ linear('ground', palette.surface, [0, 0, 1, 0.3]) }${ motif('motif', palette, 0.55) }<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>`,
        '<rect width="240" height="40" fill="url(#ground)"/>',
        '<rect width="240" height="40" fill="url(#motif)" opacity="0.2"/>',
        grain,
        '<rect width="240" height="20" fill="url(#sheen)"/>',
        edges,
        '</svg>'
    ].join('');
}

// ---------------------------------------------------------------- covers

function coverGlow(palette)
{
    const next = seeded(7);
    const stars = Array.from({ length: 46 }, (_, index) =>
    {
        const x = r2(40 + next() * 900);
        const y = r2(14 + next() * 200);
        const size = r2(1 + next() * (index % 7 === 0 ? 6 : 3));
        const tone = index % 3 === 0 ? '#FFFFFF' : (index % 3 === 1 ? palette.glint : palette.edge);
        return `<path d="${ sparkle(x, y, size) }" fill="${ tone }" opacity="${ r2(0.45 + next() * 0.5) }"/>`;
    }).join('');

    const big = [[728, 104, 30], [842, 168, 13], [628, 176, 10], [906, 58, 8]].map(([x, y, size]) =>
        `<path d="${ sparkle(x, y, size * 1.5) }" fill="${ palette.glint }" opacity="0.18" filter="url(#soft)"/><path d="${ sparkle(x, y, size) }" fill="${ palette.glint }"/><path d="${ sparkle(x, y, size * 0.42) }" fill="#FFFFFF"/>`).join('');

    return {
        defs: [
            linear('sky', [palette.surface[1], palette.ground[1], palette.ground[2]], [0, 0, 1, 1]),
            `<radialGradient id="light" cx="0.76" cy="0.36" r="0.6"><stop offset="0" stop-color="${ palette.piece[1] }" stop-opacity="0.62"/><stop offset="1" stop-color="${ palette.piece[1] }" stop-opacity="0"/></radialGradient>`,
            `<radialGradient id="low" cx="0.12" cy="1" r="0.55"><stop offset="0" stop-color="${ palette.edge }" stop-opacity="0.28"/><stop offset="1" stop-color="${ palette.edge }" stop-opacity="0"/></radialGradient>`,
            motif('pattern', palette, 1.6),
            SOFT
        ],
        body: [
            '<rect width="960" height="240" fill="url(#sky)"/>',
            '<rect width="960" height="240" fill="url(#light)"/>',
            '<rect width="960" height="240" fill="url(#low)"/>',
            '<rect width="960" height="240" fill="url(#pattern)" opacity="0.1"/>',
            `<ellipse cx="728" cy="104" rx="96" ry="34" fill="none" stroke="${ palette.edge }" stroke-width="1.2" stroke-dasharray="1 9" stroke-linecap="round" opacity="0.5" transform="rotate(-14 728 104)"/>`,
            `<ellipse cx="728" cy="104" rx="150" ry="56" fill="none" stroke="${ palette.edge }" stroke-width="0.9" stroke-dasharray="1 12" stroke-linecap="round" opacity="0.35" transform="rotate(-14 728 104)"/>`,
            stars,
            big
        ]
    };
}

function coverShiraz(palette)
{
    const rosette = (cx, cy, size) => [
        `<path d="${ starOf(cx, cy, size, size * 0.72, 16) }" fill="url(#tile)" stroke="${ palette.edge }" stroke-width="2.2"/>`,
        `<path d="${ starOf(cx, cy, size * 0.66, size * 0.4, 8) }" fill="url(#lapis)" stroke="${ palette.edge }" stroke-width="1.8"/>`,
        `<path d="${ octagram(cx, cy, size * 0.32) }" fill="none" stroke="${ palette.edge }" stroke-width="1.6"/>`,
        `<circle cx="${ cx }" cy="${ cy }" r="${ r2(size * 0.12) }" fill="#C2263A" stroke="${ palette.edge }" stroke-width="1.4"/>`,
        `<circle cx="${ r2(cx - size * 0.04) }" cy="${ r2(cy - size * 0.04) }" r="${ r2(size * 0.035) }" fill="#FFFFFF" opacity="0.7"/>`
    ].join('');

    const seeds = Array.from({ length: 8 }, (_, index) =>
    {
        const angle = (index * 45 + 22.5) * Math.PI / 180;
        const x = r2(760 + 70 * Math.cos(angle));
        const y = r2(120 + 70 * Math.sin(angle));
        return `<path d="M${ x } ${ r2(y - 5) }L${ r2(x + 3.4) } ${ y }L${ x } ${ r2(y + 5) }L${ r2(x - 3.4) } ${ y }Z" fill="#C2263A" stroke="#7F1424" stroke-width="0.6"/>`;
    }).join('');

    return {
        defs: [
            linear('ground', palette.surface, [0, 0, 1, 1]),
            linear('tile', palette.piece, [0, 0, 1, 1]),
            linear('lapis', palette.deep, [0, 0, 1, 1]),
            motif('pattern', palette, 2.4),
            '<radialGradient id="glaze" cx="0.25" cy="0" r="0.8"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.2"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>'
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            '<rect width="960" height="240" fill="url(#pattern)" opacity="0.42"/>',
            '<rect width="960" height="240" fill="url(#glaze)"/>',
            rosette(760, 120, 116),
            seeds,
            `<rect y="232" width="960" height="2" fill="${ palette.edge }" opacity="0.7"/>`
        ]
    };
}

function coverNeon(palette)
{
    const horizon = 150;
    const floor = [
        ...Array.from({ length: 7 }, (_, index) =>
        {
            const y = r2(horizon + 4 + (index + 1) ** 1.8 * 2.6);
            return `M0 ${ y }H960`;
        }),
        ...Array.from({ length: 25 }, (_, index) =>
        {
            const x = (index - 12) * 120;
            return `M720 ${ horizon }L${ 720 + x * 2.4 } 240`;
        })
    ].join('');

    const stripes = [12, 26, 38, 48, 56].map((offset, index) => `<rect x="640" y="${ horizon - offset }" width="160" height="${ 2 + index * 0.8 }" fill="${ palette.surface[1] }"/>`).join('');

    const next = seeded(23);
    const stars = Array.from({ length: 34 }, () => `<circle cx="${ r2(next() * 960) }" cy="${ r2(next() * 120) }" r="${ r2(0.6 + next() * 1.2) }" fill="#FFFFFF" opacity="${ r2(0.3 + next() * 0.6) }"/>`).join('');

    return {
        defs: [
            `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ palette.surface[2] }"/><stop offset="0.55" stop-color="${ palette.ground[0] }"/><stop offset="0.62" stop-color="#3B0E4A"/><stop offset="1" stop-color="${ palette.surface[2] }"/></linearGradient>`,
            `<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ palette.glint }"/><stop offset="1" stop-color="${ palette.edge }"/></linearGradient>`,
            `<radialGradient id="haze" cx="0.75" cy="0.62" r="0.5"><stop offset="0" stop-color="${ palette.edge }" stop-opacity="0.45"/><stop offset="1" stop-color="${ palette.edge }" stop-opacity="0"/></radialGradient>`,
            `<clipPath id="above"><rect width="960" height="${ horizon }"/></clipPath>`,
            `<clipPath id="disc"><circle cx="720" cy="${ horizon }" r="74"/></clipPath>`,
            `<clipPath id="below"><rect y="${ horizon }" width="960" height="${ 240 - horizon }"/></clipPath>`,
            GLOW
        ],
        body: [
            '<rect width="960" height="240" fill="url(#sky)"/>',
            stars,
            '<rect width="960" height="240" fill="url(#haze)"/>',
            `<g clip-path="url(#above)"><g clip-path="url(#disc)"><circle cx="720" cy="${ horizon }" r="74" fill="url(#sun)" opacity="0.92"/>${ stripes }</g></g>`,
            `<g clip-path="url(#below)"><path d="${ floor }" stroke="${ palette.glint }" stroke-width="1.1" opacity="0.55" filter="url(#glow)"/></g>`,
            `<rect y="${ horizon - 1 }" width="960" height="2" fill="${ palette.edge }" filter="url(#glow)"/>`
        ]
    };
}

function coverGold(palette)
{
    const vine = (y, flip) =>
    {
        const turns = Array.from({ length: 9 }, (_, index) =>
        {
            const x = index * 120;
            const up = (index % 2 === 0) !== flip ? -1 : 1;
            return `C${ x + 40 } ${ y + up * 38 } ${ x + 80 } ${ y + up * 38 } ${ x + 120 } ${ y }`;
        }).join('');
        return `M0 ${ y }${ turns }`;
    };

    const leaves = Array.from({ length: 18 }, (_, index) =>
    {
        const x = 30 + index * 55;
        const y = 120 + Math.sin(index * 1.3) * 26;
        return `<ellipse cx="${ r2(x) }" cy="${ r2(y) }" rx="9" ry="3.4" transform="rotate(${ r2(-30 + (index % 4) * 22) } ${ r2(x) } ${ r2(y) })" fill="url(#gold)" opacity="0.75"/>`;
    }).join('');

    const curls = Array.from({ length: 16 }, (_, index) =>
    {
        const x = 50 + index * 60;
        const y = index % 2 === 0 ? 70 : 170;
        return `<path d="M${ x } ${ y }c-10 -12 6 -26 16 -14c7 9 -4 17 -9 10" fill="none" stroke="${ palette.edge }" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/>`;
    }).join('');

    const next = seeded(41);
    const dust = Array.from({ length: 70 }, () => `<circle cx="${ r2(next() * 960) }" cy="${ r2(next() * 240) }" r="${ r2(0.5 + next() * 1.3) }" fill="${ palette.glint }" opacity="${ r2(0.2 + next() * 0.6) }"/>`).join('');

    return {
        defs: [
            linear('ground', palette.surface, [0, 0, 1, 1]),
            linear('gold', palette.piece, [0, 0, 1, 1]),
            '<radialGradient id="lacquer" cx="0.7" cy="0.3" r="0.7"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.08"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>'
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            '<rect width="960" height="240" fill="url(#lacquer)"/>',
            `<path d="${ vine(120, false) }" fill="none" stroke="url(#gold)" stroke-width="2.4" opacity="0.8"/>`,
            `<path d="${ vine(120, true) }" fill="none" stroke="url(#gold)" stroke-width="1.2" opacity="0.45"/>`,
            leaves,
            curls,
            dust,
            `<circle cx="760" cy="120" r="78" fill="none" stroke="url(#gold)" stroke-width="3"/>`,
            `<circle cx="760" cy="120" r="70" fill="${ palette.surface[1] }" opacity="0.85"/>`,
            `<path d="${ starOf(760, 120, 62, 34, 8) }" fill="none" stroke="url(#gold)" stroke-width="2.4"/>`,
            `<path d="${ starOf(760, 120, 34, 18, 8) }" fill="url(#gold)"/>`,
            `<circle cx="760" cy="120" r="9" fill="${ palette.surface[2] }" stroke="${ palette.glint }" stroke-width="1.6"/>`,
            `<path d="${ sparkle(736, 96, 9) }" fill="#FFFFFF" opacity="0.85"/>`,
            `<rect y="8" width="960" height="1.4" fill="${ palette.edge }" opacity="0.7"/><rect y="230.6" width="960" height="1.4" fill="${ palette.edge }" opacity="0.7"/>`
        ]
    };
}

const COVERS = { sparkle: coverGlow, girih: coverShiraz, grid: coverNeon, filigree: coverGold };

const cover = (palette) =>
{
    const drawn = COVERS[palette.pattern](palette);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 240" width="960" height="240" preserveAspectRatio="xMidYMid slice"><defs>${ drawn.defs.join('') }</defs>${ drawn.body.join('') }</svg>`;
};

// ---------------------------------------------------------------- the files

const write = (folder, files) =>
{
    const into = join(PUBLIC, folder);
    mkdirSync(into, { recursive: true });

    for (const name of readdirSync(into))
    {
        rmSync(join(into, name));
    }

    for (const [name, text] of files)
    {
        writeFileSync(join(into, name), text);
    }
};

write('frames', SHOP_COLLECTIONS.flatMap((collection) => [
    [`${ collection }.svg`, frame(PALETTES[collection], false)],
    [`${ collection }-still.svg`, frame(PALETTES[collection], true)]
]));
write('plates', SHOP_COLLECTIONS.map((collection) => [`${ collection }.svg`, plate(PALETTES[collection])]));
write('covers', SHOP_COLLECTIONS.map((collection) => [`${ collection }.svg`, cover(PALETTES[collection])]));

console.log(`profile looks: ${ SHOP_COLLECTIONS.length } frames (and still), plates and covers in ${ PUBLIC }`);

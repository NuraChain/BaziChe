/**
 * Frost Revenant: faceted translucent ice, six-fold crystals and icicles. Brittle stillness, crystals
 * that grow, and a glint that runs over the ice.
 */
import { about, at, C, linear, r2, RING, seeded } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'crystals';

const GLACIER = '#F2FBFF';
const ICE = '#8FD3FF';
const DEEP = '#1E5B8C';
const NIGHT = '#0A1A2B';

/** A six-armed crystal of `r` at (x, y), each arm with a pair of barbs. */
const flake = (x, y, r) => Array.from({ length: 6 }, (_, arm) =>
{
    const angle = arm * Math.PI / 3 - Math.PI / 2;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const barb = (along, side) =>
    {
        const ax = x + cos * r * along;
        const ay = y + sin * r * along;
        const bend = angle + side * Math.PI / 4;
        return `M${ r2(ax) } ${ r2(ay) }L${ r2(ax + Math.cos(bend) * r * 0.3) } ${ r2(ay + Math.sin(bend) * r * 0.3) }`;
    };
    return `M${ r2(x) } ${ r2(y) }L${ r2(x + cos * r) } ${ r2(y + sin * r) }${ barb(0.55, 1) }${ barb(0.55, -1) }`;
}).join('');

/** A shard of ice: a long hexagonal prism standing on (x, y), its two faces shaded apart. */
const shard = (id, x, y, tall, wide, lean = 0) =>
{
    const tip = [x + lean * tall, y - tall];
    const left = `M${ r2(x - wide / 2) } ${ r2(y) }L${ r2(x - wide / 2 + lean * tall * 0.8) } ${ r2(y - tall * 0.78) }L${ r2(tip[0]) } ${ r2(tip[1]) }L${ r2(x + lean * tall * 0.85) } ${ r2(y - tall * 0.72) }L${ r2(x) } ${ r2(y + wide * 0.12) }Z`;
    const right = `M${ r2(x) } ${ r2(y + wide * 0.12) }L${ r2(x + lean * tall * 0.85) } ${ r2(y - tall * 0.72) }L${ r2(tip[0]) } ${ r2(tip[1]) }L${ r2(x + wide / 2 + lean * tall * 0.8) } ${ r2(y - tall * 0.78) }L${ r2(x + wide / 2) } ${ r2(y) }Z`;
    return `<path d="${ left }" fill="url(#${ id }-lit)"/><path d="${ right }" fill="url(#${ id }-shade)"/>`;
};

const ices = (id) => [
    `<linearGradient id="${ id }-lit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="${ GLACIER }"/><stop offset="1" stop-color="${ ICE }"/></linearGradient>`,
    `<linearGradient id="${ id }-shade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ ICE }"/><stop offset="1" stop-color="${ DEEP }"/></linearGradient>`
];

/** Crystals and hexagons of frost, a tile 30 across. */
export const tile = (palette) => ({
    size: 30,
    body: `<path d="${ flake(9, 10, 5) }" fill="none" stroke="${ palette.glint }" stroke-width="0.7" stroke-linecap="round"/><path d="M21 19L25 21.3V25.8L21 28L17 25.8V21.3Z" fill="none" stroke="${ palette.edge }" stroke-width="0.6" opacity="0.8"/><circle cx="25" cy="7" r="0.7" fill="#FFFFFF"/>`
});

/** The collection's sign: an ice crystal of six arms inside a hexagon, a shard at its heart. */
export function emblem(palette, cx, cy, size, id = 'frost')
{
    const s = size / 50;
    const hex = Array.from({ length: 6 }, (_, side) =>
    {
        const angle = side * Math.PI / 3 - Math.PI / 2;
        return `${ r2(cx + Math.cos(angle) * 24 * s) } ${ r2(cy + Math.sin(angle) * 24 * s) }`;
    }).join('L');

    return {
        defs: ices(id),
        body: [
            `<path d="M${ hex }Z" fill="${ NIGHT }" fill-opacity="0.5" stroke="${ ICE }" stroke-width="${ r2(1.4 * s) }" stroke-linejoin="round"/>`,
            `<path d="${ flake(cx, cy, 20 * s) }" fill="none" stroke="${ NIGHT }" stroke-width="${ r2(4 * s) }" stroke-linecap="round"/>`,
            `<path d="${ flake(cx, cy, 20 * s) }" fill="none" stroke="${ GLACIER }" stroke-width="${ r2(2 * s) }" stroke-linecap="round"/>`,
            shard(id, cx, cy + 9 * s, 20 * s, 8 * s),
            `<circle cx="${ r2(cx) }" cy="${ r2(cy) }" r="${ r2(1.6 * s) }" fill="#FFFFFF"/>`
        ]
    };
}

/** The crown of ice on the pawn's head (centre (128, 62), radius 56): five shards rising, the middle tallest, frost on the brow. */
export function crest(palette, id = 'crest')
{
    const shards = [[-38, 22, 16, -0.22], [38, 22, 16, 0.22], [-19, 34, 20, -0.1], [19, 34, 20, 0.1], [0, 46, 24, 0]];

    return {
        defs: ices(id),
        body: [
            ...shards.map(([dx, tall, wide, lean]) => `<g stroke="${ NIGHT }" stroke-width="5" stroke-linejoin="round">${ shard(id, 128 + dx, 50 - Math.abs(dx) * 0.14, tall, wide, lean).replace(/<path /g, '<path paint-order="stroke" ') }</g>`),
            `<path d="M84 50C100 42 156 42 172 50" stroke="${ NIGHT }" stroke-width="11" stroke-linecap="round" fill="none"/>`,
            `<path d="M84 50C100 42 156 42 172 50" stroke="${ ICE }" stroke-width="6" stroke-linecap="round" fill="none"/>`,
            `<path d="${ flake(128, 46, 6) }" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>`
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/**
 * Frost Revenant's frame: a band of faceted ice, crystals growing out of it, icicles hanging under
 * it, and a glint that runs round the ice; the crown at its top is three shards.
 */
export function frame(palette, still)
{
    const grow = (offset) => (still ? '' : `<animateTransform attributeName="transform" type="scale" values="1 1;1.18 1.18;1 1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.4 0 0.2 1;0.6 0 0.8 1" dur="4.8s" begin="${ -offset }s" repeatCount="indefinite"/>`);
    const glint = still ? '' : `<animateTransform attributeName="transform" type="rotate" values="-40 ${ C } ${ C };320 ${ C } ${ C };320 ${ C } ${ C }" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.4 0 0.3 1;0 0 1 1" dur="6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.06;0.44;0.5;1" dur="6s" repeatCount="indefinite"/>`;

    const facets = Array.from({ length: 24 }, (_, index) =>
    {
        const turn = index * 15;
        return `<path d="M${ at(RING - 3.2, turn).join(' ') }L${ at(RING + 3.2, turn + 7.5).join(' ') }" stroke="#FFFFFF" stroke-width="0.35" opacity="${ index % 2 === 0 ? 0.55 : 0.25 }"/>`;
    }).join('');

    const crystals = [[56, 1], [124, 0.8], [236, 0.9], [304, 1.1]].map(([turn, size], index) =>
    {
        const [x, y] = at(RING + 3, turn);
        return about(x, y, grow(index * 1.1), `<path d="${ flake(x, y, 4.2 * size) }" stroke="${ NIGHT }" stroke-width="1.6" stroke-linecap="round"/><path d="${ flake(x, y, 4.2 * size) }" stroke="${ GLACIER }" stroke-width="0.7" stroke-linecap="round"/>`);
    }).join('');

    const icicles = [150, 165, 180, 195, 210].map((turn, index) =>
    {
        const [x, y] = at(RING + 3, turn);
        const long = [3.6, 5.6, 7.2, 5, 3.2][index];
        return `<path d="M${ r2(x - 1.2) } ${ r2(y - 0.5) }L${ r2(x) } ${ r2(y + long) }L${ r2(x + 1.2) } ${ r2(y - 0.5) }Z" fill="url(#icicle)" stroke="${ NIGHT }" stroke-width="0.4" stroke-linejoin="round"/>`;
    }).join('');

    const crown = [[-5, 11, 4.6, -0.12], [5, 11, 4.6, 0.12], [0, 15, 5.6, 0]].map(([dx, tall, wide, lean]) =>
        `<g stroke="${ NIGHT }" stroke-width="0.6" stroke-linejoin="round">${ shard('crown', C + dx, 12.5, tall, wide, lean).replace(/<path /g, '<path paint-order="stroke" ') }</g>`).join('');

    return {
        defs: [
            `<linearGradient id="ice" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.3" stop-color="${ GLACIER }"/><stop offset="0.65" stop-color="${ ICE }"/><stop offset="1" stop-color="${ DEEP }"/></linearGradient>`,
            `<linearGradient id="icicle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ ICE }"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>`,
            ...ices('crown'),
            '<filter id="cold" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2"/></filter>'
        ],
        body: [
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ ICE }" stroke-width="9" opacity="0.35" filter="url(#cold)"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ NIGHT }" stroke-width="8"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#ice)" stroke-width="6.4" opacity="0.92"/>`,
            facets,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 3.1 }" fill="none" stroke="#FFFFFF" stroke-width="0.4" opacity="0.6"/>`,
            icicles,
            crystals,
            `<g opacity="${ still ? 0 : 1 }">${ glint }<path d="M${ at(RING, -14).join(' ') }A${ RING } ${ RING } 0 0 1 ${ at(RING, 14).join(' ') }" fill="none" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round" opacity="0.7"/></g>`,
            crown
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** Frost Revenant's cover: an arctic night, ice shards rising from a frozen floor, snow falling, the crystal. */
export function cover(palette)
{
    const next = seeded(83);
    const snow = Array.from({ length: 110 }, () => `<circle cx="${ r2(next() * 960) }" cy="${ r2(next() * 240) }" r="${ r2(0.5 + next() * 1.6) }" fill="#FFFFFF" opacity="${ r2(0.25 + next() * 0.6) }"/>`).join('');
    const shards = Array.from({ length: 22 }, (_, index) =>
    {
        const x = 10 + index * 44 + next() * 20;
        if (x > 660 && x < 860)
        {
            return '';
        }
        return shard('cover', x, 240, 40 + next() * 80, 18 + next() * 16, (next() - 0.5) * 0.4);
    }).join('');
    const sign = emblem(palette, 760, 120, 84, 'sign');

    return {
        defs: [
            linear('ground', ['#16365A', '#0C2238', NIGHT], [0, 0, 0, 1]),
            `<radialGradient id="aurora" cx="0.35" cy="0" r="0.9"><stop offset="0" stop-color="${ ICE }" stop-opacity="0.35"/><stop offset="1" stop-color="${ ICE }" stop-opacity="0"/></radialGradient>`,
            ...ices('cover'),
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            '<rect width="960" height="240" fill="url(#aurora)"/>',
            ...[[120, 60, 22], [380, 40, 14], [560, 80, 18]].map(([x, y, r]) => `<path d="${ flake(x, y, r) }" stroke="${ GLACIER }" stroke-width="1.6" stroke-linecap="round" opacity="0.4"/>`),
            shards,
            snow,
            `<circle cx="760" cy="120" r="80" fill="${ NIGHT }" opacity="0.92"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="${ ICE }" stroke-width="2.4"/>`,
            `<circle cx="760" cy="120" r="72" fill="none" stroke="${ GLACIER }" stroke-width="0.8" opacity="0.6"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.2" fill="${ ICE }" opacity="0.6"/><rect y="230.8" width="960" height="1.2" fill="${ ICE }" opacity="0.6"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: frosted white paper, deep ice blue and cold crimson inks (each at 4.5:1 or more on both stops), courts in ice. */
export const dress = {
    paper: ['#FFFFFF', '#E8F4FC'],
    suits: [
        { name: 'club', ink: '#123E63', tint: '#E4F1FB', accent: DEEP },
        { name: 'diamond', ink: '#B0234A', tint: '#F9E6EC', accent: '#8A1B3A' },
        { name: 'heart', ink: '#B0234A', tint: '#F9E6EC', accent: '#8A1B3A' },
        { name: 'spade', ink: '#123E63', tint: '#E4F1FB', accent: DEEP }
    ],
    metal: { band: ICE, line: DEEP, frame: '#4FA8DC', crown: GLACIER, jewel: '#FFFFFF' }
};

/** What every card wears in the corners its indices leave free: a small crystal. */
export const ornament = (W, H) => `<path d="${ flake(W - 26, 26, 9) }" stroke="#4FA8DC" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/><path d="${ flake(26, H - 26, 9) }" stroke="#4FA8DC" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/>`;

/** Its card back's border, and the emblem at its middle: the crystal in its hexagon. */
export const back = {
    border: NIGHT,
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2, 74, 'back');
        return {
            defs: sign.defs,
            body: [
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="${ NIGHT }" stroke="${ ICE }" stroke-width="2.4"/>`,
                ...sign.body
            ]
        };
    }
};

// ---------------------------------------------------------------- the pawn

/** A pawn: the seat's colour in enamel set in clear ice at its foot and collar, frost at its foot, a crown of ice shards. */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.frost;
    const crown = crest(palette, 'ice');

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('clear', [[0, '#FFFFFF'], [0.4, GLACIER], [0.8, ICE], [1, DEEP]]),
        ...crown.defs
    ], [
        kit.outlined({ foot: 'url(#clear)', base: 'url(#clear)', body: 'url(#enamel)', collar: 'url(#clear)', head: 'url(#dome)' }, NIGHT),
        ...[[92, 192], [128, 198], [164, 192]].map(([x, y]) => `<path d="${ flake(x, y, 7) }" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>`),
        `<path d="M100 150L108 172L104 186M156 150L148 170L152 186" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.55"/>`,
        ...kit.lighting(dark, '#FFFFFF', 0.6),
        ...crown.body
    ]);
}

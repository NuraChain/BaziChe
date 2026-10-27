/**
 * Solar Phoenix: gilded feathers and burnished bronze, sunburst rays and plumes. Soaring and
 * radiant: wings sweep up round what it frames to a sun that rises at the top.
 */
import { about, at, C, linear, r2, RING, seeded } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'feathers';

const GOLD = '#FFC94A';
const FLAME = '#FF7A1A';
const CRIMSON = '#D7263D';
const RADIANT = '#FFF6D6';
const UMBER = '#3A1406';

/** A feather from (x, y) pointing at `angle` (radians, 0 right), `long` and `wide`: a vane round a quill. */
const feather = (x, y, angle, long, wide) =>
{
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const p = (along, aside) => `${ r2(x + cos * along - sin * aside) } ${ r2(y + sin * along + cos * aside) }`;
    return {
        vane: `M${ p(0, 0) }C${ p(long * 0.3, wide * 0.9) } ${ p(long * 0.75, wide * 0.7) } ${ p(long, 0) }C${ p(long * 0.75, -wide * 0.7) } ${ p(long * 0.3, -wide * 0.9) } ${ p(0, 0) }Z`,
        quill: `M${ p(long * 0.05, 0) }L${ p(long * 0.92, 0) }`
    };
};

/** A feather drawn: its vane burning from crimson at the root to gold, its quill light. */
const drawn = (id, x, y, angle, long, wide, outline = '') =>
{
    const one = feather(x, y, angle, long, wide);
    return `<path d="${ one.vane }" fill="url(#${ id })"${ outline }/><path d="${ one.quill }" stroke="${ RADIANT }" stroke-width="${ r2(Math.max(0.4, wide * 0.12)) }" stroke-linecap="round" opacity="0.85"/>`;
};

const plumage = (id, x1, y1, x2, y2) => `<linearGradient id="${ id }" gradientUnits="userSpaceOnUse" x1="${ r2(x1) }" y1="${ r2(y1) }" x2="${ r2(x2) }" y2="${ r2(y2) }"><stop offset="0" stop-color="${ CRIMSON }"/><stop offset="0.45" stop-color="${ FLAME }"/><stop offset="1" stop-color="${ GOLD }"/></linearGradient>`;

/** Rows of feathers like scales, a tile 28 across. */
export const tile = (palette) => ({
    size: 28,
    body: `<path d="M0 14C4 6 10 6 14 14C18 6 24 6 28 14M-7 28C-3 20 3 20 7 28C11 20 17 20 21 28C25 20 31 20 35 28M-7 0C-3 -8 3 -8 7 0C11 -8 17 -8 21 0C25 -8 31 -8 35 0" fill="none" stroke="${ palette.edge }" stroke-width="0.8"/><path d="M7 21L7 27M21 7L21 13" stroke="${ palette.glint }" stroke-width="0.6"/>`
});

/** The collection's sign: a phoenix rising with its wings spread before the sun, its tail plumes falling. */
export function emblem(palette, cx, cy, size, id = 'phoenix')
{
    const s = size / 50;
    const wing = (side) => [0, 1, 2, 3, 4].map((nth) => drawn(`${ id }-plume`, cx + side * 4 * s, cy - 2 * s, -Math.PI / 2 + side * (0.45 + nth * 0.26), (22 - nth * 2) * s, 5 * s)).join('');

    return {
        defs: [
            plumage(`${ id }-plume`, cx, cy + 20 * s, cx, cy - 26 * s),
            `<radialGradient id="${ id }-sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ RADIANT }"/><stop offset="0.6" stop-color="${ GOLD }"/><stop offset="1" stop-color="${ FLAME }" stop-opacity="0"/></radialGradient>`
        ],
        body: [
            `<circle cx="${ r2(cx) }" cy="${ r2(cy - 6 * s) }" r="${ r2(22 * s) }" fill="url(#${ id }-sun)"/>`,
            ...Array.from({ length: 12 }, (_, nth) =>
            {
                const angle = nth * Math.PI / 6;
                return `<path d="M${ r2(cx + Math.cos(angle) * 16 * s) } ${ r2(cy - 6 * s + Math.sin(angle) * 16 * s) }L${ r2(cx + Math.cos(angle) * 25 * s) } ${ r2(cy - 6 * s + Math.sin(angle) * 25 * s) }" stroke="${ GOLD }" stroke-width="${ r2(1.2 * s) }" stroke-linecap="round" opacity="0.7"/>`;
            }),
            wing(-1),
            wing(1),
            ...[-1, 0, 1].map((side) => drawn(`${ id }-plume`, cx + side * 2 * s, cy + 4 * s, Math.PI / 2 + side * 0.32, 20 * s, 4 * s)),
            `<ellipse cx="${ r2(cx) }" cy="${ r2(cy) }" rx="${ r2(4 * s) }" ry="${ r2(8 * s) }" fill="${ GOLD }" stroke="${ UMBER }" stroke-width="${ r2(0.8 * s) }"/>`,
            `<circle cx="${ r2(cx) }" cy="${ r2(cy - 9 * s) }" r="${ r2(3.4 * s) }" fill="${ GOLD }" stroke="${ UMBER }" stroke-width="${ r2(0.8 * s) }"/>`,
            `<path d="M${ r2(cx) } ${ r2(cy - 12 * s) }C${ r2(cx - 3 * s) } ${ r2(cy - 18 * s) } ${ r2(cx + 2 * s) } ${ r2(cy - 20 * s) } ${ r2(cx + 4 * s) } ${ r2(cy - 22 * s) }" fill="none" stroke="${ CRIMSON }" stroke-width="${ r2(1.4 * s) }" stroke-linecap="round"/>`
        ]
    };
}

/** The plumed crest on the pawn's head (centre (128, 62), radius 56): a fan of feathers rising from a gold band. */
export function crest(palette, id = 'crest')
{
    const fan = [[-1, 38], [1, 38], [-0.5, 48], [0.5, 48], [0, 56]];

    return {
        defs: [plumage(id, 128, 60, 128, 2), `<filter id="${ id }-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>`],
        body: [
            `<ellipse cx="128" cy="30" rx="54" ry="30" fill="${ GOLD }" opacity="0.35" filter="url(#${ id }-glow)"/>`,
            ...fan.map(([turn, long]) => drawn(id, 128, 60, -Math.PI / 2 + turn, long, 18, ` stroke="${ UMBER }" stroke-width="4.5" stroke-linejoin="round"`)),
            `<path d="M84 62C100 53 156 53 172 62" stroke="${ UMBER }" stroke-width="11" stroke-linecap="round" fill="none"/>`,
            `<path d="M84 62C100 53 156 53 172 62" stroke="${ GOLD }" stroke-width="6" stroke-linecap="round" fill="none"/>`,
            `<circle cx="128" cy="55" r="7" fill="${ CRIMSON }" stroke="${ UMBER }" stroke-width="3"/>`,
            `<circle cx="126" cy="53" r="2.2" fill="${ RADIANT }"/>`
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/**
 * Solar Phoenix's frame: a band of burnished bronze, two wings of gilded feathers sweeping up its
 * sides to the sun at its top, whose rays turn and whose light swells.
 */
export function frame(palette, still)
{
    const turn = still ? '' : `<animateTransform attributeName="transform" type="rotate" from="0 ${ C } 9" to="360 ${ C } 9" dur="18s" repeatCount="indefinite"/>`;
    const swell = still ? '' : '<animateTransform attributeName="transform" type="scale" values="1 1;1.14 1.14;1 1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" dur="3.2s" repeatCount="indefinite"/>';
    const lift = (offset) => (still ? '' : `<animateTransform attributeName="transform" type="scale" values="1 1;1.08 1.08;1 1" dur="2.4s" begin="${ -offset }s" repeatCount="indefinite"/>`);

    const wing = (side) => Array.from({ length: 11 }, (_, nth) => 170 - nth * 14).map((along, nth) =>
    {
        const [x, y] = at(RING - 2.6, side * along);
        const toward = ((side * (along - 34) - 90) * Math.PI / 180) - side * 0.42;
        const long = 9 + nth * 0.55;
        return about(x, y, lift(nth * 0.15), drawn('plume', x, y, toward, long, 3.2, ` stroke="${ UMBER }" stroke-width="0.45"`));
    }).join('');

    const rays = Array.from({ length: 12 }, (_, nth) =>
    {
        const angle = nth * Math.PI / 6;
        return `<path d="M${ r2(C + Math.cos(angle) * 5.8) } ${ r2(9 + Math.sin(angle) * 5.8) }L${ r2(C + Math.cos(angle) * 8.8) } ${ r2(9 + Math.sin(angle) * 8.8) }" stroke="${ GOLD }" stroke-width="0.9" stroke-linecap="round"/>`;
    }).join('');

    return {
        defs: [
            `<linearGradient id="bronze" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#FFE7A0"/><stop offset="0.35" stop-color="#C77A2A"/><stop offset="0.75" stop-color="#7A3A12"/><stop offset="1" stop-color="${ UMBER }"/></linearGradient>`,
            plumage('plume', C, 60, C, 0),
            `<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.45" stop-color="${ RADIANT }"/><stop offset="0.8" stop-color="${ GOLD }"/><stop offset="1" stop-color="${ FLAME }"/></radialGradient>`,
            '<filter id="blaze" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>'
        ],
        body: [
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ FLAME }" stroke-width="9" opacity="0.35" filter="url(#blaze)"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ UMBER }" stroke-width="8"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#bronze)" stroke-width="6.4"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 2.2 }" fill="none" stroke="${ RADIANT }" stroke-width="0.4" opacity="0.6"/>`,
            wing(-1),
            wing(1),
            `<g>${ turn }${ rays }</g>`,
            about(C, 9, swell, `<circle cx="${ C }" cy="9" r="7.4" fill="${ GOLD }" opacity="0.55" filter="url(#blaze)"/>`),
            `<circle cx="${ C }" cy="9" r="5" fill="url(#sun)" stroke="${ UMBER }" stroke-width="0.5"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** Solar Phoenix's cover: a sunrise from crimson to gold, its rays fanning, feathers drifting, and the phoenix. */
export function cover(palette)
{
    const next = seeded(97);
    const rays = Array.from({ length: 22 }, (_, nth) =>
    {
        const angle = Math.PI + nth * Math.PI / 21;
        return `<path d="M260 250L${ r2(260 + Math.cos(angle) * 700) } ${ r2(250 + Math.sin(angle) * 700) }L${ r2(260 + Math.cos(angle + 0.05) * 700) } ${ r2(250 + Math.sin(angle + 0.05) * 700) }Z" fill="${ RADIANT }" opacity="${ nth % 2 === 0 ? 0.1 : 0.05 }"/>`;
    }).join('');
    const drifting = Array.from({ length: 16 }, () => drawn('cover-plume', next() * 640, 30 + next() * 190, next() * Math.PI * 2, 14 + next() * 14, 4 + next() * 3)).join('');
    const sign = emblem(palette, 760, 122, 84, 'sign');

    return {
        defs: [
            `<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A0E08"/><stop offset="0.55" stop-color="#7A1E14"/><stop offset="1" stop-color="${ FLAME }"/></linearGradient>`,
            `<radialGradient id="sunrise" cx="0.27" cy="1.05" r="0.6"><stop offset="0" stop-color="${ RADIANT }"/><stop offset="0.3" stop-color="${ GOLD }"/><stop offset="0.7" stop-color="${ FLAME }" stop-opacity="0.4"/><stop offset="1" stop-color="${ FLAME }" stop-opacity="0"/></radialGradient>`,
            plumage('cover-plume', 0, 240, 0, 0),
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            rays,
            '<rect width="960" height="240" fill="url(#sunrise)"/>',
            `<g opacity="0.7">${ drifting }</g>`,
            `<circle cx="760" cy="120" r="80" fill="#220605" opacity="0.92"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="${ GOLD }" stroke-width="3"/>`,
            `<circle cx="760" cy="120" r="72" fill="none" stroke="${ FLAME }" stroke-width="1.2" opacity="0.8"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.4" fill="${ GOLD }" opacity="0.6"/><rect y="230.6" width="960" height="1.4" fill="${ GOLD }" opacity="0.6"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: warm ivory paper, umber and crimson inks (each at 4.5:1 or more on both stops), courts gilded. */
export const dress = {
    paper: ['#FFFBEA', '#FBEFCB'],
    suits: [
        { name: 'club', ink: UMBER, tint: '#FBF0D4', accent: '#7A3A12' },
        { name: 'diamond', ink: '#B81E2A', tint: '#FCE7DC', accent: '#8E1620' },
        { name: 'heart', ink: '#B81E2A', tint: '#FCE7DC', accent: '#8E1620' },
        { name: 'spade', ink: UMBER, tint: '#FBF0D4', accent: '#7A3A12' }
    ],
    metal: { band: GOLD, line: '#8A3A0A', frame: FLAME, crown: GOLD, jewel: RADIANT }
};

/** What every card wears in the corners its indices leave free: a small feather. */
export const ornament = (W, H) =>
{
    const top = feather(W - 34, 18, Math.PI / 4, 20, 5);
    const bottom = feather(34, H - 18, -Math.PI * 0.75, 20, 5);
    return `<path d="${ top.vane }${ bottom.vane }" fill="${ FLAME }" opacity="0.45"/>`;
};

/** Its card back's border, and the emblem at its middle: the phoenix before the sun. */
export const back = {
    border: '#220605',
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2 + 2, 72, 'back');
        return {
            defs: sign.defs,
            body: [
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="#220605" stroke="${ GOLD }" stroke-width="3"/>`,
                ...sign.body
            ]
        };
    }
};

// ---------------------------------------------------------------- the pawn

/** A pawn: the seat's colour in enamel set in burnished bronze at its foot and collar, feathers at its foot, a plume on its head. */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.phoenix;
    const plume = crest(palette, 'plume');

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('bronze', [[0, '#FFE7A0'], [0.35, '#C77A2A'], [0.75, '#7A3A12'], [1, UMBER]]),
        plumage('foot', 0, 210, 0, 170),
        ...plume.defs
    ], [
        kit.outlined({ foot: 'url(#bronze)', base: 'url(#bronze)', body: 'url(#enamel)', collar: 'url(#bronze)', head: 'url(#dome)' }, UMBER),
        ...[-1, 1].map((side) => [0, 1, 2].map((nth) => drawn('foot', 128 + side * (30 + nth * 18), 196, Math.PI + (side > 0 ? -Math.PI : 0) + side * (0.25 - nth * 0.05) * -1, 20, 7)).join('')),
        ...kit.lighting(dark, '#FFFFFF', 0.55),
        ...plume.body
    ]);
}

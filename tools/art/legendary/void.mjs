/**
 * Void Emperor: matte black split by violet fractures, hollow shards and negative space, tendrils
 * that curl inward and spectral wisps let go. It takes the light in, then gives it back.
 */
import { about, at, C, linear, r2, RING, seeded } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'fractures';

const VOID = '#050308';
const VIOLET = '#5B21B6';
const ULTRA = '#A855F7';
const LILAC = '#E9D5FF';

/** Hollow shards and a fracture through them, a tile 32 across. */
export const tile = (palette) => ({
    size: 32,
    body: `<path d="M4 6L12 3L9 12Z" fill="none" stroke="${ palette.edge }" stroke-width="0.8" stroke-linejoin="round"/><path d="M22 18L29 22L21 27Z" fill="none" stroke="${ palette.glint }" stroke-width="0.7" stroke-linejoin="round" opacity="0.7"/><path d="M0 22L7 19L13 23L18 15L26 12L32 14" fill="none" stroke="${ ULTRA }" stroke-width="0.9" stroke-linejoin="round" opacity="0.85"/>`
});

/** An eye of the void: a vesica of ultraviolet round a black pupil ringed in lilac, fractures running out of it. */
export function emblem(palette, cx, cy, size, id = 'void')
{
    const s = size / 50;
    const w = 24 * s;
    const h = 12 * s;
    const cracks = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.4], [0, 1.4]].map(([dx, dy]) =>
        `<path d="M${ r2(cx + dx * 8 * s) } ${ r2(cy + dy * 5 * s) }L${ r2(cx + dx * 14 * s + dy * 2 * s) } ${ r2(cy + dy * 11 * s) }L${ r2(cx + dx * 20 * s) } ${ r2(cy + dy * 17 * s) }" fill="none" stroke="${ ULTRA }" stroke-width="${ r2(1.1 * s) }" stroke-linejoin="round"/>`);

    return {
        defs: [
            `<radialGradient id="${ id }-dark" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stop-color="${ VOID }"/><stop offset="1" stop-color="${ VIOLET }"/></radialGradient>`,
            `<radialGradient id="${ id }-pupil" cx="0.5" cy="0.5" r="0.5"><stop offset="0.6" stop-color="#000000"/><stop offset="0.85" stop-color="${ ULTRA }"/><stop offset="1" stop-color="${ LILAC }"/></radialGradient>`
        ],
        body: [
            ...cracks,
            `<path d="M${ r2(cx - w) } ${ r2(cy) }Q${ r2(cx) } ${ r2(cy - h * 2) } ${ r2(cx + w) } ${ r2(cy) }Q${ r2(cx) } ${ r2(cy + h * 2) } ${ r2(cx - w) } ${ r2(cy) }Z" fill="url(#${ id }-dark)" stroke="${ ULTRA }" stroke-width="${ r2(1.6 * s) }"/>`,
            `<circle cx="${ r2(cx) }" cy="${ r2(cy) }" r="${ r2(8.5 * s) }" fill="url(#${ id }-pupil)"/>`,
            `<circle cx="${ r2(cx) }" cy="${ r2(cy) }" r="${ r2(3.4 * s) }" fill="#000000"/>`,
            `<circle cx="${ r2(cx - 3 * s) }" cy="${ r2(cy - 3 * s) }" r="${ r2(1.3 * s) }" fill="${ LILAC }"/>`
        ]
    };
}

/**
 * The hood on the pawn's head (centre (128, 62), radius 56): a cowl of black falling round its
 * top and sides with an ultraviolet edge, its shadow over the brow and two lilac eyes in it.
 */
export function crest(palette, id = 'crest')
{
    const hood = 'M66 96C58 46 84 4 128 3C172 4 198 46 190 96C182 80 172 66 160 58C150 50 140 46 128 46C116 46 106 50 96 58C84 66 74 80 66 96Z';

    return {
        defs: [
            `<linearGradient id="${ id }" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A1840"/><stop offset="0.6" stop-color="#0E0818"/><stop offset="1" stop-color="${ VOID }"/></linearGradient>`,
            `<linearGradient id="${ id }-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ VOID }" stop-opacity="0.85"/><stop offset="1" stop-color="${ VOID }" stop-opacity="0"/></linearGradient>`,
            `<filter id="${ id }-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>`
        ],
        body: [
            `<ellipse cx="128" cy="62" rx="50" ry="28" fill="url(#${ id }-shade)" transform="translate(0 4)"/>`,
            `<path d="${ hood }" fill="url(#${ id })" stroke="${ VOID }" stroke-width="7" stroke-linejoin="round"/>`,
            `<path d="M70 92C66 50 88 6 128 4C168 6 190 50 186 92" fill="none" stroke="${ ULTRA }" stroke-width="3" opacity="0.9"/>`,
            `<path d="M104 18L112 30L106 40" fill="none" stroke="${ ULTRA }" stroke-width="2.4" stroke-linejoin="round"/>`,
            ...[108, 148].map((x) => `<ellipse cx="${ x }" cy="66" rx="9" ry="5" fill="${ LILAC }" filter="url(#${ id }-glow)"/><ellipse cx="${ x }" cy="66" rx="6" ry="3" fill="#FFFFFF"/>`)
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/** A fracture across the band at `turn`, forking as it goes. */
const fracture = (turn, twist) =>
{
    const line = (points) => `M${ points.map(([r, dt]) => at(r, turn + dt).join(' ')).join('L') }`;
    return `${ line([[RING - 3.4, 0], [RING - 0.8, twist], [RING + 1.4, -twist * 0.4], [RING + 3.4, twist * 0.8]]) }${ line([[RING - 0.8, twist], [RING + 2, twist * 2.4]]) }`;
};

/** A tendril curling in from outside the band at `turn`, `sweep` degrees round. */
const tendril = (turn, sweep) =>
{
    const [x1, y1] = at(RING + 6.2, turn);
    const [cx1, cy1] = at(RING + 7.4, turn + sweep * 0.5);
    const [x2, y2] = at(RING + 1, turn + sweep);
    const [cx2, cy2] = at(RING + 3.4, turn + sweep * 1.1);
    return `M${ x1 } ${ y1 }Q${ cx1 } ${ cy1 } ${ x2 } ${ y2 }Q${ cx2 } ${ cy2 } ${ at(RING + 2.6, turn + sweep * 0.8).join(' ') }`;
};

/**
 * Void Emperor's frame: a band of matte black that draws the darkness in round it and breathes it
 * out again, violet fractures through it, tendrils curling in, and wisps let go.
 */
export function frame(palette, still)
{
    const breathe = still ? '' : '<animate attributeName="opacity" values="0.25;0.85;0.25" keyTimes="0;0.55;1" calcMode="spline" keySplines="0.6 0 0.4 1;0.4 0 0.6 1" dur="4.4s" repeatCount="indefinite"/>';
    const pulse = (offset) => (still ? '' : `<animate attributeName="opacity" values="1;0.35;1" dur="3.2s" begin="${ -offset }s" repeatCount="indefinite"/>`);
    const curl = (offset) => (still ? '' : `<animateTransform attributeName="transform" type="scale" values="1 1;0.94 0.94;1 1" dur="4.4s" begin="${ -offset }s" repeatCount="indefinite"/>`);

    const fractures = [[20, 3], [96, -2.6], [160, 2.8], [232, -3], [300, 2.4]].map(([turn, twist], index) =>
        `<g>${ pulse(index * 0.55) }<path d="${ fracture(turn, twist) }" fill="none" stroke="${ ULTRA }" stroke-width="2.4" stroke-linejoin="round" filter="url(#bleed)"/><path d="${ fracture(turn, twist) }" fill="none" stroke="${ LILAC }" stroke-width="0.6" stroke-linejoin="round"/></g>`).join('');

    const tendrils = [[55, 30], [175, 28], [270, -30], [330, 26]].map(([turn, sweep], index) =>
        about(C, C, curl(index * 0.9), `<path d="${ tendril(turn, sweep) }" fill="none" stroke="${ VOID }" stroke-width="2.6" stroke-linecap="round"/><path d="${ tendril(turn, sweep) }" fill="none" stroke="${ ULTRA }" stroke-width="0.7" stroke-linecap="round"/>`)).join('');

    const shards = [[-28, 1.8], [36, 1.4], [140, 1.6], [208, 1.3]].map(([turn, size]) =>
    {
        const [x, y] = at(RING + 6, turn);
        return `<path d="M${ r2(x) } ${ r2(y - size) }L${ r2(x + size * 0.8) } ${ r2(y + size * 0.6) }L${ r2(x - size * 0.7) } ${ r2(y + size * 0.5) }Z" fill="none" stroke="${ palette.glint }" stroke-width="0.4" stroke-linejoin="round" transform="rotate(${ turn } ${ x } ${ y })"/>`;
    }).join('');

    const wisps = still ? '' : [[-10, 0], [14, 1.8], [2, 3.2]].map(([dx, delay]) =>
        `<ellipse cx="${ C + dx }" cy="9" rx="2.4" ry="1.4" fill="${ LILAC }" opacity="0" filter="url(#bleed)"><animate attributeName="cy" values="9;-4" dur="3.4s" begin="${ delay }s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0.8;0" dur="3.4s" begin="${ delay }s" repeatCount="indefinite"/></ellipse>`).join('');

    const eye = emblem(palette, C, 9, 22, 'crown');

    return {
        defs: [
            `<linearGradient id="matte" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#241838"/><stop offset="0.5" stop-color="#0C0614"/><stop offset="1" stop-color="${ VOID }"/></linearGradient>`,
            '<filter id="bleed" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1"/></filter>',
            '<filter id="dark" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>',
            ...eye.defs
        ],
        body: [
            `<g>${ breathe }<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ VIOLET }" stroke-width="12" filter="url(#dark)"/></g>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="#000000" stroke-width="8.4"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#matte)" stroke-width="6.8"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 3.4 }" fill="none" stroke="${ ULTRA }" stroke-width="0.5" opacity="0.7"/>`,
            fractures,
            tendrils,
            shards,
            `<circle cx="${ C }" cy="9" r="8.6" fill="#000000" stroke="${ ULTRA }" stroke-width="0.8"/>`,
            ...eye.body,
            wisps
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** Void Emperor's cover: a black field cracked with violet, spectral smoke, a hole that takes the light, and the eye. */
export function cover(palette)
{
    const next = seeded(53);
    const smoke = Array.from({ length: 16 }, () => `<ellipse cx="${ r2(next() * 960) }" cy="${ r2(next() * 240) }" rx="${ r2(40 + next() * 90) }" ry="${ r2(14 + next() * 26) }" fill="${ next() < 0.5 ? ULTRA : LILAC }" opacity="${ r2(0.06 + next() * 0.12) }" transform="rotate(${ r2(-20 + next() * 40) })"/>`).join('');
    const motes = Array.from({ length: 60 }, () => `<circle cx="${ r2(next() * 960) }" cy="${ r2(next() * 240) }" r="${ r2(0.4 + next() * 1.1) }" fill="${ LILAC }" opacity="${ r2(0.2 + next() * 0.6) }"/>`).join('');
    const sign = emblem(palette, 760, 120, 78, 'cover');
    const cracks = ['M0 70L120 92L180 60L300 110L360 86L470 120', 'M300 110L330 170L300 240', 'M180 60L200 0', 'M600 240L640 180L700 196L760 150'];

    return {
        defs: [
            linear('ground', ['#120A1E', '#08040F', VOID], [0, 0, 1, 1]),
            '<filter id="smoke" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>',
            '<filter id="bleed" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>',
            `<radialGradient id="hole" cx="0.5" cy="0.5" r="0.5"><stop offset="0.45" stop-color="#000000"/><stop offset="0.7" stop-color="${ VIOLET }" stop-opacity="0.8"/><stop offset="1" stop-color="${ ULTRA }" stop-opacity="0"/></radialGradient>`,
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            `<g filter="url(#smoke)">${ smoke }</g>`,
            ...cracks.map((path) => `<path d="${ path }" fill="none" stroke="${ ULTRA }" stroke-width="6" stroke-linejoin="round" opacity="0.5" filter="url(#bleed)"/><path d="${ path }" fill="none" stroke="${ LILAC }" stroke-width="1.2" stroke-linejoin="round"/>`),
            '<circle cx="470" cy="120" r="70" fill="url(#hole)"/>',
            `<circle cx="470" cy="120" r="34" fill="#000000" stroke="${ ULTRA }" stroke-width="1.2"/>`,
            motes,
            `<circle cx="760" cy="120" r="80" fill="#000000" opacity="0.92"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="${ ULTRA }" stroke-width="2.4"/>`,
            `<circle cx="760" cy="120" r="72" fill="none" stroke="${ LILAC }" stroke-width="0.8" opacity="0.6"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.2" fill="${ ULTRA }" opacity="0.55"/><rect y="230.8" width="960" height="1.2" fill="${ ULTRA }" opacity="0.55"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: black paper, lilac and rose inks (each at 4.5:1 or more on both stops), courts edged in ultraviolet. */
export const dress = {
    paper: ['#140C22', '#08040F'],
    suits: [
        { name: 'club', ink: LILAC, tint: '#1C1230', accent: '#B497E8' },
        { name: 'diamond', ink: '#FF7AA8', tint: '#2A0F22', accent: '#D24F82' },
        { name: 'heart', ink: '#FF7AA8', tint: '#2A0F22', accent: '#D24F82' },
        { name: 'spade', ink: LILAC, tint: '#1C1230', accent: '#B497E8' }
    ],
    metal: { band: ULTRA, line: '#2A0F55', frame: VIOLET, crown: LILAC, jewel: '#F3EAFF' }
};

/** What every card wears in the corners its indices leave free: a hollow shard. */
export const ornament = (W, H) => `<path d="M${ W - 34 } 18L${ W - 18 } 26L${ W - 30 } 40Z" fill="none" stroke="${ ULTRA }" stroke-width="1.6" stroke-linejoin="round" opacity="0.6"/><path d="M34 ${ H - 18 }L18 ${ H - 26 }L30 ${ H - 40 }Z" fill="none" stroke="${ ULTRA }" stroke-width="1.6" stroke-linejoin="round" opacity="0.6"/>`;

/** Its card back's border, and the emblem at its middle: the eye of the void in a fractured ring. */
export const back = {
    border: VOID,
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2, 66, 'back');
        return {
            defs: sign.defs,
            body: [
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="#000000" stroke="${ ULTRA }" stroke-width="2.6"/>`,
                `<path d="M${ W / 2 - 46 } ${ H / 2 - 10 }L${ W / 2 - 36 } ${ H / 2 - 6 }M${ W / 2 + 46 } ${ H / 2 + 12 }L${ W / 2 + 35 } ${ H / 2 + 6 }" stroke="${ LILAC }" stroke-width="1.4"/>`,
                ...sign.body
            ]
        };
    }
};

// ---------------------------------------------------------------- the pawn

/** A pawn: the seat's colour in enamel over matte black cracked with ultraviolet, hooded, its eyes lit in the shadow. */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.void;
    const hood = crest(palette, 'hood');
    const crack = 'M74 190L96 184L104 194L124 186L140 196L156 188L178 194';

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('matte', [[0, '#241838'], [0.5, '#0C0614'], [1, VOID]]),
        ...hood.defs
    ], [
        kit.outlined({ foot: 'url(#matte)', base: 'url(#matte)', body: 'url(#enamel)', collar: 'url(#matte)', head: 'url(#dome)' }, VOID),
        `<path d="${ crack }" fill="none" stroke="${ ULTRA }" stroke-width="6" stroke-linejoin="round" opacity="0.5"/>`,
        `<path d="${ crack }" fill="none" stroke="${ LILAC }" stroke-width="2" stroke-linejoin="round"/>`,
        ...kit.lighting(dark, '#FFFFFF', 0.5),
        ...hood.body
    ]);
}

/**
 * Infernal Sovereign: cracked obsidian with molten gold in its seams, flame tongues and a jagged
 * crown, smouldering until it erupts. Every part of the collection's art is drawn here from its
 * palette and the lava it burns with.
 */
import { about, at, C, linear, r2, RING, seeded } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'magma';

const LAVA = '#E2381C';
const EMBER = '#FF7A1F';
const CHAR = '#2A0E06';
const WHITE_HOT = '#FFFBEA';

/** A tongue of flame standing on (x, y), `tall` high and `wide` across, its tip leaning by `lean` of its height. */
const tongue = (x, y, tall, wide, lean = 0) =>
{
    const tip = [x + lean * tall, y - tall];
    return `M${ r2(x - wide / 2) } ${ r2(y) }C${ r2(x - wide * 0.62) } ${ r2(y - tall * 0.45) } ${ r2(tip[0] - wide * 0.18) } ${ r2(y - tall * 0.7) } ${ r2(tip[0]) } ${ r2(tip[1]) }C${ r2(tip[0] + wide * 0.2) } ${ r2(y - tall * 0.66) } ${ r2(x + wide * 0.64) } ${ r2(y - tall * 0.42) } ${ r2(x + wide / 2) } ${ r2(y) }Z`;
};

/** The crack network of a plate of obsidian, a tile 34 across whose seams meet its neighbours'. */
const SEAMS = 'M0 12L7 14L11 9L19 11L24 7L34 12M11 9L13 0M13 34L16 27L21 20L19 11M21 20L29 23L34 26M0 26L5 23L7 14';

export const tile = (palette) => ({
    size: 34,
    body: `<path d="${ SEAMS }" fill="none" stroke="${ LAVA }" stroke-width="2.6" stroke-linejoin="round" opacity="0.45"/><path d="${ SEAMS }" fill="none" stroke="${ palette.edge }" stroke-width="0.9" stroke-linejoin="round"/><circle cx="21" cy="20" r="1.1" fill="${ palette.glint }"/>`
});

/** Five jagged points over a band: the sovereign's crown, `wide` across with its band on y. */
const crownPath = (cx, y, wide, tall) =>
{
    const half = wide / 2;
    const points = [[-half, 0], [-half * 0.92, -tall * 0.62], [-half * 0.55, -tall * 0.28], [-half * 0.32, -tall * 0.86], [0, -tall * 0.4], [half * 0.32, -tall * 0.86], [half * 0.55, -tall * 0.28], [half * 0.92, -tall * 0.62], [half, 0]];
    return `M${ points.map(([x, py]) => `${ r2(cx + x) } ${ r2(y + py) }`).join('L') }Z`;
};

/** Lava at a flame's root to ember at its tip, and a core from ember to white-gold. */
const flames = (id, palette) => [
    `<linearGradient id="${ id }" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${ LAVA }"/><stop offset="1" stop-color="${ EMBER }"/></linearGradient>`,
    `<linearGradient id="${ id }-core" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${ EMBER }"/><stop offset="0.6" stop-color="${ palette.edge }"/><stop offset="1" stop-color="${ palette.glint }"/></linearGradient>`
];

/** A tongue of flame burning from lava to a white-hot heart, in three layers. */
const fire = (id, x, y, tall, wide, lean, outline = '') => [
    `<path d="${ tongue(x, y, tall, wide, lean) }" fill="url(#${ id })"${ outline }/>`,
    `<path d="${ tongue(x + lean * tall * 0.08, y - tall * 0.04, tall * 0.64, wide * 0.52, lean) }" fill="url(#${ id }-core)"/>`,
    `<path d="${ tongue(x + lean * tall * 0.12, y - tall * 0.06, tall * 0.3, wide * 0.24, lean) }" fill="${ WHITE_HOT }" opacity="0.92"/>`
].join('');

const gilt = (id, palette) => `<linearGradient id="${ id }" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ palette.glint }"/><stop offset="0.5" stop-color="${ palette.edge }"/><stop offset="1" stop-color="#9A4A12"/></linearGradient>`;

/** The collection's sign: a flame rising out of a jagged crown, in molten gold on obsidian. */
export function emblem(palette, cx, cy, size, id = 'inf')
{
    const s = size / 50;

    return {
        defs: [...flames(`${ id }-flame`, palette), gilt(`${ id }-crown`, palette)],
        body: [
            fire(`${ id }-flame`, cx, cy + 14 * s, 40 * s, 24 * s, 0.03),
            fire(`${ id }-flame`, cx - 12 * s, cy + 16 * s, 20 * s, 12 * s, -0.22),
            fire(`${ id }-flame`, cx + 12 * s, cy + 16 * s, 20 * s, 12 * s, 0.22),
            `<path d="${ crownPath(cx, cy + 22 * s, 46 * s, 22 * s) }" fill="url(#${ id }-crown)" stroke="${ CHAR }" stroke-width="${ r2(1.2 * s) }" stroke-linejoin="round"/>`,
            `<rect x="${ r2(cx - 23 * s) }" y="${ r2(cy + 22 * s) }" width="${ r2(46 * s) }" height="${ r2(6 * s) }" rx="${ r2(1.5 * s) }" fill="url(#${ id }-crown)" stroke="${ CHAR }" stroke-width="${ r2(1.2 * s) }"/>`,
            ...[-14, 0, 14].map((dx) => `<circle cx="${ r2(cx + dx * s) }" cy="${ r2(cy + 25 * s) }" r="${ r2(1.7 * s) }" fill="${ LAVA }" stroke="${ CHAR }" stroke-width="${ r2(0.5 * s) }"/>`)
        ]
    };
}

/**
 * A crown of flame worn on the pawn's head (the board pawn's head: centre (128, 62), radius 56),
 * hugging its top so the pawn stands on the board as every pawn does: one tall tongue in the
 * middle, two leaning out beside it and two small ones curling at the ends, each burning from lava
 * to a white-gold heart, set in a gilt circlet with three lava stones.
 */
export function crest(palette, id = 'crest')
{
    const tongues = [[-40, 22, 18, -0.34], [40, 22, 18, 0.34], [-22, 36, 24, -0.18], [22, 36, 24, 0.18], [0, 50, 32, 0]];

    return {
        defs: flames(id, palette),
        body: [
            ...tongues.map(([dx, tall, wide, lean]) => fire(id, 128 + dx, 50 - Math.abs(dx) * 0.16, tall, wide, lean, ` stroke="${ CHAR }" stroke-width="5" stroke-linejoin="round"`)),
            `<path d="M82 50C100 41 156 41 174 50" stroke="${ CHAR }" stroke-width="11" stroke-linecap="round" fill="none"/>`,
            `<path d="M82 50C100 41 156 41 174 50" stroke="${ palette.edge }" stroke-width="6" stroke-linecap="round" fill="none"/>`,
            ...[[100, 46], [128, 43], [156, 46]].map(([x, y]) => `<circle cx="${ x }" cy="${ y }" r="4.2" fill="${ LAVA }" stroke="${ CHAR }" stroke-width="2.5"/>`)
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/** A crack across the band at `turn`: in from its inner edge, kinking twice, out at its outer edge, with a branch. */
const crack = (turn, twist) =>
{
    const line = (points) => `M${ points.map(([r, dt]) => at(r, turn + dt).join(' ')).join('L') }`;
    return `${ line([[RING - 3.6, -twist * 0.2], [RING - 1.4, twist], [RING + 0.6, -twist * 0.5], [RING + 3.6, twist * 0.6]]) }${ line([[RING - 1.4, twist], [RING + 1.2, twist * 2.1], [RING + 2.6, twist * 2.6]]) }`;
};

const CRACKS = [[34, 2.6], [70, -2.2], [104, 2.8], [140, -2.6], [180, 2.2], [216, -2.8], [252, 2.4], [290, -2.2], [326, 2.6]];

/**
 * Infernal Sovereign's frame: a band of black glass with lava glowing under it and in its cracks,
 * its upper rim burning, and a crown of fire at its top that erupts every few seconds. Fire rises,
 * so every tongue on the rim points up whatever side of the ring it stands on.
 */
export function frame(palette, still)
{
    const smoulder = (offset) => (still ? '' : `<animate attributeName="opacity" values="1;0.4;1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" dur="2.8s" begin="${ -offset }s" repeatCount="indefinite"/>`);
    const lick = (offset, reach = 0.16) => (still ? '' : `<animateTransform attributeName="transform" type="scale" values="1 1;1 ${ 1 + reach };1 ${ 1 - reach * 0.5 };1 1" keyTimes="0;0.35;0.7;1" dur="${ r2(0.8 + offset * 0.3) }s" begin="${ -offset }s" repeatCount="indefinite"/>`);
    const erupt = still ? '' : '<animateTransform attributeName="transform" type="scale" values="1 1;1 1;1.12 1.7;1 1" keyTimes="0;0.8;0.86;1" calcMode="spline" keySplines="0 0 1 1;0.2 0 0.2 1;0.5 0 0.5 1" dur="6s" repeatCount="indefinite"/>';

    const cracks = CRACKS.map(([turn, twist], index) => `<g>${ smoulder(index * 0.31) }<path d="${ crack(turn, twist) }" fill="none" stroke="${ LAVA }" stroke-width="3" stroke-linejoin="round" filter="url(#heat)"/><path d="${ crack(turn, twist) }" fill="none" stroke="${ EMBER }" stroke-width="1.3" stroke-linejoin="round"/><path d="${ crack(turn, twist) }" fill="none" stroke="${ palette.glint }" stroke-width="0.45" stroke-linejoin="round"/></g>`).join('');

    const rim = [[-74, 4.2, 3.4], [-52, 5.6, 4], [-30, 6.4, 4.4], [30, 6.4, 4.4], [52, 5.6, 4], [74, 4.2, 3.4]].map(([turn, tall, wide], index) =>
    {
        const [x, y] = at(RING + 1.2, turn);
        return about(x, y, lick(index * 0.23), fire('fire', x, y, tall, wide, turn < 0 ? -0.18 : 0.18));
    }).join('');

    const crown = [[-11, 9, 6, -0.22], [11, 9, 6, 0.22], [-5.5, 12.5, 7, -0.08], [5.5, 12.5, 7, 0.08], [0, 15, 8.4, 0]].map(([dx, tall, wide, lean], index) =>
        about(C + dx, 15, lick(index * 0.19 + 0.4, 0.12), fire('fire', C + dx, 15, tall, wide, lean))).join('');

    const embers = still ? '' : [[-16, 0, 1], [20, 1.3, 0.8], [-3, 2.4, 1.1], [9, 3.4, 0.7]].map(([dx, delay, size]) =>
        `<circle cx="${ C + dx }" cy="12" r="${ size }" fill="${ palette.glint }" opacity="0"><animate attributeName="cy" values="12;-2" dur="2.6s" begin="${ delay }s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="2.6s" begin="${ delay }s" repeatCount="indefinite"/></circle>`).join('');

    return {
        defs: [
            '<linearGradient id="glass" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#4A3630"/><stop offset="0.4" stop-color="#160B08"/><stop offset="1" stop-color="#050201"/></linearGradient>',
            ...flames('fire', palette),
            gilt('gilt', palette),
            '<filter id="heat" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.1"/></filter>',
            '<filter id="smoulder" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter>'
        ],
        body: [
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ LAVA }" stroke-width="9" opacity="0.55" filter="url(#smoulder)"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="#050201" stroke-width="8.4"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#glass)" stroke-width="6.8"/>`,
            `<path d="M${ at(RING - 1.8, 210).join(' ') }A${ RING - 1.8 } ${ RING - 1.8 } 0 0 1 ${ at(RING - 1.8, 330).join(' ') }" fill="none" stroke="#FFFFFF" stroke-width="0.8" stroke-linecap="round" opacity="0.28"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING + 3.4 }" fill="none" stroke="${ palette.edge }" stroke-width="0.5" opacity="0.6"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 3.4 }" fill="none" stroke="${ LAVA }" stroke-width="0.6" opacity="0.6"/>`,
            cracks,
            rim,
            about(C, 15, erupt, crown),
            `<path d="${ crownPath(C, 16.4, 30, 11) }" fill="url(#gilt)" stroke="${ CHAR }" stroke-width="0.7" stroke-linejoin="round"/>`,
            `<rect x="${ C - 15 }" y="16.4" width="30" height="2.6" rx="0.8" fill="url(#gilt)" stroke="${ CHAR }" stroke-width="0.6"/>`,
            ...[-8, 0, 8].map((dx) => `<circle cx="${ C + dx }" cy="17.7" r="0.85" fill="${ LAVA }"/>`),
            embers
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** A ridge of obsidian against the glow, jagged as cooled lava is. */
const ridge = (next, y, height) =>
{
    const points = [[0, 240], [0, y]];
    for (let x = 0; x <= 960; x += 40)
    {
        points.push([x + next() * 20, y - next() * height]);
    }
    points.push([960, y], [960, 240]);
    return `M${ points.map(([px, py]) => `${ r2(px) } ${ r2(py) }`).join('L') }Z`;
};

/** Infernal Sovereign's cover: cracked obsidian over lava, a ridge against its glow, embers rising, the crowned flame. */
export function cover(palette)
{
    const next = seeded(73);
    const embers = Array.from({ length: 90 }, () =>
    {
        const y = 40 + next() * 200;
        return `<circle cx="${ r2(next() * 960) }" cy="${ r2(y) }" r="${ r2(0.6 + next() * 1.6) }" fill="${ next() < 0.6 ? palette.glint : EMBER }" opacity="${ r2(0.25 + (y / 240) * 0.6) }"/>`;
    }).join('');
    const sign = emblem(palette, 760, 116, 70, 'cover');
    const fissures = ['M0 196L90 188L150 200L230 184L300 196L380 180L470 194', 'M520 210L600 196L640 206L700 192L780 204L860 190L960 200', 'M150 200L170 230M380 180L396 220M640 206L648 240'];

    return {
        defs: [
            linear('ground', [palette.surface[0], palette.surface[1], palette.surface[2]], [0, 0, 0, 1]),
            `<radialGradient id="heat" cx="0.42" cy="1.1" r="0.85"><stop offset="0" stop-color="${ LAVA }" stop-opacity="0.95"/><stop offset="0.45" stop-color="${ EMBER }" stop-opacity="0.22"/><stop offset="1" stop-color="${ EMBER }" stop-opacity="0"/></radialGradient>`,
            `<pattern id="plates" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="scale(2.6)">${ tile(palette).body }</pattern>`,
            '<linearGradient id="rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A0B07"/><stop offset="1" stop-color="#050201"/></linearGradient>',
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            '<rect width="960" height="240" fill="url(#plates)" opacity="0.13"/>',
            '<rect width="960" height="240" fill="url(#heat)"/>',
            `<path d="${ ridge(next, 186, 46) }" fill="url(#rock)"/>`,
            ...fissures.map((path) => `<path d="${ path }" fill="none" stroke="${ LAVA }" stroke-width="7" stroke-linejoin="round" opacity="0.55"/><path d="${ path }" fill="none" stroke="${ palette.edge }" stroke-width="2.2" stroke-linejoin="round"/>`),
            embers,
            `<circle cx="760" cy="120" r="80" fill="${ palette.surface[2] }" opacity="0.9"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="url(#cover-crown)" stroke-width="4"/>`,
            `<circle cx="760" cy="120" r="71" fill="none" stroke="${ LAVA }" stroke-width="1.4" opacity="0.7"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.4" fill="${ palette.edge }" opacity="0.7"/><rect y="230.6" width="960" height="1.4" fill="${ palette.edge }" opacity="0.7"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: obsidian paper, molten gold and lava inks (each at 4.5:1 or more on both stops), courts set in gold. */
export const dress = {
    paper: ['#2A140C', '#170A06'],
    suits: [
        { name: 'club', ink: '#FFD27A', tint: '#2E180C', accent: '#C8892E' },
        { name: 'diamond', ink: '#FF8A5C', tint: '#341208', accent: '#D9542C' },
        { name: 'heart', ink: '#FF8A5C', tint: '#341208', accent: '#D9542C' },
        { name: 'spade', ink: '#FFD27A', tint: '#2E180C', accent: '#C8892E' }
    ],
    metal: { band: '#FFB43A', line: '#7A2E10', frame: LAVA, crown: '#FFE7A1', jewel: '#FFF4E2' }
};

/** What every card wears in the corners its indices leave free: a small flame. */
export const ornament = (W, H) => `<path d="${ tongue(W - 26, 36, 20, 11, 0.06) }" fill="${ LAVA }" opacity="0.45"/><path d="${ tongue(26, H - 16, 20, 11, -0.06) }" fill="${ LAVA }" opacity="0.45"/>`;

/** Its card back's border, and the emblem at its middle: the crowned flame in a molten ring. */
export const back = {
    border: '#120807',
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2 - 6, 64, 'back');
        return {
            defs: sign.defs,
            body: [
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="${ palette.surface[2] }" stroke="${ palette.edge }" stroke-width="3"/>`,
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="42" fill="none" stroke="${ LAVA }" stroke-width="1.2" opacity="0.7"/>`,
                ...sign.body
            ]
        };
    }
};

// ---------------------------------------------------------------- backgammon

/** A molten seam running round a checker's rim from one turn to another, jagged as cooled lava splits. */
const seam = (round, from, to) => `M${ Array.from({ length: Math.round((to - from) / 5) + 1 }, (_, step) => round(60.2 + (step % 2 === 0 ? -1 : 1) * (0.6 + (step % 3) * 0.45), from + step * 5).join(' ')).join('L') }`;

/** A jagged crack down a point's middle, from its base to near its tip, kinking less as the point narrows (`half` is its half-width at a height). */
const vent = ({ x, top, bottom, half }) => `M${ Array.from({ length: 9 }, (_, step) =>
{
    const y = bottom - (bottom - top) * step / 8;
    return `${ r2(x + (step % 2 === 0 ? -1 : 1) * (step === 0 || step === 8 ? 0 : half(y) * (0.22 + (step % 3) * 0.06))) } ${ r2(y) }`;
}).join('L') }`;

/**
 * Its backgammon art: obsidian points, every other one glowing as embers do, each split by a lava
 * crack ending in a bead of molten gold past its tip (a bead and not a flame, because the opponent's
 * home board is the same drawing turned round, and fire does not burn downward); a checker's rim
 * split by three molten seams.
 */
export const board = {
    tones: [['#4A3630', '#1A0D09', '#050201'], ['#7A3218', '#3E160A', '#120807']],
    defs: (palette) => [`<radialGradient id="bg-bead" cx="0.42" cy="0.38" r="0.62"><stop offset="0" stop-color="${ WHITE_HOT }"/><stop offset="0.35" stop-color="${ palette.edge }"/><stop offset="0.75" stop-color="${ EMBER }"/><stop offset="1" stop-color="${ LAVA }"/></radialGradient>`],
    rim: (round) => [[12, 74], [132, 194], [252, 314]].map(([from, to]) =>
        `<path d="${ seam(round, from, to) }" fill="none" stroke="${ LAVA }" stroke-width="2.6" stroke-linejoin="round" opacity="0.75"/><path d="${ seam(round, from, to) }" fill="none" stroke="${ EMBER }" stroke-width="1.1" stroke-linejoin="round"/><path d="${ seam(round, from, to) }" fill="none" stroke="${ WHITE_HOT }" stroke-width="0.35" stroke-linejoin="round" opacity="0.8"/>`).join(''),
    vein: (line, palette) => `<path d="${ vent(line) }" fill="none" stroke="${ LAVA }" stroke-width="5" stroke-linejoin="round" opacity="0.5"/><path d="${ vent(line) }" fill="none" stroke="${ EMBER }" stroke-width="2" stroke-linejoin="round"/><path d="${ vent(line) }" fill="none" stroke="${ palette.glint }" stroke-width="0.7" stroke-linejoin="round"/>`,
    tip: (x, y) => `<circle cx="${ r2(x) }" cy="${ r2(y - 11) }" r="11" fill="${ LAVA }" opacity="0.3"/><circle cx="${ r2(x) }" cy="${ r2(y - 11) }" r="6.4" fill="url(#bg-bead)" stroke="${ CHAR }" stroke-width="1.4"/>`
};

// ---------------------------------------------------------------- the pawn

/**
 * A pawn: the seat's colour in a glassy enamel under obsidian at its foot and collar, cracked with
 * molten gold, and a crown of flame on its head.
 */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.inferno;
    const crown = crest(palette, 'flames');
    const molten = 'M70 192L92 186L104 196L122 188L138 198L158 190L176 196L188 190';

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('obsidian', [[0, '#4A3630'], [0.45, '#160B08'], [1, '#050201']]),
        ...crown.defs
    ], [
        kit.outlined({ foot: 'url(#obsidian)', base: 'url(#obsidian)', body: 'url(#enamel)', collar: 'url(#obsidian)', head: 'url(#dome)' }),
        `<path d="${ molten }" fill="none" stroke="${ LAVA }" stroke-width="7" stroke-linejoin="round" opacity="0.6"/>`,
        `<path d="${ molten }" fill="none" stroke="${ palette.edge }" stroke-width="2.6" stroke-linejoin="round"/>`,
        `<path d="M92 108L108 104L118 112L134 104L146 112L162 106" fill="none" stroke="${ palette.edge }" stroke-width="2.4" stroke-linejoin="round"/>`,
        ...kit.lighting(dark, '#FFF4E2', 0.55),
        ...crown.body
    ]);
}

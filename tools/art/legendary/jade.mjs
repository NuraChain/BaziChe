/**
 * Jade Dragon Dynasty: carved translucent jade inlaid with imperial gold, cloud scrolls, and a
 * dragon's coil round everything it frames. Serene and sinuous.
 */
import { at, C, linear, r2, RING, seeded, turned } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'scales';

const JADE = '#2BB67F';
const DEEP = '#0F7A55';
const PALE = '#BFF2D9';
const GOLD = '#F2C14E';
const CINNABAR = '#C7372F';
const INK = '#063A27';

/** A cloud scroll: a curl that turns in on itself twice, `size` across, from (x, y). */
const scroll = (x, y, size, flip = 1) =>
{
    const s = size / 20;
    return `M${ r2(x) } ${ r2(y) }c${ r2(flip * 4 * s) } ${ r2(-8 * s) } ${ r2(flip * 14 * s) } ${ r2(-8 * s) } ${ r2(flip * 14 * s) } ${ r2(-1 * s) }c0 ${ r2(4 * s) } ${ r2(flip * -5 * s) } ${ r2(5 * s) } ${ r2(flip * -6 * s) } ${ r2(2 * s) }m${ r2(flip * 6 * s) } ${ r2(-2 * s) }c${ r2(flip * 2 * s) } ${ r2(-6 * s) } ${ r2(flip * 10 * s) } ${ r2(-6 * s) } ${ r2(flip * 10 * s) } 0`;
};

/** Dragon scales in rows, edged in gold, a tile 24 across. */
export const tile = (palette) => ({
    size: 24,
    body: `<path d="M0 12A6 6 0 0 1 12 12A6 6 0 0 1 24 12M-6 24A6 6 0 0 1 6 24A6 6 0 0 1 18 24A6 6 0 0 1 30 24M-6 0A6 6 0 0 1 6 0A6 6 0 0 1 18 0A6 6 0 0 1 30 0" fill="none" stroke="${ palette.edge }" stroke-width="0.8"/><circle cx="6" cy="6" r="0.9" fill="${ PALE }"/><circle cx="18" cy="18" r="0.9" fill="${ PALE }"/>`
});

const carved = (id) => `<linearGradient id="${ id }" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ PALE }"/><stop offset="0.35" stop-color="${ JADE }"/><stop offset="1" stop-color="${ DEEP }"/></linearGradient>`;
const gilt = (id) => `<linearGradient id="${ id }" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1C4"/><stop offset="0.5" stop-color="${ GOLD }"/><stop offset="1" stop-color="#9A6E12"/></linearGradient>`;

/** A dragon's head in profile at (x, y) facing `face` (1 right, -1 left), `size` long: a horned head, its jaw open toward the pearl. */
const head = (x, y, size, face, id) =>
{
    const s = size / 30;
    const p = (dx, dy) => `${ r2(x + face * dx * s) } ${ r2(y + dy * s) }`;
    return [
        `<path d="M${ p(-14, -2) }C${ p(-12, -10) } ${ p(-2, -12) } ${ p(6, -8) }L${ p(16, -6) }C${ p(19, -5) } ${ p(19, -1) } ${ p(15, 0) }L${ p(8, 1) }L${ p(16, 4) }C${ p(14, 7) } ${ p(6, 7) } ${ p(2, 5) }C${ p(-4, 8) } ${ p(-12, 6) } ${ p(-14, -2) }Z" fill="url(#${ id }-jade)" stroke="${ INK }" stroke-width="${ r2(1.1 * s) }" stroke-linejoin="round"/>`,
        `<path d="M${ p(-6, -10) }C${ p(-10, -18) } ${ p(-16, -20) } ${ p(-22, -18) }M${ p(-2, -11) }C${ p(-4, -20) } ${ p(-10, -24) } ${ p(-16, -24) }" fill="none" stroke="url(#${ id }-gold)" stroke-width="${ r2(1.8 * s) }" stroke-linecap="round"/>`,
        `<path d="M${ p(14, 1) }C${ p(20, 6) } ${ p(22, 12) } ${ p(18, 16) }" fill="none" stroke="${ GOLD }" stroke-width="${ r2(0.9 * s) }" stroke-linecap="round"/>`,
        `<circle cx="${ r2(x + face * 4 * s) }" cy="${ r2(y - 5 * s) }" r="${ r2(1.6 * s) }" fill="${ CINNABAR }"/>`
    ].join('');
};

/** The collection's sign: a dragon coiled round a flaming pearl over a cloud scroll. */
export function emblem(palette, cx, cy, size, id = 'jade')
{
    const s = size / 50;
    const coil = `M${ r2(cx + 18 * s) } ${ r2(cy + 14 * s) }C${ r2(cx + 30 * s) } ${ r2(cy - 4 * s) } ${ r2(cx + 12 * s) } ${ r2(cy - 24 * s) } ${ r2(cx - 6 * s) } ${ r2(cy - 18 * s) }C${ r2(cx - 26 * s) } ${ r2(cy - 10 * s) } ${ r2(cx - 24 * s) } ${ r2(cy + 14 * s) } ${ r2(cx - 4 * s) } ${ r2(cy + 18 * s) }`;

    return {
        defs: [carved(`${ id }-jade`), gilt(`${ id }-gold`), `<radialGradient id="${ id }-pearl" cx="0.36" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#FFF1C4"/><stop offset="1" stop-color="${ GOLD }"/></radialGradient>`],
        body: [
            `<path d="${ scroll(cx - 22 * s, cy + 24 * s, 22 * s) }${ scroll(cx + 22 * s, cy + 24 * s, 22 * s, -1) }" fill="none" stroke="url(#${ id }-gold)" stroke-width="${ r2(1.8 * s) }" stroke-linecap="round"/>`,
            `<path d="${ coil }" fill="none" stroke="${ INK }" stroke-width="${ r2(9 * s) }" stroke-linecap="round"/>`,
            `<path d="${ coil }" fill="none" stroke="url(#${ id }-jade)" stroke-width="${ r2(7 * s) }" stroke-linecap="round"/>`,
            `<path d="${ coil }" fill="none" stroke="${ GOLD }" stroke-width="${ r2(1.2 * s) }" stroke-dasharray="${ r2(1.4 * s) } ${ r2(2.6 * s) }" stroke-linecap="round"/>`,
            head(cx + 17 * s, cy + 12 * s, 26 * s, -1, id),
            `<circle cx="${ r2(cx - 2 * s) }" cy="${ r2(cy) }" r="${ r2(6.4 * s) }" fill="url(#${ id }-pearl)" stroke="${ INK }" stroke-width="${ r2(0.8 * s) }"/>`,
            `<path d="M${ r2(cx - 2 * s) } ${ r2(cy - 10 * s) }c${ r2(2 * s) } ${ r2(2 * s) } ${ r2(1 * s) } ${ r2(3 * s) } 0 ${ r2(4 * s) }" fill="none" stroke="${ CINNABAR }" stroke-width="${ r2(1 * s) }" stroke-linecap="round"/>`
        ]
    };
}

/**
 * The dragon on the pawn's head (centre (128, 62), radius 56): its jade body coiled over the top of
 * the head with gilt scales, its tail curling down one side and its horned head on the other,
 * holding the pearl.
 */
export function crest(palette, id = 'crest')
{
    const body = 'M76 92C62 66 74 34 104 26C132 18 146 38 166 34C180 31 186 22 186 14';
    const tail = 'M76 92C72 104 84 110 92 102C98 96 92 88 86 92';

    return {
        defs: [carved(`${ id }-jade`), gilt(`${ id }-gold`), `<radialGradient id="${ id }-pearl" cx="0.36" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#FFF1C4"/><stop offset="1" stop-color="${ GOLD }"/></radialGradient>`],
        body: [
            `<path d="${ body }" fill="none" stroke="${ INK }" stroke-width="24" stroke-linecap="round"/>`,
            `<path d="${ tail }" fill="none" stroke="${ INK }" stroke-width="12" stroke-linecap="round"/>`,
            `<path d="${ body }" fill="none" stroke="url(#${ id }-jade)" stroke-width="16" stroke-linecap="round"/>`,
            `<path d="${ tail }" fill="none" stroke="url(#${ id }-gold)" stroke-width="5" stroke-linecap="round"/>`,
            `<path d="${ body }" fill="none" stroke="${ GOLD }" stroke-width="3.4" stroke-dasharray="4 7" stroke-linecap="round"/>`,
            head(196, 24, 46, -1, id),
            `<circle cx="160" cy="44" r="10" fill="url(#${ id }-pearl)" stroke="${ INK }" stroke-width="4"/>`,
            `<circle cx="157" cy="41" r="3" fill="#FFFFFF"/>`
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/** The dragon's body coiling round the ring from `from` to `to`, weaving across the band. */
const coil = (from, to) =>
{
    const steps = 48;
    return `M${ Array.from({ length: steps + 1 }, (_, index) =>
    {
        const turn = from + (to - from) * index / steps;
        return at(RING + Math.sin(index * Math.PI / 6) * 2.6, turn).join(' ');
    }).join('L') }`;
};

/**
 * Jade Dragon Dynasty's frame: a band of carved jade with gold cloud scrolls, a dragon coiling
 * round it to the pearl at its top, motes of jade drifting, its scales catching the light.
 */
export function frame(palette, still)
{
    const shimmer = still ? '' : '<animate attributeName="stroke-dashoffset" values="0;-8" dur="2.4s" repeatCount="indefinite"/>';
    const glow = still ? '' : '<animate attributeName="opacity" values="0.4;0.9;0.4" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" dur="3.2s" repeatCount="indefinite"/>';
    const drift = still ? '' : [[-30, 0], [40, 1.6], [150, 0.8], [220, 2.4], [300, 1.2]].map(([turn, delay]) =>
    {
        const [x, y] = at(RING + 5, turn);
        return `<circle cx="${ x }" cy="${ y }" r="0.8" fill="${ PALE }" opacity="0"><animate attributeName="cy" values="${ y };${ r2(y - 7) }" dur="3.6s" begin="${ delay }s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0.9;0" dur="3.6s" begin="${ delay }s" repeatCount="indefinite"/></circle>`;
    }).join('');

    const scrolls = [90, 180, 270].map((turn) =>
    {
        const [x, y] = at(RING, turn);
        return `<path d="${ scroll(x - 4, y + 1.4, 8) }" fill="none" stroke="url(#gold)" stroke-width="0.9" stroke-linecap="round" transform="rotate(${ turn } ${ x } ${ y })"/>`;
    }).join('');

    const body = coil(28, 352);

    return {
        defs: [
            carved('jade'),
            gilt('gold'),
            '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2"/></filter>',
            `<radialGradient id="pearl" cx="0.36" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#FFF1C4"/><stop offset="1" stop-color="${ GOLD }"/></radialGradient>`
        ],
        body: [
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ JADE }" stroke-width="9" opacity="0.35" filter="url(#soft)"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ INK }" stroke-width="8"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#jade)" stroke-width="6.4"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 2 }" fill="none" stroke="#FFFFFF" stroke-width="0.5" opacity="0.35"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING + 3.2 }" fill="none" stroke="url(#gold)" stroke-width="0.6"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 3.2 }" fill="none" stroke="url(#gold)" stroke-width="0.6"/>`,
            scrolls,
            `<path d="${ body }" fill="none" stroke="${ INK }" stroke-width="3.6" stroke-linecap="round"/>`,
            `<path d="${ body }" fill="none" stroke="url(#gold)" stroke-width="2.4" stroke-linecap="round"/>`,
            `<path d="${ body }" fill="none" stroke="${ DEEP }" stroke-width="0.8" stroke-dasharray="1 1.6">${ shimmer }</path>`,
            `<g>${ glow }<circle cx="${ C }" cy="7.4" r="5.4" fill="${ GOLD }" opacity="0.6" filter="url(#soft)"/></g>`,
            `<circle cx="${ C }" cy="7.4" r="3.4" fill="url(#pearl)" stroke="${ INK }" stroke-width="0.5"/>`,
            head(at(RING, 352)[0] - 1, at(RING, 352)[1] + 0.5, 9, 1, 'f').replace(/url\(#f-jade\)/g, 'url(#jade)').replace(/url\(#f-gold\)/g, 'url(#gold)'),
            drift
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** Jade Dragon Dynasty's cover: misty jade mountains in layers, gold cloud scrolls, a pearl of a sun, and the dragon. */
export function cover(palette)
{
    const next = seeded(61);
    const range = (y, height, colour, opacity) =>
    {
        let path = `M0 240L0 ${ y }`;
        for (let x = 0; x < 960; x += 70 + next() * 40)
        {
            const wide = 50 + next() * 50;
            const peak = y - height * (0.45 + next() * 0.55);
            path += `C${ r2(x + wide * 0.2) } ${ r2(y) } ${ r2(x + wide * 0.3) } ${ r2(peak) } ${ r2(x + wide * 0.5) } ${ r2(peak) }C${ r2(x + wide * 0.7) } ${ r2(peak) } ${ r2(x + wide * 0.8) } ${ r2(y) } ${ r2(x + wide) } ${ r2(y) }`;
        }
        return `<path d="${ path }L960 ${ y }L960 240Z" fill="${ colour }" opacity="${ opacity }"/>`;
    };
    const clouds = Array.from({ length: 9 }, (_, index) => `<path d="${ scroll(40 + index * 100 + next() * 30, 50 + next() * 60, 40 + next() * 30, index % 2 === 0 ? 1 : -1) }" fill="none" stroke="${ GOLD }" stroke-width="2" stroke-linecap="round" opacity="${ r2(0.35 + next() * 0.35) }"/>`).join('');
    const sign = emblem(palette, 760, 120, 82, 'cover');

    return {
        defs: [
            linear('ground', ['#1A6A4C', '#0E4A35', '#05281C'], [0, 0, 0, 1]),
            '<filter id="mist" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>',
            `<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFF8E1"/><stop offset="0.6" stop-color="${ GOLD }" stop-opacity="0.85"/><stop offset="1" stop-color="${ GOLD }" stop-opacity="0"/></radialGradient>`,
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            '<circle cx="250" cy="80" r="64" fill="url(#sun)"/>',
            clouds,
            range(150, 70, '#2BB67F', 0.35),
            `<g filter="url(#mist)">${ range(176, 60, '#0F7A55', 0.55) }</g>`,
            range(206, 40, '#063A27', 0.9),
            `<circle cx="760" cy="120" r="80" fill="#05281C" opacity="0.92"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="url(#cover-gold)" stroke-width="3.4"/>`,
            `<circle cx="760" cy="120" r="72" fill="none" stroke="${ JADE }" stroke-width="1.2" opacity="0.8"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.4" fill="${ GOLD }" opacity="0.6"/><rect y="230.6" width="960" height="1.4" fill="${ GOLD }" opacity="0.6"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: pale jade paper, deep jade and cinnabar inks (each at 4.5:1 or more on both stops), courts in gold and jade. */
export const dress = {
    paper: ['#F4FFF8', '#DDF3E6'],
    suits: [
        { name: 'club', ink: '#0B3D2A', tint: '#E0F5EA', accent: '#14684A' },
        { name: 'diamond', ink: '#B3262E', tint: '#FAE8E4', accent: '#8E1C24' },
        { name: 'heart', ink: '#B3262E', tint: '#FAE8E4', accent: '#8E1C24' },
        { name: 'spade', ink: '#0B3D2A', tint: '#E0F5EA', accent: '#14684A' }
    ],
    metal: { band: GOLD, line: '#7A5A12', frame: JADE, crown: GOLD, jewel: PALE }
};

/** What every card wears in the corners its indices leave free: a cloud scroll. */
export const ornament = (W, H) => `<path d="${ scroll(W - 40, 30, 20) }" fill="none" stroke="${ JADE }" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/><path d="${ scroll(40, H - 26, 20, -1) }" fill="none" stroke="${ JADE }" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>`;

/** Its card back's border, and the emblem at its middle: the dragon and its pearl in a gold ring. */
export const back = {
    border: '#05281C',
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2, 66, 'back');
        return {
            defs: sign.defs,
            body: [
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="#05281C" stroke="url(#back-gold)" stroke-width="3"/>`,
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="42" fill="none" stroke="${ JADE }" stroke-width="1" opacity="0.8"/>`,
                ...sign.body
            ]
        };
    }
};

// ---------------------------------------------------------------- backgammon

/**
 * Its backgammon art: points of carved jade and deep jade, a line of gold inlaid down each and a
 * pearl at its tip; a checker's rim clasped in gold at four places.
 */
export const board = {
    tones: [['#4BD39C', '#24A472', '#0E5A3D'], ['#1C8A60', '#0D5038', '#052A1C']],
    defs: () => [gilt('bg-gold'), `<radialGradient id="bg-pearl" cx="0.36" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#FFF1C4"/><stop offset="1" stop-color="${ GOLD }"/></radialGradient>`],
    rim: (round, light) => [45, 135, 225, 315].map((turn) =>
    {
        const [x, y] = round(60.2, turn);
        return `<g transform="rotate(${ turn } ${ x } ${ y })"><rect x="${ r2(x - 4.4) }" y="${ r2(y - 3.4) }" width="8.8" height="6.8" rx="2" fill="url(#bg-gold)" stroke="${ INK }" stroke-width="0.8"/><circle cx="${ x }" cy="${ y }" r="1.5" fill="${ light ? JADE : PALE }"/></g>`;
    }).join(''),
    vein: ({ x, top, bottom }) => `<path d="M${ r2(x) } ${ r2(bottom - 12) }V${ r2(top + 28) }" stroke="${ INK }" stroke-width="3.4" stroke-linecap="round" opacity="0.6"/><path d="M${ r2(x) } ${ r2(bottom - 12) }V${ r2(top + 28) }" stroke="url(#bg-gold)" stroke-width="1.8" stroke-linecap="round"/>${ [0.3, 0.55, 0.78].map((along) => `<circle cx="${ r2(x) }" cy="${ r2(bottom - 12 - (bottom - top - 40) * along) }" r="1.9" fill="${ PALE }" stroke="${ INK }" stroke-width="0.6"/>`).join('') }`,
    tip: (x, y) => `<path d="M${ r2(x) } ${ r2(y - 25) }c2 2 1 3.4 0 4.6" fill="none" stroke="${ CINNABAR }" stroke-width="1.6" stroke-linecap="round"/><circle cx="${ r2(x) }" cy="${ r2(y - 12) }" r="7.4" fill="url(#bg-pearl)" stroke="${ INK }" stroke-width="1.2"/><circle cx="${ r2(x - 2.4) }" cy="${ r2(y - 14.4) }" r="2" fill="#FFFFFF" opacity="0.8"/>`
};

// ---------------------------------------------------------------- the pawn

/** A pawn: the seat's colour in enamel set in carved jade with gold rims at its foot and collar, a dragon's horns, whiskers and pearl. */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.jade;
    const dragon = crest(palette, 'dragon');

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('jade', [[0, PALE], [0.4, JADE], [1, DEEP]]),
        ...dragon.defs
    ], [
        kit.outlined({ foot: 'url(#jade)', base: 'url(#jade)', body: 'url(#enamel)', collar: 'url(#jade)', head: 'url(#dome)' }, INK),
        `<path d="M66 196C88 209 168 209 190 196" fill="none" stroke="${ GOLD }" stroke-width="4" stroke-linecap="round"/>`,
        `<path d="${ scroll(100, 196, 22) }${ scroll(156, 196, 22, -1) }" fill="none" stroke="${ GOLD }" stroke-width="2.6" stroke-linecap="round"/>`,
        ...kit.lighting(dark, '#FFFFFF', 0.55),
        ...dragon.body
    ]);
}

// ---------------------------------------------------------------- the chess set

/**
 * What the collection's chess set is crowned with (`chess-looks.mjs`): the dragon's pearl on
 * (x, y) in a gilt cradle, a cinnabar flame rising from it, and gold for the king's cross and every
 * trim.
 */
export const chess = {
    metal: ['#FFF1C4', '#F2C14E', '#9A6E12'],
    accent: (palette, x, y, size, turn, id) =>
    {
        const cradle = `M${ r2(x - size * 0.95) } ${ r2(y + size * 0.15) }Q${ r2(x) } ${ r2(y + size * 1.25) } ${ r2(x + size * 0.95) } ${ r2(y + size * 0.15) }`;

        return {
            defs: [gilt(`${ id }-gold`), `<radialGradient id="${ id }-pearl" cx="0.36" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#FFF1C4"/><stop offset="1" stop-color="${ GOLD }"/></radialGradient>`],
            body: turned([
                `<path d="${ cradle }" fill="none" stroke="${ INK }" stroke-width="${ r2(size * 0.5) }" stroke-linecap="round"/>`,
                `<path d="${ cradle }" fill="none" stroke="url(#${ id }-gold)" stroke-width="${ r2(size * 0.28) }" stroke-linecap="round"/>`,
                `<circle cx="${ r2(x) }" cy="${ r2(y) }" r="${ r2(size * 0.72) }" fill="url(#${ id }-pearl)" stroke="${ INK }" stroke-width="${ r2(size * 0.14) }"/>`,
                `<circle cx="${ r2(x - size * 0.24) }" cy="${ r2(y - size * 0.24) }" r="${ r2(size * 0.2) }" fill="#FFFFFF"/>`,
                `<path d="M${ r2(x) } ${ r2(y - size * 0.82) }c${ r2(size * 0.4) } ${ r2(-size * 0.36) } ${ r2(size * 0.16) } ${ r2(-size * 0.8) } ${ r2(-size * 0.1) } ${ r2(-size * 1.05) }" fill="none" stroke="${ CINNABAR }" stroke-width="${ r2(size * 0.22) }" stroke-linecap="round"/>`
            ].join(''), x, y, turn)
        };
    }
};

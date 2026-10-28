/**
 * Stormforged Monarch: charged forged steel, riveted bands, chevrons and pylons, and the storm in
 * it: electric blue and violet arcs that gather, crawl and strike.
 */
import { at, C, linear, r2, RING, seeded, turned } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'bolts';

const VIOLET = '#8B5CFF';
const CYAN = '#7DF0FF';
const IRON = '#060A14';

/** A bolt from one point to another, bent at fixed places so the drawing is the same every time it is drawn. */
const bolt = (x1, y1, x2, y2, kinks = [0.18, -0.22, 0.26, -0.12]) =>
{
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const points = kinks.map((aside, index) =>
    {
        const along = (index + 1) / (kinks.length + 1);
        return [x1 + dx * along - (dy / length) * aside * length * 0.4, y1 + dy * along + (dx / length) * aside * length * 0.4];
    });
    return `M${ [[x1, y1], ...points, [x2, y2]].map(([x, y]) => `${ r2(x) } ${ r2(y) }`).join('L') }`;
};

/** A bolt drawn as storms are: a violet haze, a blue body and a white-hot core. */
const lit = (path, width) => `<path d="${ path }" fill="none" stroke="${ VIOLET }" stroke-width="${ r2(width * 3.2) }" stroke-linejoin="round" stroke-linecap="round" opacity="0.35"/><path d="${ path }" fill="none" stroke="#3FA9FF" stroke-width="${ r2(width * 1.6) }" stroke-linejoin="round" stroke-linecap="round"/><path d="${ path }" fill="none" stroke="#EAF6FF" stroke-width="${ r2(width * 0.6) }" stroke-linejoin="round" stroke-linecap="round"/>`;

/** Riveted steel plates with a chevron and a spark of blue, a tile 30 across. */
export const tile = (palette) => ({
    size: 30,
    body: `<path d="M0 0.5H30M0.5 0V30" stroke="${ palette.piece[1] }" stroke-width="1" opacity="0.8"/><path d="M6 19L15 13L24 19" fill="none" stroke="${ palette.edge }" stroke-width="1.2" stroke-linejoin="round"/><path d="M15 3L12.6 8.4H16L13.6 13" fill="none" stroke="${ CYAN }" stroke-width="0.8" stroke-linejoin="round"/><circle cx="3" cy="3" r="1.1" fill="${ palette.piece[0] }"/><circle cx="27" cy="27" r="1.1" fill="${ palette.piece[0] }"/>`
});

const steel = (id, palette) => `<linearGradient id="${ id }" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2F6FC"/><stop offset="0.3" stop-color="${ palette.piece[0] }"/><stop offset="0.7" stop-color="${ palette.piece[1] }"/><stop offset="1" stop-color="${ palette.piece[2] }"/></linearGradient>`;

/** A pylon of forged steel `tall` high on (x, y), a ball of charge at its tip. */
const pylon = (x, y, tall, wide) => `M${ r2(x - wide / 2) } ${ r2(y) }L${ r2(x - wide * 0.16) } ${ r2(y - tall) }L${ r2(x + wide * 0.16) } ${ r2(y - tall) }L${ r2(x + wide / 2) } ${ r2(y) }Z`;

/** The collection's sign: three pylons of a steel crown and the bolt that strikes through the middle one. */
export function emblem(palette, cx, cy, size, id = 'storm')
{
    const s = size / 50;
    const pylons = [[-15, 22, 9], [0, 34, 11], [15, 22, 9]];

    return {
        defs: [steel(`${ id }-steel`, palette)],
        body: [
            ...pylons.map(([dx, tall, wide]) => `<path d="${ pylon(cx + dx * s, cy + 12 * s, tall * s, wide * s) }" fill="url(#${ id }-steel)" stroke="${ IRON }" stroke-width="${ r2(1.1 * s) }" stroke-linejoin="round"/><circle cx="${ r2(cx + dx * s) }" cy="${ r2(cy + 12 * s - tall * s) }" r="${ r2(2.6 * s) }" fill="${ CYAN }" stroke="${ IRON }" stroke-width="${ r2(0.8 * s) }"/>`),
            `<rect x="${ r2(cx - 24 * s) }" y="${ r2(cy + 12 * s) }" width="${ r2(48 * s) }" height="${ r2(9 * s) }" rx="${ r2(2 * s) }" fill="url(#${ id }-steel)" stroke="${ IRON }" stroke-width="${ r2(1.1 * s) }"/>`,
            ...[-17, -6, 6, 17].map((dx) => `<circle cx="${ r2(cx + dx * s) }" cy="${ r2(cy + 16.5 * s) }" r="${ r2(1.3 * s) }" fill="${ palette.piece[2] }"/>`),
            lit(bolt(cx + 4 * s, cy - 26 * s, cx - 2 * s, cy + 4 * s, [0.3, -0.34, 0.28]), 1.3 * s),
            `<circle cx="${ r2(cx) }" cy="${ r2(cy - 22 * s) }" r="${ r2(5 * s) }" fill="${ CYAN }" opacity="0.35"/>`
        ]
    };
}

/**
 * The storm spire worn on the pawn's head (centre (128, 62), radius 56): a crown of three steel
 * pylons tipped with charge, an arc leaping between them.
 */
export function crest(palette, id = 'crest')
{
    const pylons = [[-32, 30, 20], [0, 46, 24], [32, 30, 20]];

    return {
        defs: [steel(id, palette)],
        body: [
            ...pylons.map(([dx, tall, wide]) => `<path d="${ pylon(128 + dx, 50 - Math.abs(dx) * 0.12, tall, wide) }" fill="url(#${ id })" stroke="${ IRON }" stroke-width="5" stroke-linejoin="round"/>`),
            lit(bolt(96, 22, 128, 6, [0.22, -0.3]), 2),
            lit(bolt(160, 22, 128, 6, [-0.22, 0.3]), 2),
            ...pylons.map(([dx, tall]) => `<circle cx="${ 128 + dx }" cy="${ 50 - Math.abs(dx) * 0.12 - tall }" r="7" fill="${ CYAN }" stroke="${ IRON }" stroke-width="3.5"/><circle cx="${ 126 + dx }" cy="${ 48 - Math.abs(dx) * 0.12 - tall }" r="2.4" fill="#FFFFFF"/>`),
            `<path d="M84 50C100 42 156 42 172 50" stroke="${ IRON }" stroke-width="12" stroke-linecap="round" fill="none"/>`,
            `<path d="M84 50C100 42 156 42 172 50" stroke="url(#${ id })" stroke-width="7" stroke-linecap="round" fill="none"/>`,
            ...[96, 112, 128, 144, 160].map((x) => `<circle cx="${ x }" cy="${ x === 128 ? 44 : 45.5 + Math.abs(x - 128) * 0.06 }" r="1.8" fill="${ palette.piece[2] }"/>`)
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/** A jagged arc along the ring from one turn to another, its path wandering in and out of the band. */
const crawl = (from, to, wobble) =>
{
    const steps = 10;
    return `M${ Array.from({ length: steps + 1 }, (_, index) => at(RING + (index % 2 === 0 ? -wobble : wobble) * (index === 0 || index === steps ? 0 : 1), from + (to - from) * index / steps).join(' ')).join('L') }`;
};

/**
 * Stormforged Monarch's frame: a riveted band of forged steel with chevrons, a crown of three
 * pylons at its top, arcs crawling round it, and a bolt that strikes the crown every few seconds.
 */
export function frame(palette, still)
{
    const crawling = (from, to, seconds, offset) => (still ? '' : `<animateTransform attributeName="transform" type="rotate" values="0 ${ C } ${ C };${ to - from } ${ C } ${ C }" dur="${ seconds }s" begin="${ -offset }s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0.3;1;0" keyTimes="0;0.15;0.5;0.7;1" dur="${ seconds }s" begin="${ -offset }s" repeatCount="indefinite"/>`);
    const strike = still ? '' : '<animate attributeName="opacity" values="0;0;1;0.2;1;0" keyTimes="0;0.8;0.83;0.86;0.89;1" dur="5s" repeatCount="indefinite"/>';
    const charge = still ? '' : '<animate attributeName="r" values="2.2;2.2;3.6;2.2" keyTimes="0;0.78;0.86;1" dur="5s" repeatCount="indefinite"/>';

    const rivets = Array.from({ length: 16 }, (_, index) =>
    {
        const [x, y] = at(RING, index * 22.5 + 11.25);
        return `<circle cx="${ x }" cy="${ y }" r="1.05" fill="${ palette.piece[2] }"/><circle cx="${ r2(x - 0.3) }" cy="${ r2(y - 0.3) }" r="0.4" fill="#FFFFFF" opacity="0.8"/>`;
    }).join('');

    const chevrons = Array.from({ length: 16 }, (_, index) =>
    {
        const turn = index * 22.5;
        return Math.abs(((turn + 180) % 360) - 180) < 20 ? '' : `<path d="M${ at(RING - 2, turn - 3).join(' ') }L${ at(RING + 0.8, turn).join(' ') }L${ at(RING - 2, turn + 3).join(' ') }" fill="none" stroke="${ palette.edge }" stroke-width="0.8" stroke-linejoin="round" opacity="0.8"/>`;
    }).join('');

    const arcs = [[40, 90, 1.6, 0], [150, 205, 2.2, 0.7], [250, 300, 1.8, 1.3]].map(([from, to, seconds, offset]) =>
        `<g opacity="${ still ? 0.8 : 0 }">${ crawling(from, to, seconds, offset) }${ lit(crawl(from, from + 30, 1.6), 0.45) }</g>`).join('');

    const pylons = [[-9, 9, 5.2], [0, 13, 6.4], [9, 9, 5.2]];

    return {
        defs: [
            steel('steel', palette),
            '<filter id="charge" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter>'
        ],
        body: [
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="#3FA9FF" stroke-width="8.6" opacity="0.28" filter="url(#charge)"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ IRON }" stroke-width="8.2"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#steel)" stroke-width="6.6"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 2.4 }" fill="none" stroke="${ IRON }" stroke-width="0.5" opacity="0.6"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING + 2.4 }" fill="none" stroke="${ IRON }" stroke-width="0.5" opacity="0.6"/>`,
            chevrons,
            rivets,
            arcs,
            ...pylons.map(([dx, tall, wide]) => `<path d="${ pylon(C + dx, 17, tall, wide) }" fill="url(#steel)" stroke="${ IRON }" stroke-width="0.7" stroke-linejoin="round"/>`),
            `<rect x="${ C - 13 }" y="16" width="26" height="3.4" rx="0.9" fill="url(#steel)" stroke="${ IRON }" stroke-width="0.6"/>`,
            ...pylons.map(([dx, tall]) => `<circle cx="${ C + dx }" cy="${ 17 - tall }" r="${ dx === 0 ? 2.2 : 1.7 }" fill="${ CYAN }" stroke="${ IRON }" stroke-width="0.5">${ dx === 0 ? charge : '' }</circle>`),
            `<g opacity="${ still ? 0 : 1 }">${ strike }${ lit(bolt(C + 3, -2, C, 4, [0.4, -0.5]), 0.5) }<circle cx="${ C }" cy="4" r="4" fill="${ CYAN }" opacity="0.5" filter="url(#charge)"/></g>`
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** Stormforged Monarch's cover: a night of storm clouds, rain, two bolts striking, and the steel crown. */
export function cover(palette)
{
    const next = seeded(19);
    const clouds = Array.from({ length: 26 }, () => `<ellipse cx="${ r2(next() * 960) }" cy="${ r2(20 + next() * 90) }" rx="${ r2(60 + next() * 90) }" ry="${ r2(18 + next() * 22) }" fill="${ next() < 0.5 ? '#2A3A5E' : '#1A2442' }" opacity="${ r2(0.35 + next() * 0.4) }"/>`).join('');
    const rain = Array.from({ length: 120 }, () =>
    {
        const x = next() * 980;
        const y = next() * 240;
        return `<path d="M${ r2(x) } ${ r2(y) }l-6 18" stroke="#9FB4D8" stroke-width="0.8" opacity="${ r2(0.12 + next() * 0.22) }"/>`;
    }).join('');
    const sign = emblem(palette, 760, 126, 76, 'cover');

    return {
        defs: [
            linear('ground', [palette.surface[0], palette.surface[1], palette.surface[2]], [0, 0, 0, 1]),
            '<filter id="mist" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>',
            '<filter id="flash" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>',
            `<radialGradient id="glow" cx="0.28" cy="0.35" r="0.5"><stop offset="0" stop-color="${ VIOLET }" stop-opacity="0.4"/><stop offset="1" stop-color="${ VIOLET }" stop-opacity="0"/></radialGradient>`,
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            '<rect width="960" height="240" fill="url(#glow)"/>',
            `<g filter="url(#mist)">${ clouds }</g>`,
            `<path d="${ bolt(250, 0, 210, 230, [0.12, -0.18, 0.1, -0.14, 0.16, -0.08]) }" fill="none" stroke="${ VIOLET }" stroke-width="16" opacity="0.4" filter="url(#flash)"/>`,
            lit(bolt(250, 0, 210, 230, [0.12, -0.18, 0.1, -0.14, 0.16, -0.08]), 1.6),
            lit(bolt(232, 118, 300, 168, [0.2, -0.24]), 0.8),
            lit(bolt(520, 0, 548, 120, [-0.16, 0.2, -0.1]), 1),
            rain,
            `<circle cx="760" cy="120" r="80" fill="${ palette.surface[2] }" opacity="0.92"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="url(#cover-steel)" stroke-width="5"/>`,
            ...Array.from({ length: 12 }, (_, index) =>
            {
                const angle = index * Math.PI / 6;
                return `<circle cx="${ r2(760 + Math.cos(angle) * 80) }" cy="${ r2(120 + Math.sin(angle) * 80) }" r="2" fill="${ palette.piece[2] }"/>`;
            }),
            `<circle cx="760" cy="120" r="71" fill="none" stroke="${ palette.edge }" stroke-width="1.4" opacity="0.7"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.4" fill="${ palette.edge }" opacity="0.6"/><rect y="230.6" width="960" height="1.4" fill="${ palette.edge }" opacity="0.6"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: brushed steel paper, deep blue and crimson inks (each at 4.5:1 or more on both stops), courts in steel and charge. */
export const dress = {
    paper: ['#F4F7FB', '#DCE4EF'],
    suits: [
        { name: 'club', ink: '#142057', tint: '#E3EAF6', accent: '#2B3E7A' },
        { name: 'diamond', ink: '#B4184E', tint: '#F8E6EE', accent: '#8E1240' },
        { name: 'heart', ink: '#B4184E', tint: '#F8E6EE', accent: '#8E1240' },
        { name: 'spade', ink: '#142057', tint: '#E3EAF6', accent: '#2B3E7A' }
    ],
    metal: { band: '#3FA9FF', line: '#1B2A55', frame: VIOLET, crown: '#C9D4E6', jewel: CYAN }
};

/** What every card wears in the corners its indices leave free: a small bolt. */
export const ornament = (W, H) => `<path d="${ bolt(W - 22, 14, W - 30, 40, [0.4, -0.4]) }" fill="none" stroke="#3FA9FF" stroke-width="2" stroke-linejoin="round" opacity="0.55"/><path d="${ bolt(30, H - 40, 22, H - 14, [0.4, -0.4]) }" fill="none" stroke="#3FA9FF" stroke-width="2" stroke-linejoin="round" opacity="0.55"/>`;

/** Its card back's border, and the emblem at its middle: the steel crown struck in a riveted ring. */
export const back = {
    border: IRON,
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2 + 2, 62, 'back');
        return {
            defs: sign.defs,
            body: [
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="${ palette.surface[2] }" stroke="url(#back-steel)" stroke-width="4"/>`,
                ...Array.from({ length: 12 }, (_, index) =>
                {
                    const angle = index * Math.PI / 6;
                    return `<circle cx="${ r2(W / 2 + Math.cos(angle) * 48) }" cy="${ r2(H / 2 + Math.sin(angle) * 48) }" r="1.6" fill="${ palette.piece[2] }"/>`;
                }),
                ...sign.body
            ]
        };
    }
};

// ---------------------------------------------------------------- backgammon

/**
 * Its backgammon art: points of forged steel and dark iron, each struck down its middle by a bolt
 * and sparking at its tip; a checker's rim riveted eight times round.
 */
export const board = {
    tones: [['#8A97B2', '#4A566E', '#121A2C'], ['#2A3858', '#151F38', '#0B0F18']],
    rim: (round, light, palette) => Array.from({ length: 8 }, (_, nth) =>
    {
        const [x, y] = round(60.2, nth * 45 + 22.5);
        return `<circle cx="${ x }" cy="${ y }" r="2.4" fill="${ light ? palette.piece[0] : '#EAF6FF' }" stroke="${ IRON }" stroke-width="0.9"/><circle cx="${ r2(x - 0.7) }" cy="${ r2(y - 0.7) }" r="0.8" fill="#FFFFFF" opacity="0.9"/>`;
    }).join(''),
    vein: ({ x, top, bottom, half }) => lit(`M${ Array.from({ length: 8 }, (_, step) =>
    {
        const y = bottom - (bottom - top) * step / 7;
        return `${ r2(x + (step === 0 || step === 7 ? 0 : (step % 2 === 0 ? -1 : 1) * half(y) * 0.3)) } ${ r2(y) }`;
    }).join('L') }`, 1.3),
    tip: (x, y) => `<circle cx="${ r2(x) }" cy="${ r2(y - 9) }" r="10" fill="${ CYAN }" opacity="0.25"/><path d="M${ r2(x) } ${ r2(y - 22) }L${ r2(x + 2.6) } ${ r2(y - 11.6) }L${ r2(x + 11) } ${ r2(y - 9) }L${ r2(x + 2.6) } ${ r2(y - 6.4) }L${ r2(x) } ${ r2(y + 4) }L${ r2(x - 2.6) } ${ r2(y - 6.4) }L${ r2(x - 11) } ${ r2(y - 9) }L${ r2(x - 2.6) } ${ r2(y - 11.6) }Z" fill="#EAF6FF" stroke="#3FA9FF" stroke-width="1.2" stroke-linejoin="round"/>`
};

// ---------------------------------------------------------------- the pawn

/** A pawn: the seat's colour in enamel set in forged steel at its foot and collar, riveted, a storm spire on its head. */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.storm;
    const spire = crest(palette, 'spire');

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('forged', [[0, '#F2F6FC'], [0.35, palette.piece[0]], [0.75, palette.piece[1]], [1, palette.piece[2]]]),
        ...spire.defs
    ], [
        kit.outlined({ foot: 'url(#forged)', base: 'url(#forged)', body: 'url(#enamel)', collar: 'url(#forged)', head: 'url(#dome)' }, IRON),
        ...[80, 104, 128, 152, 176].map((x) => `<circle cx="${ x }" cy="${ 196 - Math.abs(x - 128) * 0.06 }" r="3.4" fill="${ palette.piece[2] }"/>`),
        `<path d="M96 186L112 196L128 186L144 196L160 186" fill="none" stroke="${ palette.edge }" stroke-width="3" stroke-linejoin="round" opacity="0.85"/>`,
        ...kit.lighting(dark, '#FFFFFF', 0.55),
        ...spire.body
    ]);
}

// ---------------------------------------------------------------- the chess set

/**
 * What the collection's chess set is crowned with (`chess-looks.mjs`): a pylon of forged steel
 * standing on (x, y), a ball of charge at its tip, and blue steel for the king's cross and every
 * trim.
 */
export const chess = {
    metal: ['#EAF6FF', '#7FB8F0', '#24467A'],
    accent: (palette, x, y, size, turn, id) =>
    {
        const top = y + size * 0.9 - size * 2.1;

        return {
            defs: [steel(id, palette)],
            body: turned([
                `<path d="${ pylon(x, y + size * 0.9, size * 2.1, size * 1.3) }" fill="url(#${ id })" stroke="${ IRON }" stroke-width="${ r2(size * 0.2) }" stroke-linejoin="round"/>`,
                `<circle cx="${ r2(x) }" cy="${ r2(top) }" r="${ r2(size * 0.66) }" fill="${ CYAN }" opacity="0.35"/>`,
                `<circle cx="${ r2(x) }" cy="${ r2(top) }" r="${ r2(size * 0.42) }" fill="${ CYAN }" stroke="${ IRON }" stroke-width="${ r2(size * 0.14) }"/>`,
                `<circle cx="${ r2(x - size * 0.13) }" cy="${ r2(top - size * 0.13) }" r="${ r2(size * 0.14) }" fill="#FFFFFF"/>`
            ].join(''), x, y, turn)
        };
    }
};

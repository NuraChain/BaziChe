/**
 * Astral Rift: dark glass full of stars, the rings of an orrery and a rift of light that opens in
 * the night and seals again. Slow, gravitational, every part of it in orbit.
 */
import { about, at, C, linear, r2, RING, seeded, sparkle } from '../svg-parts.mjs';

/** The palette's pattern this collection's art is drawn for (`game/looks/palette.ts`). */
export const pattern = 'stars';

const NEBULA = '#B04BFF';
const SPACE = '#0A0820';
const PINK = '#FF7AD9';

/** Stars of three sizes and a faint orbit through them, a tile 36 across. */
export const tile = (palette) => ({
    size: 36,
    body: `<path d="${ sparkle(10, 11, 3.4) }" fill="${ palette.glint }"/><path d="${ sparkle(27, 26, 2) }" fill="${ palette.edge }"/><circle cx="25" cy="7" r="0.7" fill="#FFFFFF"/><circle cx="6" cy="29" r="0.6" fill="${ palette.edge }"/><circle cx="17" cy="19" r="0.45" fill="#FFFFFF"/><path d="M0 22C12 16 24 16 36 22" fill="none" stroke="${ NEBULA }" stroke-width="0.6" opacity="0.7"/>`
});

/** A planet with its ring, the ring's far half drawn behind it and its near half before. */
const planet = (id, cx, cy, r, palette, tilt = -18) =>
{
    const ring = (half) => `<path d="M${ r2(cx - r * 1.9) } ${ r2(cy) }A${ r2(r * 1.9) } ${ r2(r * 0.55) } 0 0 ${ half } ${ r2(cx + r * 1.9) } ${ r2(cy) }" fill="none" stroke="url(#${ id }-ring)" stroke-width="${ r2(r * 0.32) }" transform="rotate(${ tilt } ${ r2(cx) } ${ r2(cy) })"/>`;
    return {
        defs: [
            `<radialGradient id="${ id }-ball" cx="0.36" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.25" stop-color="${ palette.edge }"/><stop offset="0.7" stop-color="${ NEBULA }"/><stop offset="1" stop-color="#2A1050"/></radialGradient>`,
            `<linearGradient id="${ id }-ring" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ palette.glint }" stop-opacity="0.2"/><stop offset="0.5" stop-color="${ palette.glint }"/><stop offset="1" stop-color="${ palette.glint }" stop-opacity="0.2"/></linearGradient>`
        ],
        back: ring(1),
        ball: `<circle cx="${ r2(cx) }" cy="${ r2(cy) }" r="${ r2(r) }" fill="url(#${ id }-ball)"/>`,
        front: ring(0)
    };
};

/** The collection's sign: a ringed world with a moon in orbit and a star beside it. */
export function emblem(palette, cx, cy, size, id = 'astral')
{
    const s = size / 50;
    const world = planet(id, cx, cy + 2 * s, 13 * s, palette);

    return {
        defs: world.defs,
        body: [
            `<ellipse cx="${ r2(cx) }" cy="${ r2(cy + 2 * s) }" rx="${ r2(24 * s) }" ry="${ r2(10 * s) }" fill="none" stroke="${ palette.edge }" stroke-width="${ r2(0.7 * s) }" stroke-dasharray="${ r2(2 * s) } ${ r2(2.4 * s) }" transform="rotate(24 ${ r2(cx) } ${ r2(cy) })" opacity="0.8"/>`,
            world.back,
            world.ball,
            world.front,
            `<circle cx="${ r2(cx + 20 * s) }" cy="${ r2(cy + 12 * s) }" r="${ r2(2.6 * s) }" fill="${ PINK }"/>`,
            `<path d="${ sparkle(cx - 17 * s, cy - 16 * s, 6 * s) }" fill="${ palette.glint }"/>`,
            `<path d="${ sparkle(cx + 15 * s, cy - 18 * s, 3 * s) }" fill="#FFFFFF"/>`
        ]
    };
}

/** The ringed orb on the pawn's head (centre (128, 62), radius 56): a ring round it, a moon and a star. */
export function crest(palette, id = 'crest')
{
    const ring = (sweep) => `<path d="M48 70A80 24 0 0 ${ sweep } 208 70" fill="none" stroke="url(#${ id })" stroke-width="11" stroke-linecap="round" transform="rotate(-14 128 62)"/>`;

    return {
        defs: [`<linearGradient id="${ id }" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ palette.edge }"/><stop offset="0.5" stop-color="${ palette.glint }"/><stop offset="1" stop-color="${ palette.edge }"/></linearGradient>`],
        back: [`<g stroke="#140A30" stroke-width="18" fill="none" stroke-linecap="round"><path d="M48 70A80 24 0 0 1 208 70" transform="rotate(-14 128 62)"/></g>`, ring(1)],
        body: [
            `<g stroke="#140A30" stroke-width="18" fill="none" stroke-linecap="round"><path d="M48 70A80 24 0 0 0 208 70" transform="rotate(-14 128 62)"/></g>`,
            ring(0),
            `<circle cx="196" cy="28" r="10" fill="${ PINK }" stroke="#140A30" stroke-width="4"/><circle cx="193" cy="25" r="3" fill="#FFFFFF" opacity="0.85"/>`,
            `<path d="${ sparkle(76, 22, 14) }" fill="${ palette.glint }" stroke="#140A30" stroke-width="2"/>`
        ]
    };
}

// ---------------------------------------------------------------- the frame round a picture

/**
 * Astral Rift's frame: a band of dark glass full of stars between rings of an orrery, two worlds in
 * slow orbit round it, and a rift of light at its top that opens and seals.
 */
export function frame(palette, still)
{
    const orbit = (seconds, back = false) => (still ? '' : `<animateTransform attributeName="transform" type="rotate" from="0 ${ C } ${ C }" to="${ back ? -360 : 360 } ${ C } ${ C }" dur="${ seconds }s" repeatCount="indefinite"/>`);
    const twinkle = (offset) => (still ? '' : `<animate attributeName="opacity" values="1;0.25;1" dur="2.4s" begin="${ -offset }s" repeatCount="indefinite"/>`);
    const open = still ? '' : '<animateTransform attributeName="transform" type="scale" values="0.15 1;1 1;1 1;0.15 1;0.15 1" keyTimes="0;0.2;0.6;0.8;1" calcMode="spline" keySplines="0.3 0 0.2 1;0 0 1 1;0.6 0 0.8 1;0 0 1 1" dur="7s" repeatCount="indefinite"/>';

    const next = seeded(7);
    const stars = Array.from({ length: 46 }, () =>
    {
        const [x, y] = at(RING + (next() - 0.5) * 5.4, next() * 360);
        return `<circle cx="${ x }" cy="${ y }" r="${ r2(0.2 + next() * 0.5) }" fill="${ next() < 0.3 ? palette.glint : '#FFFFFF' }" opacity="${ r2(0.5 + next() * 0.5) }"/>`;
    }).join('');

    const glints = [[60, 2.6], [140, 2], [205, 2.4], [300, 2.2]].map(([turn, size], index) =>
    {
        const [x, y] = at(RING + 0.6, turn);
        return `<path d="${ sparkle(x, y, size) }" fill="${ palette.glint }">${ twinkle(index * 0.6) }</path>`;
    }).join('');

    const [mx, my] = at(RING + 4.6, 0);
    const [px, py] = at(RING - 4.4, 0);

    return {
        defs: [
            '<linearGradient id="glass" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#3A2470"/><stop offset="0.45" stop-color="#170A36"/><stop offset="1" stop-color="#05030F"/></linearGradient>',
            `<radialGradient id="rift" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.4" stop-color="${ palette.glint }"/><stop offset="0.75" stop-color="${ palette.edge }" stop-opacity="0.6"/><stop offset="1" stop-color="${ NEBULA }" stop-opacity="0"/></radialGradient>`,
            '<filter id="haze" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2"/></filter>',
            `<radialGradient id="moon" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="${ PINK }"/><stop offset="1" stop-color="#5A1A70"/></radialGradient>`,
            `<radialGradient id="world" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.45" stop-color="${ palette.edge }"/><stop offset="1" stop-color="#0E4A5C"/></radialGradient>`
        ],
        body: [
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ NEBULA }" stroke-width="9" opacity="0.4" filter="url(#haze)"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="${ SPACE }" stroke-width="8.2"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING }" fill="none" stroke="url(#glass)" stroke-width="6.6"/>`,
            stars,
            `<circle cx="${ C }" cy="${ C }" r="${ RING - 3.4 }" fill="none" stroke="${ palette.glint }" stroke-width="0.45" opacity="0.85"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING + 3.4 }" fill="none" stroke="${ palette.edge }" stroke-width="0.45" opacity="0.85"/>`,
            `<circle cx="${ C }" cy="${ C }" r="${ RING + 5.2 }" fill="none" stroke="${ palette.edge }" stroke-width="0.35" stroke-dasharray="1.2 2.6" opacity="0.6"/>`,
            glints,
            `<g>${ orbit(36) }<circle cx="${ mx }" cy="${ my }" r="2.1" fill="url(#moon)"/></g>`,
            `<g>${ orbit(24, true) }<circle cx="${ px }" cy="${ py }" r="1.6" fill="url(#world)"/></g>`,
            about(C, 7.5, open, `<ellipse cx="${ C }" cy="7.5" rx="3.6" ry="9" fill="url(#rift)" filter="url(#haze)"/><path d="M${ C } -1.2C${ C + 2.6 } 3 ${ C + 2.6 } 12 ${ C } 16.2C${ C - 2.6 } 12 ${ C - 2.6 } 3 ${ C } -1.2Z" fill="url(#rift)"/><path d="M${ C } 0.6L${ C } 14.4" stroke="#FFFFFF" stroke-width="0.6"/>`)
        ]
    };
}

// ---------------------------------------------------------------- the cover

/** Astral Rift's cover: deep space, nebulae, a field of stars, orbits, a rift of light, and the ringed world. */
export function cover(palette)
{
    const next = seeded(29);
    const stars = Array.from({ length: 160 }, () => `<circle cx="${ r2(next() * 960) }" cy="${ r2(next() * 240) }" r="${ r2(0.3 + next() * 1.1) }" fill="${ next() < 0.2 ? palette.glint : '#FFFFFF' }" opacity="${ r2(0.3 + next() * 0.7) }"/>`).join('');
    const clouds = Array.from({ length: 14 }, () => `<ellipse cx="${ r2(next() * 960) }" cy="${ r2(next() * 240) }" rx="${ r2(50 + next() * 110) }" ry="${ r2(24 + next() * 50) }" fill="${ next() < 0.55 ? NEBULA : palette.edge }" opacity="${ r2(0.12 + next() * 0.18) }"/>`).join('');
    const sign = emblem(palette, 760, 120, 84, 'cover');

    return {
        defs: [
            linear('ground', ['#170A36', '#0E0628', SPACE], [0, 0, 1, 1]),
            '<filter id="nebula" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="22"/></filter>',
            '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>',
            `<radialGradient id="tear" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="${ palette.glint }"/><stop offset="0.7" stop-color="${ PINK }" stop-opacity="0.5"/><stop offset="1" stop-color="${ NEBULA }" stop-opacity="0"/></radialGradient>`,
            ...sign.defs
        ],
        body: [
            '<rect width="960" height="240" fill="url(#ground)"/>',
            `<g filter="url(#nebula)">${ clouds }</g>`,
            stars,
            `<ellipse cx="300" cy="120" rx="250" ry="70" fill="none" stroke="${ palette.edge }" stroke-width="0.8" opacity="0.35" transform="rotate(-10 300 120)"/>`,
            `<ellipse cx="300" cy="120" rx="170" ry="46" fill="none" stroke="${ palette.glint }" stroke-width="0.8" stroke-dasharray="4 7" opacity="0.4" transform="rotate(-10 300 120)"/>`,
            '<ellipse cx="300" cy="120" rx="34" ry="110" fill="url(#tear)" filter="url(#glow)"/>',
            `<path d="M300 22C318 70 318 170 300 218C282 170 282 70 300 22Z" fill="url(#tear)"/>`,
            '<path d="M300 34L300 206" stroke="#FFFFFF" stroke-width="1.6"/>',
            `<circle cx="760" cy="120" r="80" fill="${ SPACE }" opacity="0.92"/>`,
            `<circle cx="760" cy="120" r="80" fill="none" stroke="${ palette.edge }" stroke-width="2"/>`,
            `<circle cx="760" cy="120" r="74" fill="none" stroke="${ palette.glint }" stroke-width="1" stroke-dasharray="2 5"/>`,
            ...sign.body,
            `<rect y="8" width="960" height="1.2" fill="${ palette.edge }" opacity="0.55"/><rect y="230.8" width="960" height="1.2" fill="${ palette.edge }" opacity="0.55"/>`
        ]
    };
}

// ---------------------------------------------------------------- the cards

/** Its deck: night-glass paper, star gold and nebula pink inks (each at 4.5:1 or more on both stops), courts in orbit. */
export const dress = {
    paper: ['#1A0E3A', '#0A0620'],
    suits: [
        { name: 'club', ink: '#FFE58A', tint: '#22134A', accent: '#C9A94A' },
        { name: 'diamond', ink: PINK, tint: '#2A1048', accent: '#D24FB0' },
        { name: 'heart', ink: PINK, tint: '#2A1048', accent: '#D24FB0' },
        { name: 'spade', ink: '#FFE58A', tint: '#22134A', accent: '#C9A94A' }
    ],
    metal: { band: '#4FE3D8', line: '#2A1458', frame: NEBULA, crown: '#FFE58A', jewel: '#FFFFFF' }
};

/** What every card wears in the corners its indices leave free: a star. */
export const ornament = (W, H) => `<path d="${ sparkle(W - 26, 26, 8) }" fill="#4FE3D8" opacity="0.6"/><path d="${ sparkle(26, H - 26, 8) }" fill="#4FE3D8" opacity="0.6"/>`;

/** Its card back's border, and the emblem at its middle: the ringed world in an orbit. */
export const back = {
    border: SPACE,
    emblem: (palette, W, H) =>
    {
        const sign = emblem(palette, W / 2, H / 2, 70, 'back');
        return {
            defs: sign.defs,
            body: [
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="48" fill="${ SPACE }" stroke="${ palette.edge }" stroke-width="2.4"/>`,
                `<circle cx="${ W / 2 }" cy="${ H / 2 }" r="42" fill="none" stroke="${ palette.glint }" stroke-width="1" stroke-dasharray="2 4"/>`,
                ...sign.body
            ]
        };
    }
};

// ---------------------------------------------------------------- the pawn

/** A pawn: the seat's colour in star-glass, set in night glass at its foot and collar, a ringed world on its head. */
export function pawn(seat, kit)
{
    const [light, fill, dark] = kit.SEAT_RAMPS[seat];
    const palette = kit.PALETTES.astral;
    const ring = crest(palette, 'ring');
    const next = seeded(seat.length * 13);
    const motes = Array.from({ length: 9 }, () => `<circle cx="${ r2(84 + next() * 88) }" cy="${ r2(184 + next() * 14) }" r="${ r2(1 + next() * 1.6) }" fill="#FFFFFF" opacity="${ r2(0.5 + next() * 0.5) }"/>`).join('');

    return kit.svg([
        kit.vertical('enamel', [[0, light], [0.5, fill], [1, dark]]),
        kit.radial('dome', [light, fill, dark], [0.4, 0.34, 0.85]),
        kit.vertical('night', [[0, '#3A2470'], [0.5, '#170A36'], [1, '#05030F']]),
        ...ring.defs
    ], [
        ...ring.back,
        kit.outlined({ foot: 'url(#night)', base: 'url(#night)', body: 'url(#enamel)', collar: 'url(#night)', head: 'url(#dome)' }, '#140A30'),
        motes,
        ...kit.lighting(dark, '#FFFFFF', 0.6),
        ...ring.body
    ]);
}

/**
 * What the shop's drawings share: gradients, the four-pointed sparkle, girih's stars and each
 * collection's own pattern, all in SVG text. `looks.mjs` draws the shop's cards with them and
 * `profile-looks.mjs` the frames, plates, covers and effects a profile wears.
 */

export const r2 = (value) => Math.round(value * 100) / 100;

export const linear = (id, [lit, mid, dark], [x1, y1, x2, y2] = [0.2, 0, 0.8, 1]) =>
    `<linearGradient id="${ id }" x1="${ x1 }" y1="${ y1 }" x2="${ x2 }" y2="${ y2 }"><stop offset="0" stop-color="${ lit }"/><stop offset="0.55" stop-color="${ mid }"/><stop offset="1" stop-color="${ dark }"/></linearGradient>`;

export const radial = (id, [lit, mid, dark], [cx, cy, r] = [0.5, 0.42, 0.78]) =>
    `<radialGradient id="${ id }" cx="${ cx }" cy="${ cy }" r="${ r }"><stop offset="0" stop-color="${ lit }"/><stop offset="0.6" stop-color="${ mid }"/><stop offset="1" stop-color="${ dark }"/></radialGradient>`;

export const gloss = (id, opacity, [cx, cy, r] = [0.3, 0.2, 0.72]) =>
    `<radialGradient id="${ id }" cx="${ cx }" cy="${ cy }" r="${ r }"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${ opacity }"/><stop offset="0.7" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`;

/** A four-pointed sparkle, concave between its points. */
export const sparkle = (cx, cy, r) =>
    `M${ r2(cx) } ${ r2(cy - r) }Q${ r2(cx) } ${ r2(cy) } ${ r2(cx + r) } ${ r2(cy) }Q${ r2(cx) } ${ r2(cy) } ${ r2(cx) } ${ r2(cy + r) }Q${ r2(cx) } ${ r2(cy) } ${ r2(cx - r) } ${ r2(cy) }Q${ r2(cx) } ${ r2(cy) } ${ r2(cx) } ${ r2(cy - r) }Z`;

export const polygon = (cx, cy, r, sides, turn) =>
    `M${ Array.from({ length: sides }, (_, step) =>
    {
        const angle = (turn + step * 360 / sides) * Math.PI / 180;
        return `${ r2(cx + r * Math.cos(angle)) } ${ r2(cy + r * Math.sin(angle)) }`;
    }).join('L') }Z`;

/** The eight-pointed star of girih tilework: two squares, one turned an eighth. */
export const octagram = (cx, cy, r) => `${ polygon(cx, cy, r, 4, 45) }${ polygon(cx, cy, r, 4, 0) }`;

/** An eight-pointed star drawn as one outline, for a filled emblem. */
export const starOf = (cx, cy, outer, inner, points) =>
    `M${ Array.from({ length: points * 2 }, (_, step) =>
    {
        const angle = (-90 + step * 180 / points) * Math.PI / 180;
        const radius = step % 2 === 0 ? outer : inner;
        return `${ r2(cx + radius * Math.cos(angle)) } ${ r2(cy + radius * Math.sin(angle)) }`;
    }).join('L') }Z`;

/** The collection's own pattern as a tile, in its edge and its glint. */
export function motif(id, palette, scale = 1)
{
    const at = `patternTransform="scale(${ scale })"`;

    if (palette.pattern === 'sparkle')
    {
        return `<pattern id="${ id }" width="22" height="22" patternUnits="userSpaceOnUse" ${ at }><path d="${ sparkle(11, 11, 3.4) }" fill="${ palette.glint }"/><circle cx="3.5" cy="4" r="0.8" fill="${ palette.edge }"/><circle cx="18" cy="18.5" r="0.55" fill="${ palette.glint }"/><path d="${ sparkle(19, 4, 1.3) }" fill="${ palette.edge }"/></pattern>`;
    }

    if (palette.pattern === 'girih')
    {
        return `<pattern id="${ id }" width="28" height="28" patternUnits="userSpaceOnUse" ${ at }><path d="${ octagram(14, 14, 7.5) }M14 0V6.5M14 21.5V28M0 14H6.5M21.5 14H28M0 0L4 4M28 0L24 4M0 28L4 24M28 28L24 24" fill="none" stroke="${ palette.edge }" stroke-width="0.9" stroke-linejoin="round"/><circle cx="14" cy="14" r="1.6" fill="${ palette.glint }"/></pattern>`;
    }

    if (palette.pattern === 'grid')
    {
        return `<pattern id="${ id }" width="16" height="16" patternUnits="userSpaceOnUse" ${ at }><path d="M0 0.5H16M0.5 0V16" stroke="${ palette.glint }" stroke-width="0.7"/><circle cx="0.5" cy="0.5" r="1.1" fill="${ palette.edge }"/></pattern>`;
    }

    return `<pattern id="${ id }" width="30" height="30" patternUnits="userSpaceOnUse" ${ at }><path d="M4 15C4 8.4 10.4 6.6 13.4 10.2C15.4 12.8 13 16.2 10.6 14.4M26 15C26 21.6 19.6 23.4 16.6 19.8C14.6 17.2 17 13.8 19.4 15.6M15 2.5C17.4 5 17.4 7.6 15 9.6C12.6 7.6 12.6 5 15 2.5Z" fill="none" stroke="${ palette.edge }" stroke-width="0.9" stroke-linecap="round"/><circle cx="15" cy="25" r="1.3" fill="${ palette.edge }"/></pattern>`;
}

export const neon = (palette) => palette.pattern === 'grid';

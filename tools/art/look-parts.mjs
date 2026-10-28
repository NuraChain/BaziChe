/**
 * What the shop's drawings share: each collection's own pattern as a tile, and the parts every
 * drawing is made of (`svg-parts.mjs`, passed on from here). `looks.mjs` draws the shop's cards
 * with them and `profile-looks.mjs` the frames, plates, covers and effects a profile wears; a
 * legendary collection's pattern is its own module's (`legendary/`).
 */
import { lineOf } from './legendary/index.mjs';
import { octagram, sparkle } from './svg-parts.mjs';

export { gloss, linear, octagram, polygon, r2, radial, sparkle, starOf } from './svg-parts.mjs';

/** The collection's own pattern as a tile, in its edge and its glint. */
export function motif(id, palette, scale = 1)
{
    const at = `patternTransform="scale(${ scale })"`;

    const line = lineOf(palette);

    if (line !== undefined)
    {
        const { size, body } = line.tile(palette);
        return `<pattern id="${ id }" width="${ size }" height="${ size }" patternUnits="userSpaceOnUse" ${ at }>${ body }</pattern>`;
    }

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

/** How far apart two colours stand in light, by the measure the palette's ink is held to (WCAG). */
export const contrast = (one, other) =>
{
    const light = (hex) =>
    {
        const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [high, low] = [light(one), light(other)].sort((a, b) => b - a);

    return (high + 0.05) / (low + 0.05);
};

/**
 * A collection's chip: the light, the face and the dark of what it is made of; the inserts round
 * its edge, white (Neon's in its glint, Royal Gold's in its gold) or its dark where white would not
 * show on its face; and its inlay, whichever of its edge and its dark stands out more from its face.
 */
export function chipTones(palette)
{
    const [lit, face, dark] = lineOf(palette) !== undefined
        ? [palette.glint, palette.edge, palette.deep[1]]
        : (palette.pattern === 'sparkle' || palette.pattern === 'girih' ? palette.piece : palette.surface);
    const light = neon(palette) ? palette.glint : (palette.pattern === 'filigree' ? palette.edge : '#FFFFFF');

    return {
        lit,
        face,
        dark,
        stripe: contrast(light, face) >= 2.5 ? light : dark,
        inlay: contrast(palette.edge, face) >= contrast(dark, face) ? palette.edge : dark
    };
}

/** The cloth a collection's felt is woven in: Royal Gold's a deep green under its gold, Shiraz's its turquoise glaze, every other collection's its surface. */
export const clothOf = (palette) => (palette.pattern === 'filigree' ? ['#1E3B2C', '#10261B', '#07140E'] : (palette.pattern === 'girih' ? palette.piece : palette.surface));

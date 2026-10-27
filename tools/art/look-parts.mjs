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

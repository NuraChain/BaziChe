/**
 * The smallest parts every drawing here is made of, in SVG text: rounding, gradients, the
 * four-pointed sparkle, polygons and stars, a frame's ring and a seeded sequence. They import
 * nothing, so each collection's art (`legendary/`) and the shared pattern (`look-parts.mjs`)
 * can both stand on them.
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

/** The middle of a frame's 120 square, and the radius its band runs on. */
export const C = 60;
export const RING = 52.5;

/** A point on a circle round a frame's middle, a turn of 0 at the top and going clockwise. */
export const at = (r, turn) =>
{
    const angle = (turn - 90) * Math.PI / 180;
    return [r2(C + r * Math.cos(angle)), r2(C + r * Math.sin(angle))];
};

/** A seeded sequence, so a drawing comes out the same each time it is drawn. */
export const seeded = (seed) =>
{
    let state = seed;
    return () =>
    {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
};

/** `content` turned `turn` degrees clockwise about (x, y), or left as it is. */
export const turned = (content, x, y, turn) => (turn === 0 ? content : `<g transform="rotate(${ r2(turn) } ${ r2(x) } ${ r2(y) })">${ content }</g>`);

/** `content` scaled about (x, y) by `scale`, an animateTransform of type scale or nothing. */
export const about = (x, y, scale, content) => `<g transform="translate(${ x } ${ y })"><g>${ scale }<g transform="translate(${ -x } ${ -y })">${ content }</g></g></g>`;

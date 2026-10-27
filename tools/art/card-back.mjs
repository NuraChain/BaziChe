/**
 * A collection's card back, in the classic back's shape, for the table's files
 * (`table-looks.mjs`) and the shop's drawings (`looks.mjs`) alike.
 */
import { H, W } from './card-parts.mjs';
import { motif } from './look-parts.mjs';

/** A soft light round a neon line, which a back's emblem and a pawn's glow are drawn with. */
export const HALO = '<filter id="halo" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="5"/></filter>';

/** A back: a border, the collection's pattern framed twice, and its emblem (a drawing, or the defs and body of one) at the middle. */
export function cardBack(palette, border, emblem)
{
    const drawn = typeof emblem === 'string' ? { defs: [], body: [emblem] } : emblem;
    const [lit, mid, dark] = palette.surface;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W } ${ H }" width="${ W }" height="${ H }">
<defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ lit }"/><stop offset="0.55" stop-color="${ mid }"/><stop offset="1" stop-color="${ dark }"/></linearGradient>
    ${ motif('pattern', palette, 1.2) }
    ${ HALO }${ drawn.defs.join('') }
</defs>
<rect width="${ W }" height="${ H }" fill="${ border }"/>
<rect x="9" y="9" width="${ W - 18 }" height="${ H - 18 }" rx="10" fill="url(#field)"/>
<rect x="9" y="9" width="${ W - 18 }" height="${ H - 18 }" rx="10" fill="url(#pattern)" opacity="0.55"/>
<rect x="17" y="17" width="${ W - 34 }" height="${ H - 34 }" rx="6" fill="none" stroke="${ palette.edge }" stroke-opacity="0.85" stroke-width="2"/>
<rect x="22" y="22" width="${ W - 44 }" height="${ H - 44 }" rx="4" fill="none" stroke="${ palette.edge }" stroke-opacity="0.35" stroke-width="1"/>
${ drawn.body.join('') }
</svg>
`;
}

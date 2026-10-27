import { PALETTES } from './palette.ts';
import type { Collection } from './table.ts';

/** The custom properties the stylesheet draws a die from; each one not set is the classic die's. */
export const DIE_PROPERTIES = ['--die-lit', '--die-mid', '--die-dark', '--die-side', '--die-shade', '--die-ink', '--die-shine', '--die-pip', '--die-pip-lit', '--die-glow'] as const;

/** How a die in each collection catches the light: the gloss on its face, and whether its pips glow. */
const SHEEN = {
    glow: { gloss: 0.55, glowing: false },
    shiraz: { gloss: 0.55, glowing: false },
    neon: { gloss: 0.18, glowing: true },
    gold: { gloss: 0.55, glowing: false }
} as const satisfies Record<Collection, { gloss: number; glowing: boolean }>;

/** A die in its collection's colours, as the shop draws it (`tools/art/looks.mjs`): its face, side, rim and pips. */
export function dieDress(collection: Collection)
{
    const { die, edge } = PALETTES[collection];
    const { gloss, glowing } = SHEEN[collection];

    return {
        '--die-lit': die.face[0],
        '--die-mid': die.face[1],
        '--die-dark': die.face[1],
        '--die-side': die.face[2],
        '--die-shade': `color-mix(in oklab, ${ die.face[2] } 76%, #000)`,
        '--die-ink': edge,
        '--die-shine': `rgb(255 255 255 / ${ gloss })`,
        '--die-pip': die.pip,
        '--die-pip-lit': `color-mix(in oklab, ${ die.pip } 72%, #FFF)`,
        '--die-glow': glowing ? `0 0 0.08em ${ die.pip }` : 'none'
    } satisfies Record<(typeof DIE_PROPERTIES)[number], string>;
}

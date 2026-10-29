import type { Colour } from '../../../../backend/src/domains/match/chess/board.ts';
import type { Step } from '../vfx/engine.ts';
import type { Collection } from './table.ts';

/** The collection each colour's pieces are drawn in at a chess table, or nothing for Classic. */
export type Sets = Record<Colour, Collection | null>;

const KINDS = ['k', 'q', 'r', 'b', 'n', 'p'] as const;

/**
 * Where each side's pieces are drawn from, as custom properties on the board's root: a piece of a
 * side in a set reads its drawing there wherever the board draws it, on a square, in a tray and in
 * the promotion chooser, and a side in Classic sets none, so its pieces are the board's own.
 */
export function dressOf(sets: Sets)
{
    return (['w', 'b'] as const).flatMap((colour) =>
    {
        const set = sets[colour];

        return set === null ? [] : KINDS.map((kind) => `--piece-${ colour }${ kind }: url('/pieces/${ set }-${ colour }${ kind }.svg')`);
    }).join('; ');
}

/** How lightly a piece in a set is set down: a game is forty moves a side, so its landing is the least of its moments and over within a second. */
export const LANDING = { intensity: 0.45, density: 0.6, duration: 600 } as const;

/**
 * Castling in a set: its collection's flourish where the rook is set down beside its king, a wall
 * drawn round the king rather than a blow.
 */
export const CASTLES = {
    glow: [{ effect: 'shockwave' }, { effect: 'stars', after: 60 }],
    shiraz: [{ effect: 'shockwave' }, { effect: 'dust', after: 60 }],
    neon: [{ effect: 'pulse' }, { effect: 'sparks', after: 40, tune: { intensity: 0.7 } }],
    gold: [{ effect: 'shockwave' }, { effect: 'burst', after: 60, tune: { intensity: 0.7 } }],
    inferno: [{ effect: 'cracks', tune: { intensity: 0.6 } }, { effect: 'shockwave', after: 120 }],
    storm: [{ effect: 'discharge', tune: { intensity: 0.7 } }, { effect: 'pulse', after: 80 }],
    astral: [{ effect: 'nebula', tune: { intensity: 0.6, duration: 900 } }, { effect: 'stars', after: 100 }],
    void: [{ effect: 'absorb', tune: { speed: 1.4 } }],
    jade: [{ effect: 'sigil', tune: { intensity: 0.8 } }, { effect: 'orbs', after: 200, tune: { intensity: 0.7 } }],
    frost: [{ effect: 'crystals' }, { effect: 'frost', after: 160 }],
    phoenix: [{ effect: 'sunburst', tune: { intensity: 0.6 } }, { effect: 'embers', after: 100 }],
    oni: [{ effect: 'scan' }, { effect: 'pulse', after: 120 }]
} as const satisfies Record<Collection, readonly Step[]>;

/** A king put in check by a piece in a set: a warning in its collection under the king, never over it. */
export const CHECKS = {
    glow: [{ effect: 'pulse', tune: { intensity: 0.8 } }],
    shiraz: [{ effect: 'shockwave', tune: { intensity: 0.7 } }],
    neon: [{ effect: 'pulse', tune: { intensity: 0.9 } }],
    gold: [{ effect: 'shockwave', tune: { intensity: 0.8 } }],
    inferno: [{ effect: 'cracks', tune: { intensity: 0.5 } }],
    storm: [{ effect: 'charge', tune: { intensity: 0.7 } }],
    astral: [{ effect: 'rift', tune: { intensity: 0.5, speed: 2 } }],
    void: [{ effect: 'fracture', tune: { intensity: 0.6 } }],
    jade: [{ effect: 'sigil', tune: { intensity: 0.6 } }],
    frost: [{ effect: 'crystals', tune: { intensity: 0.6 } }],
    phoenix: [{ effect: 'flare', tune: { intensity: 0.6 } }],
    oni: [{ effect: 'scan', tune: { intensity: 0.8 } }]
} as const satisfies Record<Collection, readonly Step[]>;

/**
 * The layer a mate adds to the winner's critical reveal, played over the king laid down: the game's
 * end goes one step further than a promotion does.
 */
export const FINALES = {
    glow: { effect: 'shockwave', after: 380 },
    shiraz: { effect: 'shockwave', after: 420 },
    neon: { effect: 'shockwave', after: 380 },
    gold: { effect: 'stars', after: 300 },
    inferno: { effect: 'embers', after: 700, tune: { density: 1.6 } },
    storm: { effect: 'shockwave', after: 560 },
    astral: { effect: 'nebula', after: 420 },
    void: { effect: 'fracture', after: 640 },
    jade: { effect: 'orbs', after: 520 },
    frost: { effect: 'frost', after: 620 },
    phoenix: { effect: 'wings', after: 360 },
    oni: { effect: 'pulse', after: 420 }
} as const satisfies Record<Collection, Step>;

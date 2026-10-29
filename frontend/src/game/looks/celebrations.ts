import type { Step } from '../vfx/engine.ts';
import type { Point } from '../vfx/presets.ts';
import { lightOf, wornOf, type Collection } from './table.ts';

/**
 * A celebration in a look: its collection's fullest signature, risen from the winner's own place at
 * the table while the table holds the end of the match (`PAUSES.end`), so it is over before the
 * result comes, and drawn under every piece. A legendary collection's builds in layers as its reveal
 * does, and every one ends in a burst that fills the winner's side.
 */
export const CELEBRATIONS = {
    glow: [{ effect: 'pulse' }, { effect: 'stars', after: 80, tune: { density: 2 } }, { effect: 'fireworks', after: 380 }, { effect: 'stars', after: 820, tune: { density: 1.4 } }],
    shiraz: [{ effect: 'shockwave' }, { effect: 'dust', after: 60, tune: { density: 2.2 } }, { effect: 'fireworks', after: 420 }],
    neon: [{ effect: 'pulse' }, { effect: 'sparks', after: 40, tune: { density: 2.4 } }, { effect: 'fireworks', after: 360 }, { effect: 'scan', after: 700 }],
    gold: [{ effect: 'shockwave' }, { effect: 'burst', after: 60, tune: { density: 2 } }, { effect: 'confetti', after: 300 }, { effect: 'fireworks', after: 600 }],
    inferno: [{ effect: 'cracks' }, { effect: 'eruption', after: 320 }, { effect: 'fireworks', after: 650 }],
    storm: [{ effect: 'charge' }, { effect: 'strike', after: 420 }, { effect: 'discharge', after: 470 }, { effect: 'strike', after: 900 }],
    astral: [{ effect: 'rift', tune: { speed: 1.5 } }, { effect: 'starburst', after: 300 }, { effect: 'stars', after: 420, tune: { density: 2 } }, { effect: 'fireworks', after: 700 }],
    void: [{ effect: 'implosion' }, { effect: 'release', after: 420 }, { effect: 'fracture', after: 460 }, { effect: 'starburst', after: 900 }],
    jade: [{ effect: 'sigil' }, { effect: 'orbs', after: 260 }, { effect: 'dust', after: 300, tune: { density: 2 } }, { effect: 'fireworks', after: 820 }],
    frost: [{ effect: 'crystals' }, { effect: 'shatter', after: 500 }, { effect: 'fireworks', after: 700 }],
    phoenix: [{ effect: 'wings' }, { effect: 'flare', after: 300 }, { effect: 'sunburst', after: 420 }, { effect: 'fireworks', after: 650 }],
    oni: [{ effect: 'scan' }, { effect: 'glitch', after: 200, tune: { density: 2 } }, { effect: 'fireworks', after: 600 }, { effect: 'glitch', after: 1000 }]
} as const satisfies Record<Collection, readonly Step[]>;

/** How wide a place a celebration fills at scale 1, and the most it is scaled to: past that its bolts smear. */
const CHEER_FITS = 40;

const CHEER_MOST = 3;

/** The collection of the celebration a seat's look wears, or null for Classic and for anything this build does not draw. */
export const celebrationOf = (look: { celebration?: string } | undefined) => wornOf('celebration', look?.celebration);

/** A celebration risen from `at`, in its collection's light, sized to a place `across` pixels wide. */
export function cheerAt(collection: Collection, at: Point, across: number)
{
    return { steps: CELEBRATIONS[collection], at, tune: { colors: lightOf(collection), scale: Math.min(CHEER_MOST, across / CHEER_FITS) } };
}

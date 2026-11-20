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
    shiraz: [{ effect: 'mosaic' }, { effect: 'dust', after: 160, tune: { density: 1.4 } }, { effect: 'mosaic', after: 530, dy: -22 }],
    neon: [{ effect: 'circuit' }, { effect: 'sparks', after: 110, tune: { density: 1.5 } }, { effect: 'circuit', after: 440, dy: -22 }],
    gold: [{ effect: 'burst' }, { effect: 'confetti', after: 260 }],
    inferno: [{ effect: 'cracks' }, { effect: 'eruption', after: 320 }, { effect: 'embers', after: 720, tune: { duration: 1200 } }],
    storm: [{ effect: 'charge' }, { effect: 'strike', after: 420 }, { effect: 'discharge', after: 470 }, { effect: 'strike', after: 900 }],
    astral: [{ effect: 'rift', tune: { speed: 1.5 } }, { effect: 'starburst', after: 300 }, { effect: 'nebula', after: 620, tune: { duration: 1400 } }],
    void: [{ effect: 'implosion' }, { effect: 'release', after: 420 }, { effect: 'fracture', after: 460 }, { effect: 'starburst', after: 900 }],
    jade: [{ effect: 'sigil' }, { effect: 'orbs', after: 260 }, { effect: 'dust', after: 440, tune: { density: 1.5 } }],
    frost: [{ effect: 'crystals' }, { effect: 'shatter', after: 500 }, { effect: 'frost', after: 690, tune: { duration: 1100 } }],
    phoenix: [{ effect: 'wings' }, { effect: 'flare', after: 300 }, { effect: 'sunburst', after: 420 }],
    oni: [{ effect: 'scan' }, { effect: 'glitch', after: 200, tune: { density: 1.5 } }, { effect: 'fracture', after: 540 }, { effect: 'glitch', after: 800 }]
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

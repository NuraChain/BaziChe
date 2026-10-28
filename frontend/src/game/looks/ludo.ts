import type { Flow, Step } from '../vfx/engine.ts';
import type { Collection } from './table.ts';

/**
 * What a pawn in a look leaves behind as it walks: the trail in its collection's light, and from a
 * legendary collection's its own stream shed along it. Astral's comet is a trail of its own.
 */
export const TRAILS = {
    glow: ['trail'],
    shiraz: ['trail'],
    neon: ['trail'],
    gold: ['trail'],
    inferno: ['trail', 'cinders'],
    storm: ['trail', 'static'],
    astral: ['comet'],
    void: ['trail', 'wisps'],
    jade: ['trail', 'runes'],
    frost: ['trail', 'glints'],
    phoenix: ['trail', 'feathers'],
    oni: ['trail', 'pixels']
} as const satisfies Record<Collection, readonly Flow[]>;

/**
 * A six that keeps its thrower's turn, in a die look: its collection's fuller signature over the
 * die once it has landed on the six, which it never touches. Storm's strike comes down from above
 * the die, which only this moment is given.
 */
export const SIXES = {
    glow: [{ effect: 'pulse' }, { effect: 'stars', after: 60, tune: { density: 1.8 } }],
    shiraz: [{ effect: 'shockwave' }, { effect: 'dust', after: 80, tune: { density: 2 } }],
    neon: [{ effect: 'pulse' }, { effect: 'sparks', after: 60, tune: { density: 2 } }],
    gold: [{ effect: 'shockwave' }, { effect: 'burst', after: 60, tune: { density: 1.6 } }],
    inferno: [{ effect: 'cracks' }, { effect: 'eruption', after: 300 }],
    storm: [{ effect: 'charge' }, { effect: 'strike', after: 420 }, { effect: 'discharge', after: 470 }],
    astral: [{ effect: 'rift', tune: { speed: 1.5 } }, { effect: 'starburst', after: 260 }],
    void: [{ effect: 'absorb' }, { effect: 'release', after: 500 }],
    jade: [{ effect: 'sigil' }, { effect: 'dust', after: 300, tune: { density: 1.6 } }],
    frost: [{ effect: 'crystals' }, { effect: 'shatter', after: 500 }],
    phoenix: [{ effect: 'flare' }, { effect: 'sunburst', after: 120 }],
    oni: [{ effect: 'scan' }, { effect: 'glitch', after: 200, tune: { density: 1.6 } }]
} as const satisfies Record<Collection, readonly Step[]>;

/** A capture by a pawn in a look: its collection's signature where the pawn lands on the one it takes. */
export const TAKES = {
    glow: [{ effect: 'stars' }, { effect: 'shockwave', after: 40 }],
    shiraz: [{ effect: 'dust', tune: { density: 1.6 } }, { effect: 'shockwave', after: 40 }],
    neon: [{ effect: 'sparks' }, { effect: 'shockwave', after: 40 }],
    gold: [{ effect: 'burst' }, { effect: 'shockwave', after: 40 }],
    inferno: [{ effect: 'eruption', tune: { intensity: 0.8 } }],
    storm: [{ effect: 'discharge' }, { effect: 'shockwave', after: 40 }],
    astral: [{ effect: 'starburst' }, { effect: 'shockwave', after: 40 }],
    void: [{ effect: 'implosion' }, { effect: 'release', after: 220 }],
    jade: [{ effect: 'sigil', tune: { intensity: 0.8 } }, { effect: 'dust', after: 150 }],
    frost: [{ effect: 'shatter' }],
    phoenix: [{ effect: 'flare' }, { effect: 'embers', after: 80 }],
    oni: [{ effect: 'glitch', tune: { density: 1.5 } }, { effect: 'shockwave', after: 60 }]
} as const satisfies Record<Collection, readonly Step[]>;

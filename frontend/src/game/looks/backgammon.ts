import type { Step } from '../vfx/engine.ts';
import type { Collection } from './table.ts';

/**
 * A checker in a look coming back in from the bar: its collection's signature where it lands, a
 * return to the game, as Phoenix's wings and Void's release say it.
 */
export const ENTRIES = {
    glow: [{ effect: 'pulse' }, { effect: 'stars', after: 40 }],
    shiraz: [{ effect: 'shockwave' }, { effect: 'dust', after: 60, tune: { density: 1.6 } }],
    neon: [{ effect: 'pulse' }, { effect: 'sparks', after: 40 }],
    gold: [{ effect: 'shockwave' }, { effect: 'burst', after: 50 }],
    inferno: [{ effect: 'cracks', tune: { intensity: 0.8 } }, { effect: 'embers', after: 160 }],
    storm: [{ effect: 'charge', tune: { speed: 1.4 } }, { effect: 'discharge', after: 300 }],
    astral: [{ effect: 'rift', tune: { speed: 2 } }, { effect: 'stars', after: 220 }],
    void: [{ effect: 'release' }],
    jade: [{ effect: 'orbs' }, { effect: 'shockwave', after: 60 }],
    frost: [{ effect: 'crystals', tune: { speed: 1.4 } }, { effect: 'frost', after: 200 }],
    phoenix: [{ effect: 'wings', tune: { speed: 1.3 } }],
    oni: [{ effect: 'scan' }, { effect: 'glitch', after: 120 }]
} as const satisfies Record<Collection, readonly Step[]>;

/**
 * A checker in a look borne off: a short signature of its collection where it comes to rest in the
 * tray, over within a second, because a side bears fifteen off a game and up to four in a turn.
 */
export const BORNE = {
    glow: [{ effect: 'stars', tune: { intensity: 0.7, duration: 700 } }],
    shiraz: [{ effect: 'dust', tune: { intensity: 0.8, duration: 700 } }],
    neon: [{ effect: 'sparks', tune: { intensity: 0.7 } }],
    gold: [{ effect: 'burst', tune: { intensity: 0.6 } }],
    inferno: [{ effect: 'embers', tune: { duration: 800 } }],
    storm: [{ effect: 'discharge', tune: { intensity: 0.6 } }],
    astral: [{ effect: 'starburst', tune: { intensity: 0.6, duration: 700 } }],
    void: [{ effect: 'implosion', tune: { intensity: 0.7, duration: 450 } }],
    jade: [{ effect: 'orbs', tune: { intensity: 0.7, duration: 700 } }],
    frost: [{ effect: 'shatter', tune: { duration: 460, density: 0.6 } }],
    phoenix: [{ effect: 'flare', tune: { intensity: 0.6 } }],
    oni: [{ effect: 'glitch', tune: { density: 0.8 } }]
} as const satisfies Record<Collection, readonly Step[]>;

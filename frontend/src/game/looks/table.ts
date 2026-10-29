import type { Effect, Step } from '../vfx/engine.ts';
import { LIGHTS } from './lights.ts';
import { PALETTES } from './palette.ts';

export type Collection = keyof typeof PALETTES;

/** The kinds of look a table draws on its players' things, and the celebration it plays for its winner. */
type TableKind = 'dice' | 'pawns' | 'yard' | 'face' | 'back' | 'felt' | 'chips' | 'checkers' | 'home' | 'pieces' | 'celebration';

/** The collection a worn look of a kind names, or null for Classic and for anything this build does not draw. */
export function wornOf(kind: TableKind, look: string | undefined)
{
    const collection = look?.startsWith(`${ kind }.`) === true ? look.slice(kind.length + 1) : '';
    return Object.hasOwn(PALETTES, collection) ? collection as Collection : null;
}

/** Every collection anybody at a table wears a look of these kinds in, once each: the voices that table is heard in. */
export function heardAt(looks: readonly (Partial<Record<TableKind, string>> | undefined)[], kinds: readonly TableKind[])
{
    const heard = looks.flatMap((look) => kinds.map((kind) => wornOf(kind, look?.[kind]))).filter((collection) => collection !== null);

    return [...new Set(heard)];
}

/** The colours a collection's effects play in at a table: its light. */
export function lightOf(collection: Collection)
{
    return LIGHTS[collection];
}

/**
 * Each collection's burst: where its die lands, and where one of its looks is put on. A legendary
 * collection's is one of its own effect families.
 */
const BURSTS = {
    glow: 'stars',
    shiraz: 'dust',
    neon: 'sparks',
    gold: 'burst',
    inferno: 'cracks',
    storm: 'discharge',
    astral: 'starburst',
    void: 'release',
    jade: 'orbs',
    frost: 'shatter',
    phoenix: 'flare',
    oni: 'glitch'
} as const satisfies Record<Collection, Effect>;

export function burstOf(collection: Collection)
{
    return { effect: BURSTS[collection], tune: { colors: lightOf(collection) } };
}

/**
 * A die's critical reveal in a look: its collection's fuller signature once the dice have landed,
 * which it never touches: a six that keeps its thrower's turn at Ludo, doubles at backgammon.
 * Storm's strike comes down from above the dice, which only this moment is given.
 */
export const CRITICALS = {
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

/**
 * A capture in a look: its collection's signature where the piece that takes lands on the one it
 * takes, a Ludo pawn on another and a backgammon checker on a blot.
 */
export const CAPTURES = {
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

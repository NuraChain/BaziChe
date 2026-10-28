import type { Effect } from '../vfx/engine.ts';
import { LIGHTS } from './lights.ts';
import { PALETTES } from './palette.ts';

export type Collection = keyof typeof PALETTES;

/** The kinds of look a table draws on its players' things. */
type TableKind = 'dice' | 'pawns' | 'yard' | 'face' | 'back' | 'felt';

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
 * Each collection's burst: where its die lands, where a card of it is laid, and where its pawn
 * takes another. A legendary collection's is one of its own effect families.
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

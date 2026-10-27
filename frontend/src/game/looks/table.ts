import type { Preset } from '../vfx/presets.ts';
import { PALETTES } from './palette.ts';

export type Collection = keyof typeof PALETTES;

/** The collection a worn look of a kind names, or null for Classic and for anything this build does not draw. */
export function wornOf(kind: 'dice' | 'pawns', look: string | undefined)
{
    const collection = look?.startsWith(`${ kind }.`) === true ? look.slice(kind.length + 1) : '';
    return Object.hasOwn(PALETTES, collection) ? collection as Collection : null;
}

/** The colours a collection's effects play in: its edge, its glint and white. */
export function lightOf(collection: Collection)
{
    const { edge, glint } = PALETTES[collection];

    return [edge, glint, '#FFFFFF'];
}

/** Each collection's burst: where its die lands, and where its pawn takes another. */
const BURSTS = { glow: 'stars', shiraz: 'dust', neon: 'sparks', gold: 'burst' } as const satisfies Record<Collection, Preset>;

export function burstOf(collection: Collection)
{
    return { preset: BURSTS[collection], tune: { colors: lightOf(collection) } };
}

import type { ShopCollection } from '../../../../backend/src/domains/shop/catalogue.ts';
import type { Stream, Tune } from '../vfx/presets.ts';

/**
 * The collections a frame is drawn for (`public/frames/<collection>.svg`), named here so a picture
 * can wear one without the shell carrying the catalogue; `avatar-looks.spec.ts` holds the list to it.
 */
export const FRAMES = ['glow', 'shiraz', 'neon', 'gold'] as const satisfies readonly ShopCollection[];

export type Frame = (typeof FRAMES)[number];

/** The collection a worn decoration names, or null for Classic and for anything this build does not draw. */
export function frameOf(deco: string | undefined)
{
    const collection = deco?.startsWith('decoration.') === true ? deco.slice('decoration.'.length) : '';
    return (FRAMES as readonly string[]).includes(collection) ? collection as Frame : null;
}

/** What plays round its owner's picture on their own profile, in the collection's light. */
export const AURAS = {
    glow: { stream: 'aura', tune: { colors: ['#FBE7A6', '#9CC2FF', '#FFFFFF'] } },
    shiraz: { stream: 'aura', tune: { colors: ['#E7BE63', '#B9F0E8', '#FFF4D6'] } },
    neon: { stream: 'arcs', tune: { colors: ['#FF46D2', '#38E8FF'] } },
    gold: { stream: 'aura', tune: { colors: ['#E9C565', '#FFFAE6', '#D9B044'] } }
} as const satisfies Record<Frame, { stream: Stream; tune: Tune }>;

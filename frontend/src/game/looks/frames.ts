import type { ShopCollection } from '../../../../backend/src/domains/shop/catalogue.ts';
import type { Flow, Tune } from '../vfx/engine.ts';

/**
 * The collections a frame is drawn for (`public/frames/<collection>.svg`), named here so a picture
 * can wear one without the shell carrying the catalogue; `avatar-looks.spec.ts` holds the list to it.
 */
export const FRAMES = ['glow', 'shiraz', 'neon', 'gold', 'inferno', 'storm', 'astral', 'void', 'jade', 'frost', 'phoenix', 'oni'] as const satisfies readonly ShopCollection[];

export type Frame = (typeof FRAMES)[number];

/** The collection a worn decoration names, or null for Classic and for anything this build does not draw. */
export function frameOf(deco: string | undefined)
{
    const collection = deco?.startsWith('decoration.') === true ? deco.slice('decoration.'.length) : '';
    return (FRAMES as readonly string[]).includes(collection) ? collection as Frame : null;
}

/** What plays round its owner's picture on their own profile, in the collection's light; a legendary collection's is one of its own streams. */
export const AURAS = {
    glow: { stream: 'aura', tune: { colors: ['#FBE7A6', '#9CC2FF', '#FFFFFF'] } },
    shiraz: { stream: 'aura', tune: { colors: ['#E7BE63', '#B9F0E8', '#FFF4D6'] } },
    neon: { stream: 'arcs', tune: { colors: ['#FF46D2', '#38E8FF'] } },
    gold: { stream: 'aura', tune: { colors: ['#E9C565', '#FFFAE6', '#D9B044'] } },
    inferno: { stream: 'blaze', tune: { colors: ['#FFF1C1', '#FFC14D', '#FF7A1F', '#E2381C'] } },
    storm: { stream: 'static', tune: { colors: ['#EAF6FF', '#7DF0FF', '#3FA9FF', '#8B5CFF'] } },
    astral: { stream: 'orbit', tune: { colors: ['#FFFFFF', '#FFE58A', '#4FE3D8', '#B04BFF'] } },
    void: { stream: 'tendrils', tune: { colors: ['#E9D5FF', '#A855F7', '#5B21B6'] } },
    jade: { stream: 'coil', tune: { colors: ['#F2C14E', '#2BB67F'] } },
    frost: { stream: 'glints', tune: { colors: ['#FFFFFF', '#DFF3FF', '#8FD3FF'] } },
    phoenix: { stream: 'feathers', tune: { colors: ['#FFF6D6', '#FFC94A', '#FF7A1A', '#D7263D'] } },
    oni: { stream: 'pixels', tune: { colors: ['#20E6FF', '#FF2E4D', '#7C5CFF'] } }
} as const satisfies Record<Frame, { stream: Flow; tune: Tune }>;

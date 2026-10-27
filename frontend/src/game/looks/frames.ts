import type { ShopCollection } from '../../../../backend/src/domains/shop/catalogue.ts';

/**
 * The collections a frame is drawn for (`public/frames/<collection>.svg`), named here so a picture
 * can wear one without the shell carrying the catalogue; `avatar-looks.spec.ts` holds the list to it.
 */
export const FRAMES = ['glow', 'shiraz', 'neon', 'gold', 'inferno', 'storm', 'astral', 'void', 'jade', 'frost', 'phoenix', 'oni'] as const satisfies readonly ShopCollection[];

export type Frame = (typeof FRAMES)[number];

/**
 * The collection a worn profile look of a kind names, or null for Classic and for anything this
 * build does not draw: a profile's frames, covers and plates are drawn for the same collections.
 */
export function lookIn(kind: 'decoration' | 'theme' | 'nameplate' | 'effect', look: string | undefined)
{
    const collection = look?.startsWith(`${ kind }.`) === true ? look.slice(kind.length + 1) : '';
    return (FRAMES as readonly string[]).includes(collection) ? collection as Frame : null;
}

/** The collection a worn decoration names, whose frame is drawn round its owner's picture. */
export const frameOf = (deco: string | undefined) => lookIn('decoration', deco);

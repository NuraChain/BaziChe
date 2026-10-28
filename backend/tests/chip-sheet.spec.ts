import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the rule written with exactly this selector at the start of a line. */
const rule = (selector: string) => new RegExp(`\\n *${ escaped(selector) }\\n *\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';

interface Tones
{
    face: string;
    dark: string;
    stripe: string;
    inlay: string;
}

/** The shop draws a chip from the same tones (`tools/art/look-parts.mjs`), so its picture and the table's chip are one look. */
const tones = async () => (await import(new URL('../../tools/art/look-parts.mjs', import.meta.url).href)) as { chipTones: (palette: unknown) => Tones; contrast: (one: string, other: string) => number };

describe('a player’s chips in a look, in the stylesheet', () =>
{
    it('paints a chip in a look on the seat that holds it or on its own flight, and leaves the classic disc as it was', () =>
    {
        const sides = rule(':is([data-chips] .chip-stack, .chip-stack[data-chips])');
        const face = rule(':is([data-chips] .chip-stack, .chip-stack[data-chips])::before');

        expect(sides).toContain('--chip-rim: var(--chips-rim);');
        expect(sides).toContain('--chip-band: var(--chips-band);');
        expect(face).toContain('border-color: var(--chips-stripe);');
        expect(face, 'the inlay is not drawn').toContain('var(--chips-inlay)');
        expect(face, 'the inserts round the edge are not drawn').toContain('repeating-conic-gradient(var(--chips-stripe)');
        expect(face).toContain('var(--chips-face)');
        expect(rule('.chip-stack::before'), 'the classic disc changed').toContain('background: var(--madder);');
        expect(rule('.chip-stack'), 'the classic sides changed').toContain('--chip-rim: color-mix(in srgb, var(--madder) 58%, black);');
    });

    it.each([...SHOP_COLLECTIONS])('paints %s’s chips in the tones of its shop chip', async (collection) =>
    {
        const { chipTones } = await tones();
        const { face, dark, stripe, inlay } = chipTones(PALETTES[collection]);
        const worn = rule(`[data-chips='${ collection }']`);

        expect(worn).toContain(`--chips-face: ${ face };`);
        expect(worn).toContain(`--chips-stripe: ${ stripe };`);
        expect(worn).toContain(`--chips-inlay: ${ inlay };`);
        expect(worn).toContain(`--chips-rim: ${ dark };`);
        expect(worn).toContain(`--chips-band: ${ face };`);
    });

    it.each([...SHOP_COLLECTIONS])('gives %s’s chips inserts that show on their face', async (collection) =>
    {
        const { chipTones, contrast } = await tones();
        const { face, stripe } = chipTones(PALETTES[collection]);

        expect(contrast(stripe, face)).toBeGreaterThanOrEqual(2.5);
    });

    it('names chips for every collection the shop sells and no other, and counts a stack by data-discs alone', () =>
    {
        const named = [...sheet.matchAll(/\[data-chips='([^']+)'\]/g)].map(([, collection]) => collection);

        expect(new Set(named)).toEqual(new Set(SHOP_COLLECTIONS));
        expect(sheet.match(/data-chips='\d'/g), 'a stack is still counted by the look\'s attribute').toBeNull();
        expect([0, 2, 3, 4, 5].map((discs) => sheet.includes(`.chip-stack[data-discs='${ discs }']`))).toEqual([true, true, true, true, true]);
    });
});

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the rule written with exactly this selector at the start of a line. */
const rule = (selector: string) => new RegExp(`\\n *${ escaped(selector) }\\n *\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';

/** Whether the sheet's text at `index` lies inside a block that opens with this header. */
const inside = (header: string, index: number) =>
{
    for (let from = sheet.indexOf(`\n${ header }\n{`); from >= 0; from = sheet.indexOf(`\n${ header }\n{`, from + 1))
    {
        let depth = 0;

        for (let at = sheet.indexOf('{', from); at < sheet.length; at += 1)
        {
            depth += sheet[at] === '{' ? 1 : sheet[at] === '}' ? -1 : 0;

            if (depth === 0)
            {
                if (index > from && index < at)
                {
                    return true;
                }
                break;
            }
        }
    }

    return false;
};

describe('a ludo yard in a look, in the stylesheet', () =>
{
    it('lies under every mark and pawn of the board as the drawing its look names, and takes no press', () =>
    {
        const yard = rule('.lb-yard');

        expect(yard).toContain('z-index: 1;');
        expect(yard).toContain('background: var(--yard) center / 100% 100% no-repeat;');
        expect(yard).toContain('pointer-events: none;');
    });

    it.each([...SHOP_COLLECTIONS])('draws %s’s yard, crossed by its glint', (collection) =>
    {
        const worn = rule(`[data-yard='${ collection }']`);

        expect(worn).toContain(`--yard: url('/yards/${ collection }.svg');`);
        expect(worn).toContain(`--shine: ${ PALETTES[collection].glint };`);
    });

    it('names a yard for every collection the shop sells and no other, and every one is drawn', () =>
    {
        const named = [...sheet.matchAll(/\[data-yard='([^']+)'\]/g)].map(([, collection]) => collection);
        const drawn = readdirSync(new URL('../../frontend/public/yards/', import.meta.url));

        expect(new Set(named)).toEqual(new Set(SHOP_COLLECTIONS));
        expect(drawn.toSorted()).toEqual(SHOP_COLLECTIONS.map((collection) => `${ collection }.svg`).toSorted());
    });

    it('breathes a yard’s glint round its edge only on a board that moves, for somebody who asked for no less motion, by its opacity alone', () =>
    {
        const selector = '.lb:not([data-still]) .lb-yard::after';
        const glow = rule(selector);
        const breath = /@keyframes yard-glint\n\{([\s\S]*?)\n\}/.exec(sheet)?.[1] ?? '';

        expect(glow).toContain('animation: yard-glint');
        expect(glow).toContain('var(--shine)');
        expect(inside('@media (prefers-reduced-motion: no-preference)', sheet.indexOf(`\n    ${ selector }\n`)), 'the glint breathes for somebody who asked for less motion').toBe(true);
        expect([...breath.matchAll(/^ *([a-z-]+):/gm)].map(([, property]) => property), 'the breath moves something the compositor cannot').toEqual(['opacity']);
    });
});

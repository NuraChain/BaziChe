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

const keyframes = (name: string) => /\n\{([\s\S]*?)\n\}/.exec(sheet.slice(sheet.indexOf(`@keyframes ${ name }\n`)))?.[1] ?? '';

const properties = (block: string) => [...block.matchAll(/^ *([a-z-]+):/gm)].map(([, property]) => property);

describe('a player’s felt in a look, in the stylesheet', () =>
{
    it('lays every mat on the cloth alone, under the table’s cards, chips and plates, and takes no press', () =>
    {
        const mats = rule('.felt-mats');

        expect(mats).toContain('z-index: 0;');
        expect(mats).toContain('clip-path: inset(var(--cloth-in) round var(--cloth-round));');
        expect(mats).toContain('pointer-events: none;');
        expect(rule('.felt-mat')).toContain('background: var(--felt) center / 100% 100% no-repeat;');
    });

    it('keeps every mat inside its table, so a mat reaching past the rail never makes the page scroll', () =>
    {
        expect(rule('.felt-mats')).toContain('overflow: clip;');
    });

    it('clips the mats to each table’s own cloth', () =>
    {
        expect(rule('.hokm-table > .felt-mats'), 'Hokm’s cloth begins where its rail’s drawing ends').toContain('--cloth-in: 6.1cqmin;');
        expect(rule('.poker-table > .felt-mats'), 'poker’s cloth begins inside its leather and its wood').toContain('--cloth-in: 10.2cqmin;');
        expect(rule('.poker-table > .felt-mats'), 'poker’s cloth is a stadium').toContain('--cloth-round: 999px;');
    });

    it('lays a poker seat’s mat where its plate is placed', () =>
    {
        const placed = rule('.poker-table .felt-mat');

        expect(placed).toContain('left: calc(var(--x) * 1%);');
        expect(placed).toContain('top: calc(var(--y) * 1%);');
    });

    it.each(['top', 'bottom', 'left', 'right', 'top-left', 'top-right'])('lays a Hokm mat on the %s side', (side) =>
    {
        const named = [...sheet.matchAll(/\n\.hokm-table \.felt-mat(?:\[data-side='([a-z-]+)'\]|:is\(([^)]*)\))\n\{([^}]*)\}/g)]
            .filter(([, one, many]) => one === side || (many ?? '').includes(`'${ side }'`))
            .map(([, , , body]) => body)
            .join('');

        expect(named, 'a side’s mat has no left').toMatch(/\bleft:/);
        expect(named, 'a side’s mat has no top').toMatch(/\btop:/);
    });

    it.each([...SHOP_COLLECTIONS])('draws %s’s felt, lit in its glint', (collection) =>
    {
        const worn = rule(`[data-mat='${ collection }']`);

        expect(worn).toContain(`--felt: url('/felts/${ collection }.svg');`);
        expect(worn).toContain(`--felt-light: ${ PALETTES[collection].glint };`);
    });

    it('names a felt for every collection the shop sells and no other, and every one is drawn', () =>
    {
        const named = [...sheet.matchAll(/\[data-mat='([^']+)'\]/g)].map(([, collection]) => collection);
        const drawn = readdirSync(new URL('../../frontend/public/felts/', import.meta.url));

        expect(new Set(named)).toEqual(new Set(SHOP_COLLECTIONS));
        expect(drawn.toSorted()).toEqual(SHOP_COLLECTIONS.map((collection) => `${ collection }.svg`).toSorted());
    });

    it('lights the ring of the mat whose owner is on turn, round the ring the drawing engraves', () =>
    {
        const light = rule('.felt-mat::after');

        expect(light).toContain('var(--felt-light)');
        expect(light, 'the light is not masked to the engraved ring at 84% of the mat’s radius').toContain('mask: radial-gradient(closest-side, transparent 80.5%, #000000 82% 86%, transparent 87.5%);');
        expect(light).toContain('opacity: 0;');
        expect(rule('.felt-mat[data-turn]::after')).toContain('opacity: 1;');
    });

    it('runs the light round the ring and grows a mat out of its seat only for somebody who asked for no less motion, by transform and opacity alone', () =>
    {
        const running = '.felt-mat[data-turn]::after';
        const growing = '.felt-mat';

        expect(inside('@media (prefers-reduced-motion: no-preference)', sheet.indexOf(`\n    ${ running }\n`)), 'the light runs for somebody who asked for less motion').toBe(true);
        expect(inside('@media (prefers-reduced-motion: no-preference)', sheet.indexOf(`\n    ${ growing }\n    {\n        animation: felt-in`)), 'a mat grows for somebody who asked for less motion').toBe(true);
        expect(properties(keyframes('felt-run'))).toEqual(['rotate']);
        expect(properties(keyframes('felt-in')).toSorted()).toEqual(['opacity', 'scale']);
    });

    it('lights the whole ring still for somebody who asked for less motion', () =>
    {
        const still = sheet.indexOf('\n    .felt-mat::after\n    {\n        background: var(--felt-light);');

        expect(still, 'nothing lights the ring with less motion').toBeGreaterThan(0);
        expect(inside('@media (prefers-reduced-motion: reduce)', still)).toBe(true);
    });
});

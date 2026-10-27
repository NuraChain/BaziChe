import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the rule written with exactly this selector at the start of a line. */
const rule = (selector: string) => new RegExp(`\\n *${ escaped(selector) }\\n *\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';

/** Where each block that opens with this header starts and ends in the sheet. */
const blocks = (header: string) => [...sheet.matchAll(new RegExp(`\\n${ escaped(header) }\\n\\{`, 'g'))].map(({ index: start }) =>
{
    let depth = 0;
    let at = sheet.indexOf('{', start);

    for (; at < sheet.length; at += 1)
    {
        depth += sheet[at] === '{' ? 1 : sheet[at] === '}' ? -1 : 0;

        if (depth === 0)
        {
            break;
        }
    }

    return [start, at] as const;
});

describe('a name on its plate, in the stylesheet', () =>
{
    it('lays the plate behind the name, in the plate’s own ink', () =>
    {
        const plate = rule('[data-plate]');

        expect(plate).toContain('color: var(--plate-ink);');
        expect(plate).toContain('background: var(--plate) center / cover no-repeat;');
    });

    it.each([...SHOP_COLLECTIONS])('draws %s’s plate from its own file, in the ink its palette holds to its surface', (collection) =>
    {
        const own = rule(`[data-plate='${ collection }']`);

        expect(own).toContain(`--plate: url('/plates/${ collection }.svg');`);
        expect(own).toContain(`--plate-ink: ${ PALETTES[collection].ink };`);
        expect(existsSync(new URL(`../../frontend/public/plates/${ collection }.svg`, import.meta.url))).toBe(true);
    });

    it('names no plate the shop does not sell', () =>
    {
        const named = [...sheet.matchAll(/\[data-plate='([^']+)'\]/g)].map(([, collection]) => collection);

        expect(new Set(named)).toEqual(new Set(SHOP_COLLECTIONS));
    });

    it('moves a light across a plate only for somebody who asked for no less motion, and keeps the plate under it', () =>
    {
        const unhurried = blocks('@media (prefers-reduced-motion: no-preference)');
        const sweeps = [...sheet.matchAll(/animation: plate-sweep\b/g)].map(({ index }) => index);
        const swept = unhurried.find(([start, end]) => sheet.slice(start, end).includes('animation: plate-sweep'));

        expect(sweeps.length).toBeGreaterThan(0);
        expect(sweeps.filter((at) => !unhurried.some(([start, end]) => at > start && at < end)), 'the light moves outside the block').toEqual([]);
        expect(sheet.slice(swept![0], swept![1])).toContain(', var(--plate) center / cover no-repeat;');
        expect(rule('@keyframes plate-sweep')).toContain('background-position: 105% 0, center;');
    });
});

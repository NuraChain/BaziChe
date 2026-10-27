import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_TIERS } from '../src/domains/shop/catalogue.ts';

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

const MOVING = '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

const EDGED = [...SHOP_TIERS.filter((tier) => tier !== 'common'), 'bundle'];

describe('a look\'s edge, in the stylesheet', () =>
{
    it.each(EDGED)('marks a %s look on its card and in its sheet', (tier) =>
    {
        expect(sheet).toContain(`.look-card[data-tier='${ tier }'],\n.look-large[data-tier='${ tier }']`);
    });

    it('names no tier the shop does not have', () =>
    {
        const named = [...sheet.matchAll(/\[data-tier='([^']+)'\]/g)].map(([, tier]) => tier);

        expect(new Set(named)).toEqual(new Set(EDGED));
    });

    it('draws a mythic edge as a light laid under the card\'s own fill, which a pointer does not paint over', () =>
    {
        const edge = rule('.look-card[data-tier=\'mythic\'],\n.look-large[data-tier=\'mythic\']');

        expect(edge).toContain('border-color: transparent;');
        expect(edge).toContain('linear-gradient(var(--field), var(--field)) padding-box');
        expect(edge).toMatch(/conic-gradient\(from var\(--mythic-turn\),[^)]*\) border-box/);
        expect(rule('.look-card[data-tier=\'mythic\']:hover,\n.look-card[data-tier=\'mythic\']:focus-visible')).toContain('border-color: transparent;');
    });

    it('turns the light through a whole circle, which the browser can only do with an angle it was told is one', () =>
    {
        expect(rule('@property --mythic-turn')).toContain('syntax: \'<angle>\';');
        expect(rule('@property --mythic-turn')).toContain('inherits: false;');
        expect(rule('@keyframes mythic-turn')).toContain('--mythic-turn: 360deg;');
    });

    it('turns it only under a fine pointer that hovers, for somebody who asked for no less motion', () =>
    {
        const moving = blocks(MOVING);
        const turns = [...sheet.matchAll(/animation: mythic-turn\b/g)].map(({ index }) => index);

        expect(turns.length).toBeGreaterThan(0);
        expect(turns.filter((at) => !moving.some(([start, end]) => at > start && at < end)), 'the edge turns outside the block').toEqual([]);
        expect(moving.some(([start, end]) => sheet.slice(start, end).includes('.look-card[data-tier=\'mythic\']:hover'))).toBe(true);
    });

    it('slides a mythic badge\'s light a whole tile along, with no seam, only for somebody who asked for no less motion', () =>
    {
        const unhurried = blocks('@media (prefers-reduced-motion: no-preference)');
        const shines = [...sheet.matchAll(/animation: mythic-shine\b/g)].map(({ index }) => index);
        const badge = rule('.tier-mythic');
        const stops = [...badge.matchAll(/#[0-9A-F]{6}/gi)].map(([stop]) => stop);

        expect(shines.length).toBeGreaterThan(0);
        expect(shines.filter((at) => !unhurried.some(([start, end]) => at > start && at < end)), 'the badge shines outside the block').toEqual([]);
        expect(badge).toContain('0 0 / 200% 100%');
        expect(stops.at(0)).toBe(stops.at(-1));
        expect(rule('@keyframes mythic-shine')).toContain('background-position: 200% 0;');
    });
});

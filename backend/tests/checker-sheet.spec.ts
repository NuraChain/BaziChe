import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const tokens = readFileSync(new URL('../../frontend/src/styles/tokens.css', import.meta.url), 'utf8');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the rule written with exactly this selector at the start of a line. */
const rule = (selector: string) => new RegExp(`\\n *${ escaped(selector) }\\n *\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';

const token = (name: string) => new RegExp(`--nard-${ name }: (#\\w{6});`).exec(tokens)![1]!;

const luminance = (hex: string) =>
{
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const contrast = (one: string, other: string) =>
{
    const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
};

const TONES = ['light', 'dark'] as const;

describe('backgammon checkers in a look, in the stylesheet', () =>
{
    it('draws a checker in a look as the drawing its look names, with none of the board’s own rim and groove over it', () =>
    {
        const worn = rule('.man[data-checkers]:not([data-off])');

        expect(worn).toContain('border: 0;');
        expect(worn).toContain('background: var(--checker) center / 100% 100% no-repeat;');
        expect(rule('.man[data-checkers]:not([data-off])::after')).toContain('display: none;');
    });

    it.each(SHOP_COLLECTIONS.flatMap((collection) => TONES.map((tone) => [collection, tone] as const)))('names %s’s %s checker, and paints one borne off as a slab of its material ringed in its colour', (collection, tone) =>
    {
        const worn = rule(`[data-checkers='${ collection }'][data-tone='${ tone }']`);
        const palette = PALETTES[collection];
        const [hi, fill, lo] = tone === 'light' ? palette.pale : palette.deep;

        expect(worn).toContain(`--checker: url('/checkers/${ collection }-${ tone }.svg');`);
        expect(worn).toContain(`--hi: ${ hi };`);
        expect(worn).toContain(`--fill: ${ fill };`);
        expect(worn).toContain(`--lo: ${ lo };`);
        expect(worn).toContain(`--rim: ${ tone === 'light' ? palette.deep[1] : palette.edge };`);
    });

    it('names a checker of every collection the shop sells on each side and no other, and every one is drawn', () =>
    {
        const named = [...sheet.matchAll(/\[data-checkers='([^']+)'\]\[data-tone='([^']+)'\]/g)].map(([, collection, tone]) => `${ collection }-${ tone }`);
        const drawn = readdirSync(new URL('../../frontend/public/checkers/', import.meta.url));

        expect(named.toSorted()).toEqual(SHOP_COLLECTIONS.flatMap((collection) => TONES.map((tone) => `${ collection }-${ tone }`)).toSorted());
        expect(drawn.toSorted()).toEqual(named.map((name) => `${ name }.svg`).toSorted());
    });

    it('keeps the middle of a counted checker and of one that takes a move back plain, so the number and the arrow never lie on its emblem', () =>
    {
        const plain = 'radial-gradient(circle closest-side, var(--fill) 0 46%, transparent 48%)';

        expect(rule('.bgt-count[data-checkers]')).toContain(`background: ${ plain };`);
        expect(rule('.man[data-checkers][data-back]')).toContain(`background: ${ plain }, var(--checker) center / 100% 100% no-repeat;`);
    });

    it('writes that number and arrow in the board’s own inks, which read at 4.5:1 or more on every look’s plain middle', () =>
    {
        expect(rule('.bgt-count[data-tone=\'light\']')).toContain('color: var(--nard-dark);');
        expect(rule('.bgt-count[data-tone=\'dark\']')).toContain('color: var(--nard-light);');
        expect(rule('.man[data-tone=\'light\'][data-back]')).toContain('--ink: var(--nard-dark);');
        expect(rule('.man[data-tone=\'dark\'][data-back]')).toContain('--ink: var(--nard-light);');

        for (const collection of SHOP_COLLECTIONS)
        {
            expect(contrast(token('dark'), PALETTES[collection].pale[1]), `${ collection } light`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(token('light'), PALETTES[collection].deep[1]), `${ collection } dark`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('marks a player’s rail with their checker in its look', () =>
    {
        const marker = rule('.bg-checker[data-checkers]');

        expect(marker).toContain('background: var(--checker) center / 100% 100% no-repeat;');
        expect(marker).toContain('outline: 0;');
    });
});

describe('a backgammon home board in a look, in the stylesheet', () =>
{
    it('lies under every checker of the board as the drawing its look names, and takes no press', () =>
    {
        const home = rule('.bgt-home');

        expect(home).toContain('position: absolute;');
        expect(home).toContain('z-index: var(--layer-inlay);');
        expect(home).toContain('background: var(--home) center / 100% 100% no-repeat;');
        expect(home).toContain('pointer-events: none;');
    });

    it('turns the other player’s round, as their home faces them across the board', () =>
    {
        expect(rule('.bgt-home[data-side=\'far\']')).toContain('rotate: 180deg;');
    });

    it.each([...SHOP_COLLECTIONS])('draws %s’s home board', (collection) =>
    {
        expect(rule(`.bgt-home[data-home='${ collection }']`)).toContain(`--home: url('/homes/${ collection }.svg');`);
    });

    it('names a home board for every collection the shop sells and no other, and every one is drawn', () =>
    {
        const named = [...sheet.matchAll(/\.bgt-home\[data-home='([^']+)'\]/g)].map(([, collection]) => collection);
        const drawn = readdirSync(new URL('../../frontend/public/homes/', import.meta.url));

        expect(named.toSorted()).toEqual([...SHOP_COLLECTIONS].toSorted());
        expect(drawn.toSorted()).toEqual(named.map((collection) => `${ collection }.svg`).toSorted());
    });
});

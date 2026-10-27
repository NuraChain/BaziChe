import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

describe('a set’s sigil, in the stylesheet', () =>
{
    it('stands off the frame by a shadow of its own', () =>
    {
        expect(rule('[data-set-sigil]')).toContain('filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.55));');
    });

    it('is struck only for somebody who asked for no less motion, at the moment its reveal sets', () =>
    {
        const unhurried = blocks('@media (prefers-reduced-motion: no-preference)');
        const strikes = [...sheet.matchAll(/animation: sigil-struck\b/g)].map(({ index }) => index);

        expect(strikes).toHaveLength(1);
        expect(strikes.filter((at) => !unhurried.some(([start, end]) => at > start && at < end)), 'struck outside the block').toEqual([]);
        expect(rule('[data-set-sigil][data-struck]')).toContain('var(--struck, 0ms)');
    });

    it('glows, as it is struck, in the light its reveal hands it, and keeps its shadow under the glow', () =>
    {
        const [[start, end]] = blocks('@keyframes sigil-struck');
        const struck = sheet.slice(start, end);

        expect(struck).toContain('drop-shadow(0 0 10px var(--sigil-glow, #FFFFFF))');
        expect(struck).toContain('filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.55)) drop-shadow(');
    });
});

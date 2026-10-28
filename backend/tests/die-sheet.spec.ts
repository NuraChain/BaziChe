import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DIE_PROPERTIES, dieDress } from '../../frontend/src/game/looks/dice.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the rule written with exactly this selector at the start of a line. */
const rule = (selector: string) => new RegExp(`\\n *${ escaped(selector) }\\n *\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';

/** The rules that draw a ludo die as it lies or flies; a spent one keeps its own greys whatever it wears. */
const drawn = sheet.split('\n}').filter((rule) => /\n\.die3d\[data-flat\] [^\n{]+\n\{/.test(rule)).join('\n}');

/** The rules that draw a backgammon die: a cube whose six faces are all drawn, and their pips. */
const cube = [rule('.die3d-face'), rule('.die3d-pip')].join('\n');

/** What the backgammon die reads of a die's dress; the base and its shade belong to the ludo die, which lies flat. */
const CUBE_PROPERTIES = DIE_PROPERTIES.filter((name) => name !== '--die-dark' && name !== '--die-shade');

const channel = (value: number) =>
{
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
};

/** A colour's luminance once a face's brightness filter has scaled its channels. */
const luminance = (hex: string, brightness: number) =>
{
    const [r, g, b] = [1, 3, 5].map((at) => channel(Number.parseInt(hex.slice(at, at + 2), 16) * brightness));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const contrast = (one: string, other: string, brightness: number) =>
{
    const [light, dark] = [luminance(one, brightness), luminance(other, brightness)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
};

describe('a die in a look, in the stylesheet', () =>
{
    it.each([...DIE_PROPERTIES])('reads %s where it draws a ludo die, with the classic die’s colour where none is set', (name) =>
    {
        expect(drawn).toMatch(new RegExp(`var\\(${ name }, [^)]+\\)`));
    });

    it.each(Object.keys(PALETTES) as (keyof typeof PALETTES)[])('dresses a %s die in every one of them', (collection) =>
    {
        expect(Object.keys(dieDress(collection)).sort()).toEqual([...DIE_PROPERTIES].sort());
    });

    it.each(CUBE_PROPERTIES)('reads %s where it draws a backgammon die', (name) =>
    {
        expect(cube).toMatch(new RegExp(`var\\(${ name }, [^)]+\\)`));
    });

    it('draws a backgammon die in no look exactly as the board’s own die was drawn', () =>
    {
        for (const kept of ['var(--die-lit, #fffdf4)', 'var(--die-mid, #f4ecd8) 58%', 'var(--die-side, #e2d6b6)', 'var(--die-ink, rgb(60 40 20 / 0.3))', 'var(--die-shine, rgb(255 255 255 / 0))', 'var(--die-pip-lit, #4a3321)', 'var(--die-pip, #1f140b)', 'var(--die-glow, inset 0 0.012em 0.025em rgb(0 0 0 / 0.5))'])
        {
            expect(cube).toContain(kept);
        }
    });

    it.each(Object.keys(PALETTES) as (keyof typeof PALETTES)[])('dots a %s backgammon die at 4.5:1 or more on every stop of every face, the most shaded included', (collection) =>
    {
        const shades = [...sheet.matchAll(/\n\.die3d-face\[data-n='\d'\](?:,\n\.die3d-face\[data-n='\d'\])*\n\{\n\s*filter: brightness\(([\d.]+)\);/g)].map(([, brightness]) => Number(brightness));
        const { face, pip } = PALETTES[collection].die;

        expect(shades.length).toBeGreaterThan(0);

        for (const brightness of [1, ...shades])
        {
            for (const stop of face)
            {
                expect(contrast(pip, stop, brightness), `${ pip } on ${ stop } at ${ brightness }`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });
});

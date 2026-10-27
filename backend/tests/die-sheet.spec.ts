import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DIE_PROPERTIES, dieDress } from '../../frontend/src/game/looks/dice.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The rules that draw a ludo die as it lies or flies; a spent one keeps its own greys whatever it wears. */
const drawn = sheet.split('\n}').filter((rule) => /\n\.die3d\[data-flat\] [^\n{]+\n\{/.test(rule)).join('\n}');

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
});

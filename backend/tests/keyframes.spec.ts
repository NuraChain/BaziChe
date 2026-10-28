import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SHEETS = ['app.css', 'base.css', 'tokens.css'];

const names = SHEETS.flatMap((sheet) => [...readFileSync(new URL(`../../frontend/src/styles/${ sheet }`, import.meta.url), 'utf8').matchAll(/@keyframes ([\w-]+)/g)].map(([, name]) => `${ name }`));

describe('the stylesheets\' animations', () =>
{
    it('name every set of keyframes once, because a second of one name replaces the first wherever it is used', () =>
    {
        const twice = names.filter((name, index) => names.indexOf(name) !== index);

        expect(names.length).toBeGreaterThan(0);
        expect(twice).toEqual([]);
    });
});

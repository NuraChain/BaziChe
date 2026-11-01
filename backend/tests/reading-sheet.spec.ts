import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BASE = readFileSync(new URL('../../frontend/src/styles/base.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('a placeholder that says it is loading', () =>
{
    it('takes the words of every skeleton inside a group that says them, and never the group\'s own', () =>
    {
        const quiet = [...BASE.matchAll(/([^{}]*)\{\s*display: none;\s*\}/g)]
            .map((rule) => rule[1].trim())
            .filter((selector) => selector.includes('data-reading') || selector.includes('data-skeleton'));

        expect(quiet).toEqual(['[data-reading] [data-skeleton] > .sr-only']);
    });
});

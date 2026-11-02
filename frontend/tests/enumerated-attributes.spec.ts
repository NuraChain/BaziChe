import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob('../src/**/*.azeroth', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('an attribute whose words are true and false', () =>
{
    // AzerothJS removes an attribute given false and empties one given true (framework register, 49), so
    // `draggable={ false }` left the viewer's photo draggable, and Chrome's own drag cancelled every pan.
    it('is written as its word, never as an expression', () =>
    {
        const given = Object.entries(SOURCES).flatMap(([path, text]) =>
            [...text.matchAll(/\b(draggable|spellcheck|contenteditable)=\{/g)].map((found) => `${ path.replace('../src/', '') } ${ found[1] }`));

        expect(given).toEqual([]);
    });
});

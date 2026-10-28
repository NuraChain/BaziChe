import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { dressOf } from '../../frontend/src/game/looks/chess.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the rule written with exactly this selector at the start of a line. */
const rule = (selector: string) => new RegExp(`\\n *${ escaped(selector) }\\n *\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';

const PIECES = ['wk', 'bk', 'wq', 'bq', 'wr', 'br', 'wb', 'bb', 'wn', 'bn', 'wp', 'bp'];

describe('chess pieces in a set, in the stylesheet', () =>
{
    it.each(PIECES)('draws %s from its side\'s set wherever the board draws it, and the board\'s own where the side wears none', (piece) =>
    {
        expect(rule(`:is(.cp, .chess-promote-piece, .chess-taken > i, .chess-figure)[data-piece='${ piece }']`)).toContain(`background-image: var(--piece-${ piece }, url('/board/chess/${ piece }.svg'));`);
    });

    it('marks the side a player has on their rail with that side\'s king, in its set', () =>
    {
        expect(rule('.chess-side[data-side=\'w\']')).toContain('background-image: var(--piece-wk, url(\'/board/chess/wk.svg\'));');
        expect(rule('.chess-side[data-side=\'b\']')).toContain('background-image: var(--piece-bk, url(\'/board/chess/bk.svg\'));');
    });

    it('reads no piece from a set anywhere else', () =>
    {
        expect([...sheet.matchAll(/var\(--piece-([a-z]+)/g)].map(([, piece]) => piece).toSorted()).toEqual([...PIECES, 'wk', 'bk'].toSorted());
    });

    it.each(SHOP_COLLECTIONS)('names, for %s on either side, a drawing the build ships for every piece the sheet reads', (collection) =>
    {
        const named = dressOf({ w: collection, b: collection }).split('; ').map((one) => /^--piece-([wb][kqrbnp]): url\('([^']+)'\)$/.exec(one));

        expect(named.map((match) => match?.[1]).toSorted()).toEqual(PIECES.toSorted());

        for (const match of named)
        {
            expect(match?.[2]).toBe(`/pieces/${ collection }-${ match?.[1] }.svg`);
            expect(existsSync(new URL(`../../frontend/public${ match?.[2] }`, import.meta.url))).toBe(true);
        }
    });
});

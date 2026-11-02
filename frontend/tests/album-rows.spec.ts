import { describe, expect, it } from 'vitest';

import { albumRows, rowSizes } from '../src/components/chat/album-rows.ts';
import type { Message } from '../src/data/chat.ts';

/** How an album's photos and videos stand in its grid: rows of up to three, each at its own shape. */

let made = 0;

const item = (w?: number, h?: number): Message =>
{
    made += 1;

    return {
        id: `p${ made }`,
        conversationId: 'c',
        from: 'omid',
        kind: 'file',
        text: '',
        at: made,
        ref: null,
        file: { id: `f${ made }`, key: 'k', iv: 'i', as: 'photo', mime: 'image/jpeg', name: 'a.jpg', bytes: 10, ...(w === undefined || h === undefined ? {} : { w, h }) }
    };
};

describe('an album laid out', () =>
{
    it('stands three to a row, the first row holding what is left over, four two and two, three one over two', () =>
    {
        expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(rowSizes)).toEqual([[1], [2], [1, 2], [2, 2], [2, 3], [3, 3], [1, 3, 3], [2, 3, 3], [3, 3, 3], [1, 3, 3, 3]]);
        expect(rowSizes(0), 'nothing to lay out').toEqual([]);
    });

    it('places every item once, in order, keying each row by its first', () =>
    {
        const items = Array.from({ length: 7 }, () => item(1600, 1200));
        const rows = albumRows(items);

        expect(rows.flatMap((row) => row.tiles.map((tile) => tile.message.id))).toEqual(items.map((one) => one.id));
        expect(rows.map((row) => row.key)).toEqual([items[0].id, items[1].id, items[4].id]);
    });

    it('keeps each item at its own shape inside its row, held between a tall one and a panorama', () =>
    {
        const rows = albumRows([item(1600, 1200), item(1200, 1600), item(4000, 1000)]);

        expect(rows.map((row) => row.tiles.map((tile) => tile.shape))).toEqual([[1600 / 1200], [0.75, 1.6]]);
        expect(rows.map((row) => row.shape), 'each row as wide as its shapes together').toEqual([1600 / 1200, 0.75 + 1.6]);
    });

    it('holds a row of one tall photo short enough for a phone, and a row of panoramas tall enough to see', () =>
    {
        const tall = albumRows([item(900, 1600), item(1600, 1200), item(1600, 1200)]);
        const wide = albumRows([item(4000, 1000), item(4000, 1000), item(4000, 1000), item(4000, 1000), item(4000, 1000), item(4000, 1000)]);

        expect(tall[0].shape, 'never taller than wide past its bound').toBe(1.2);
        expect(wide.map((row) => row.shape), 'never a strip').toEqual([3.6, 3.6]);
    });

    it('takes an item that says nothing of its size as square', () =>
    {
        expect(albumRows([item(), item()])[0].tiles.map((tile) => tile.shape)).toEqual([1, 1]);
    });
});

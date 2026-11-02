import { describe, expect, it } from 'vitest';

import { boxAt, moved } from '../src/lib/reorder.ts';

describe('a list put in another order', () =>
{
    it('takes what was moved to the place it was moved to, the rest keeping their order', () =>
    {
        expect(moved([ 'a', 'b', 'c', 'd' ], 0, 2)).toEqual([ 'b', 'c', 'a', 'd' ]);
        expect(moved([ 'a', 'b', 'c', 'd' ], 3, 0)).toEqual([ 'd', 'a', 'b', 'c' ]);
        expect(moved([ 'a', 'b', 'c' ], 1, 1)).toEqual([ 'a', 'b', 'c' ]);
    });

    it('stops at either end, and moves nothing it does not hold', () =>
    {
        expect(moved([ 'a', 'b', 'c' ], 0, 9)).toEqual([ 'b', 'c', 'a' ]);
        expect(moved([ 'a', 'b', 'c' ], 2, -4)).toEqual([ 'c', 'a', 'b' ]);
        expect(moved([ 'a', 'b', 'c' ], 2, -1), 'never a place counted from the end').toEqual([ 'c', 'a', 'b' ]);
        expect(moved([ 'a', 'b' ], 5, 0)).toEqual([ 'a', 'b' ]);
    });

    it('finds the box under a point, edges included', () =>
    {
        const boxes = [ new DOMRect(0, 0, 96, 96), new DOMRect(100, 0, 96, 96) ];

        expect(boxAt(boxes, 50, 50)).toBe(0);
        expect(boxAt(boxes, 196, 96)).toBe(1);
        expect(boxAt(boxes, 98, 50), 'the gap between').toBe(-1);
    });
});

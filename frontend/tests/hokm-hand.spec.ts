import { describe, expect, it } from 'vitest';
import { handRows } from '../src/game/hokm-hand.ts';

const full = Array.from({ length: 17 }, (_, n) => n);

describe('Hokm hand layout', () =>
{
    it('exposes the whole hand on small touch screens in deal order', () =>
    {
        const rows = handRows(full, 294, 590, true);
        expect(rows.map((row) => row.length)).toEqual([6, 6, 5]);
        expect(rows.flat()).toEqual(full);
    });

    it('uses a single row when all thirteen touch targets fit', () =>
    {
        expect(handRows(full.slice(0, 13), 660, 300, true)).toHaveLength(1);
    });

    it('retains the desktop fan and handles an empty hand', () =>
    {
        expect(handRows(full.slice(0, 13), 304, 550, false)).toHaveLength(1);
        expect(handRows([], 304, 550, true)).toEqual([]);
    });
});

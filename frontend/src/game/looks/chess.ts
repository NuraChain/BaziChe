import type { Colour } from '../../../../backend/src/domains/match/chess/board.ts';
import type { Collection } from './table.ts';

/** The collection each colour's pieces are drawn in at a chess table, or nothing for Classic. */
export type Sets = Record<Colour, Collection | null>;

const KINDS = ['k', 'q', 'r', 'b', 'n', 'p'] as const;

/**
 * Where each side's pieces are drawn from, as custom properties on the board's root: a piece of a
 * side in a set reads its drawing there wherever the board draws it, on a square, in a tray and in
 * the promotion chooser, and a side in Classic sets none, so its pieces are the board's own.
 */
export function dressOf(sets: Sets)
{
    return (['w', 'b'] as const).flatMap((colour) =>
    {
        const set = sets[colour];

        return set === null ? [] : KINDS.map((kind) => `--piece-${ colour }${ kind }: url('/pieces/${ set }-${ colour }${ kind }.svg')`);
    }).join('; ');
}

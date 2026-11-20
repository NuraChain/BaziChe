import { describe, expect, it } from 'vitest';

import {
    COLOURS,
    ENTRY,
    FINISHED,
    HOME_CELLS,
    HOME_RUN,
    RING,
    RING_CELLS,
    RING_STEPS,
    SAFE,
    YARD,
    cellAt,
    coloursFor,
    obstacle,
    ringIndex,
    type Cell,
    type LudoColour,
    type Walker
} from '../src/domains/match/ludo/board.ts';

/** Cell coordinates from the live board SVG in `frontend/public/board/ludo-board.svg`. */

const STARTS: Record<LudoColour, readonly [number, number]> = {
    red: [1, 6],
    green: [8, 1],
    yellow: [13, 8],
    blue: [6, 13]
};

const FILLED_STARS: readonly (readonly [number, number])[] = [
    [6, 2], [12, 6], [8, 12], [2, 8]
];

const HOMES: Record<LudoColour, readonly (readonly [number, number])[]> = {
    red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    yellow: [[9, 7], [10, 7], [11, 7], [12, 7], [13, 7]],
    blue: [[7, 9], [7, 10], [7, 11], [7, 12], [7, 13]]
};

const key = (cell: Cell) => `${ cell.col },${ cell.row }`;

const pair = ([col, row]: readonly [number, number]) => `${ col },${ row }`;

const adjacent = (a: Cell, b: Cell) =>
    Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;

describe('the ring', () =>
{
    it('is the fifty-two squares the art paints as track', () =>
    {
        const painted = new Set<string>();

        for (let col = 6; col <= 8; col += 1)
        {
            for (const row of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14])
            {
                painted.add(`${ col },${ row }`);
            }
        }

        for (let row = 6; row <= 8; row += 1)
        {
            for (const col of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14])
            {
                painted.add(`${ col },${ row }`);
            }
        }

        expect(painted.size).toBe(72);

        for (const colour of COLOURS)
        {
            for (const cell of HOMES[colour])
            {
                painted.delete(pair(cell));
            }
        }

        expect(painted.size).toBe(RING);
        expect(new Set(RING_CELLS.map(key))).toEqual(painted);
    });

    it('never touches the three-by-three centre', () =>
    {
        for (const cell of RING_CELLS)
        {
            expect(cell.col >= 6 && cell.col <= 8 && cell.row >= 6 && cell.row <= 8).toBe(false);
        }
    });

    it('visits every square exactly once', () =>
    {
        expect(new Set(RING_CELLS.map(key)).size).toBe(RING);
    });

    it('steps one square at a time, and turns the four inner corners', () =>
    {
        let corners = 0;

        for (let index = 0; index < RING; index += 1)
        {
            const here = RING_CELLS[index];
            const next = RING_CELLS[(index + 1) % RING];
            const reach = Math.max(Math.abs(here.col - next.col), Math.abs(here.row - next.row));

            expect(reach, `${ key(here) } -> ${ key(next) }`).toBe(1);

            if (!adjacent(here, next))
            {
                corners += 1;
            }
        }

        expect(corners).toBe(4);
    });
});

describe('where a colour joins it', () =>
{
    it('enters on the square the art stars, not the one the model parks a token on', () =>
    {
        for (const colour of COLOURS)
        {
            expect(key(RING_CELLS[ENTRY[colour]]), colour).toBe(pair(STARTS[colour]));
        }
    });

    it('spaces the four entries evenly, as a four-fold board demands', () =>
    {
        expect(COLOURS.map((colour) => ENTRY[colour])).toEqual([0, 13, 26, 39]);
    });

    it('counts every colour from its own entry', () =>
    {
        expect(ringIndex('yellow', 0)).toBe(ENTRY.yellow);
        expect(ringIndex('yellow', RING - 1)).toBe(ENTRY.yellow - 1);
        expect(ringIndex('blue', 13)).toBe(ENTRY.red);
    });
});

describe('the safe squares', () =>
{
    it('are the four the art marks with a filled star', () =>
    {
        expect(new Set(SAFE.map((index) => key(RING_CELLS[index])))).toEqual(new Set(FILLED_STARS.map(pair)));
    });

    it('exclude every entry marked with a hollow star', () =>
    {
        for (const colour of COLOURS)
        {
            expect(SAFE, colour).not.toContain(ENTRY[colour]);
        }
    });
});

describe('the home column', () =>
{
    it('is the five squares the art paints in each colour', () =>
    {
        for (const colour of COLOURS)
        {
            expect(new Set(HOME_CELLS[colour].map(key)), colour).toEqual(new Set(HOMES[colour].map(pair)));
        }
    });

    it('runs inward, so the first home square is the one the ring leads to', () =>
    {
        for (const colour of COLOURS)
        {
            const last = cellAt(colour, RING_STEPS - 1);
            const first = HOME_CELLS[colour][0];

            expect(last, colour).not.toBeNull();
            expect(adjacent(last!, first), colour).toBe(true);
        }
    });

    it('takes fifty-six steps to finish, and no more', () =>
    {
        expect(FINISHED).toBe(RING_STEPS + HOME_RUN);
        expect(cellAt('red', FINISHED - 1)).not.toBeNull();
        expect(cellAt('red', FINISHED)).toBeNull();
    });

    it('belongs to one colour, so no two colours share a home square', () =>
    {
        const seen = new Set<string>();

        for (const colour of COLOURS)
        {
            for (const cell of HOME_CELLS[colour])
            {
                expect(seen.has(key(cell)), `${ colour } ${ key(cell) }`).toBe(false);
                seen.add(key(cell));
            }
        }
    });
});

describe('who plays', () =>
{
    it('seats two players opposite each other rather than side by side', () =>
    {
        const [first, second] = coloursFor(2);
        const apart = Math.abs(ENTRY[first] - ENTRY[second]);

        expect(apart).toBe(RING / 2);
    });

    it('takes three and four in ring order', () =>
    {
        expect(coloursFor(3)).toEqual(['red', 'green', 'yellow']);
        expect(coloursFor(4)).toEqual(['red', 'green', 'yellow', 'blue']);
    });
});

describe('what stops a move', () =>
{
    const EMPTY = [YARD, YARD, YARD, YARD];

    const PAIRED = [0, 1, 0, 1];

    const ALONE = [0, 1, 2, 3];

    const SHARED = 30;

    const on = (colour: LudoColour, square: number) => (square - ENTRY[colour] + RING) % RING;

    const walkers = (rows: readonly (readonly number[])[], sides: readonly number[]): Walker[] =>
        rows.map((pieces, index) => ({ colour: coloursFor(rows.length)[index], pieces, side: sides[index] }));

    it('requires an empty square or a capturable opponent', () =>
    {
        const yellow = on('yellow', SHARED);
        const red = [SHARED - 3, YARD, YARD, YARD];
        const rival = [yellow, YARD, YARD, YARD];

        expect(obstacle(walkers([red, EMPTY, rival, EMPTY], ALONE), 0, 0, SHARED)).toBeNull();
        expect(obstacle(walkers([red, EMPTY, rival, EMPTY], PAIRED), 0, 0, SHARED)).toBe('occupied');
        expect(obstacle(walkers([[red[0], SHARED, YARD, YARD], EMPTY, EMPTY, EMPTY], ALONE), 0, 0, SHARED)).toBe('occupied');
    });

    it('blocks a protected destination while allowing a token to pass over it', () =>
    {
        const star = SAFE[1];
        const board = walkers([[star - 2, YARD, YARD, YARD], [on('yellow', star), YARD, YARD, YARD]], ALONE);

        expect(obstacle(board, 0, 0, star)).toBe('safe');
        expect(obstacle(board, 0, 0, star + 1)).toBeNull();
    });

    it('allows entry onto an empty start or one occupied by a single opponent', () =>
    {
        const there = on('yellow', ENTRY.red);

        expect(obstacle(walkers([[0, YARD, YARD, YARD], EMPTY, EMPTY, EMPTY], PAIRED), 0, 1, 0)).toBe('start');
        expect(obstacle(walkers([EMPTY, EMPTY, [there, YARD, YARD, YARD], EMPTY], PAIRED), 0, 0, 0)).toBe('occupied');
        expect(obstacle(walkers([EMPTY, EMPTY, [there, YARD, YARD, YARD], EMPTY], ALONE), 0, 0, 0)).toBeNull();
        expect(obstacle(walkers([EMPTY, EMPTY, EMPTY, EMPTY], ALONE), 0, 0, 0)).toBeNull();
    });

    it('allows passing a pre-existing stack but refuses to land on it', () =>
    {
        const yellow = on('yellow', SHARED);
        const board = walkers([[SHARED - 2, YARD, YARD, YARD], [yellow, yellow, YARD, YARD]], ALONE);

        expect(obstacle(board, 0, 0, SHARED)).toBe('occupied');
        expect(obstacle(board, 0, 0, SHARED + 1)).toBeNull();
    });
});

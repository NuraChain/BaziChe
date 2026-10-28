import { describe, expect, it } from 'vitest';

import type { Engine } from '../src/domains/match/engine.ts';
import { ENGINES } from '../src/domains/match/service.ts';
import type { Variant } from '../src/domains/match/sides.ts';
import { BEHIND_MOST_MS, choicesOf, outcomeOf, verdictOf, type Ended } from '../src/domains/market/outcomes.ts';

const engineOf = (game: string) => ENGINES.find((one) => one.id === game) as Engine;

const marketOf = (game: string, seats: number, variant: Variant = 'standard') =>
{
    const engine = engineOf(game);

    return choicesOf(seats, (seat) => engine.sideOf(seat, { seats, variant }), engine.drawable === true);
};

describe('what a market on a game asks', () =>
{
    it('is one outcome a seat where every seat plays for itself, and nothing more at a game that cannot end level', () =>
    {
        expect(marketOf('ludo', 2)).toEqual([{ kind: 'seat', seat: 0 }, { kind: 'seat', seat: 1 }]);
        expect(marketOf('backgammon', 2)).toEqual([{ kind: 'seat', seat: 0 }, { kind: 'seat', seat: 1 }]);
        expect(marketOf('hokm', 3)).toEqual([0, 1, 2].map((seat) => ({ kind: 'seat', seat })));
        expect(marketOf('poker', 9)).toHaveLength(9);
    });

    it('is one outcome a side where seats play together, the sides the game itself scores', () =>
    {
        expect(marketOf('ludo', 4, 'teams')).toEqual([{ kind: 'side', seats: [0, 2] }, { kind: 'side', seats: [1, 3] }]);
        expect(marketOf('hokm', 4, 'teams')).toEqual([{ kind: 'side', seats: [0, 2] }, { kind: 'side', seats: [1, 3] }]);
    });

    it('offers a draw, last, at a game that can end level, and only there', () =>
    {
        expect(marketOf('chess', 2)).toEqual([{ kind: 'seat', seat: 0 }, { kind: 'seat', seat: 1 }, { kind: 'draw' }]);

        for (const engine of ENGINES.filter((one) => one.id !== 'chess'))
        {
            expect(engine.drawable, engine.id).toBeUndefined();
        }
    });
});

describe('the outcome that happened', () =>
{
    const seats = marketOf('ludo', 3);
    const sides = marketOf('ludo', 4, 'teams');
    const chess = marketOf('chess', 2);

    it('is the seat the game named, or the side whose seats it named, in any order', () =>
    {
        expect(outcomeOf(seats, [1], false)).toBe(1);
        expect(outcomeOf(sides, [3, 1], false)).toBe(1);
        expect(outcomeOf(sides, [0, 2], false)).toBe(0);
    });

    it('is the draw for a game that ended level with nobody named, where the market offers one', () =>
    {
        expect(outcomeOf(chess, [], true)).toBe(2);
    });

    it('is nothing, which calls the market off, for anything that is not one outcome', () =>
    {
        expect(outcomeOf(seats, [], true), 'a draw the market does not offer').toBeNull();
        expect(outcomeOf(chess, [], false), 'nobody named and no draw').toBeNull();
        expect(outcomeOf(seats, [0, 2], false), 'two seats that are no one outcome').toBeNull();
        expect(outcomeOf(sides, [0], false), 'half of a side').toBeNull();
        expect(outcomeOf(seats, [7], false), 'a seat the market does not have').toBeNull();
    });
});

describe('whether a market is settled from its game', () =>
{
    const choices = marketOf('ludo', 2);
    const CLOSE = 100_000;
    const won = (finishedAt: number, more: Partial<Ended> = {}): Ended => ({ finishedAt, voided: false, winners: [1], drawn: false, ...more });

    it('settles on the outcome when the game ended after the market closed, by both clocks', () =>
    {
        expect(verdictOf(choices, CLOSE, won(160_000), 200_000, 200_000)).toBe(1);
        expect(verdictOf(choices, CLOSE, won(CLOSE), 200_000, 200_000), 'the chain takes no position from the close itself').toBe(1);
    });

    it('calls it off when the game ended while the chain could still take a position', () =>
    {
        expect(verdictOf(choices, CLOSE, won(99_000), 200_000, 200_000), 'over before the close').toBeNull();
        expect(verdictOf(choices, CLOSE, won(105_000), 190_000, 200_000), 'after the close by this clock, before it by a chain ten seconds behind').toBeNull();
    });

    it('reads the chain\'s clock as it is, so a chain ahead of this one closed earlier', () =>
    {
        expect(verdictOf(choices, CLOSE, won(95_000), 210_000, 200_000)).toBe(1);
    });

    it('reads a newest block minutes old as a quiet chain, its clock at most half a minute behind', () =>
    {
        expect(BEHIND_MOST_MS).toBe(30_000);
        expect(verdictOf(choices, CLOSE, won(CLOSE + BEHIND_MOST_MS), 20_000, 200_000)).toBe(1);
        expect(verdictOf(choices, CLOSE, won(CLOSE + BEHIND_MOST_MS - 1), 20_000, 200_000)).toBeNull();
        expect(verdictOf(choices, CLOSE, won(CLOSE + 20_000), 180_000, 200_000), 'twenty seconds behind is a clock').toBe(1);
        expect(verdictOf(choices, CLOSE, won(CLOSE + 19_999), 180_000, 200_000)).toBeNull();
    });

    it('calls off a game the staff ended as no contest, and one with no outcome', () =>
    {
        expect(verdictOf(choices, CLOSE, won(160_000, { voided: true }), 200_000, 200_000)).toBeNull();
        expect(verdictOf(choices, CLOSE, won(160_000, { winners: [] }), 200_000, 200_000)).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';

import { FORMATS } from '../src/domains/tournament/engine/formats.ts';
import { pokerResult } from '../src/domains/tournament/engine/shootout.ts';
import { dueGames } from '../src/domains/tournament/engine/game.ts';

describe('six-seat poker shootouts', () =>
{
    it.each<[number, number[]]>([[4, [4]], [6, [6]], [7, [4, 3]], [12, [6, 6]], [13, [5, 4, 4]], [36, [6, 6, 6, 6, 6, 6]]])('seats %i entrants exactly once', (entrants, sizes) =>
    {
        const rules = { entrants, bestOf: 1, rounds: 1 };
        const games = dueGames(FORMATS.shootout.start(rules));

        expect(games.map((game) => game.poker?.seeds.length)).toEqual(sizes);
        expect(games.flatMap((game) => game.poker!.seeds).sort((a, b) => a - b)).toEqual(Array.from({ length: rules.entrants }, (_, n) => n + 1));
    });

    it('balances every round up to 128 entrants and advances winners exactly once after reloading', () =>
    {
        const rules = { entrants: 128, bestOf: 1, rounds: 3 };
        const format = FORMATS.shootout;
        let games = format.start(rules);
        for (const expected of [22, 4, 1])
        {
            const due = dueGames(games);
            expect(due).toHaveLength(expected);
            for (const game of due)
            {
                expect(game.poker!.seeds.length).toBeGreaterThanOrEqual(2);
                expect(game.poker!.seeds.length).toBeLessThanOrEqual(6);
            }

            games = games.map((game) => game.how !== null ? game : pokerResult(game, game.poker!.seeds.length - 1, new Set()));
            const reloaded = format.advance(JSON.parse(JSON.stringify(games)), rules);
            expect(format.advance(reloaded, rules)).toEqual(reloaded);
            games = reloaded;
        }

        expect(dueGames(games)).toEqual([]);
        const standings = format.standings(games, rules);
        expect(standings.filter((row) => row.place === 1)).toHaveLength(1);
        expect(standings.every((row) => row.place !== null)).toBe(true);
    });
});

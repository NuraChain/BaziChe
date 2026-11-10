import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bracketSizeFor, seedOrder } from '../src/domains/tournament/engine/elimination.ts';
import { FORMATS, type FormatId } from '../src/domains/tournament/engine/formats.ts';
import { applyResult, currentPhase, dueGames, forfeitAbsent, shuffledSeeds, withoutAbsent, type Game, type Rules, type Side } from '../src/domains/tournament/engine/game.ts';
import { groupCountFor, groupsOf } from '../src/domains/tournament/engine/groups.ts';
import { rankLeague } from '../src/domains/tournament/engine/league.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const random = (seed: number) =>
{
    let state = seed;

    return () =>
    {
        state = (state * 1664525 + 1013904223) % 4294967296;

        return state / 4294967296;
    };
};

type Pick_ = (game: Game) => Side | null;

const better: Pick_ = (game) => (game.a as number) < (game.b as number) ? 'a' : 'b';

const rulesFor = (format: FormatId, entrants: number, bestOf = 1): Rules => ({ entrants, bestOf, rounds: FORMATS[format].roundsFor(entrants) });

/** Plays a tournament to its end exactly as the service does: phase by phase, one table at a time. */
const playOut = (format: FormatId, entrants: number, pick: Pick_, bestOf = 1) =>
{
    const rules = rulesFor(format, entrants, bestOf);
    const engine = FORMATS[format];
    let games = engine.advance(engine.start(rules), rules);
    const everyPhase: number[] = [];

    for (let guard = 0; guard < 5000 && currentPhase(games) !== null; guard += 1)
    {
        const due = dueGames(games);

        expect(due.length, `${ format } with ${ entrants } stalled at phase ${ currentPhase(games) }`).toBeGreaterThan(0);
        everyPhase.push(due[0].phase);

        const playing = new Map(due.map((game) => [game.key, game]));

        games = engine.advance(games.map((game) => playing.has(game.key) ? applyResult({ ...game, dealt: true }, pick(game), bestOf) : game), rules);
    }

    expect(currentPhase(games)).toBeNull();

    return { games, rules, engine, standings: engine.standings(games, rules), everyPhase };
};

const playedGames = (games: readonly Game[]) => games.filter((game) => game.how === 'played' || game.how === 'seed' || game.how === 'draw');

const lossesOf = (games: readonly Game[], seed: number) => playedGames(games)
    .filter((game) => game.winner !== null && (game.a === seed || game.b === seed) && game.winner !== seed).length;

const FIELDS = Array.from({ length: 63 }, (_, index) => index + 2);

const SIDES = (seed: number): Pick_ =>
{
    const roll = random(seed);

    return () => roll() < 0.5 ? 'a' : 'b';
};

const everySeed = (entrants: number) => Array.from({ length: entrants }, (_, index) => index + 1);

describe('single elimination', () =>
{
    it('takes the smallest bracket the field fits, and keeps the best two apart until the final', () =>
    {
        expect([2, 3, 4, 5, 8, 9, 16, 17, 32, 33, 64].map(bracketSizeFor)).toEqual([2, 4, 4, 8, 8, 16, 16, 32, 32, 64, 64]);
        expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    });

    it.each(FIELDS)('plays %i entrants to one champion, with one fewer game than entrants', (entrants) =>
    {
        const { games, standings } = playOut('single', entrants, SIDES(entrants));

        expect(standings.filter((row) => row.place === 1)).toHaveLength(1);
        expect(playedGames(games)).toHaveLength(entrants - 1);
        expect(standings).toHaveLength(entrants);
        expect(standings.every((row) => row.place !== null)).toBe(true);

        for (const seed of everySeed(entrants))
        {
            expect(lossesOf(games, seed)).toBeLessThanOrEqual(1);
        }
    });

    it('gives the top seeds the byes', () =>
    {
        const rules = rulesFor('single', 5);
        const games = FORMATS.single.advance(FORMATS.single.start(rules), rules);

        expect(games.filter((game) => game.how === 'bye').map((game) => game.winner).sort()).toEqual([1, 2, 3]);
        expect(dueGames(games).map((game) => [game.a, game.b])).toEqual([[4, 5]]);
    });

    it('holds a round back until every game of the one before is decided', () =>
    {
        const { everyPhase } = playOut('single', 16, better);

        expect(everyPhase).toEqual([1, 2, 3, 4]);
    });

    it('lets the best seed win when the best seed always wins, and shares third place', () =>
    {
        const { standings } = playOut('single', 8, better);
        const placeOf = (seed: number) => standings.find((row) => row.seed === seed)?.place;

        expect([1, 2, 3, 4, 5].map(placeOf)).toEqual([1, 2, 3, 3, 5]);
    });
});

describe('double elimination', () =>
{
    it.each(FIELDS)('plays %i entrants out, and only ever knocks somebody out on their second loss', (entrants) =>
    {
        for (const seed of [1, 2, 3])
        {
            const { games, standings } = playOut('double', entrants, SIDES(entrants * seed));
            const champion = standings.find((row) => row.place === 1);

            expect(champion).toBeDefined();
            expect(standings.filter((row) => row.place === 1)).toHaveLength(1);
            expect(standings.every((row) => row.place !== null)).toBe(true);

            for (const one of everySeed(entrants))
            {
                const losses = lossesOf(games, one);

                if (one === champion?.seed)
                {
                    expect(losses, `the champion, seed ${ one } of ${ entrants }`).toBeLessThanOrEqual(1);
                }
                else
                {
                    expect(losses, `seed ${ one } of ${ entrants }`).toBe(2);
                }
            }
        }
    });

    it('plays 2n-2 games with no reset and 2n-1 with one', () =>
    {
        for (const entrants of [2, 3, 4, 7, 8, 16, 31, 32, 64, 127, 128])
        {
            const straight = playOut('double', entrants, better);

            expect(playedGames(straight.games)).toHaveLength(2 * entrants - 2);

            const lowerWins: Pick_ = (game) =>
                game.key === 'final:1:0' ? 'b' : better(game);
            const reset = playOut('double', entrants, lowerWins);

            expect(playedGames(reset.games)).toHaveLength(2 * entrants - 1);
            expect(reset.games.some((game) => game.key === 'final:2:0')).toBe(true);
        }
    });

    it('resets the grand final only when the player from the losers\' bracket wins it', () =>
    {
        const held = playOut('double', 8, better);

        expect(held.games.some((game) => game.key === 'final:2:0')).toBe(false);
        expect(held.standings.find((row) => row.place === 1)?.seed).toBe(1);
    });

    it('sends each winners\' bracket loser to a real slot, and exactly one loser to each', () =>
    {
        const rules = rulesFor('double', 16);
        const games = FORMATS.double.start(rules);
        const dropped = games.filter((game) => game.loseTo !== null).map((game) => `${ game.loseTo?.key }/${ game.loseTo?.side }`);
        const keys = new Set(games.map((game) => game.key));

        expect(new Set(dropped).size).toBe(dropped.length);
        expect(games.filter((game) => game.loseTo !== null).every((game) => keys.has(game.loseTo?.key as string))).toBe(true);
        expect(games.filter((game) => game.winTo !== null).every((game) => keys.has(game.winTo?.key as string))).toBe(true);
    });

    it('does not make two players meet again straight after one drops', () =>
    {
        const { games } = playOut('double', 16, better);
        const firstDrop = games.filter((game) => game.key.startsWith('losers:2:'));
        const earlier = new Set(games.filter((game) => game.key.startsWith('winners:')).map((game) => `${ game.a }-${ game.b }`));

        for (const game of firstDrop)
        {
            expect(earlier.has(`${ game.a }-${ game.b }`) || earlier.has(`${ game.b }-${ game.a }`)).toBe(false);
        }
    });
});

describe('round robin', () =>
{
    it.each([2, 3, 4, 5, 6, 7, 8, 9, 16])('has everybody play everybody exactly once with %i entrants', (entrants) =>
    {
        const { games, rules, engine } = playOut('round-robin', entrants, SIDES(entrants));
        const pairs = playedGames(games).map((game) => [game.a as number, game.b as number].sort((one, other) => one - other).join('-'));

        expect(pairs).toHaveLength(entrants * (entrants - 1) / 2);
        expect(new Set(pairs).size).toBe(pairs.length);

        const table = engine.standings(games, rules);

        expect(table.map((row) => row.place)).toEqual(everySeed(entrants));
    });

    it('never has anybody at two tables in one round', () =>
    {
        const { games } = playOut('round-robin', 8, better);

        for (const round of new Set(games.map((game) => game.round)))
        {
            const players = games.filter((game) => game.round === round).flatMap((game) => [game.a, game.b]);

            expect(new Set(players).size).toBe(players.length);
        }
    });

    it('counts a draw as a point each and lets a league end level', () =>
    {
        const { standings } = playOut('round-robin', 4, () => null);

        expect(standings.every((row) => row.draws === 3 && row.points === 3)).toBe(true);
        expect(standings.map((row) => row.seed)).toEqual([1, 2, 3, 4]);
    });

    it('breaks a tie on points by who won when they met', () =>
    {
        const game = (a: number, b: number, winner: number): Game => ({
            key: `league:1:${ a }${ b }`, stage: 'league', round: 1, slot: 0, phase: 1, a, b,
            scoreA: winner === a ? 1 : 0, scoreB: winner === b ? 1 : 0, winner, how: 'played', attempt: 1, dealt: true, winTo: null, loseTo: null
        });

        expect(rankLeague([game(1, 2, 2), game(1, 3, 1), game(2, 3, 3)], [1, 2, 3], 'head-to-head').map((row) => row.seed)).toEqual([1, 2, 3]);
        expect(rankLeague([game(1, 2, 2), game(3, 4, 3), game(1, 3, 1), game(2, 4, 2), game(1, 4, 1), game(2, 3, 3)], [1, 2, 3, 4], 'head-to-head')[0].seed).toBe(1);
    });
});

describe('Swiss', () =>
{
    it.each([4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65, 127, 128])('plays %i entrants the rounds it promised, with no repeated pairing', (entrants) =>
    {
        for (const seed of [11, 22, 33])
        {
            const { games, rules, standings } = playOut('swiss', entrants, SIDES(entrants * seed));
            const pairs = playedGames(games).map((game) => [game.a as number, game.b as number].sort((one, other) => one - other).join('-'));

            expect(new Set(pairs).size, `${ entrants } repeated a pairing`).toBe(pairs.length);
            expect(Math.max(...games.map((game) => game.round))).toBe(rules.rounds);
            expect(standings.map((row) => row.place).sort((one, other) => (one as number) - (other as number))).toEqual(everySeed(entrants));
        }
    });

    it('gives a bye only to somebody who has not had one, and never twice while another has none', () =>
    {
        const { games } = playOut('swiss', 9, SIDES(5));
        const byes = games.filter((game) => game.how === 'bye').map((game) => game.winner);

        expect(new Set(byes).size).toBe(byes.length);
    });

    it('generates a round only when the one before it is over', () =>
    {
        const rules = rulesFor('swiss', 8);
        const games = FORMATS.swiss.advance(FORMATS.swiss.start(rules), rules);

        expect(Math.max(...games.map((game) => game.round))).toBe(1);
    });

    it('never has anybody at two tables in one round', () =>
    {
        const { games } = playOut('swiss', 16, SIDES(9));

        for (const round of new Set(games.map((game) => game.round)))
        {
            const players = games.filter((game) => game.round === round).flatMap((game) => [game.a, game.b]).filter((seed) => seed !== null);

            expect(new Set(players).size).toBe(players.length);
        }
    });
});

describe('groups and playoffs', () =>
{
    it('makes 8 groups of 4 from 32, and 16 go through', () =>
    {
        expect(groupsOf(32)).toHaveLength(8);
        expect(groupsOf(32).every((group) => group.length === 4)).toBe(true);

        const { games } = playOut('groups', 32, SIDES(1));

        expect(games.filter((game) => game.stage === 'playoff' && game.round === 1)).toHaveLength(8);
    });

    it.each([[64, 16], [128, 32]])('keeps the groups at four with %i entrants, in %i groups', (entrants, count) =>
    {
        expect(groupsOf(entrants)).toHaveLength(count);
        expect(groupsOf(entrants).every((group) => group.length === 4)).toBe(true);
    });

    it.each([2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 20, 23, 24, 25, 31, 32, 47, 48, 64, 95, 96, 128])('runs %i entrants through groups into a playoff with one champion', (entrants) =>
    {
        const { games, standings } = playOut('groups', entrants, SIDES(entrants));
        const placed = standings.map((row) => row.seed).sort((one, other) => one - other);

        expect(placed).toEqual(everySeed(entrants));
        expect(standings.filter((row) => row.place === 1)).toHaveLength(1);
        expect(standings.every((row) => row.place !== null)).toBe(true);

        const group = groupCountFor(entrants);

        expect(games.filter((game) => game.stage === 'playoff').length).toBe(Math.max(group * 2, 2) - 1);
    });

    it('puts every entrant in exactly one group, the groups within one of each other', () =>
    {
        for (let entrants = 2; entrants <= 128; entrants += 1)
        {
            const groups = groupsOf(entrants);
            const sizes = groups.map((group) => group.length);

            expect(groups.flat().sort((one, other) => one - other)).toEqual(everySeed(entrants));
            expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        }
    });

    it('never pairs two from the same group in the first playoff round', () =>
    {
        for (const entrants of [8, 16, 32, 64, 128])
        {
            const { games, rules } = playOut('groups', entrants, SIDES(entrants + 1));
            const groupOf = new Map(groupsOf(rules.entrants).flatMap((seeds, group) => seeds.map((seed) => [seed, group])));

            for (const game of games.filter((one) => one.stage === 'playoff' && one.round === 1))
            {
                expect(groupOf.get(game.a as number)).not.toBe(groupOf.get(game.b as number));
            }
        }
    });

    it('waits for every group game before drawing the playoff', () =>
    {
        const rules = rulesFor('groups', 8);
        const games = FORMATS.groups.advance(FORMATS.groups.start(rules), rules);

        expect(games.some((game) => game.stage === 'playoff')).toBe(false);
    });

    it('draws the same tree every time from the same results', () =>
    {
        expect(playOut('groups', 16, SIDES(7)).games).toEqual(playOut('groups', 16, SIDES(7)).games);
    });
});

describe('a series, and a game with no winner', () =>
{
    const game: Game = { key: 'main:1:0', stage: 'main', round: 1, slot: 0, phase: 1, a: 7, b: 2, scoreA: 0, scoreB: 0, winner: null, how: null, attempt: 1, dealt: true, winTo: null, loseTo: null };

    it('names the side that won a single game', () =>
    {
        expect(applyResult(game, 'a', 1)).toMatchObject({ winner: 7, how: 'played', scoreA: 1 });
        expect(applyResult(game, 'b', 1)).toMatchObject({ winner: 2, how: 'played', scoreB: 1 });
    });

    it('is played again the first time nobody wins a knockout game, and the table is dealt afresh', () =>
    {
        expect(applyResult(game, null, 1)).toMatchObject({ winner: null, how: null, attempt: 2, dealt: false });
    });

    it('goes to the better seed the second time, so a bracket can never go round for ever', () =>
    {
        expect(applyResult({ ...game, attempt: 2 }, null, 1)).toMatchObject({ winner: 2, how: 'seed' });
    });

    it('ends a best of three at two wins and not before', () =>
    {
        const one = applyResult(game, 'a', 3);

        expect(one).toMatchObject({ how: null, scoreA: 1, attempt: 2, dealt: false });
        expect(applyResult({ ...one, dealt: true }, 'a', 3)).toMatchObject({ winner: 7, how: 'played', scoreA: 2 });
    });

    it('takes a level series to one more game, then to the better seed', () =>
    {
        const level = { ...game, scoreA: 1, scoreB: 1, attempt: 4 };

        expect(applyResult(level, null, 3)).toMatchObject({ winner: 2, how: 'seed' });
    });

    it('lets a league series end level', () =>
    {
        expect(applyResult({ ...game, stage: 'league' }, null, 1)).toMatchObject({ winner: null, how: 'draw' });
    });

    it.each<[FormatId, number]>([['single', 8], ['double', 8], ['round-robin', 8], ['swiss', 8], ['groups', 8]])('finishes %s when every table ends with no winner', (format, entrants) =>
    {
        expect(playOut(format, entrants, () => null).standings.every((row) => row.place !== null)).toBe(true);
    });

    it.each<[FormatId, number]>([['single', 16], ['double', 16], ['swiss', 16], ['groups', 16]])('finishes %s when every game is a best of five', (format, entrants) =>
    {
        expect(playOut(format, entrants, SIDES(3), 5).standings.filter((row) => row.place === 1).length).toBeGreaterThan(0);
    });
});

describe('somebody taken out', () =>
{
    const dealtTo = (games: readonly Game[]) => dueGames(games).map((game) => ({ ...game, dealt: true }));

    it('loses the game in hand to whoever faces them, and leaves every other game alone', () =>
    {
        const rules = rulesFor('single', 8);
        const games = FORMATS.single.advance(FORMATS.single.start(rules), rules);
        const playing = new Set(dealtTo(games).map((game) => game.key));
        const dealt = games.map((game) => playing.has(game.key) ? { ...game, dealt: true } : game);
        const held = dealt.find((game) => game.a === 3 || game.b === 3) as Game;
        const after = forfeitAbsent(dealt, new Set([3]));

        expect(after.find((game) => game.key === held.key)).toMatchObject({ how: 'seed', winner: held.a === 3 ? held.b : held.a });
        expect(after.filter((game) => game.key !== held.key)).toEqual(dealt.filter((game) => game.key !== held.key));
    });

    it('touches no game that is not yet dealt, or already over', () =>
    {
        const rules = rulesFor('single', 8);
        const games = FORMATS.single.advance(FORMATS.single.start(rules), rules);

        expect(forfeitAbsent(games, new Set([3]))).toEqual(games);
    });

    it('goes out of a knockout like anybody beaten, and the bracket still ends with one champion', () =>
    {
        const rules = rulesFor('single', 8);
        let games = FORMATS.single.advance(FORMATS.single.start(rules), rules);

        for (let guard = 0; guard < 50 && currentPhase(games) !== null; guard += 1)
        {
            const playing = new Set(dueGames(games).map((game) => game.key));

            games = forfeitAbsent(games.map((game) => playing.has(game.key) ? { ...game, dealt: true } : game), new Set([1]));
            games = FORMATS.single.advance(games.map((game) => playing.has(game.key) && game.how === null ? applyResult(game, better(game), 1) : game), rules);
        }

        const standings = FORMATS.single.standings(games, rules);

        expect(standings.find((row) => row.place === 1)?.seed).toBe(2);
        expect(standings.find((row) => row.seed === 1)?.place).not.toBe(1);
    });

    it('cannot top a league on the points they had, and the rest close up behind the leader', () =>
    {
        const { standings } = playOut('round-robin', 8, better);
        const kept = withoutAbsent(standings, new Set([1]));

        expect(kept.map((row) => row.seed)).toEqual([2, 3, 4, 5, 6, 7, 8, 1]);
        expect(kept.map((row) => row.place)).toEqual([1, 2, 3, 4, 5, 6, 7, null]);
    });

    it('leaves a table with nobody taken out exactly as it was', () =>
    {
        const { standings } = playOut('swiss', 8, SIDES(4));

        expect(withoutAbsent(standings, new Set())).toEqual(standings);
    });
});

describe('the random draw', () =>
{
    it('uses every seed exactly once', () =>
    {
        const roll = random(4);

        expect(shuffledSeeds(16, (limit) => Math.floor(roll() * limit)).sort((one, other) => one - other)).toEqual(everySeed(16));
    });

    it('takes its randomness from outside', () =>
    {
        expect(shuffledSeeds(4, () => 0)).toEqual([2, 3, 4, 1]);
    });

    it('is a set of modules that import only each other, with no clock in them', () =>
    {
        const folder = join(HERE, '..', 'src', 'domains', 'tournament', 'engine');

        for (const file of readdirSync(folder))
        {
            const source = readFileSync(join(folder, file), 'utf8');

            expect(source.match(/from '([^']+)'/g)?.every((line) => line.startsWith("from './")) ?? true, file).toBe(true);
            expect(source, file).not.toMatch(/\bDate\b|setTimeout|setInterval|Math\.random/);
        }
    });
});

describe('the sizes a tournament can be', () =>
{
    const offered = [...new Set(Object.values(FORMATS).flatMap((format) => format.sizes))].sort((one, other) => one - other);

    it('are all allowed by the database', () =>
    {
        const entity = readFileSync(join(HERE, '..', 'src', 'entities', 'tournament.entity.ts'), 'utf8');
        const allowed = /size in \(([^)]+)\)/.exec(entity)?.[1].split(',').map(Number);

        expect(allowed).toEqual(offered);
    });

    it('are all allowed by the form the server reads', () =>
    {
        const schemas = readFileSync(join(HERE, '..', 'src', 'schemas.ts'), 'utf8');
        const most = /tournamentCreateInput[\s\S]*?size: number\(\{ int: true, min: \d+, max: (\d+) \}\)/.exec(schemas)?.[1];

        expect(Number(most)).toBe(offered[offered.length - 1]);
    });
});

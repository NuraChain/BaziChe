import { knockoutRows, knockoutTree } from './elimination.ts';
import { allDecided, settle, withPhases, type Format, type Game, type Rules, type Standing, type StandingsTable } from './game.ts';
import { rankLeague, roundRobinGames } from './league.ts';

const PLAYOFF = 'playoff';

/** Groups of three to five wherever the field allows it, and always a number the playoff can halve. */
export const groupCountFor = (entrants: number) =>
{
    if (entrants >= 24)
    {
        return 8;
    }

    if (entrants >= 12)
    {
        return 4;
    }

    return entrants >= 6 ? 2 : 1;
};

export const QUALIFY_PER_GROUP = 2;

/** Snake order: 1 to the last group and back, so every group gets one of the best. */
export const groupsOf = (entrants: number) =>
{
    const count = groupCountFor(entrants);
    const groups: number[][] = Array.from({ length: count }, () => []);

    for (let index = 0; index < entrants; index += 1)
    {
        const lap = Math.floor(index / count);
        const along = index % count;

        groups[lap % 2 === 0 ? along : count - 1 - along].push(index + 1);
    }

    return groups;
};

const stageOf = (group: number) => `group${ group }`;

const inGroup = (games: readonly Game[], group: number) => games.filter((game) => game.stage === stageOf(group));

const groupTable = (games: readonly Game[], seeds: readonly number[], group: number) =>
    rankLeague(inGroup(games, group), seeds, 'head-to-head');

/**
 * The playoff tree from the group tables.
 *
 * Group winners take the top seeds in group order and runners-up the rest in the same order. Because
 * a tree pairs seed `s` with `size + 1 - s`, the winner of group `i` meets the runner-up of the
 * group mirrored from it, never their own, whenever there is more than one group.
 */
const playoffTree = (games: readonly Game[], groups: readonly number[][], afterPhase: number) =>
{
    const tables = groups.map((seeds, group) => groupTable(games, seeds, group));
    const qualified = [...tables.map((rows) => rows[0].seed), ...tables.map((rows) => rows[1]?.seed).filter((seed) => seed !== undefined)];

    return withPhases(knockoutTree(PLAYOFF, qualified.length, (position) => qualified[position - 1]))
        .map((game) => ({ ...game, phase: game.phase + afterPhase }));
};

const everyGroupGame = (games: readonly Game[]) => games.filter((game) => game.stage !== PLAYOFF);

export const groupsAndPlayoffs: Format = {
    id: 'groups',
    sizes: [8, 16, 32],
    roundsFor: (entrants) => entrants,

    start: (rules) => settle(groupsOf(rules.entrants).flatMap((seeds, group) => roundRobinGames(stageOf(group), seeds))),

    advance(games, rules)
    {
        const next = settle(games);
        const grouped = everyGroupGame(next);

        if (grouped.length !== next.length || !allDecided(grouped))
        {
            return next;
        }

        return settle([...next, ...playoffTree(next, groupsOf(rules.entrants), Math.max(...grouped.map((game) => game.phase)))]);
    },

    standings(games: readonly Game[], rules: Rules): Standing[]
    {
        const groups = groupsOf(rules.entrants);
        const playoff = games.filter((game) => game.stage === PLAYOFF);
        const tables = groups.map((seeds, group) => groupTable(games, seeds, group));
        const out = tables.flatMap((rows) => rows.slice(QUALIFY_PER_GROUP))
            .sort((one, other) => other.points - one.points || other.diff - one.diff || one.seed - other.seed);

        if (playoff.length === 0)
        {
            return tables.flat().map((row) => ({ ...row, place: null }));
        }

        const seeds = tables.flatMap((rows) => rows.slice(0, QUALIFY_PER_GROUP).map((row) => row.seed));
        const top = knockoutRows(playoff, seeds);
        const over = allDecided(playoff);

        return [...top, ...out.map((row, index) => ({ ...row, place: over ? seeds.length + index + 1 : null }))];
    },

    tables(games: readonly Game[], rules: Rules): StandingsTable[]
    {
        return groupsOf(rules.entrants).map((seeds, group) => ({
            group,
            rows: groupTable(games, seeds, group),
            qualify: QUALIFY_PER_GROUP
        }));
    }
};

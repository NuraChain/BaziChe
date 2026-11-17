import { describe, expect, it } from 'vitest';

import { GAME_FAMILIES } from '../src/domains/achieve/families.ts';
import { AVAILABLE_GAMES, QUEST_TEMPLATES, drawnGames, metricOf, mostInPeriod, questView, questsFor, templateOf, type GameId } from '../src/domains/reward/quests.ts';

const PLAIN_METRICS = ['played', 'won', 'played-with-friend', 'tournament-played', 'distinct-games'];

/** The tally names an achievement family of that game counts: the ones its engine is known to produce. */
const talliesOf = (game: string) => GAME_FAMILIES[game]
    .flatMap((family) => family.metric.of === 'tally' ? [family.metric.name] : []);

describe('reward quests', () =>
{
    it('keeps the template catalogue valid and complete', () =>
    {
        expect(QUEST_TEMPLATES.filter((quest) => quest.game === 'any')).toHaveLength(6);

        for (const game of AVAILABLE_GAMES)
        {
            expect(QUEST_TEMPLATES.filter((quest) => quest.game === game && quest.period === 'daily').length).toBeGreaterThanOrEqual(6);
            expect(QUEST_TEMPLATES.filter((quest) => quest.game === game && quest.period === 'weekly').length).toBeGreaterThanOrEqual(4);
        }

        expect(new Set(QUEST_TEMPLATES.map((quest) => quest.id)).size).toBe(QUEST_TEMPLATES.length);
    });

    it('uses only the closed metrics, and a game only the tallies its achievement families use', () =>
    {
        for (const quest of QUEST_TEMPLATES)
        {
            if (typeof quest.metric === 'string')
            {
                expect(PLAIN_METRICS).toContain(quest.metric);
                continue;
            }

            expect(quest.game).not.toBe('any');
            expect(talliesOf(quest.game)).toContain(quest.metric.tally);
        }
    });

    it('asks for different games only on the weekly any-game quests', () =>
    {
        for (const quest of QUEST_TEMPLATES.filter((one) => one.metric === 'distinct-games'))
        {
            expect(quest).toMatchObject({ game: 'any', period: 'weekly' });
        }
    });

    it('can finish every template within its period', () =>
    {
        for (const quest of QUEST_TEMPLATES)
        {
            expect(quest.target, quest.id).toBeGreaterThan(0);
            expect(quest.target, quest.id).toBeLessThanOrEqual(mostInPeriod(quest));
        }
    });

    it('asks daily for no tournament and no tally a day of play may not make, and sizes each tally on its own', () =>
    {
        const daily = QUEST_TEMPLATES.filter((quest) => quest.period === 'daily');

        expect(daily.filter((quest) => quest.metric === 'tournament-played')).toEqual([]);
        expect(daily.map((quest) => quest.id)).not.toContain('chess-enPassants-daily');
        expect(daily.map((quest) => quest.id)).not.toContain('backgammon-backgammons-daily');
        expect(templateOf('daily', 'hokm-kots-daily')?.target).toBe(1);
        expect(templateOf('daily', 'poker-knockouts-daily')?.target).toBe(1);
        expect(templateOf('daily', 'ludo-rolls-daily')?.target).toBeGreaterThan(5);
    });

    it('names a metric for the wire, a tally as tally:<name>', () =>
    {
        expect(metricOf({ metric: 'played' })).toBe('played');
        expect(metricOf({ metric: { tally: 'sixes' } })).toBe('tally:sixes');
    });

    it('draws a quest with no row as neither done nor claimed, with what it pays', () =>
    {
        const [quest] = QUEST_TEMPLATES;

        expect(questView(quest, undefined, 1000)).toEqual({ id: quest.id, game: quest.game, metric: metricOf(quest), target: quest.target, reward: 1000, progress: 0, done: false, claimed: false });
        expect(questView(quest, { progress: 2, doneAt: null, claimedAt: null }, 1000)).toMatchObject({ progress: 2, done: false, claimed: false });
        expect(questView(quest, { progress: quest.target, doneAt: new Date(), claimedAt: null }, 1000)).toMatchObject({ done: true, claimed: false });
        expect(questView(quest, { progress: quest.target, doneAt: new Date(), claimedAt: new Date() }, 1000)).toMatchObject({ done: true, claimed: true });
    });

    const ALL: GameId[] = [...AVAILABLE_GAMES];

    /** Every day of three cycles, or every week, in order, as (cycle, day-or-week) pairs. */
    const periods = (period: 'daily' | 'weekly') => [34, 35, 36].flatMap((cycle) =>
        Array.from({ length: period === 'daily' ? 30 : 4 }, (_, index) => [cycle, index + 1] as const));

    it('gives every day and week a deterministic 1+2 mix of any and specific quests from different games', () =>
    {
        for (const period of ['daily', 'weekly'] as const)
        {
            for (const [cycle, at] of periods(period))
            {
                const list = questsFor(cycle, at, period, ALL);

                expect(list).toEqual(questsFor(cycle, at, period, [...ALL]));
                expect(list).toHaveLength(3);
                expect(list.every((quest) => quest.period === period)).toBe(true);
                expect(list.filter((quest) => quest.game === 'any')).toHaveLength(1);
                expect(new Set(list.filter((quest) => quest.game !== 'any').map((quest) => quest.game)).size).toBe(2);
            }
        }
    });

    it('never draws a quest on two days or two weeks in a row, across a cycle boundary too', () =>
    {
        for (const games of [ALL, ['hokm', 'chess'] as GameId[], ['ludo'] as GameId[], [] as GameId[]])
        {
            for (const period of ['daily', 'weekly'] as const)
            {
                const draws = periods(period).map(([cycle, at]) => questsFor(cycle, at, period, games).map((quest) => quest.id));

                for (let index = 1; index < draws.length; index += 1)
                {
                    expect(draws[index].filter((id) => draws[index - 1].includes(id)), `${ games.join(',') } ${ period } ${ index }`).toEqual([]);
                }
            }
        }
    });

    it('draws every game equally often over as many days as there are games', () =>
    {
        const days = periods('daily');

        for (let start = 0; start + ALL.length <= days.length; start += 1)
        {
            const counts = new Map<string, number>();

            for (const [cycle, day] of days.slice(start, start + ALL.length))
            {
                for (const quest of questsFor(cycle, day, 'daily', ALL).filter((one) => one.game !== 'any'))
                {
                    counts.set(quest.game, (counts.get(quest.game) ?? 0) + 1);
                }
            }

            expect([...counts.values()]).toEqual(ALL.map(() => 2));
        }
    });

    it('draws only the games that are available, in the same order however they were read', () =>
    {
        expect(drawnGames(['chess', 'hokm', 'nope'])).toEqual(['hokm', 'chess']);
        expect(drawnGames([])).toEqual([]);

        for (const [cycle, day] of periods('daily'))
        {
            const games = questsFor(cycle, day, 'daily', ['hokm', 'chess']).map((quest) => quest.game);

            expect(games.filter((game) => game !== 'any').sort()).toEqual(['chess', 'hokm']);
            expect(questsFor(cycle, day, 'daily', ['ludo']).map((quest) => quest.game)).toEqual(['ludo', 'any']);
            expect(questsFor(cycle, day, 'daily', []).map((quest) => quest.game)).toEqual(['any']);
        }
    });

    it('asks for no more different games than are available', () =>
    {
        for (const [cycle, week] of periods('weekly'))
        {
            for (const games of [['hokm', 'chess'] as GameId[], ['ludo'] as GameId[]])
            {
                const asked = questsFor(cycle, week, 'weekly', games).filter((quest) => quest.metric === 'distinct-games');

                expect(asked.every((quest) => quest.target <= games.length)).toBe(true);
            }
        }
    });

    it('finds any template by period and id, drawn today or not, so a quest stays claimable after its game is switched off', () =>
    {
        for (const quest of QUEST_TEMPLATES)
        {
            expect(templateOf(quest.period, quest.id)).toBe(quest);
        }

        const daily = QUEST_TEMPLATES.find((quest) => quest.period === 'daily')!;

        expect(templateOf('weekly', daily.id)).toBeNull();
        expect(templateOf('daily', 'no-such-quest')).toBeNull();
    });
});

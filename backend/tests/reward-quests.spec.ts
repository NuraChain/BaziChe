import { describe, expect, it } from 'vitest';

import { AVAILABLE_GAMES, QUEST_TEMPLATES, questsFor } from '../src/domains/reward/quests.ts';

describe('reward quests', () =>
{
    it('keeps the template catalogue valid and complete', () =>
    {
        expect(QUEST_TEMPLATES.length).toBeGreaterThan(0);
        expect(QUEST_TEMPLATES.filter((quest) => quest.game === 'any')).toHaveLength(6);
        for (const quest of QUEST_TEMPLATES)
        {
            expect(quest.period).toMatch(/^(daily|weekly)$/);
            if (quest.game !== 'any')
            {
                expect(AVAILABLE_GAMES).toContain(quest.game);
            }
            const metric = typeof quest.metric === 'string' ? quest.metric : quest.metric.tally;
            expect(['played', 'won', 'played-with-friend', 'tournament-played', 'distinct-games', 'rolls', 'sixes', 'captures', 'home', 'enters', 'hands', 'tricks', 'kots', 'trumps', 'games', 'gammons', 'backgammons', 'hits', 'borneOff', 'pots', 'showdowns', 'knockouts', 'moves', 'checks', 'checkmates', 'castles', 'promotions', 'enPassants', 'draws']).toContain(metric);
        }
    });

    it('gives every day and week a deterministic 1+2 mix of any and specific quests', () =>
    {
        for (let cycle = 0; cycle < 3; cycle += 1)
        {
            for (let day = 1; day <= 5; day += 1)
            {
                const list = questsFor(cycle, day, 'daily');
                expect(list).toHaveLength(3);
                expect(list.filter((quest) => quest.game === 'any')).toHaveLength(1);
                const specific = list.filter((quest) => quest.game !== 'any').map((quest) => quest.game);
                expect(new Set(specific).size).toBe(2);
                expect(specific[0]).not.toBe(specific[1]);
            }

            for (let week = 1; week <= 4; week += 1)
            {
                const list = questsFor(cycle, week, 'weekly');
                expect(list).toHaveLength(3);
                expect(list.filter((quest) => quest.game === 'any')).toHaveLength(1);
                const specific = list.filter((quest) => quest.game !== 'any').map((quest) => quest.game);
                expect(new Set(specific).size).toBe(2);
            }
        }
    });

    it('rotates games and never repeats a quest id on consecutive selections', () =>
    {
        const byDay: string[] = [];
        for (let day = 1; day <= 10; day += 1)
        {
            byDay.push(...questsFor(0, day, 'daily').map((quest) => quest.id));
        }
        for (let index = 1; index < byDay.length; index += 1)
        {
            expect(byDay[index]).not.toBe(byDay[index - 1]);
        }

        const byWeek: string[] = [];
        for (let week = 1; week <= 10; week += 1)
        {
            byWeek.push(...questsFor(0, week, 'weekly').map((quest) => quest.id));
        }
        for (let index = 1; index < byWeek.length; index += 1)
        {
            expect(byWeek[index]).not.toBe(byWeek[index - 1]);
        }
    });
});

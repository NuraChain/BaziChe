import { describe, expect, it } from 'vitest';

import { countsForQuests } from '../src/domains/reward/progress.ts';
import { deltasForQuests, inQuestOrder, wantsDistinctGame, weeklyChestReady } from '../src/domains/reward/progress.ts';

describe('reward quest progress', () =>
{
    it('counts a qualifying match toward the standard quest metrics', () =>
    {
        expect(countsForQuests({
            game: 'chess',
            result: 'won',
            credit: true,
            ownTurns: 18,
            opponentIds: ['u-2', 'u-3'],
            sameOpponentCounts: { 'u-2': 2 },
            establishedOpponents: ['u-2'],
            tally: { moves: 24, captures: 3, checks: 2 }
        })).toMatchObject({
            played: 1,
            won: 1,
            'tally:moves': 24,
            'tally:captures': 3
        });
    });

    it('ignores a match that does not qualify and enforces the same-opponent limit', () =>
    {
        expect(countsForQuests({
            game: 'ludo',
            result: 'won',
            credit: false,
            ownTurns: 25,
            opponentIds: ['u-8'],
            sameOpponentCounts: { 'u-8': 3 },
            establishedOpponents: ['u-8'],
            distinctGames: 2,
            tally: { captures: 4 }
        })).toEqual({});

        expect(countsForQuests({
            game: 'chess',
            result: 'void',
            ownTurns: 30,
            opponentIds: ['u-8'],
            distinctGames: 2,
            tally: { moves: 30 }
        })).toEqual({});

        expect(countsForQuests({
            game: 'poker',
            result: 'lost',
            ownTurns: 11,
            opponentIds: ['u-9', 'u-6'],
            sameOpponentCounts: { 'u-9': 3 },
            establishedOpponents: ['u-9']
        })).toMatchObject({
            played: 1
        });
    });

    it('requires an established opponent for win quests', () =>
    {
        const counts = countsForQuests({
            game: 'hokm',
            result: 'won',
            credit: true,
            ownTurns: 20,
            opponentIds: ['u-2', 'u-3'],
            sameOpponentCounts: { 'u-2': 1 },
            establishedOpponents: []
        });

        expect(counts).toMatchObject({ played: 1 });
        expect(counts).not.toHaveProperty('won');
    });

    it('maps every quest metric to the matching progress delta and game', () =>
    {
        const quests = [
            { id: 'played', period: 'daily', game: 'any', metric: 'played', target: 5, title: '', blurb: '' },
            { id: 'won', period: 'weekly', game: 'chess', metric: 'won', target: 2, title: '', blurb: '' },
            { id: 'tally', period: 'daily', game: 'chess', metric: { tally: 'moves' }, target: 20, title: '', blurb: '' },
            { id: 'wrong-game', period: 'daily', game: 'ludo', metric: 'played', target: 2, title: '', blurb: '' },
            { id: 'missing', period: 'daily', game: 'chess', metric: 'played-with-friend', target: 2, title: '', blurb: '' }
        ] as const;

        expect(deltasForQuests(quests, 'chess', { played: 1, won: 1, 'tally:moves': 8 })).toEqual([
            { period: 'daily', quest_id: 'played', progress: 1, target: 5 },
            { period: 'weekly', quest_id: 'won', progress: 1, target: 2 },
            { period: 'daily', quest_id: 'tally', progress: 8, target: 20 }
        ]);
    });

    it('opens the weekly chest with the third different weekly quest claimed, whichever draw it came from', () =>
    {
        expect(weeklyChestReady([])).toBe(false);
        expect(weeklyChestReady(['one', 'two'])).toBe(false);
        expect(weeklyChestReady(['one', 'two', 'two'])).toBe(false);
        expect(weeklyChestReady(['one', 'two', 'three'])).toBe(true);
    });

    it('marks a game for the different-games quest only from a match that counted, while such a quest is drawn', () =>
    {
        const distinct = [{ metric: 'distinct-games' as const }];
        const counted = countsForQuests({ game: 'chess', result: 'lost', ownTurns: 30, playerId: 'me', opponentIds: ['them'] });
        const short = countsForQuests({ game: 'chess', result: 'lost', ownTurns: 6, playerId: 'me', opponentIds: ['them'] });
        const alone = countsForQuests({ game: 'chess', result: 'lost', ownTurns: 30, playerId: 'me', opponentIds: [] });
        const unearned = countsForQuests({ game: 'chess', result: 'won', credit: false, ownTurns: 30, playerId: 'me', opponentIds: ['them'] });
        const farmed = countsForQuests({ game: 'chess', result: 'lost', ownTurns: 30, playerId: 'me', opponentIds: ['them'], sameOpponentCounts: { them: 4 } });

        expect(wantsDistinctGame(distinct, counted)).toBe(true);
        expect(wantsDistinctGame([{ metric: 'played' as const }], counted)).toBe(false);

        for (const counts of [short, alone, unearned, farmed])
        {
            expect(wantsDistinctGame(distinct, counts)).toBe(false);
        }
    });

    it('puts progress rows in one lock order, by code point as collate "C" sorts', () =>
    {
        const row = (period: string, period_key: string, quest_id: string) => ({ period, period_key, quest_id });
        const rows = [
            row('weekly', '35-2', 'any-won-weekly'),
            row('daily', '1051', 'chess-moves-daily'),
            row('weekly', '35-2', 'Z-upper'),
            row('daily', '1051', 'any-played-daily'),
            row('daily', '1050', 'chess-moves-daily')
        ];

        expect(inQuestOrder(rows)).toEqual([
            row('daily', '1050', 'chess-moves-daily'),
            row('daily', '1051', 'any-played-daily'),
            row('daily', '1051', 'chess-moves-daily'),
            row('weekly', '35-2', 'Z-upper'),
            row('weekly', '35-2', 'any-won-weekly')
        ]);
        expect(inQuestOrder([...rows].reverse())).toEqual(inQuestOrder(rows));
    });
});

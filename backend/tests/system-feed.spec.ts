import { describe, expect, it } from 'vitest';

import { mayReceive } from '../src/domains/donate/service.ts';
import { movesOf, planOf, type SeatFacts } from '../src/domains/match/judge.ts';
import { apartOf, peopleOf, playedOf } from '../src/domains/match/record.ts';
import { countsForQuests, type RewardFinishPlayer } from '../src/domains/reward/progress.ts';

const seat = (facts: Partial<SeatFacts> & { seat: number; place: number }): SeatFacts => ({
    side: facts.seat,
    quitter: null,
    own: 20,
    unsettled: false,
    trailing: false,
    ...facts
});

describe('a match with a system seat moves no rating', () =>
{
    const plan = planOf({ seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2 })], after: 4, winners: [0], forfeited: false });
    const ratings = new Map([[0, 1300], [1, 1250]]);

    it('keeps every result and gives every rated seat its row, before and after the same', () =>
    {
        expect(plan.verdicts.map((one) => one.result)).toEqual(['won', 'lost']);
        expect(movesOf(plan, ratings, true)).toEqual([
            { seat: 0, before: 1300, after: 1300 },
            { seat: 1, before: 1250, after: 1250 }
        ]);
    });

    it('rates the same seats as an ordinary match would', () =>
    {
        const moved = movesOf(plan, ratings);

        expect(moved.map((one) => one.seat)).toEqual([0, 1]);
        expect(moved[0].after).toBeGreaterThan(1300);
    });

    it('leaves a seat nobody was counted against without a row, frozen or not', () =>
    {
        const lonely = planOf({ seats: [seat({ seat: 0, place: 1, quitter: { walked: true, rev: 1 }, own: 0 }), seat({ seat: 1, place: 1, own: 0 })], after: 4, winners: [], forfeited: true });

        expect(movesOf(lonely, ratings, true).map((one) => one.seat)).toEqual(movesOf(lonely, ratings).map((one) => one.seat));
    });
});

describe('the counters kept apart', () =>
{
    it('add a person\'s game, win and XP when the match had a system seat', () =>
    {
        expect(apartOf({ system: true, mine: false }, { played: 1, won: 1, xp: 40 })).toEqual({ played: 1, won: 1, xp: 40 });
        expect(apartOf({ system: true, mine: false }, { played: 1, won: 0, xp: 10 })).toEqual({ played: 1, won: 0, xp: 10 });
    });

    it('add nothing for a match among people, or to a system player\'s own row', () =>
    {
        expect(apartOf({ system: false, mine: false }, { played: 1, won: 1, xp: 40 })).toEqual({ played: 0, won: 0, xp: 0 });
        expect(apartOf({ system: true, mine: true }, { played: 1, won: 1, xp: 40 })).toEqual({ played: 0, won: 0, xp: 0 });
    });

    it('never leave more wins than games on the board', () =>
    {
        const rows = [
            { system: true, mine: false, played: 1, won: 1, xp: 40 },
            { system: false, mine: false, played: 1, won: 0, xp: 10 },
            { system: true, mine: false, played: 1, won: 1, xp: 40 },
            { system: false, mine: false, played: 1, won: 1, xp: 40 }
        ];
        const total = { played: 0, won: 0, xp: 0 };
        const apart = { played: 0, won: 0, xp: 0 };

        for (const row of rows)
        {
            const kept = apartOf(row, row);

            total.played += row.played;
            total.won += row.won;
            total.xp += row.xp;
            apart.played += kept.played;
            apart.won += kept.won;
            apart.xp += kept.xp;
        }

        expect({ played: total.played - apart.played, won: total.won - apart.won, xp: total.xp - apart.xp }).toEqual({ played: 2, won: 1, xp: 50 });
        expect(apart.won).toBeLessThanOrEqual(apart.played);
    });

    it('follow `played`: a win nobody played out is not a game', () =>
    {
        expect(playedOf({ result: 'won', credit: false })).toBe(0);
        expect(playedOf({ result: 'won', credit: true })).toBe(1);
        expect(playedOf({ result: 'lost', credit: false })).toBe(1);
    });
});

describe('what the quests are told', () =>
{
    const player = (userId: string, opponentIds: string[]): RewardFinishPlayer => ({
        userId,
        seat: 0,
        result: 'won',
        credit: true,
        ownTurns: 40,
        tally: {},
        opponentIds
    });
    const system = new Set(['bot-a', 'bot-b']);

    it('leaves out system players and every system opponent', () =>
    {
        const told = peopleOf([player('ann', ['bot-a', 'ben']), player('bot-a', ['ann', 'ben']), player('ben', ['ann', 'bot-a'])], system);

        expect(told.map((one) => [one.userId, one.opponentIds])).toEqual([['ann', ['ben']], ['ben', ['ann']]]);
    });

    it('counts a match whose only opponents were system players for nothing', () =>
    {
        const [told] = peopleOf([player('ann', ['bot-a', 'bot-b'])], system);

        expect(told.opponentIds).toEqual([]);
        expect(countsForQuests({ game: 'chess', ...told, playerId: told.userId, establishedOpponents: ['bot-a'] })).toEqual({});
    });

    it('counts a mixed match for the people in it only', () =>
    {
        const [told] = peopleOf([player('ann', ['bot-a', 'ben'])], system);
        const counts = countsForQuests({ game: 'chess', ...told, playerId: told.userId, establishedOpponents: ['bot-a'], friendOpponentIds: ['bot-a'] });

        expect(counts).toEqual({ played: 1 });
    });
});

describe('a gift to a player of the game', () =>
{
    const row = { id: 'ann', address: '0x' + '1'.repeat(40), minor: false, suspended: false, off: false, apart: false, system: false };

    it('may go to a person', () =>
    {
        expect(mayReceive(row, 'ben')).toBe(true);
    });

    it('never goes to a system player or to the giver', () =>
    {
        expect(mayReceive({ ...row, system: true }, 'ben')).toBe(false);
        expect(mayReceive(row, 'ann')).toBe(false);
    });
});

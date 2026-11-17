import { describe, expect, it } from 'vitest';

import { mayReceive } from '../src/domains/donate/service.ts';
import { movesOf, planOf, type SeatFacts } from '../src/domains/match/judge.ts';
import { ownMatches, ownOf } from '../src/domains/achieve/service.ts';
import { apartOf, playedOf, questPlayersOf, streakOf, talliesApartOf } from '../src/domains/match/record.ts';
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

    it('add a person\'s tallies only when the match had a system seat', () =>
    {
        const tally = { moves: 40, captures: 3 };

        expect(talliesApartOf({ system: true, mine: false }, tally)).toEqual(tally);
        expect(talliesApartOf({ system: false, mine: false }, tally)).toEqual({});
        expect(talliesApartOf({ system: true, mine: true }, tally)).toEqual({});
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
    // 4-seat hokm: seats 0 and 2 are one side, 1 and 3 the other; the recorder lists every other seat, partner included.
    const table = (seats: readonly string[], won: readonly number[]): RewardFinishPlayer[] => seats.map((userId, seat) => ({
        userId,
        seat,
        result: won.includes(seat) ? 'won' : 'lost',
        credit: won.includes(seat),
        ownTurns: 40,
        tally: { hands: 7, tricks: 30 },
        opponentIds: seats.filter((other) => other !== userId)
    }));
    const counts = (players: readonly RewardFinishPlayer[], established: readonly string[], friends: Record<string, string[]>) =>
        players.map((one) => countsForQuests({
            game: 'hokm',
            ...one,
            playerId: one.userId,
            establishedOpponents: established,
            friendOpponentIds: friends[one.userId] ?? []
        }));

    it('tells nothing when two established friends partner against two system players', () =>
    {
        const players = table(['ann', 'bot-a', 'ben', 'bot-b'], [0, 2]);

        expect(questPlayersOf(players, new Set(['bot-a', 'bot-b']))).toEqual([]);
    });

    it('tells nothing for a mixed match either', () =>
    {
        expect(questPlayersOf(table(['ann', 'bot-a', 'ben', 'cy'], [0, 2]), new Set(['bot-a']))).toEqual([]);
    });

    it('tells the same two people against two people exactly what it always did, partner as friend included', () =>
    {
        const players = table(['ann', 'cy', 'ben', 'dee'], [0, 2]);
        const told = questPlayersOf(players, new Set());

        expect(told).toEqual(players);
        expect(counts(told, ['ann', 'ben', 'cy', 'dee'], { ann: ['ben'], ben: ['ann'] })).toEqual([
            { played: 1, won: 1, 'played-with-friend': 1, 'tally:hands': 7, 'tally:tricks': 30 },
            { played: 1, 'tally:hands': 7, 'tally:tricks': 30 },
            { played: 1, won: 1, 'played-with-friend': 1, 'tally:hands': 7, 'tally:tricks': 30 },
            { played: 1, 'tally:hands': 7, 'tally:tricks': 30 }
        ]);
    });
});

describe('a win streak', () =>
{
    const people = { system: false, mine: false };
    const withSystem = { system: true, mine: false };

    it('moves as before in a match among people', () =>
    {
        expect([streakOf(4, 'add', people), streakOf(4, 'reset', people), streakOf(4, 'keep', people)]).toEqual([5, 0, 4]);
    });

    it('neither grows nor breaks for a person in a match with a system seat', () =>
    {
        expect([streakOf(4, 'add', withSystem), streakOf(4, 'reset', withSystem), streakOf(4, 'keep', withSystem)]).toEqual([4, 4, 4]);
    });

    it('moves as usual for the system player itself', () =>
    {
        const mine = { system: true, mine: true };

        expect([streakOf(4, 'add', mine), streakOf(4, 'reset', mine)]).toEqual([5, 0]);
    });
});

describe('what achievements stand on', () =>
{
    const tallies = { moves: 148, captures: 11, checks: 2, checkmates: 1 };
    const row = { played: 30, won: 20, xp: 900, tallies, systemPlayed: 12, systemWon: 10, systemXp: 400, systemTallies: { moves: 100, captures: 11, checkmates: 1 } };
    const none = { ...row, systemPlayed: 0, systemWon: 0, systemXp: 0, systemTallies: {} };

    it('is a person\'s totals less their games with a system seat', () =>
    {
        expect(ownOf(row, false)).toEqual({ played: 18, won: 10, xp: 500, tallies: { moves: 48, captures: 0, checks: 2, checkmates: 0 } });
        expect(ownOf(none, false)).toEqual({ played: 30, won: 20, xp: 900, tallies });
    });

    it('leaves a person no tally when every game behind it had a system seat', () =>
    {
        expect(Object.values(ownOf({ ...row, systemTallies: tallies }, false).tallies).every((value) => value === 0)).toBe(true);
    });

    it('is a system player\'s plain totals', () =>
    {
        expect(ownOf(none, true)).toEqual({ played: 30, won: 20, xp: 900, tallies });
        expect(ownOf(row, true).tallies).toEqual(tallies);
    });

    it('leaves out matches with a system seat for a person only', () =>
    {
        expect(ownMatches('m.id', false)).toMatch(/^not exists .*system_players/s);
        expect(ownMatches('m.id', true)).toBe('true');
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

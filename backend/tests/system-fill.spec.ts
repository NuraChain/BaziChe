import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import {
    AFTER_LEAST_MS,
    AFTER_MOST_MS,
    ALONE_LEAST_MS,
    ALONE_MOST_MS,
    STALL_MS,
    afterDelay,
    aloneDelay,
    fillable,
    standUps,
    startsWith,
    systemChairFor,
    waitingSince,
    type Board,
    type Chair
} from '../src/domains/system/fill.ts';
import { SYSTEM_DEFAULTS, type SystemConfig } from '../src/domains/system/rules.ts';

const NOW = 1_800_000_000_000;

const ON: SystemConfig = { ...SYSTEM_DEFAULTS, on: true, wait: 20 };

const empty = (seat: number): Chair => ({ seat, user: null, invited: false, ready: false, joined: null, system: false, retired: false });

const person = (seat: number, user: string, joined = NOW - 30_000, ready = true): Chair =>
    ({ seat, user, invited: false, ready, joined, system: false, retired: false });

const bot = (seat: number, user: string, joined = NOW - 5_000, ready = true): Chair =>
    ({ seat, user, invited: false, ready, joined, system: true, retired: false });

const boardOf = (chairs: Chair[], more: Partial<Board> = {}): Board => ({
    id: '6b1f0c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    game: 'backgammon',
    seats: chairs.length,
    teams: false,
    available: true,
    open: true,
    public: true,
    quick: true,
    humansOnly: false,
    staked: false,
    tournament: false,
    live: false,
    started: null,
    finished: null,
    now: NOW,
    chairs,
    agent: true,
    stood: null,
    alone: null,
    ...more
});

const everyone = new Set(['ann', 'bob', 'cy']);

describe('when a table may be filled', () =>
{
    it('fills a free chair once a ready, present person has waited long enough', () =>
    {
        expect(fillable(ON, boardOf([person(0, 'ann'), empty(1)]), everyone)).toBe(true);
    });

    it('waits until the wait has passed', () =>
    {
        expect(fillable(ON, boardOf([person(0, 'ann', NOW - 19_000), empty(1)]), everyone)).toBe(false);
        expect(fillable(ON, boardOf([person(0, 'ann', NOW - 20_000), empty(1)]), everyone)).toBe(true);
    });

    it('measures the wait from the person waiting longest', () =>
    {
        const board = boardOf([person(0, 'ann', NOW - 25_000), person(1, 'bob', NOW - 2_000), empty(2), empty(3)]);

        expect(waitingSince(board)).toBe(NOW - 25_000);
        expect(fillable(ON, board, everyone)).toBe(true);
    });

    it('fills nothing while any person seated is not ready, since the table could not start', () =>
    {
        const board = boardOf([person(0, 'ann'), person(1, 'bob', NOW - 30_000, false), empty(2), empty(3)]);

        expect(waitingSince(board)).toBeNull();
        expect(fillable(ON, board, everyone)).toBe(false);
    });

    it('starts the wait afresh after a system player stood up from the table', () =>
    {
        const board = boardOf([person(0, 'ann', NOW - 600_000), empty(1)], { stood: NOW - 19_000 });

        expect(waitingSince(board)).toBe(NOW - 19_000);
        expect(fillable(ON, board, everyone)).toBe(false);
        expect(fillable(ON, { ...board, stood: NOW - 20_000 }, everyone)).toBe(true);
    });

    it('fills only a game that has an agent, whatever the settings say', () =>
    {
        expect(fillable(ON, boardOf([person(0, 'ann'), empty(1)], { agent: false }), everyone)).toBe(false);
    });

    it('measures the wait from the end of the last game for somebody who stayed on', () =>
    {
        const board = boardOf([person(0, 'ann', NOW - 600_000), empty(1)], { started: NOW - 300_000, finished: NOW - 10_000 });

        expect(waitingSince(board)).toBe(NOW - 10_000);
        expect(fillable(ON, board, everyone)).toBe(false);
    });

    it('does not fill when people already took every chair', () =>
    {
        expect(fillable(ON, boardOf([person(0, 'ann'), person(1, 'bob')]), everyone)).toBe(false);
    });

    it('needs a ready person who is here, and never seats beside system players alone', () =>
    {
        expect(fillable(ON, boardOf([person(0, 'ann', NOW - 30_000, false), empty(1)]), everyone)).toBe(false);
        expect(fillable(ON, boardOf([person(0, 'ann'), empty(1)]), new Set())).toBe(false);
        expect(fillable(ON, boardOf([bot(0, 'sys'), empty(1), empty(2)]), everyone)).toBe(false);
    });

    it('keeps a human-only quick table waiting for people after any delay', () =>
    {
        expect(fillable(ON, boardOf([person(0, 'ann', NOW - 600_000), empty(1)], { humansOnly: true }), everyone)).toBe(false);
    });

    it('never fills a chair held for an invite', () =>
    {
        expect(fillable(ON, boardOf([person(0, 'ann'), { ...empty(1), invited: true }]), everyone)).toBe(false);
    });

    it('is off with the switch, with the game, or when the catalogue has paused the game', () =>
    {
        const board = boardOf([person(0, 'ann'), empty(1)]);

        expect(fillable({ ...ON, on: false }, board, everyone)).toBe(false);
        expect(fillable({ ...ON, games: { backgammon: false } }, board, everyone)).toBe(false);
        expect(fillable({ ...ON, games: { chess: false } }, board, everyone)).toBe(true);
        expect(fillable(ON, { ...board, available: false }, everyone)).toBe(false);
    });

    it('never fills a staked, tournament, private, non-quick, closed or playing table', () =>
    {
        const board = boardOf([person(0, 'ann'), empty(1)]);

        for (const more of [{ staked: true }, { tournament: true }, { public: false }, { quick: false }, { open: false }, { live: true }])
        {
            expect(fillable(ON, { ...board, ...more }, everyone)).toBe(false);
        }
    });
});

describe('which chair a system player takes', () =>
{
    it('takes the lowest free chair at an ordinary table', () =>
    {
        expect(systemChairFor(boardOf([empty(0), person(1, 'ann'), empty(2)]))).toBe(0);
    });

    it('skips a chair held for an invite', () =>
    {
        expect(systemChairFor(boardOf([person(0, 'ann'), { ...empty(1), invited: true }, empty(2)]))).toBe(2);
        expect(systemChairFor(boardOf([person(0, 'ann'), { ...empty(1), invited: true }]))).toBeNull();
    });

    it('at a teams table sits beside a lone person, keeping the other side for the next person', () =>
    {
        const board = boardOf([person(0, 'ann'), empty(1), empty(2), empty(3)], { teams: true });

        expect(systemChairFor(board)).toBe(2);
    });

    it('at a teams table fills the side people have not filled', () =>
    {
        const board = boardOf([person(0, 'ann'), empty(1), person(2, 'bob'), empty(3)], { teams: true });

        expect(systemChairFor(board)).toBe(1);
    });

    it('counts people, not system players, when choosing a side', () =>
    {
        const board = boardOf([person(0, 'ann'), bot(1, 'sys'), empty(2), empty(3)], { teams: true });

        expect(systemChairFor(board)).toBe(2);
    });
});

describe('when the game starts', () =>
{
    it('starts once the last chair is taken and every chair is ready', () =>
    {
        expect(startsWith(boardOf([person(0, 'ann'), bot(1, 'sys'), empty(2)]), 2)).toBe(true);
        expect(startsWith(boardOf([person(0, 'ann'), empty(1), empty(2)]), 2)).toBe(false);
        expect(startsWith(boardOf([person(0, 'ann', NOW - 30_000, false), empty(1)]), 1)).toBe(false);
    });
});

describe('when system players stand up', () =>
{
    it('stands them up one at a time when no person is left, each its own delay after the last', () =>
    {
        const chairs = [bot(0, 'a'), bot(1, 'b'), empty(2)];
        const alone = NOW - 60_000;
        const first = aloneDelay('6b1f0c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', 0, alone);

        expect(standUps(ON, boardOf(chairs)), 'not before the table was seen empty').toEqual([]);
        expect(standUps(ON, boardOf(chairs, { alone, now: alone + first - 1 }))).toEqual([]);
        expect(standUps(ON, boardOf(chairs, { alone, now: alone + first }))).toEqual([{ user: 'a', why: 'alone' }]);

        const stood = alone + first;
        const second = aloneDelay('6b1f0c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', 1, stood);
        const after = [empty(0), bot(1, 'b'), empty(2)];

        expect(standUps(ON, boardOf(after, { alone, stood, now: stood + second - 1 }))).toEqual([]);
        expect(standUps(ON, boardOf(after, { alone, stood, now: stood + second }))).toEqual([{ user: 'b', why: 'alone' }]);
    });

    it('keeps them seated once a person sits down again', () =>
    {
        expect(standUps(ON, boardOf([bot(0, 'a'), person(1, 'ann'), empty(2)], { alone: NOW - 600_000 }))).toEqual([]);
    });

    it('lets them go from a game with no agent', () =>
    {
        expect(standUps(ON, boardOf([person(0, 'ann'), bot(1, 'a'), empty(2)], { agent: false }))).toEqual([{ user: 'a', why: 'off' }]);
    });

    it('stands them up before the start when the switch or the game goes off', () =>
    {
        const board = boardOf([person(0, 'ann'), bot(1, 'a'), empty(2)]);

        expect(standUps({ ...ON, on: false }, board)).toEqual([{ user: 'a', why: 'off' }]);
        expect(standUps({ ...ON, games: { backgammon: false } }, board)).toEqual([{ user: 'a', why: 'off' }]);
        expect(standUps(ON, board)).toEqual([]);
    });

    it('never touches a game under way', () =>
    {
        expect(standUps({ ...ON, on: false }, boardOf([bot(0, 'a'), bot(1, 'b')], { live: true }))).toEqual([]);
    });

    it('lets go when a filled table has not started within a minute', () =>
    {
        const chairs = (filled: number) => [person(0, 'ann', NOW - 90_000, false), bot(1, 'a', filled)];

        expect(standUps(ON, boardOf(chairs(NOW - STALL_MS + 1)))).toEqual([]);
        expect(standUps(ON, boardOf(chairs(NOW - STALL_MS)))).toEqual([{ user: 'a', why: 'stalled' }]);
    });

    it('stands each up at its own moment 8 to 20 s after the game', () =>
    {
        const finished = NOW - 30_000;
        const after = { started: NOW - 200_000, finished };
        const chairs = [person(0, 'ann', NOW - 300_000, false), bot(1, 'a', NOW - 250_000, false), bot(2, 'b', NOW - 250_000, false)];
        const board = boardOf(chairs, after);
        const one = afterDelay(board.id, 1, finished);
        const two = afterDelay(board.id, 2, finished);

        expect(standUps(ON, { ...board, now: finished + Math.min(one, two) - 1 })).toEqual([]);
        expect(standUps(ON, { ...board, now: finished + Math.max(one, two) }).map((stood) => stood.why)).toEqual(['after', 'after']);
    });

    it('releases a player stranded at a partial table after its last seat change', () =>
    {
        const chairs = (since: number) => [person(0, 'ann', NOW - 120_000), bot(1, 'a', since), empty(2), empty(3)];
        expect(standUps(ON, boardOf(chairs(NOW - STALL_MS + 1)))).toEqual([]);
        expect(standUps(ON, boardOf(chairs(NOW - STALL_MS)))).toEqual([{ user: 'a', why: 'stalled' }]);
        expect(standUps(ON, boardOf(chairs(NOW - STALL_MS), { live: true }))).toEqual([]);
    });

    it('keeps a system player seated after the game was over', () =>
    {
        const board = boardOf([person(0, 'ann'), bot(1, 'a', NOW - 1_000), empty(2)], { started: NOW - 200_000, finished: NOW - 60_000 });

        expect(standUps(ON, board)).toEqual([]);
    });

    it('lets a retired one go', () =>
    {
        expect(standUps(ON, boardOf([person(0, 'ann'), { ...bot(1, 'a'), retired: true }, empty(2)]))).toEqual([{ user: 'a', why: 'retired' }]);
    });
});

describe('the delay when left alone', () =>
{
    it('stays in its window', () =>
    {
        for (let seat = 0; seat < 9; seat += 1)
        {
            const delay = aloneDelay('6b1f0c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', seat, NOW + seat * 911);

            expect(delay).toBeGreaterThanOrEqual(ALONE_LEAST_MS);
            expect(delay).toBeLessThanOrEqual(ALONE_MOST_MS);
        }
    });
});

describe('the delay after a game', () =>
{
    it('is the same for the same seat and finish, and stays in its window', () =>
    {
        const id = '6b1f0c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
        const seen = new Set<number>();

        for (let seat = 0; seat < 9; seat += 1)
        {
            for (let at = 0; at < 20; at += 1)
            {
                const delay = afterDelay(id, seat, NOW + at * 7_919.5);

                expect(delay).toBe(afterDelay(id, seat, NOW + at * 7_919.5));
                expect(delay).toBeGreaterThanOrEqual(AFTER_LEAST_MS);
                expect(delay).toBeLessThanOrEqual(AFTER_MOST_MS);
                seen.add(delay);
            }
        }

        expect(seen.size).toBeGreaterThan(50);
    });
});

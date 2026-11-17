import { describe, expect, it } from 'vitest';

import { AI_ENGINES } from '../src/domains/ai/agent.ts';
import type { Decided, Job } from '../src/domains/ai/agents.ts';
import { Dropped, createWorkerBrain, type Brain, type WorkerLike } from '../src/domains/ai/brain.ts';
import {
    BANK_SHARE,
    FORCED_MOST,
    LEAVE_LEAST,
    LEAVE_SPREAD,
    SAFETY_MS,
    THINK_LEAST,
    THINK_MOST,
    createAiRuntime,
    fallbackOf,
    stillIn,
    thinkBounds,
    thinkTime,
    whoActs,
    type Act,
    type AiRuntime,
    type Pace,
    type SeatRow,
    type Source,
    type Turn
} from '../src/domains/ai/runtime.ts';
import { hashOf, inputOf, seededRandom } from '../src/domains/ai/agent.ts';
import { createSeatLogs, follows, type Feed } from '../src/domains/ai/source.ts';
import type { MatchLog, MatchPlay } from '../src/schemas.ts';

const MATCH = '00000000-0000-4000-8000-000000000001';

const BOT = 'bot-user';

const PERSON = 'person-user';

const MOVE: MatchPlay = { kind: 'chess', verb: 'move', from: 12, to: 28 };

const settle = async () =>
{
    for (let round = 0; round < 5; round += 1)
    {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

function fakeClock()
{
    let at = 0;
    let made = 0;
    let timers: { at: number; id: number; run: () => void }[] = [];

    return {
        now: () => at,
        after(ms: number, run: () => void)
        {
            const timer = { at: at + ms, id: (made += 1), run };

            timers.push(timer);

            return () =>
            {
                timers = timers.filter((one) => one !== timer);
            };
        },
        async advance(ms: number)
        {
            const end = at + ms;

            await settle();

            for (;;)
            {
                const due = timers.filter((one) => one.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];

                if (due === undefined)
                {
                    break;
                }

                timers = timers.filter((one) => one !== due);
                at = due.at;
                due.run();
                await settle();
            }

            at = end;
            await settle();
        }
    };
}

const chessState = () => AI_ENGINES.chess.create([0, 1], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state;

const seatsOf = (bot: number, person: string | null = null): SeatRow[] => [0, 1].map((seat) => (seat === bot
    ? { seat, userId: BOT, result: null, system: { skill: 'intermediate', style: 10 } }
    : { seat, userId: PERSON, result: person, system: null }));

/** White (seat 0) to move in a fresh game; `bot` says which seat the system player holds. */
const chessTurn = (rev: number, bot = 0, extra: Partial<Turn> = {}): Turn => ({
    matchId: MATCH,
    game: 'chess',
    rev,
    format: { seats: 2, variant: 'standard' },
    state: { ...(chessState() as object), rev },
    finished: false,
    leftMs: 30_000,
    limitMs: 30_000,
    clock: false,
    seats: seatsOf(bot),
    ...extra
});

type Answer = 'now' | 'never' | 'fail';

function harness(answer: Answer = 'now', acted: (want: Parameters<Act>[2]) => Promise<'now' | 'already' | 'stale'> = async () => 'now')
{
    const clock = fakeClock();
    let turn: Turn | null = chessTurn(1);
    let due: { matchId: string; rev: number }[] = [];
    const jobs: Job[] = [];
    const sends: { userId: string; play: MatchPlay | null; rev: number; key: string }[] = [];
    let reads = 0;

    const source: Source = {
        turnAt: async () =>
        {
            reads += 1;

            return turn;
        },
        hidden: async () => null,
        due: async () => due
    };

    const brain: Brain = {
        decide: (job: Job, live: () => boolean) =>
        {
            if (!live())
            {
                return Promise.reject(new Dropped('moved on'));
            }

            jobs.push(job);

            if (answer === 'never')
            {
                return new Promise<Decided>(() => undefined);
            }

            return answer === 'fail' ? Promise.reject(new Error('worker died')) : Promise.resolve({ play: MOVE, ms: 12 });
        },
        stop: async () => undefined
    };

    const act: Act = async (userId, _matchId, want) =>
    {
        sends.push({ userId, ...want });

        return await acted(want);
    };

    const runtime = createAiRuntime({ source, act, brain, clock, salt: 99 });

    return {
        clock,
        runtime,
        jobs,
        sends,
        reads: () => reads,
        set: (next: Turn | null) =>
        {
            turn = next;
        },
        due: (next: { matchId: string; rev: number }[]) =>
        {
            due = next;
        },
        start: async () =>
        {
            await runtime.drive(0);
        }
    };
}

describe('the AI runtime', () =>
{
    it('does nothing until its first sweep switches it on', async () =>
    {
        const h = harness();

        h.runtime.moved(MATCH);
        await h.clock.advance(20_000);

        expect(h.reads()).toBe(0);
        expect(h.sends).toEqual([]);
    });

    it('sends the decision as the system player after the think time, keyed by the revision', async () =>
    {
        const h = harness();

        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(THINK_LEAST - 1);

        expect(h.jobs).toHaveLength(1);
        expect(h.sends).toEqual([]);

        await h.clock.advance(THINK_MOST);

        expect(h.sends).toEqual([{ userId: BOT, play: MOVE, rev: 1, key: 'ai:1' }]);
        expect(h.runtime.figures()).toMatchObject({ decisions: 1, averageMs: 12, worstMs: 12, fallbacks: 0, errors: [] });
    });

    it('keeps one decision per match in flight', async () =>
    {
        const h = harness();

        await h.start();
        h.runtime.moved(MATCH);
        h.runtime.moved(MATCH);
        await h.clock.advance(100);
        h.runtime.moved(MATCH);
        await h.clock.advance(20_000);

        expect(h.jobs).toHaveLength(1);
        expect(h.sends).toHaveLength(1);
    });

    it('drops a decision when the match moves on before it is sent', async () =>
    {
        const h = harness();

        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(300);

        // The person's turn now: nothing is sent for revision 1.
        h.set(chessTurn(2, 1));
        h.runtime.moved(MATCH);
        await h.clock.advance(20_000);

        expect(h.sends).toEqual([]);

        // The system player's turn again at revision 3: one move, for revision 3.
        h.set(chessTurn(3));
        h.runtime.moved(MATCH);
        await h.clock.advance(20_000);

        expect(h.sends.map((one) => one.key)).toEqual(['ai:3']);
    });

    it('plays the fallback when no decision arrives in time', async () =>
    {
        const h = harness('never');

        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(30_000 - SAFETY_MS);

        expect(h.sends).toEqual([{ userId: BOT, play: fallbackOf('chess', chessTurn(1).state, 0), rev: 1, key: 'ai:1' }]);
        expect((h.sends[0].play as { verb: string }).verb).toBe('move');
        expect(h.runtime.figures().fallbacks).toBe(1);
    });

    it('plays the fallback and counts an error when the decision fails', async () =>
    {
        const h = harness('fail');

        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(20_000);

        expect(h.sends).toHaveLength(1);
        expect(h.runtime.figures()).toMatchObject({ fallbacks: 1 });
        expect(h.runtime.figures().errors.map((one) => one.message)).toEqual(['worker died']);
    });

    it('plays the fallback when the engine refuses the decision', async () =>
    {
        const h = harness('now', async (want) =>
        {
            if (want.play === MOVE)
            {
                throw new Error('That move is not allowed.');
            }

            return 'now';
        });

        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(20_000);

        expect(h.sends.map((one) => one.play)).toEqual([MOVE, fallbackOf('chess', chessTurn(1).state, 0)]);
        expect(h.runtime.figures().fallbacks).toBe(1);
        expect(h.runtime.figures().errors).toHaveLength(1);
    });

    it('drops a stale or already-applied move without an error', async () =>
    {
        const h = harness('now', async () => 'stale');

        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(20_000);

        expect(h.sends).toHaveLength(1);
        expect(h.runtime.figures().errors).toEqual([]);
    });

    it('gives up a system seat once no person is left playing', async () =>
    {
        const h = harness();

        h.set(chessTurn(4, 1, { seats: seatsOf(1, 'abandoned') }));
        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(LEAVE_LEAST - 1);

        expect(h.sends).toEqual([]);

        await h.clock.advance(LEAVE_SPREAD + 1);

        expect(h.jobs).toEqual([]);
        expect(h.sends).toEqual([{ userId: BOT, play: null, rev: 4, key: 'ai:4' }]);
    });

    it('with no person left, each system seat leaves at its own time and plays its turns until then', async () =>
    {
        const clock = fakeClock();
        const bots = [0, 1, 2, 3];
        const left: { seat: number; at: number }[] = [];
        let moves = 0;
        let runtime: AiRuntime | null = null;
        let turn: Turn = chessTurn(1, 0, {
            seats: [
                ...bots.map((seat): SeatRow => ({ seat, userId: `bot-${ seat }`, result: null, system: { skill: 'intermediate', style: seat } })),
                { seat: 4, userId: PERSON, result: 'abandoned', system: null }
            ]
        });

        const source: Source = { turnAt: async () => turn, hidden: async () => null, due: async () => [] };
        const brain: Brain = { decide: async () => ({ play: MOVE, ms: 5 }), stop: async () => undefined };

        const act: Act = async (userId, _matchId, want) =>
        {
            const seat = Number(userId.slice(4));

            if (want.play === null)
            {
                left.push({ seat, at: clock.now() });
            }
            else
            {
                moves += 1;
            }

            turn = {
                ...turn,
                rev: turn.rev + 1,
                state: { ...(turn.state as object), rev: turn.rev + 1 },
                seats: turn.seats.map((row) => (row.seat === seat && want.play === null ? { ...row, result: 'left' } : row))
            };
            runtime?.moved(MATCH);

            return 'now';
        };

        runtime = createAiRuntime({ source, act, brain, clock, salt: 7 });
        await runtime.drive(0);
        runtime.moved(MATCH);
        await clock.advance(30_000);

        const times = left.map((one) => one.at);

        expect(left.map((one) => one.seat).sort()).toEqual(bots);
        expect(Math.min(...times)).toBeGreaterThanOrEqual(LEAVE_LEAST);
        expect(Math.max(...times)).toBeLessThanOrEqual(LEAVE_LEAST + LEAVE_SPREAD);
        expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(2_000);
        expect(new Set(times).size).toBe(bots.length);
        expect(moves).toBeGreaterThan(0);
    });

    it('a cancelled decision that finishes late does not free the slot a newer one is sending from', async () =>
    {
        const clock = fakeClock();
        let turn: Turn = chessTurn(1);
        let calls = 0;
        let answer: (decided: Decided) => void = () => undefined;
        let release: () => void = () => undefined;
        const sends: number[] = [];

        const source: Source = { turnAt: async () => turn, hidden: async () => null, due: async () => [{ matchId: MATCH, rev: turn.rev }] };

        const brain: Brain = {
            decide: () =>
            {
                calls += 1;

                return calls === 1 ? new Promise<Decided>((resolve) => { answer = resolve; }) : Promise.resolve({ play: MOVE, ms: 5 });
            },
            stop: async () => undefined
        };

        const act: Act = async (_userId, _matchId, want) =>
        {
            sends.push(want.rev);
            await new Promise<void>((resolve) => { release = resolve; });

            return 'now';
        };

        const runtime = createAiRuntime({ source, act, brain, clock, salt: 99 });
        const delay = thinkTime({ game: 'chess', choices: 20, leftMs: 30_000, limitMs: 30_000, clock: false, random: seededRandom(hashOf(`99:${ MATCH }:1:0`)), last: null });

        await runtime.drive(0);
        runtime.moved(MATCH);

        // Rev 1's think time is over and it waits on a slow decision; then someone else's action moves the match on.
        await clock.advance(delay);
        turn = chessTurn(2, 0, { leftMs: 2_500 });
        runtime.moved(MATCH);
        await clock.advance(600);

        expect(sends).toEqual([2]);

        answer({ play: MOVE, ms: 5 });
        await clock.advance(0);

        expect(runtime.busy(MATCH)).toBe(true);

        await runtime.drive(1_000);

        expect(sends).toEqual([2]);

        release();
        await clock.advance(0);

        expect(runtime.busy(MATCH)).toBe(false);
    });

    it('counts a system seat that reached its deadline as an error, and still moves', async () =>
    {
        const h = harness();

        h.set(chessTurn(1, 0, { leftMs: -50 }));
        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(1_000);

        expect(h.runtime.figures().errors.map((one) => one.message)).toEqual(['A system seat reached its turn deadline.']);
        expect(h.sends).toHaveLength(1);
    });

    it('the sweep schedules what nothing scheduled, and does not read a match again at a revision it already found idle', async () =>
    {
        const h = harness();

        h.due([{ matchId: MATCH, rev: 1 }]);
        await h.runtime.drive(1_000);

        expect(h.runtime.busy(MATCH)).toBe(true);
        expect(h.reads()).toBe(1);

        await h.clock.advance(20_000);
        expect(h.sends).toHaveLength(1);

        h.set(chessTurn(2, 1));
        h.due([{ matchId: MATCH, rev: 2 }]);
        await h.runtime.drive(1_000);
        await h.runtime.drive(1_000);

        expect(h.reads()).toBe(2);
        expect(h.runtime.busy(MATCH)).toBe(false);
    });

    it('stops: nothing scheduled is sent', async () =>
    {
        const h = harness();

        await h.start();
        h.runtime.moved(MATCH);
        await h.clock.advance(100);
        await h.runtime.stop();
        await h.clock.advance(20_000);

        expect(h.sends).toEqual([]);
    });
});

describe('the seat logs of a hidden game', () =>
{
    const pokerState = () => AI_ENGINES.poker.create([0, 1, 2], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state;

    /** A match whose history grows one action at a time; `hole` drops one revision from the next incremental read. */
    function fakeMatch(game = 'poker')
    {
        const state = pokerState();
        let rev = 1;
        let read = 0;
        let hole: number | null = null;
        const asked: number[] = [];

        const entryOf = (at: number, reader: number | null) => ({
            rev: at,
            seat: at === 1 ? -1 : at % 3,
            log: [{ text: `${ at } for ${ reader }` }] as unknown as MatchLog
        });

        const feed: Feed = async (_matchId, since) =>
        {
            asked.push(since);

            const revs = Array.from({ length: rev - since }, (_, at) => since + 1 + at).filter((at) => since === 0 || at !== hole);

            hole = null;
            read += revs.length;

            return { load: { match: { rev, game }, state }, events: (reader) => revs.map((at) => entryOf(at, reader)) };
        };

        const full = (seat: number) => inputOf(game, state, seat, (reader) => Array.from({ length: rev }, (_, at) => entryOf(at + 1, reader)));

        return {
            feed,
            full,
            asked,
            read: () => read,
            step: (by = 1) =>
            {
                rev += by;
            },
            rev: () => rev,
            hole: (at: number) =>
            {
                hole = at;
            }
        };
    }

    it('hands an agent the same input as a full read, at every revision, reading each action once', async () =>
    {
        const match = fakeMatch();
        const logs = createSeatLogs(match.feed);

        for (let step = 0; step < 40; step += 1)
        {
            expect(await logs.read(MATCH, match.rev(), 1)).toEqual(match.full(1));
            match.step(1 + (step % 3));
        }

        expect(match.asked[0]).toBe(0);
        expect(match.asked.slice(1).every((since) => since > 0)).toBe(true);
        expect(match.read()).toBe(match.rev() - (1 + (39 % 3)));
    });

    it('keeps each seat apart: two seats of one match see their own logs', async () =>
    {
        const match = fakeMatch();
        const logs = createSeatLogs(match.feed);

        for (let step = 0; step < 5; step += 1)
        {
            expect(await logs.read(MATCH, match.rev(), 0)).toEqual(match.full(0));
            expect(await logs.read(MATCH, match.rev(), 2)).toEqual(match.full(2));
            match.step();
        }

        expect(match.full(0)).not.toEqual(match.full(2));
    });

    it('rebuilds from nothing on a hole in what is newer', async () =>
    {
        const match = fakeMatch();
        const logs = createSeatLogs(match.feed);

        await logs.read(MATCH, match.rev(), 1);
        match.step(4);
        match.hole(match.rev() - 1);

        expect(await logs.read(MATCH, match.rev(), 1)).toEqual(match.full(1));
        expect(match.asked).toEqual([0, 1, 0]);

        match.step();

        expect(await logs.read(MATCH, match.rev(), 1)).toEqual(match.full(1));
        expect(match.asked.at(-1)).toBe(5);
    });

    it('answers null once the match is past the revision asked, and keeps what it built', async () =>
    {
        const match = fakeMatch();
        const logs = createSeatLogs(match.feed);

        match.step(3);
        await logs.read(MATCH, match.rev(), 1);

        const reads = match.asked.length;

        expect(await logs.read(MATCH, match.rev() - 1, 1)).toBeNull();
        expect(match.asked.length).toBe(reads);

        match.step();

        expect(await logs.read(MATCH, match.rev() - 1, 1)).toBeNull();
        expect(await logs.read(MATCH, match.rev(), 1)).toEqual(match.full(1));
    });

    it('holds a bounded number of matches and forgets the ones that ended', async () =>
    {
        const match = fakeMatch();
        const logs = createSeatLogs(match.feed, 2);
        const ids = ['m-1', 'm-2', 'm-3'];

        for (const id of ids)
        {
            await logs.read(id, match.rev(), 0);
        }

        expect(logs.held()).toBe(2);

        logs.keepOnly(new Set(['m-3']));
        expect(logs.held()).toBe(1);

        logs.forget('m-3');
        expect(logs.held()).toBe(0);
    });

    it('never keeps an open game', async () =>
    {
        const match = fakeMatch('chess');
        const logs = createSeatLogs(match.feed);

        expect(await logs.read(MATCH, match.rev(), 0)).toBeNull();
        expect(logs.held()).toBe(0);
    });

    it('needs every revision once, and nothing missing', () =>
    {
        expect(follows(3, 3, [])).toBe(true);
        expect(follows(3, 5, [{ rev: 4 }, { rev: 5 }])).toBe(true);
        expect(follows(3, 5, [{ rev: 5 }])).toBe(false);
        expect(follows(3, 5, [{ rev: 4 }, { rev: 6 }])).toBe(false);
    });
});

describe('who the runtime acts for', () =>
{
    it('the system player to move, nobody when a person is to move, and a system seat to leave once no person is left', () =>
    {
        expect(whoActs(chessTurn(1, 0))).toMatchObject({ mover: { seat: 0, userId: BOT }, alone: [] });
        expect(whoActs(chessTurn(1, 1))).toBeNull();
        expect(whoActs(chessTurn(1, 1, { seats: seatsOf(1, 'abandoned') }))).toMatchObject({ mover: null, alone: [{ seat: 1 }] });
        expect(whoActs(chessTurn(1, 0, { seats: seatsOf(0, 'abandoned') }))).toMatchObject({ mover: { seat: 0 }, alone: [{ seat: 0 }] });
        expect(whoActs(chessTurn(1, 0, { finished: true }))).toBeNull();
    });

    it('reads a poker seat that went broke, and a ludo or hokm seat that is out, as no longer playing', () =>
    {
        expect(stillIn('poker', { out: [false, true] }, 1)).toBe(false);
        expect(stillIn('poker', { out: [false, true] }, 0)).toBe(true);
        expect(stillIn('hokm', { out: [true, false] }, 0)).toBe(false);
        expect(stillIn('ludo', { players: [{ seat: 2, out: true }] }, 2)).toBe(false);
        expect(stillIn('chess', {}, 0)).toBe(true);
    });
});

describe('think time', () =>
{
    const base = { game: 'chess', choices: 20, leftMs: 30_000, limitMs: 30_000, clock: false, last: null };

    it('stays between its bounds, a third of the turn and two seconds before the deadline', () =>
    {
        const random = seededRandom(5);

        for (let run = 0; run < 2000; run += 1)
        {
            const leftMs = 2_000 + Math.floor(random() * 60_000);
            const ms = thinkTime({ ...base, game: ['chess', 'hokm', 'poker', 'ludo', 'backgammon'][run % 5], choices: 2 + (run % 30), leftMs, limitMs: leftMs, random });

            expect(ms).toBeLessThanOrEqual(leftMs - SAFETY_MS);
            expect(ms).toBeLessThanOrEqual(Math.max(THINK_LEAST, Math.min(THINK_MOST, leftMs / 3)) + 40);

            if (leftMs >= 3 * THINK_LEAST + SAFETY_MS)
            {
                expect(ms).toBeGreaterThanOrEqual(THINK_LEAST - 40);
            }
        }
    });

    it('is quick for a forced move', () =>
    {
        const random = seededRandom(9);

        for (let run = 0; run < 500; run += 1)
        {
            const ms = thinkTime({ ...base, choices: run % 2, random });

            expect(ms).toBeGreaterThanOrEqual(THINK_LEAST - 40);
            expect(ms).toBeLessThanOrEqual(FORCED_MOST);
        }
    });

    it('is never the same interval twice running', () =>
    {
        let last: number | null = null;

        for (let run = 0; run < 500; run += 1)
        {
            // A random that always says the same thing would otherwise give the same time every turn.
            const ms = thinkTime({ ...base, random: () => 0.5, last });

            expect(ms).not.toBe(last);
            last = ms;
        }

        // And at a bound too.
        last = null;

        for (let run = 0; run < 50; run += 1)
        {
            const ms = thinkTime({ ...base, random: () => 0.99, last, leftMs: 4_000, limitMs: 4_000 });

            expect(ms).not.toBe(last);
            expect(ms).toBeLessThanOrEqual(4_000 - SAFETY_MS);
            last = ms;
        }
    });

    it('always leaves two seconds before the deadline, and sends at once when there are not two seconds left', () =>
    {
        expect(thinkTime({ ...base, leftMs: 2_500, limitMs: 30_000, random: () => 0.9 })).toBeLessThanOrEqual(500);
        expect(thinkTime({ ...base, leftMs: 1_500, limitMs: 30_000, random: () => 0.9 })).toBe(0);
        expect(thinkTime({ ...base, leftMs: -100, limitMs: 30_000, random: () => 0.9 })).toBe(0);
    });

    it('takes a fraction of a chess bank', () =>
    {
        expect(thinkTime({ ...base, leftMs: 60_000, limitMs: 60_000, clock: true, random: () => 0.99 })).toBeLessThanOrEqual(60_000 * BANK_SHARE);
        expect(thinkTime({ ...base, leftMs: 9_000, limitMs: 9_000, clock: true, random: () => 0.99 })).toBeLessThanOrEqual(9_000 * BANK_SHARE);
    });

    it('waits out what the boards are holding before the turn\'s own time', () =>
    {
        expect(thinkTime({ ...base, leftMs: 31_500, limitMs: 30_000, random: () => 0 })).toBeGreaterThanOrEqual(1_500 + THINK_LEAST);
    });

    it('draws inside its bounds, and no one interval takes more than 2 percent of the draws', () =>
    {
        const shapes: Omit<Pace, 'random' | 'last'>[] = [
            { game: 'ludo', choices: 1, leftMs: 15_000, limitMs: 15_000, clock: false },
            { game: 'ludo', choices: 2, leftMs: 15_000, limitMs: 15_000, clock: false },
            { game: 'ludo', choices: 4, leftMs: 15_000, limitMs: 15_000, clock: false },
            { game: 'chess', choices: 1, leftMs: 60_000, limitMs: 60_000, clock: true },
            { game: 'chess', choices: 30, leftMs: 300_000, limitMs: 300_000, clock: true },
            { game: 'chess', choices: 30, leftMs: 180_000, limitMs: 180_000, clock: true },
            { game: 'chess', choices: 30, leftMs: 60_000, limitMs: 60_000, clock: true },
            { game: 'chess', choices: 25, leftMs: 30_000, limitMs: 30_000, clock: false },
            { game: 'hokm', choices: 5, leftMs: 20_000, limitMs: 20_000, clock: false },
            { game: 'poker', choices: 3, leftMs: 21_500, limitMs: 20_000, clock: false },
            { game: 'backgammon', choices: 12, leftMs: 30_000, limitMs: 30_000, clock: false }
        ];

        for (const shape of shapes)
        {
            const { least, most } = thinkBounds(shape);
            const counts = new Map<number, number>();
            let last: number | null = null;

            for (let draw = 0; draw < 2_000; draw += 1)
            {
                const ms = thinkTime({ ...shape, random: seededRandom(hashOf(`${ shape.game }:${ shape.choices }:${ shape.leftMs }:${ draw }`)), last });

                expect(ms).toBeGreaterThanOrEqual(least);
                expect(ms).toBeLessThanOrEqual(most);
                counts.set(ms, (counts.get(ms) ?? 0) + 1);
                last = ms;
            }

            expect(Math.max(...counts.values()), `${ shape.game } ${ shape.choices } ${ shape.leftMs }`).toBeLessThanOrEqual(2_000 * 0.02);
        }
    });
});

describe('the decision worker pool', () =>
{
    type Behaviour = 'answer' | 'silent' | 'die';

    function fakeWorkers(behaviours: Behaviour[])
    {
        const made: { terminated: boolean }[] = [];

        const spawn = (): WorkerLike =>
        {
            const behaviour = behaviours[made.length] ?? 'answer';
            const listeners: Record<string, ((value: never) => void)[]> = {};
            const record = { terminated: false };

            made.push(record);

            const emit = (event: string, value: unknown) => listeners[event]?.forEach((listener) => listener(value as never));

            return {
                postMessage: (message: unknown) =>
                {
                    const { id } = message as { id: number };

                    if (behaviour === 'answer')
                    {
                        setImmediate(() => emit('message', { id, play: MOVE, ms: 3 }));
                    }

                    if (behaviour === 'die')
                    {
                        setImmediate(() => emit('exit', 1));
                    }
                },
                on: (event: string, listener: (value: never) => void) =>
                {
                    (listeners[event] ??= []).push(listener);
                },
                terminate: async () =>
                {
                    record.terminated = true;

                    return 0;
                }
            } as WorkerLike;
        };

        return { spawn, made };
    }

    const job: Job = { game: 'chess', seat: 0, format: { seats: 2, variant: 'standard' }, input: null, skill: 'casual', style: 0, seed: 1, budget: 5 };

    it('makes a new worker when one dies', async () =>
    {
        const workers = fakeWorkers(['die', 'answer']);
        const brain = createWorkerBrain({ spawn: workers.spawn, graceMs: 50 });

        await expect(brain.decide(job, () => true)).rejects.toThrow(/stopped/);
        await expect(brain.decide(job, () => true)).resolves.toEqual({ play: MOVE, ms: 3 });
        expect(workers.made).toHaveLength(2);
        await brain.stop();
    });

    it('ends a worker that runs past the hard limit, and carries on with a new one', async () =>
    {
        const workers = fakeWorkers(['silent', 'answer']);
        const brain = createWorkerBrain({ spawn: workers.spawn, graceMs: 10 });

        await expect(brain.decide(job, () => true)).rejects.toThrow(/past its time/);
        expect(workers.made[0].terminated).toBe(true);
        await expect(brain.decide(job, () => true)).resolves.toMatchObject({ play: MOVE });
        await brain.stop();
    });

    it('refuses past a full queue, and drops a job whose match moved on', async () =>
    {
        const workers = fakeWorkers(['silent']);
        const brain = createWorkerBrain({ spawn: workers.spawn, graceMs: 60_000, queueMost: 1, workersMost: 1 });
        const first = brain.decide(job, () => true);
        const second = brain.decide(job, () => false);

        await expect(brain.decide(job, () => true)).rejects.toThrow(/queue is full/);
        await brain.stop();
        await expect(first).rejects.toBeInstanceOf(Dropped);
        await expect(second).rejects.toBeInstanceOf(Dropped);
    });

    it('starts with one worker and adds more only while jobs are waiting, up to its cap', async () =>
    {
        const workers = fakeWorkers([]);
        const brain = createWorkerBrain({ spawn: workers.spawn, graceMs: 60_000, workersMost: 2 });

        await expect(brain.decide(job, () => true)).resolves.toMatchObject({ play: MOVE });
        expect(workers.made).toHaveLength(1);

        const all = await Promise.all([1, 2, 3, 4].map(async () => await brain.decide(job, () => true)));

        expect(all.every((decided) => decided.play === MOVE)).toBe(true);
        expect(workers.made).toHaveLength(2);
        await brain.stop();
        expect(workers.made.every((one) => one.terminated)).toBe(true);
    });

    it('runs a real decision in a real worker from the sources', async () =>
    {
        const brain = createWorkerBrain();
        const decided = await brain.decide({ ...job, input: chessState(), budget: 1_000 }, () => true);

        expect((decided.play as { verb: string }).verb).toBe('move');
        await brain.stop();
    });
});

import { describe, expect, it } from 'vitest';

import { MARGIN, hashOf, playOf, seededRandom, type Agent, type Ask } from '../src/domains/ai/agent.ts';
import { backgammonAgent } from '../src/domains/ai/backgammon/agent.ts';
import { tableOf } from '../src/domains/ai/backgammon/cube.ts';
import { positionsAfter } from '../src/domains/ai/backgammon/position.ts';
import { PLANS, choose } from '../src/domains/ai/backgammon/search.ts';
import { BAR, OFF, facing, keyOf, pips } from '../src/domains/match/backgammon/board.ts';
import { sideOf } from '../src/domains/match/backgammon/engine.ts';
import { settle, turns } from '../src/domains/match/backgammon/moves.ts';
import type { BackgammonAction, BackgammonState } from '../src/domains/match/backgammon/state.ts';
import type { Draws, TableConfig } from '../src/domains/match/engine.ts';
import { backgammonEngine as engine } from '../src/domains/match/engines/backgammon.ts';
import { SKILLS, type Skill } from '../src/domains/system/rules.ts';
import type { MatchPlay } from '../src/schemas.ts';

/** The xorshift `Draws` the other agent specs play with. */
function seeded(seed: number): { draws: Draws; next: () => number }
{
    let state = (seed * 2654435761) >>> 0 || 1;

    const next = () =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;

        return (state >>> 0) / 4294967296;
    };

    return { draws: { die: (sides) => 1 + Math.floor(next() * sides) }, next };
}

/** The stage-1 baseline, kept here as the opponent the real strategy has to beat. */
const baseline: Agent<BackgammonState> = (() =>
{
    const NO_DRAWS = { die: () => 1 };
    const DOUBLE_LEAD = 0.12;
    const TAKE_BEHIND = 0.2;

    const scoreOf = (state: BackgammonState, seat: number) =>
    {
        const me = state.checkers[seat];
        const them = state.checkers[1 - seat];
        let score = (pips(them) - pips(me)) + me[OFF] * 6 - them[OFF] * 6 + them[BAR] * 12 - me[BAR] * 12;

        for (let point = 1; point < BAR; point += 1)
        {
            if (me[point] >= 2)
            {
                score += point <= 6 ? 4 : 2;
            }

            if (me[point] === 1)
            {
                const exposed = them.some((count, from) => count > 0 && from > facing(point) && from !== OFF);

                score -= exposed ? 6 + (BAR - point) / 4 : 1;
            }
        }

        return score;
    };

    const decide = (ask: Ask<BackgammonState>) =>
    {
        const state = ask.input;
        const seat = ask.seat;
        const legal = engine.legal(state, seat);

        if (legal.length === 0)
        {
            return null;
        }

        const kinds = new Set(legal.map((one) => one.kind));
        const race = (mine: number, theirs: number) => (theirs - mine) / Math.max(1, theirs);
        const lead = race(pips(state.checkers[seat]), pips(state.checkers[1 - seat]));

        if (kinds.has('take'))
        {
            return playOf('backgammon', { kind: lead >= -TAKE_BEHIND ? 'take' : 'drop', seat });
        }

        if (kinds.has('roll'))
        {
            return playOf('backgammon', { kind: kinds.has('double') && lead >= DOUBLE_LEAD ? 'double' : 'roll', seat });
        }

        const scored: { move: BackgammonAction; score: number }[] = [];

        for (const move of legal)
        {
            const after = engine.apply(state, move, NO_DRAWS);

            if (after.ok)
            {
                const won = after.state.winner === seat || after.state.score[seat] > state.score[seat];

                scored.push({ move, score: won ? 10_000 : scoreOf(after.state, seat) });
            }
        }

        if (scored.length === 0)
        {
            return playOf('backgammon', legal[0]);
        }

        const best = Math.max(...scored.map((one) => one.score));
        const near = scored.filter((one) => one.score >= best - MARGIN[ask.skill] * 20);

        return playOf('backgammon', (near[Math.floor(ask.random() * near.length)] ?? scored[0]).move);
    };

    return { id: 'backgammon', version: 1, decide };
})();

const FORMAT = engine.formats[0];

const tableOfMatch = (target: number, cube: boolean): TableConfig => ({ target, cube, blinds: 'low', variant: 'standard' });

const askOf = (state: BackgammonState, seat: number, skill: Skill, style: number, seed: number): Ask<BackgammonState> => ({
    seat,
    format: FORMAT,
    input: state,
    skill,
    style,
    random: seededRandom(hashOf(`bg:${ seed }`)),
    spent: () => 0,
    budget: 3000
});

type Player = (state: BackgammonState, seat: number, step: number) => MatchPlay | null;

const playerOf = (agent: Agent<BackgammonState>, skill: Skill, style: number): Player =>
    (state, seat, step) => agent.decide(askOf(state, seat, skill, style, step * 7919 + seat));

interface Played
{
    winner: number;
    score: number[];
    actions: number;
    verbs: Set<string>;
}

/** One whole match, every play through the engine's own `parse` and `apply`, refused plays failing the spec. */
function playMatch(players: readonly [Player, Player], seed: number, table: TableConfig): Played
{
    const { draws } = seeded(seed);
    let state = engine.create([0, 1], draws, table).state;
    const verbs = new Set<string>();
    let actions = 0;

    while (engine.finish(state) === null)
    {
        const seat = engine.turnOf(state) as number;
        const play = players[seat](state, seat, actions);

        expect(play, `an answer at action ${ actions }`).not.toBeNull();

        const action = engine.parse(play as MatchPlay, seat);

        expect(action, `parses: ${ JSON.stringify(play) }`).not.toBeNull();

        const applied = engine.apply(state, action as BackgammonAction, draws);

        expect(applied.ok, `accepted at action ${ actions }: ${ applied.ok ? '' : applied.reason }`).toBe(true);

        if (!applied.ok)
        {
            break;
        }

        verbs.add((play as { verb: string }).verb);
        state = applied.state;
        actions += 1;

        expect(actions).toBeLessThan(5000);
    }

    return { winner: state.winner as number, score: [...state.score], actions, verbs };
}

/** Of `pairs` single games played twice with the same dice and the seats swapped, the share `one` wins. */
function shareOf(one: Player, other: Player, pairs: number, from: number)
{
    let won = 0;

    for (let pair = 0; pair < pairs; pair += 1)
    {
        won += playMatch([one, other], from + pair, tableOfMatch(1, false)).winner === 0 ? 1 : 0;
        won += playMatch([other, one], from + pair, tableOfMatch(1, false)).winner === 1 ? 1 : 0;
    }

    return won / (2 * pairs);
}

const board = (spots: Readonly<Record<number, number>>) =>
{
    const side = new Array<number>(26).fill(0);
    let placed = 0;

    for (const [point, count] of Object.entries(spots))
    {
        side[Number(point)] = count;
        placed += count;
    }

    side[OFF] = 15 - placed;

    return side;
};

const opened = (table: TableConfig = tableOfMatch(5, true)) => engine.create([0, 1], { die: () => 1 }, table).state;

const verbOf = (state: BackgammonState, seat: number, skill: Skill) => (choose(askOf(state, seat, skill, 500, 1)).play as { verb: string } | null)?.verb;

/** The position a move leaves for the side that made it. */
const leaves = (state: BackgammonState, play: MatchPlay | null) =>
{
    const action = engine.parse(play as MatchPlay, state.turn) as BackgammonAction & { hops: { from: number; to: number }[] };

    return keyOf((settle(sideOf(state, state.turn), state.dice, action.hops) as { side: { me: number[]; them: number[] } }).side);
};

describe('backgammon agent: whole games', () =>
{
    const tables: readonly [string, TableConfig][] = [
        ['a single game', tableOfMatch(1, false)],
        ['3 points with the cube', tableOfMatch(3, true)],
        ['5 points with the cube', tableOfMatch(5, true)],
        ['7 points without the cube', tableOfMatch(7, false)]
    ];

    for (const [name, table] of tables)
    {
        it(`${ name }: every seat at every skill, every game ends and every play is accepted`, () =>
        {
            const verbs = new Set<string>();

            for (let game = 0; game < SKILLS.length; game += 1)
            {
                const players: [Player, Player] = [
                    playerOf(backgammonAgent, SKILLS[game], game * 211),
                    playerOf(backgammonAgent, SKILLS[(game + 1 + (game % 2)) % SKILLS.length], 999 - game * 97)
                ];
                const played = playMatch(players, 40 + game, table);

                expect(played.score[played.winner]).toBeGreaterThanOrEqual(table.target);

                for (const verb of played.verbs)
                {
                    verbs.add(verb);
                }
            }

            expect(verbs.has('roll') && verbs.has('move')).toBe(true);

            if (table.cube && table.target > 1)
            {
                expect(verbs.has('double')).toBe(true);
                expect(verbs.has('take') || verbs.has('drop')).toBe(true);
            }
            else
            {
                expect(verbs.has('double')).toBe(false);
            }
        }, 60_000);
    }
});

describe('backgammon agent: the same ask, the same play', () =>
{
    it('answers an ask the same way twice, and a different style or seed plays differently somewhere in a game', () =>
    {
        const { draws, next } = seeded(5);
        let state = engine.create([0, 1], draws, tableOfMatch(5, true)).state;
        let differs = 0;
        let asked = 0;

        while (engine.finish(state) === null && asked < 400)
        {
            const seat = engine.turnOf(state) as number;

            for (const skill of SKILLS)
            {
                if (skill === 'semi-pro' && asked % 8 !== 0)
                {
                    continue;
                }

                const one = backgammonAgent.decide(askOf(state, seat, skill, 321, asked));

                expect(backgammonAgent.decide(askOf(state, seat, skill, 321, asked))).toEqual(one);

                if (skill === 'intermediate' && state.phase === 'move')
                {
                    const other = [backgammonAgent.decide(askOf(state, seat, skill, 321, asked + 1)), backgammonAgent.decide(askOf(state, seat, skill, 888, asked))];

                    differs += other.some((play) => JSON.stringify(play) !== JSON.stringify(one)) ? 1 : 0;
                }
            }

            const legal = engine.legal(state, seat);
            const applied = engine.apply(state, legal[Math.floor(next() * legal.length)], draws);

            state = applied.ok ? applied.state : state;
            asked += 1;
        }

        expect(differs).toBeGreaterThan(0);
    }, 30_000);
});

describe('backgammon agent: strength', () =>
{
    it('intermediate beats the stage-1 baseline clearly', () =>
    {
        const share = shareOf(playerOf(backgammonAgent, 'intermediate', 400), playerOf(baseline, 'intermediate', 400), 150, 1000);

        console.log(`intermediate against the baseline: ${ (share * 100).toFixed(1) }% of 300 games`);
        expect(share).toBeGreaterThan(0.56);
    }, 30_000);

    it('a higher skill beats a lower one more often than not', () =>
    {
        const steps: readonly [Skill, Skill, number][] = [['intermediate', 'casual', 150], ['advanced', 'intermediate', 60]];

        for (const [higher, lower, pairs] of steps)
        {
            const share = shareOf(playerOf(backgammonAgent, higher, 123), playerOf(backgammonAgent, lower, 456), pairs, 2000);

            console.log(`${ higher } against ${ lower }: ${ (share * 100).toFixed(1) }% of ${ 2 * pairs } games`);
            expect(share).toBeGreaterThan(0.53);
        }
    }, 60_000);
});

describe('backgammon agent: cost', () =>
{
    it('keeps every decision within its skill cap on positions read, and says what a decision takes', () =>
    {
        const nodes = new Map<Skill, number[]>();
        const times = new Map<Skill, number[]>();

        const counted = (skill: Skill, style: number): Player => (state, seat, step) =>
        {
            const began = performance.now();
            const chosen = choose(askOf(state, seat, skill, style, step));

            if (state.phase === 'move' || state.phase === 'double' || (state.phase === 'roll' && engine.legal(state, seat).length > 1))
            {
                nodes.set(skill, [...(nodes.get(skill) ?? []), chosen.nodes]);
                times.set(skill, [...(times.get(skill) ?? []), performance.now() - began]);
            }

            return chosen.play;
        };

        playMatch([counted('casual', 1), counted('intermediate', 2)], 77, tableOfMatch(5, true));
        playMatch([counted('advanced', 3), counted('semi-pro', 4)], 78, tableOfMatch(3, true));

        for (const skill of SKILLS)
        {
            const read = nodes.get(skill) ?? [];
            const spent = [...(times.get(skill) ?? [])].sort((one, other) => one - other);
            const mean = spent.reduce((total, ms) => total + ms, 0) / Math.max(1, spent.length);

            expect(read.length).toBeGreaterThan(10);
            expect(Math.max(...read)).toBeLessThanOrEqual(PLANS[skill].cap);
            console.log(`${ skill }: ${ read.length } decisions, positions read mean ${ Math.round(read.reduce((total, one) => total + one, 0) / read.length) } most ${ Math.max(...read) } (cap ${ PLANS[skill].cap }), ms mean ${ mean.toFixed(2) } p95 ${ spent[Math.floor(spent.length * 0.95)].toFixed(1) } most ${ spent[spent.length - 1].toFixed(1) }`);
        }
    }, 60_000);

    it('reads more at each skill up', () =>
    {
        expect(PLANS.casual.depth).toBe('plain');
        expect(PLANS.intermediate.depth).toBe('full');
        expect(PLANS.intermediate.wide).toBe(0);
        expect(PLANS.advanced.wide).toBeGreaterThan(1);
        expect(PLANS['semi-pro'].deep).toBeGreaterThan(1);

        for (let at = 1; at < SKILLS.length; at += 1)
        {
            expect(PLANS[SKILLS[at]].cap).toBeGreaterThan(PLANS[SKILLS[at - 1]].cap);
        }
    });
});

describe('backgammon agent: rules and positions', () =>
{
    it('throws at once in the roll-off and rolls when the cube is not on offer', () =>
    {
        const start = opened();

        for (const skill of SKILLS)
        {
            expect(choose(askOf(start, start.turn, skill, 0, 1))).toEqual({ play: { kind: 'backgammon', verb: 'roll' }, nodes: 0 });
            expect(verbOf({ ...opened(tableOfMatch(1, true)), phase: 'roll', turn: 0 }, 0, skill)).toBe('roll');
            expect(verbOf({ ...start, phase: 'roll', turn: 0, crawford: 'now', score: [4, 2] }, 0, skill)).toBe('roll');
        }
    });

    it('answers nothing when it is not its turn, and plays the only move there is', () =>
    {
        const state: BackgammonState = { ...opened(), phase: 'move', turn: 0, dice: [6, 6], checkers: [board({ 1: 2 }), board({ 6: 2 })] };

        expect(backgammonAgent.decide(askOf(state, 1, 'semi-pro', 0, 1))).toBeNull();
        expect(backgammonAgent.decide(askOf(state, 0, 'semi-pro', 0, 1))).toEqual({ kind: 'backgammon', verb: 'move', hops: [{ from: 1, to: 0 }, { from: 1, to: 0 }] });
    });

    // Casual reads only the race and the blots, so its wide margin may pick another sound opening.
    it('plays the standard opening points from intermediate up', () =>
    {
        const start = opened();
        const expected: readonly [number[], Record<number, number>][] = [
            [[3, 1], { 5: 2, 6: 4, 8: 2, 13: 5, 24: 2 }],
            [[4, 2], { 4: 2, 6: 4, 8: 2, 13: 5, 24: 2 }],
            [[6, 1], { 6: 5, 7: 2, 8: 2, 13: 4, 24: 2 }],
            [[5, 3], { 3: 2, 6: 4, 8: 2, 13: 5, 24: 2 }],
            [[6, 5], { 6: 5, 8: 3, 13: 6, 24: 1 }]
        ];

        for (const skill of SKILLS.slice(1))
        {
            for (const [dice, spots] of expected)
            {
                const state: BackgammonState = { ...start, phase: 'move', turn: 0, dice, turns: 2 };
                const play = backgammonAgent.decide(askOf(state, 0, skill, 500, 1));

                expect(leaves(state, play), `${ skill } ${ dice.join('-') }`).toBe(keyOf({ me: board(spots), them: start.checkers[1] }));
            }
        }
    });

    it('doubles a race it leads well, takes one it trails a little and passes one it has lost', () =>
    {
        const race = (mine: Record<number, number>, theirs: Record<number, number>): BackgammonState =>
            ({ ...opened(), phase: 'roll', turn: 0, checkers: [board(mine), board(theirs)] });
        const even = race({ 6: 3, 5: 3, 4: 3, 3: 3, 2: 3 }, { 6: 3, 5: 3, 4: 3, 3: 3, 2: 3 });
        const ahead = race({ 6: 3, 8: 3, 10: 3, 4: 3, 2: 3 }, { 6: 3, 8: 3, 12: 3, 5: 3, 3: 3 });
        const won = race({ 6: 3, 5: 3, 4: 3, 3: 3, 2: 3 }, { 6: 3, 8: 3, 4: 3, 5: 3, 2: 3 });

        for (const skill of SKILLS)
        {
            expect(verbOf(even, 0, skill), skill).toBe('roll');
            expect(verbOf(ahead, 0, skill), skill).toBe('double');
            expect(verbOf({ ...ahead, phase: 'double' }, 1, skill), skill).toBe('take');
            expect(verbOf(won, 0, skill), skill).toBe('double');
            expect(verbOf({ ...won, phase: 'double' }, 1, skill), skill).toBe('drop');
        }
    });

    it('doubles at once as the trailer after the Crawford game, and plays on for the gammon when too good', () =>
    {
        const after: BackgammonState = { ...opened(), phase: 'roll', turn: 0, score: [1, 4], crawford: 'after' };

        for (const skill of ['intermediate', 'advanced', 'semi-pro'] as const)
        {
            expect(verbOf(after, 0, skill), skill).toBe('double');
        }

        // Three of theirs on the bar against a closed board: they would pass, so it plays on.
        const blitz: BackgammonState = {
            ...opened(),
            phase: 'roll',
            turn: 0,
            checkers: [board({ 6: 3, 5: 3, 4: 2, 3: 2, 2: 2, 1: 2, 8: 1 }), board({ 25: 3, 6: 2, 13: 5, 8: 3, 24: 2 })]
        };

        for (const skill of ['intermediate', 'advanced', 'semi-pro'] as const)
        {
            expect(verbOf(blitz, 0, skill), skill).toBe('roll');
            expect(verbOf({ ...blitz, phase: 'double' }, 1, skill), skill).toBe('drop');
        }
    });

    it('reads the match table with the Crawford game in it', () =>
    {
        const before = tableOf(false);
        const used = tableOf(true);

        expect(before(3, 3)).toBeCloseTo(0.5, 6);
        expect(before(1, 2)).toBeCloseTo(0.7, 6);
        expect(used(2, 1)).toBeCloseTo(0.5, 6);
        expect(used(3, 1)).toBeCloseTo(0.5 * (0.8 * used(1, 1) + 0.2), 6);
        expect(before(2, 5)).toBeGreaterThan(before(2, 3));
    });

    it('looks ahead over exactly the positions the engine allows', () =>
    {
        const { draws, next } = seeded(11);
        let state = engine.create([0, 1], draws, tableOfMatch(1, false)).state;
        let checked = 0;

        for (let step = 0; step < 4000 && checked < 600; step += 1)
        {
            if (engine.finish(state) !== null)
            {
                state = engine.create([0, 1], draws, tableOfMatch(1, false)).state;
            }

            const seat = engine.turnOf(state) as number;

            if (state.phase === 'move')
            {
                const side = sideOf(state, seat);
                const mine = positionsAfter(side, Math.max(...state.dice), Math.min(...state.dice)).map(keyOf).sort();
                const theirs = turns(side, state.dice).map((hops) => keyOf((settle(side, state.dice, hops) as { side: { me: number[]; them: number[] } }).side)).sort();

                expect(mine).toEqual(theirs);
                checked += 1;
            }

            const legal = engine.legal(state, seat);
            const applied = engine.apply(state, legal[Math.floor(next() * legal.length)], draws);

            state = applied.ok ? applied.state : state;
        }

        expect(checked).toBe(600);
    });
});

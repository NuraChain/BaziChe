import { describe, expect, it } from 'vitest';

import { MARGIN, playOf, seededRandom, type Agent, type Ask } from '../src/domains/ai/agent.ts';
import { ludoAgent } from '../src/domains/ai/ludo/agent.ts';
import { boardOf, dangerOf, hitChance, raceTurns } from '../src/domains/ai/ludo/judge.ts';
import { PLANS, choose } from '../src/domains/ai/ludo/search.ts';
import type { Draws } from '../src/domains/match/engine.ts';
import { ludoEngine as engine } from '../src/domains/match/engines/ludo.ts';
import { FINISHED, RING_STEPS, YARD, isProtectedRing, ringIndex } from '../src/domains/match/ludo/board.ts';
import { create } from '../src/domains/match/ludo/engine.ts';
import type { EngineAction, GameEvent, LudoState } from '../src/domains/match/ludo/state.ts';
import { sideOf, type Format } from '../src/domains/match/sides.ts';
import { SKILLS, type Skill } from '../src/domains/system/rules.ts';
import type { MatchPlay } from '../src/schemas.ts';

/** The xorshift `Draws` the other agent specs play with. */
function seeded(seed: number): Draws
{
    let state = (seed * 2654435761) >>> 0 || 1;

    return {
        die: (sides) =>
        {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;

            return 1 + Math.floor(((state >>> 0) / 4294967296) * sides);
        }
    };
}

/** The stage-1 baseline, kept here as the opponent the real strategy has to beat. */
const baseline: Agent<LudoState> = (() =>
{
    const NO_DRAWS = { die: () => 1 };
    const OUT_OF_YARD = 6;
    const progressOf = (at: number) => (at === YARD ? 0 : at + OUT_OF_YARD) + (at === FINISHED ? 10 : 0);

    const scoreOf = (state: LudoState, side: number) =>
    {
        let score = 0;

        for (const player of state.players)
        {
            for (const at of player.pieces)
            {
                const mine = player.side === side;
                const safe = at !== YARD && at < RING_STEPS && isProtectedRing(state.players, player, ringIndex(player.colour, at)) ? 2 : 0;

                score += mine ? progressOf(at) + safe : -progressOf(at) / Math.max(1, state.players.length - 1);
            }
        }

        return score;
    };

    return {
        id: 'ludo-baseline',
        version: 1,
        decide: (ask: Ask<LudoState>) =>
        {
            const state = ask.input;
            const legal = engine.legal(state, ask.seat);

            if (legal.length === 0)
            {
                return null;
            }

            if (legal[0].kind === 'roll')
            {
                return playOf('ludo', legal[0]);
            }

            const side = state.players.find((player) => player.seat === ask.seat)?.side ?? ask.seat;
            const scored: { move: EngineAction; score: number }[] = [];

            for (const move of legal)
            {
                const after = engine.apply(state, move, NO_DRAWS);

                if (after.ok)
                {
                    scored.push({ move, score: after.state.winner === side ? 10_000 : scoreOf(after.state, side) });
                }
            }

            const best = Math.max(...scored.map((one) => one.score));
            const near = scored.filter((one) => one.score >= best - MARGIN[ask.skill] * 10);

            return playOf('ludo', (near[Math.floor(ask.random() * near.length)] ?? scored[0]).move);
        }
    };
})();

interface Player
{
    agent: Agent<LudoState>;
    skill: Skill;
    style: number;
}

const at = (skill: Skill, agent: Agent<LudoState> = ludoAgent, style = 500): Player => ({ agent, skill, style });

function askOf(state: LudoState, seat: number, format: Format, player: Player, seed: number): Ask<LudoState>
{
    return { seat, format, input: state, skill: player.skill, style: player.style, random: seededRandom(seed), spent: () => 0, budget: 1000 };
}

/** A whole game, every play through the engine's own `parse` and `apply`; `watch` sees every ask and its answer. */
function playOut(format: Format, players: readonly Player[], seed: number, watch?: (ask: Ask<LudoState>, play: MatchPlay | null) => void)
{
    const draws = seeded(seed);
    const seats = Array.from({ length: format.seats }, (_, seat) => seat);
    let state = engine.create(seats, draws, { target: 0, cube: false, blinds: 'low', variant: format.variant }).state;
    let actions = 0;

    while (engine.finish(state) === null)
    {
        const seat = engine.turnOf(state) as number;
        const ask = askOf(state, seat, format, players[seat], seed * 7919 + actions);
        const play = players[seat].agent.decide(ask);

        watch?.(ask, play);

        const action = engine.parse(play as MatchPlay, seat);

        if (action === null)
        {
            throw new Error(`seat ${ seat } answered ${ JSON.stringify(play) }`);
        }

        const applied = engine.apply(state, action, draws);

        if (!applied.ok)
        {
            throw new Error(`refused at action ${ actions }: ${ applied.reason }`);
        }

        state = applied.state;
        actions += 1;

        if (actions > 20_000)
        {
            throw new Error('the game did not end');
        }
    }

    return { winner: state.winner as number, actions, ending: engine.finish(state) };
}

/** Two seats, `games` seeds each played twice with the seats swapped: the first player's share of the wins. */
function share(one: Player, other: Player, games: number, from: number)
{
    const format: Format = { seats: 2, variant: 'standard' };
    let won = 0;

    for (let game = 0; game < games; game += 1)
    {
        won += playOut(format, [one, other], from + game).winner === 0 ? 1 : 0;
        won += playOut(format, [other, one], from + game).winner === 1 ? 1 : 0;
    }

    return won / (games * 2);
}

/** A position: each seat's pieces, whose turn, the die. */
function position(format: Format, pieces: readonly (readonly number[])[], turn: number, die: number | null): LudoState
{
    const seats = Array.from({ length: format.seats }, (_, seat) => seat);
    const state = create(seats, turn, seats.map((seat) => sideOf(seat, format)));

    state.players.forEach((player, index) =>
    {
        player.pieces = [...pieces[index]];
    });

    return { ...state, die };
}

const TWO: Format = { seats: 2, variant: 'standard' };

const TEAMS: Format = { seats: 4, variant: 'teams' };

const pieceOf = (play: MatchPlay | null) => (play as { piece?: number } | null)?.piece;

/** Red's progress that stands on a ring square, and yellow's: red enters at 0, yellow at 26. */
const yellowAt = (square: number) => (square - 26 + 52) % 52;

describe('whole games', () =>
{
    for (const format of engine.formats)
    {
        it(`${ format.seats }-seat ${ format.variant }: every game ends, every play is accepted, at every skill`, () =>
        {
            for (let game = 1; game <= 3; game += 1)
            {
                const players = Array.from({ length: format.seats }, (_, seat) => at(SKILLS[(game + seat) % SKILLS.length], ludoAgent, (game * 131 + seat * 7) % 1000));
                const played = playOut(format, players, game * 31 + format.seats);

                expect(played.ending?.winners.length).toBeGreaterThan(0);
                expect(played.ending?.unsettled).toEqual([]);
            }
        }, 30_000);
    }
});

describe('decisions', () =>
{
    it('are a pure function of the ask, and style or seed can change one', () =>
    {
        const asks: Ask<LudoState>[] = [];

        playOut(TWO, [at('intermediate'), at('advanced', ludoAgent, 41)], 5, (ask) =>
        {
            if (ask.input.die !== null && engine.legal(ask.input, ask.seat).length > 1)
            {
                asks.push(ask);
            }
        });

        expect(asks.length).toBeGreaterThan(10);

        const again = (ask: Ask<LudoState>, seed: number, style = ask.style) => ludoAgent.decide({ ...ask, style, random: seededRandom(seed) });
        let differs = false;

        asks.forEach((ask, index) =>
        {
            for (const skill of SKILLS)
            {
                expect(again({ ...ask, skill }, index)).toEqual(again({ ...ask, skill }, index));
            }

            differs ||= [1, 2, 3, 4].some((seed) => pieceOf(again(ask, seed)) !== pieceOf(again(ask, 0)))
                || [0, 333, 666, 999].some((style) => pieceOf(again(ask, 0, style)) !== pieceOf(again(ask, 0)));
        });

        expect(differs).toBe(true);
    });

    it('answer a roll at once, reading nothing', () =>
    {
        const state = position(TWO, [[YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, null);

        for (const skill of SKILLS)
        {
            expect(choose(askOf(state, 0, TWO, at(skill), 1))).toEqual({ play: { kind: 'ludo', verb: 'roll' }, nodes: 0 });
        }

        expect(ludoAgent.decide(askOf(state, 1, TWO, at('casual'), 1))).toBeNull();
    });
});

describe('the dice', () =>
{
    it('count a hit from one, two or three rolls, a six rolling again and a third six passing', () =>
    {
        expect(hitChance(0)).toBe(0);
        expect(hitChance(1 << 6)).toBeCloseTo(1 / 6, 9);
        expect(hitChance(1 << 12)).toBeCloseTo(1 / 36, 9);
        expect(hitChance(1 << 15)).toBeCloseTo(1 / 216, 9);
        expect(hitChance(1 << 17)).toBeCloseTo(1 / 216, 9);

        // Three behind: a three, or a six spent on another token and then a three, twice at most.
        expect(hitChance(1 << 3)).toBeCloseTo(1 / 6 + 1 / 36 + 1 / 216, 9);

        // Nine behind: a six and a three, or two sixes and a three.
        expect(hitChance(1 << 9)).toBeCloseTo(1 / 36 + 1 / 216, 9);
        expect(hitChance((1 << 2) | (1 << 4))).toBeCloseTo(2 / 6 + 2 / 36 + 2 / 216, 9);

        // A second hunter eight behind adds nothing to one two behind: both need a two after a six.
        expect(hitChance((1 << 2) | (1 << 8))).toBeCloseTo(hitChance(1 << 2), 9);
    });

    it('read the danger to a token from the board: safe squares, pairs and start squares', () =>
    {
        // Yellow three squares behind red's token on square 20.
        const exposed = position(TWO, [[20, YARD, YARD, YARD], [yellowAt(17), FINISHED, FINISHED, FINISHED]], 0, null);

        expect(dangerOf(boardOf(exposed), exposed.players[0], 20)).toBeCloseTo(hitChance(1 << 3), 9);

        // The same token on the starred square 21, and as a pair on 20.
        const starred = position(TWO, [[21, YARD, YARD, YARD], [yellowAt(17), FINISHED, FINISHED, FINISHED]], 0, null);
        const paired = position(TWO, [[20, 20, YARD, YARD], [yellowAt(17), FINISHED, FINISHED, FINISHED]], 0, null);

        expect(dangerOf(boardOf(starred), starred.players[0], 21)).toBe(0);
        expect(dangerOf(boardOf(paired), paired.players[0], 20)).toBe(0);

        // Yellow can capture the visitor with a six when it leaves the yard.
        const start = position(TWO, [[26, YARD, YARD, YARD], [YARD, FINISHED, FINISHED, FINISHED]], 0, null);

        expect(dangerOf(boardOf(start), start.players[0], 26)).toBeCloseTo(1 / 6);

        // A token in the home stretch cannot be reached.
        expect(dangerOf(boardOf(exposed), exposed.players[0], RING_STEPS + 1)).toBe(0);

        // Only the destination matters when yellow moves past another piece.
        const open = position(TWO, [[20, YARD, YARD, YARD], [yellowAt(16), FINISHED, FINISHED, FINISHED]], 0, null);
        const occupied = position(TWO, [[20, 18, YARD, YARD], [yellowAt(16), FINISHED, FINISHED, FINISHED]], 0, null);

        expect(dangerOf(boardOf(open), open.players[0], 20)).toBeCloseTo(hitChance(1 << 4), 9);
        expect(dangerOf(boardOf(occupied), occupied.players[0], 20)).toBeCloseTo(hitChance(1 << 4), 9);
    });

    it('counts six turns on average for the exact roll that brings the last token home', () =>
    {
        for (let left = 1; left <= 6; left += 1)
        {
            expect(raceTurns([FINISHED - left, FINISHED, FINISHED, FINISHED])).toBeCloseTo(6);
        }

        expect(raceTurns([FINISHED, FINISHED, FINISHED, FINISHED])).toBe(0);
        expect(raceTurns([YARD, FINISHED, FINISHED, FINISHED])).toBeNull();
    });
});

describe('tactics', () =>
{
    it('takes the capture of a token that has come far, at every skill', () =>
    {
        // Red's token on 10 rolls a four onto yellow's token on 14, which has walked 40 squares.
        const state = position(TWO, [[10, 30, YARD, YARD], [yellowAt(14), YARD, YARD, YARD]], 0, 4);

        expect(yellowAt(14)).toBe(40);

        for (const skill of SKILLS)
        {
            expect(pieceOf(ludoAgent.decide(askOf(state, 0, TWO, at(skill), 3))), skill).toBe(0);
        }
    });

    it('leaves the yard on a six, at every skill', () =>
    {
        const state = position(TWO, [[40, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, 6);

        for (const skill of SKILLS)
        {
            expect(pieceOf(ludoAgent.decide(askOf(state, 0, TWO, at(skill), 3))), skill).toBe(1);
        }
    });

    it('from intermediate up, steps a hunted token onto a starred square rather than walking a safe one', () =>
    {
        // Red on 20 with yellow three behind; a one takes it to the starred 21. Red's other token on 2 is out of reach.
        const state = position(TWO, [[20, 2, YARD, YARD], [yellowAt(17), YARD, YARD, YARD]], 0, 1);

        for (const skill of ['intermediate', 'advanced', 'semi-pro'] as const)
        {
            for (let seed = 0; seed < 5; seed += 1)
            {
                expect(pieceOf(ludoAgent.decide(askOf(state, 0, TWO, at(skill), seed))), skill).toBe(0);
            }
        }
    });

    it('in teams, moves its partner\'s tokens once its own are home, and takes the capture with them', () =>
    {
        // Red (seat 0) is home; yellow, its partner, has a token on square 31 two short of green's on 33.
        const greenAt = (square: number) => (square - 13 + 52) % 52;
        const state = position(TEAMS, [
            [FINISHED, FINISHED, FINISHED, FINISHED],
            [greenAt(33), YARD, YARD, YARD],
            [yellowAt(31), yellowAt(4), YARD, YARD],
            [YARD, YARD, YARD, YARD]
        ], 0, 2);

        for (const skill of SKILLS)
        {
            const play = ludoAgent.decide(askOf(state, 0, TEAMS, at(skill), 1));
            const applied = engine.apply(state, engine.parse(play as MatchPlay, 0) as EngineAction, { die: () => 1 });

            expect(applied.ok, skill).toBe(true);
            expect(applied.ok && (applied.events as GameEvent[]).some((event) => event.e === 'capture' && event.victim === 1), skill).toBe(true);
        }
    });

    it('as a semi-pro, spreads its last tokens over the rolls they need', () =>
    {
        // Red's last two tokens are five and four short of home and the die is a one: four and four, or five and three.
        const state = position(TWO, [[FINISHED - 5, FINISHED - 4, FINISHED, FINISHED], [10, YARD, YARD, YARD]], 0, 1);
        const pair = raceTurns([FINISHED - 4, FINISHED - 4, FINISHED, FINISHED]) as number;
        const spread = raceTurns([FINISHED - 5, FINISHED - 3, FINISHED, FINISHED]) as number;

        expect(spread).toBeLessThan(pair - 0.1);

        for (let seed = 0; seed < 5; seed += 1)
        {
            expect(pieceOf(ludoAgent.decide(askOf(state, 0, TWO, at('semi-pro'), seed)))).toBe(1);
        }
    });
});

describe('strength', () =>
{
    it('intermediate beats the stage-1 baseline clearly, and casual', () =>
    {
        expect(share(at('intermediate'), at('intermediate', baseline), 500, 1)).toBeGreaterThan(0.55);
        expect(share(at('intermediate'), at('casual'), 500, 3000)).toBeGreaterThan(0.6);
    }, 30_000);

    it('advanced beats intermediate, and semi-pro beats advanced', () =>
    {
        expect(share(at('advanced'), at('intermediate'), 150, 1000)).toBeGreaterThan(0.53);
        expect(share(at('semi-pro'), at('advanced'), 150, 2000)).toBeGreaterThan(0.5);
    }, 60_000);
});

describe('cost', () =>
{
    it('reads no more positions than each skill\'s cap', () =>
    {
        const most = new Map<Skill, number>();

        for (const format of [TWO, { seats: 4, variant: 'standard' } as Format, TEAMS])
        {
            playOut(format, Array.from({ length: format.seats }, () => at('casual')), 77 + format.seats, (ask) =>
            {
                if (ask.input.die === null)
                {
                    return;
                }

                for (const skill of SKILLS)
                {
                    const { nodes } = choose({ ...ask, skill });

                    most.set(skill, Math.max(most.get(skill) ?? 0, nodes));
                }
            });
        }

        for (const skill of SKILLS)
        {
            expect(most.get(skill), skill).toBeLessThan(PLANS[skill].cap);
        }

        expect(most.get('casual')).toBeLessThanOrEqual(4);
        expect(most.get('intermediate')).toBeLessThanOrEqual(4);
    }, 30_000);

    it('stops at the clock with a legal play', () =>
    {
        const state = position(TWO, [[10, 30, 20, YARD], [yellowAt(14), yellowAt(3), YARD, YARD]], 0, 6);
        const chosen = choose({ ...askOf(state, 0, TWO, at('semi-pro'), 1), spent: () => 10_000 });

        expect(engine.apply(state, engine.parse(chosen.play as MatchPlay, 0) as EngineAction, { die: () => 1 }).ok).toBe(true);
        expect(chosen.nodes).toBeLessThan(10);
    });
});

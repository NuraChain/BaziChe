import { describe, expect, it } from 'vitest';

import { MARGIN, hashOf, playOf, seededRandom, type Ask } from '../src/domains/ai/agent.ts';
import { chessAgent, LEVELS, think } from '../src/domains/ai/chess/agent.ts';
import { Board, moveName } from '../src/domains/ai/chess/board.ts';
import { colourOf, kindOf, opponent, parseFen, type Colour, type Position } from '../src/domains/match/chess/board.ts';
import { attacked, legalMoves } from '../src/domains/match/chess/moves.ts';
import { keyOf } from '../src/domains/match/chess/status.ts';
import { colourOfSeat, turnSeat, type ChessAction, type ChessState } from '../src/domains/match/chess/state.ts';
import { chessEngine } from '../src/domains/match/engines/chess.ts';
import { SKILLS, type Skill } from '../src/domains/system/rules.ts';
import type { MatchPlay } from '../src/schemas.ts';

/**
 * The chess agent: its own board held to the engine, whole games it always finishes, decisions
 * that repeat for the same ask, strength that grows with skill, work that stays within its caps,
 * and the positions whose right answer is known.
 */

const NO_DRAWS = { die: () => 1 };

const at = (fen: string): Position =>
{
    const position = parseFen(fen);

    if (position === null)
    {
        throw new Error(`not a position: ${ fen }`);
    }

    return position;
};

/** A game in a position, White at seat 0, with its repetition keys begun there. */
function stateAt(fen: string, extra: Partial<ChessState> = {}): ChessState
{
    const position = at(fen);
    const base = chessEngine.create([0, 1], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state;

    return { ...base, position, keys: [keyOf(position, legalMoves(position))], moved: [true, true], ply: 2 * (position.fullmove - 1) + (position.turn === 'b' ? 1 : 0), ...extra };
}

function askOf(state: ChessState, skill: Skill, style = 0, seed = 1): Ask<ChessState>
{
    return { seat: turnSeat(state), format: { seats: 2, variant: 'standard' }, input: state, skill, style, random: seededRandom(hashOf(`ask:${ seed }`)), spent: () => 0, budget: 3000 };
}

function applied(state: ChessState, seat: number, play: MatchPlay): ChessState
{
    const action = chessEngine.parse(play, seat);

    expect(action, JSON.stringify(play)).not.toBeNull();

    const after = chessEngine.apply(state, action as ChessAction, NO_DRAWS);

    expect(after.ok, `${ JSON.stringify(play) }: ${ after.ok ? '' : after.reason }`).toBe(true);

    return after.ok ? after.state : state;
}

const VALUE: Readonly<Record<string, number>> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/** The stage-1 baseline, kept here as an opponent: one ply by material, less the worst piece left hanging. */
function baseline(ask: Ask<ChessState>): MatchPlay | null
{
    const scoreOf = (board: string, colour: Colour) =>
    {
        let score = 0;
        let hanging = 0;

        for (let square = 0; square < 64; square += 1)
        {
            const piece = board[square];

            if (piece === '.')
            {
                continue;
            }

            const value = VALUE[kindOf(piece)] ?? 0;

            if (colourOf(piece) === colour)
            {
                score += value;

                if (value > hanging && attacked(board, square, opponent(colour)) && !attacked(board, square, colour))
                {
                    hanging = value;
                }
            }
            else
            {
                score -= value;
            }
        }

        return score - hanging * 0.9;
    };

    const state = ask.input;
    const seat = ask.seat;

    if (state.over !== null || turnSeat(state) !== seat)
    {
        return null;
    }

    const colour = colourOfSeat(state, seat);

    if (state.offer === 1 - seat && scoreOf(state.position.board, colour) <= -300)
    {
        return { kind: 'chess', verb: 'accept' };
    }

    const scored: { move: ChessAction; score: number }[] = [];

    for (const move of chessEngine.legal(state, seat))
    {
        const after = chessEngine.apply(state, move, NO_DRAWS);

        if (!after.ok)
        {
            continue;
        }

        const over = after.state.over;
        const score = over === null ? scoreOf(after.state.position.board, colour) : (over.winner === seat ? 100_000 : (over.winner === null ? 0 : -100_000));

        scored.push({ move, score });
    }

    const best = Math.max(...scored.map((one) => one.score));
    const near = scored.filter((one) => one.score >= best - (MARGIN[ask.skill] * 200 + 5));

    return playOf('chess', (near[Math.floor(ask.random() * near.length)] ?? scored[0]).move);
}

type Player = (ask: Ask<ChessState>) => MatchPlay | null;

const agent: Player = (ask) => chessAgent.decide(ask);

interface Game
{
    state: ChessState;
    plays: number;
}

/** One game between two players, seat 0 White unless `white` says otherwise; at `plies` it stops where it stands. */
function playGame(players: [Player, Player], skills: [Skill, Skill], seed: number, options: { white?: number; clock?: boolean; offers?: boolean; plies?: number; styles?: [number, number] } = {}): Game
{
    const random = seededRandom(seed);
    const clock = options.clock === true ? { base: 300_000, increment: 2_000 } : null;
    let state = chessEngine.create([0, 1], { die: () => (options.white ?? 0) + 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard', clock }).state;
    let plays = 0;

    while (state.over === null && state.ply < (options.plies ?? 2000))
    {
        const seat = turnSeat(state);

        if (options.offers === true && random() < 0.05 && state.offer === null)
        {
            const offered = chessEngine.apply(state, { kind: 'offer', seat: 1 - seat }, NO_DRAWS);

            state = offered.ok ? offered.state : state;
        }

        const play = players[seat]({
            seat,
            format: { seats: 2, variant: 'standard' },
            input: state,
            skill: skills[seat],
            style: options.styles?.[seat] ?? (seed * 37 + seat * 501) % 1000,
            random: seededRandom(hashOf(`game:${ seed }:${ plays }`)),
            spent: () => 0,
            budget: 3000
        });

        expect(play, `an answer at ply ${ state.ply }`).not.toBeNull();
        expect(['move', 'accept'], JSON.stringify(play)).toContain((play as { verb: string }).verb);

        state = applied(state, seat, play as MatchPlay);
        plays += 1;
    }

    return { state, plays };
}

/** Material from White's side, for a game stopped before its end. */
const materialOf = (board: string) => [...board].reduce((sum, piece) => (piece === '.' ? sum : sum + (colourOf(piece) === 'w' ? 1 : -1) * (VALUE[kindOf(piece)] ?? 0)), 0);

/** A seat's points from a game: 1 a win, a half a draw, and a game stopped early scored by material at three pawns or more. */
function pointsOf(game: Game, seat: number)
{
    const over = game.state.over;

    if (over !== null)
    {
        return over.winner === null ? 0.5 : (over.winner === seat ? 1 : 0);
    }

    const lead = materialOf(game.state.position.board) * (colourOfSeat(game.state, seat) === 'w' ? 1 : -1);

    return lead >= 300 ? 1 : (lead <= -300 ? 0 : 0.5);
}

const PERFT: readonly { fen: string; counts: readonly number[] }[] = [
    { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', counts: [20, 400, 8902, 197_281] },
    { fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97_862] },
    { fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43_238] },
    { fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467, 422_333] },
    { fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62_379] },
    { fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89_890] }
];

const named = (move: { from: number; to: number; promotion?: string }) => `${ move.from }-${ move.to }${ move.promotion ?? '' }`;

describe('the search board', () =>
{
    it('counts the standard perft positions as the engine does', () =>
    {
        for (const { fen, counts } of PERFT)
        {
            const board = Board.of(at(fen));

            expect(counts.map((_, depth) => board.perft(depth + 1)), fen).toEqual(counts);
        }

        expect(Board.of(at(PERFT[1].fen)).perft(4)).toBe(4_085_603);
    }, 60_000);

    it('agrees with engine.legal, and with the engine on repetitions, over thousands of positions from seeded random games', () =>
    {
        let positions = 0;
        let repeated = 0;

        for (let game = 1; positions < 4000; game += 1)
        {
            const random = seededRandom(game * 2654435761);
            let state = chessEngine.create([0, 1], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state;

            while (state.over === null)
            {
                const board = Board.of(state.position, state.keys.slice(0, -1));
                const legal = chessEngine.legal(state, turnSeat(state));
                const theirs = legal.map((action) => named(action as { from: number; to: number; promotion?: string })).sort();
                const mine = board.legal().map((move) => named(moveName(move))).sort();

                expect(mine, `game ${ game } ply ${ state.ply }`).toEqual(theirs);

                const times = state.keys.filter((key) => key === state.keys[state.keys.length - 1]).length - 1;

                expect(board.seen(), `game ${ game } ply ${ state.ply }`).toBe(times);
                repeated += times > 0 ? 1 : 0;
                positions += 1;

                // Mostly random, with a lean to captures, so games reach endgames and repeat.
                const pick = legal[Math.floor(random() * legal.length)];

                state = applied(state, turnSeat(state), playOf('chess', pick) as MatchPlay);
            }
        }

        expect(repeated).toBeGreaterThan(0);
    }, 60_000);
});

describe('the chess agent plays whole games', () =>
{
    const MIXES: readonly { skills: [Skill, Skill]; clock: boolean }[] = [
        { skills: ['casual', 'intermediate'], clock: true },
        { skills: ['advanced', 'casual'], clock: false },
        { skills: ['intermediate', 'semi-pro'], clock: true }
    ];

    it('in every format the engine has, at mixed skills, with draw offers to answer: every game ends and every play is accepted', () =>
    {
        expect(chessEngine.formats).toEqual([{ seats: 2, variant: 'standard' }]);

        for (const [game, { skills, clock }] of MIXES.entries())
        {
            const played = playGame([agent, agent], skills, 11 + game, { white: game % 2, clock, offers: true });

            expect(played.state.over, `game ${ game }`).not.toBeNull();
            expect(['resign', 'flag', 'forfeit', 'abort']).not.toContain(played.state.over?.reason);
        }
    }, 120_000);
});

describe('the chess agent decides from the ask alone', () =>
{
    /** The positions of one seeded game, every tenth ply. */
    const positions = (() =>
    {
        const found: ChessState[] = [];
        let state = chessEngine.create([0, 1], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state;

        for (let ply = 0; ply < 60 && state.over === null; ply += 1)
        {
            if (ply % 6 === 0)
            {
                found.push(state);
            }

            state = applied(state, turnSeat(state), chessAgent.decide(askOf(state, 'casual', 3, ply)) as MatchPlay);
        }

        return found;
    })();

    it('gives the same play for the same ask, and a different one somewhere for another style or seed', () =>
    {
        let byStyle = 0;
        let bySeed = 0;

        for (const state of positions)
        {
            const once = chessAgent.decide(askOf(state, 'intermediate', 400, 9));

            expect(chessAgent.decide(askOf(state, 'intermediate', 400, 9))).toEqual(once);
            byStyle += JSON.stringify(chessAgent.decide(askOf(state, 'intermediate', 731, 9))) === JSON.stringify(once) ? 0 : 1;
            bySeed += JSON.stringify(chessAgent.decide(askOf(state, 'intermediate', 400, 10))) === JSON.stringify(once) ? 0 : 1;
        }

        expect(byStyle).toBeGreaterThan(0);
        expect(bySeed).toBeGreaterThan(0);
    }, 30_000);

    it('opens differently from game to game', () =>
    {
        const openings = new Set<string>();

        for (let seed = 1; seed <= 6; seed += 1)
        {
            openings.add(playGame([agent, agent], ['intermediate', 'intermediate'], seed, { plies: 4 }).state.notation.join(' '));
        }

        expect(openings.size).toBeGreaterThan(2);
    }, 30_000);
});

describe('the chess agent grows stronger with skill', () =>
{
    /** Each pairing plays its games with colours alternating; a game is cut at 300 plies and scored by material. */
    const match = (strong: Player, strongSkill: Skill, weak: Player, weakSkill: Skill, games: number) =>
    {
        let points = 0;

        for (let game = 0; game < games; game += 1)
        {
            points += pointsOf(playGame([strong, weak], [strongSkill, weakSkill], 100 + game, { white: game % 2, plies: 300 }), 0);
        }

        return points;
    };

    it('intermediate beats the stage-1 baseline clearly', () =>
    {
        expect(match(agent, 'intermediate', baseline, 'intermediate', 4)).toBeGreaterThanOrEqual(3.5);
    }, 60_000);

    it('intermediate beats casual more often than not', () =>
    {
        expect(match(agent, 'intermediate', agent, 'casual', 4)).toBeGreaterThan(2);
    }, 60_000);
});

describe('the chess agent works within its caps', () =>
{
    const FENS = [
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
        'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
        '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
        '6k1/5pp1/7p/8/8/7P/5PP1/3R2K1 w - - 0 30'
    ];

    it('counts its nodes and depth within each skill\'s caps, and stops at the budget', () =>
    {
        const lines: string[] = [];

        for (const skill of SKILLS)
        {
            const { limits } = LEVELS[skill];
            const times: number[] = [];
            const nodes: number[] = [];

            for (const fen of FENS)
            {
                const began = performance.now();
                const thought = think(askOf(stateAt(fen), skill));

                times.push(performance.now() - began);
                nodes.push(thought.nodes);
                expect(thought.nodes, `${ skill } ${ fen }`).toBeLessThanOrEqual(limits.nodes);
                expect(thought.depth).toBeLessThanOrEqual(limits.depth);
                expect(thought.depth).toBeGreaterThan(0);
            }

            lines.push(`${ skill }: nodes ${ Math.max(...nodes) } most, ms ${ Math.round(times.reduce((sum, one) => sum + one, 0) / times.length) } mean ${ Math.round(Math.max(...times)) } most`);
        }

        // Measured, not asserted: wall time depends on the machine.
        console.log(lines.join('\n'));

        // With a clock that has run out, the search returns its best so far, still a legal move.
        let clock = 0;
        const state = stateAt(FENS[2]);
        const play = chessAgent.decide({ ...askOf(state, 'semi-pro'), spent: () => (clock += 5), budget: 100 });

        expect(play?.verb).toBe('move');
        applied(state, 0, play as MatchPlay);
    }, 60_000);
});

describe('the chess agent knows the positions whose answer is known', () =>
{
    const playIn = (fen: string, skill: Skill, extra: Partial<ChessState> = {}) =>
    {
        const state = stateAt(fen, extra);
        const play = chessAgent.decide(askOf(state, skill));

        applied(state, turnSeat(state), play as MatchPlay);

        return play as MatchPlay & { from?: number; to?: number; promotion?: string };
    };

    it('mates in one at every skill, and mates rather than stalemates', () =>
    {
        for (const skill of SKILLS)
        {
            expect(playIn('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', skill), skill).toMatchObject({ from: 0, to: 56 });
            expect(playIn('k7/8/1K6/8/8/8/8/2Q5 w - - 0 1', skill), skill).toMatchObject({ from: 2, to: 58 });
        }
    });

    it('takes a queen left hanging, and promotes to a queen', () =>
    {
        for (const skill of SKILLS)
        {
            expect(playIn('rnb1kbnr/pppp1ppp/8/4p3/7q/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1', skill), skill).toMatchObject({ from: 21, to: 31 });
            expect(playIn('8/4P1k1/8/8/8/8/8/K7 w - - 0 1', skill), skill).toMatchObject({ from: 52, to: 60, promotion: 'q' });
        }
    });

    it('moves a pawn rather than let the fifty-move rule draw a won game', () =>
    {
        expect(playIn('k7/8/8/8/8/8/P7/K1Q5 w - - 99 80', 'intermediate')).toMatchObject({ from: 8 });
    });

    it('repeats a lost position a third time to draw it', () =>
    {
        const keyAt = (fen: string) => keyOf(at(fen), legalMoves(at(fen)));
        const lost = 'k7/8/3K4/8/8/8/7Q/8 b - - 20 60';

        // The position after ...Kb7 has stood twice; Black, a queen down, makes it stand a third time.
        const twice = keyAt('8/1k6/3K4/8/8/8/7Q/8 w - - 21 61');
        const filler = [keyAt('8/1k6/2K5/8/8/8/7Q/8 b - - 0 1'), keyAt('8/k7/2K5/8/8/8/7Q/8 w - - 0 1'), keyAt('8/k7/3K4/8/8/8/7Q/8 b - - 0 1')];
        const state = stateAt(lost, { keys: [twice, ...filler, twice, filler[0], filler[1], keyAt(lost)] });

        for (const skill of SKILLS)
        {
            expect(applied(state, 1, chessAgent.decide(askOf(state, skill)) as MatchPlay).over?.reason, skill).toBe('repetition');
        }
    });

    it('mates with king and queen, and with king and rook, from the middle of the board', () =>
    {
        for (const [fen, plies] of [['8/8/3k4/8/8/4K3/8/7Q w - - 0 1', 40], ['8/8/3k4/8/8/4K3/8/7R w - - 0 1', 70]] as const)
        {
            let state = stateAt(fen);

            while (state.over === null && state.ply < plies)
            {
                const seat = turnSeat(state);

                state = applied(state, seat, chessAgent.decide(askOf(state, seat === 0 ? 'intermediate' : 'semi-pro', 0, state.ply)) as MatchPlay);
            }

            expect(state.over, fen).toEqual({ winner: 0, reason: 'checkmate' });
        }
    }, 30_000);

    it('takes a draw offered when it stands clearly worse or the game is late and level, and plays on otherwise', () =>
    {
        // Black, a rook down, is offered a draw by White: it takes it. White, a rook up, offered one by Black: it plays on.
        const worse = stateAt('4k3/8/8/8/8/8/4P3/R3K3 b - - 0 30', { offer: 0 });
        const better = stateAt('4k3/8/8/8/8/8/4P3/R3K3 w - - 0 30', { offer: 1 });

        expect(chessAgent.decide(askOf(worse, 'intermediate'))).toEqual({ kind: 'chess', verb: 'accept' });
        expect(chessAgent.decide(askOf(better, 'intermediate'))?.verb).toBe('move');

        // A level pawn ending: early it plays on, late it agrees.
        const level = '4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 50';

        expect(chessAgent.decide(askOf(stateAt(level, { offer: 1, ply: 40 }), 'intermediate'))?.verb).toBe('move');
        expect(chessAgent.decide(askOf(stateAt(level, { offer: 1, ply: 120 }), 'intermediate'))).toEqual({ kind: 'chess', verb: 'accept' });
    });

    it('answers only when it is its turn, and never offers, resigns or flags', () =>
    {
        const state = stateAt('4k3/8/8/8/8/8/4P3/R3K3 w - - 0 30');

        expect(chessAgent.decide({ ...askOf(state, 'intermediate'), seat: 1 })).toBeNull();
        expect(chessAgent.version).toBe(2);
    });
});

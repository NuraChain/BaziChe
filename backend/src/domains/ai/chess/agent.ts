import { chessEngine } from '../../match/engines/chess.ts';
import { turnSeat, type ChessAction, type ChessState } from '../../match/chess/state.ts';
import type { Skill } from '../../system/rules.ts';
import type { MatchPlay } from '../../../schemas.ts';
import { playOf, type Agent, type Ask } from '../agent.ts';
import { Board, moveName } from './board.ts';
import { judgeOf, type Tastes, type Terms } from './evaluate.ts';
import { INFINITE, MATE_BOUND, search, type Limits, type Searched } from './search.ts';

/**
 * The chess agent: a real search over its own board, as strong as its skill lets it think.
 *
 * Skill decides how far it may look (a depth and a node cap), which parts of the evaluation it
 * sees, and how wide a margin of near-equal moves it chooses among; a weaker player thinks less
 * and sees less, and never plays a move it believes loses. The style shifts tastes a little - how
 * much it values an attack on the king, active pieces, pushing pawns, and how much it would rather
 * play on than draw - so two system players do not play alike. Everything comes from the ask: the
 * same position, skill, style and seed give the same move.
 *
 * It answers a draw offer: it takes one when it stands clearly worse, or late in a game that is
 * dead level, and otherwise declines it by moving, which the engine records as a decline. It never
 * offers, never resigns and never flags.
 */

interface Level
{
    limits: Limits;
    terms: Terms;

    /** Centipawns below the best a move may score and still be chosen. */
    margin: number;
}

const SEES_LITTLE: Terms = { pawns: false, pair: false, rooks: false, mobility: false, safety: false };
const SEES_STRUCTURE: Terms = { pawns: true, pair: true, rooks: true, mobility: false, safety: false };
const SEES_ALL: Terms = { pawns: true, pair: true, rooks: true, mobility: true, safety: true };

export const LEVELS: Readonly<Record<Skill, Level>> = {
    casual: { limits: { depth: 3, nodes: 12_000, table: 14 }, terms: SEES_LITTLE, margin: 40 },
    intermediate: { limits: { depth: 6, nodes: 60_000, table: 16 }, terms: SEES_STRUCTURE, margin: 20 },
    advanced: { limits: { depth: 10, nodes: 200_000, table: 18 }, terms: SEES_ALL, margin: 10 },
    'semi-pro': { limits: { depth: 16, nodes: 600_000, table: 19 }, terms: SEES_ALL, margin: 4 }
};

/** Plies of a game in which the margin is wider, so openings vary from game to game. */
const OPENING_PLIES = 12;
const OPENING_MARGIN = 20;

/** Below this, in centipawns, a side stands clearly worse and takes a draw offered. */
const WORSE = -150;

/** A game this long and this level is a draw worth agreeing. */
const LATE_PLY = 80;
const LEVEL = 20;

/** The share of the budget the search may use, the rest kept for the answer's way back. */
const BUDGET_SHARE = 0.85;

/** Tastes from a style: each digit of it moves one taste within 15% either way. */
export function tastesOf(style: number): { tastes: Tastes; contempt: number }
{
    const digit = (place: number) => (Math.floor(Math.abs(style) / place) % 10) / 9;

    return {
        tastes: {
            attack: 0.85 + 0.3 * digit(1),
            activity: 0.85 + 0.3 * digit(10),
            pushing: 0.85 + 0.3 * digit(100)
        },
        contempt: 5 + (Math.abs(style) % 7) * 4
    };
}

const nameKey = (from: number, to: number, promotion: string | undefined) => `${ from }-${ to }-${ promotion ?? '' }`;

/** One move among the near-best, the nearer the likelier, by the ask's own random. */
function chosen(searched: Searched, margin: number, random: () => number): number
{
    const { moves, scores, best } = searched;

    if (searched.depth === 0 || Math.abs(best) > MATE_BOUND || margin <= 0)
    {
        return moves[0];
    }

    const near: { move: number; weight: number }[] = [];

    for (let at = 0; at < moves.length; at += 1)
    {
        const behind = best - scores[at];

        if (scores[at] > -INFINITE && behind <= margin)
        {
            near.push({ move: moves[at], weight: margin + 1 - behind });
        }
    }

    const total = near.reduce((sum, one) => sum + one.weight, 0);
    let draw = random() * total;

    for (const one of near)
    {
        draw -= one.weight;

        if (draw < 0)
        {
            return one.move;
        }
    }

    return near.length > 0 ? near[near.length - 1].move : moves[0];
}

/** What one decision found: the play, and the work it took. */
export interface Thought
{
    play: MatchPlay | null;
    nodes: number;
    depth: number;
    best: number;
}

const answered = (play: MatchPlay | null): Thought => ({ play, nodes: 0, depth: 0, best: 0 });

/** The decision with its working shown, for the specs; `decide` is its play. */
export function think(ask: Ask<ChessState>): Thought
{
    const state = ask.input;
    const seat = ask.seat;

    if (state.over !== null || turnSeat(state) !== seat)
    {
        return answered(null);
    }

    const legal = chessEngine.legal(state, seat);

    if (legal.length === 0)
    {
        return answered(null);
    }

    const offered = state.offer === 1 - seat;

    if (legal.length === 1 && !offered)
    {
        return answered(playOf('chess', legal[0]));
    }

    const board = Board.of(state.position, state.keys.slice(0, -1));
    const byName = new Map<string, ChessAction>();

    for (const action of legal)
    {
        if (action.kind === 'move')
        {
            byName.set(nameKey(action.from, action.to, action.promotion), action);
        }
    }

    // The root searches only moves the engine itself allows, each matched to the board's own.
    const roots = board.legal().filter((move) =>
    {
        const name = moveName(move);

        return byName.has(nameKey(name.from, name.to, name.promotion));
    });

    if (roots.length === 0)
    {
        return answered(playOf('chess', legal[0]));
    }

    const level = LEVELS[ask.skill] ?? LEVELS.intermediate;
    const { tastes, contempt } = tastesOf(ask.style);
    const margin = level.margin + (state.ply < OPENING_PLIES ? OPENING_MARGIN : 0);
    const searched = search({
        board,
        judge: judgeOf(level.terms, tastes),
        limits: level.limits,
        contempt,
        margin,
        spent: ask.spent,
        budget: Math.max(1, ask.budget * BUDGET_SHARE)
    }, roots);

    const worked = { nodes: searched.nodes, depth: searched.depth, best: searched.best };

    if (offered && searched.depth > 0 && (searched.best <= WORSE || (state.ply >= LATE_PLY && Math.abs(searched.best) <= LEVEL)))
    {
        return { play: { kind: 'chess', verb: 'accept' }, ...worked };
    }

    const name = moveName(chosen(searched, margin, ask.random));

    return { play: playOf('chess', byName.get(nameKey(name.from, name.to, name.promotion)) ?? legal[0]), ...worked };
}

const decide = (ask: Ask<ChessState>) => think(ask).play;

export const chessAgent: Agent<ChessState> = {
    id: 'chess',
    version: 2,
    decide
};

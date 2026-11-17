import { KING, PAWN, QUEEN, fromOf, promotionOf, toOf, type Board } from './board.ts';
import { VALUE, evaluate, type Judge } from './evaluate.ts';

/**
 * Iterative deepening alpha-beta over the agent's own board: principal variation search with a
 * transposition table, null-move pruning and late-move reductions, a quiescence search over
 * captures and promotions, and moves tried in the order most likely to cut (the table's move,
 * captures by victim and attacker, killers, history). Repetitions and the fifty-move rule score as
 * draws, and a mate scores by its distance so the faster one is preferred.
 *
 * Its work is counted in nodes and stops at the node cap, so a decision is the same for the same
 * input; the clock is only the safety stop the runtime's budget asks for.
 */

export const INFINITE = 1_000_000;
export const MATE = 100_000;
export const MATE_BOUND = MATE - 1_000;

const MOST_PLY = 120;
const MOVES_PER_PLY = 256;

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;

/** How often, in nodes, the clock is read. */
const CLOCK_EVERY = 1024;

export interface Limits
{
    depth: number;
    nodes: number;

    /** log2 of the transposition table's entries. */
    table: number;
}

export interface Searched
{
    /** The root moves, the best first, as the last finished iteration ordered them. */
    moves: number[];

    /** By root move: its exact score, or -INFINITE for a move that fell more than the margin below the best found before it. */
    scores: number[];
    best: number;
    depth: number;
    nodes: number;
}

export interface Searching
{
    board: Board;
    judge: Judge;
    limits: Limits;

    /** What a draw is worth to the side that searches, below nothing: how much it would rather play on. */
    contempt: number;

    /** How far below the best a root move may score and still be scored exactly. */
    margin: number;
    spent: () => number;
    budget: number;
}

export function search(input: Searching, rootMoves: readonly number[]): Searched
{
    const { board, judge, limits, contempt, margin } = input;
    const size = 1 << limits.table;
    const mask = size - 1;
    const tableHi = new Int32Array(size);
    const tableLo = new Int32Array(size);
    const tableMove = new Int32Array(size);
    const tableScore = new Int32Array(size);
    const tableDepth = new Int8Array(size).fill(-1);
    const tableFlag = new Int8Array(size);
    const moves = new Int32Array(MOST_PLY * MOVES_PER_PLY);
    const ranks = new Int32Array(MOST_PLY * MOVES_PER_PLY);
    const killers = new Int32Array(MOST_PLY * 2);
    const history = new Int32Array(16 * 128);
    let nodes = 0;
    let stopped = false;

    const stopping = () =>
    {
        if (nodes >= limits.nodes || ((nodes & (CLOCK_EVERY - 1)) === 0 && input.spent() >= input.budget))
        {
            stopped = true;
        }

        return stopped;
    };

    const drawn = (ply: number) => ((ply & 1) === 0 ? -contempt : contempt);

    const rank = (move: number, best: number, ply: number) =>
    {
        if (move === best)
        {
            return 3_000_000;
        }

        const taken = board.takenBy(move);
        const promotion = promotionOf(move);

        if (taken !== 0)
        {
            return 2_000_000 + VALUE[taken & 7] * 8 - VALUE[board.squares[fromOf(move)] & 7] / 100 + (promotion === QUEEN ? 1000 : 0);
        }

        if (promotion !== 0)
        {
            return promotion === QUEEN ? 1_900_000 : -1_000;
        }

        if (move === killers[ply * 2])
        {
            return 1_500_000;
        }

        if (move === killers[ply * 2 + 1])
        {
            return 1_400_000;
        }

        return history[board.squares[fromOf(move)] * 128 + toOf(move)];
    };

    /** Brings the best-ranked move still waiting to `at`. */
    const pick = (at: number, end: number) =>
    {
        let best = at;

        for (let other = at + 1; other < end; other += 1)
        {
            if (ranks[other] > ranks[best])
            {
                best = other;
            }
        }

        if (best !== at)
        {
            const move = moves[at];
            const ranked = ranks[at];

            moves[at] = moves[best];
            ranks[at] = ranks[best];
            moves[best] = move;
            ranks[best] = ranked;
        }

        return moves[at];
    };

    const hasPieces = () =>
    {
        const squares = board.squares;
        const colour = board.side * 8;

        for (let square = 0; square < 120; square += 1)
        {
            if ((square & 0x88) !== 0)
            {
                square += 7;
                continue;
            }

            const piece = squares[square];

            if (piece !== 0 && (piece & 8) === colour && (piece & 7) !== PAWN && (piece & 7) !== KING)
            {
                return true;
            }
        }

        return false;
    };

    const anyLegal = (ply: number) =>
    {
        const start = ply * MOVES_PER_PLY;
        const end = board.generate(moves, start, false);

        for (let at = start; at < end; at += 1)
        {
            if (board.make(moves[at]))
            {
                board.unmake();

                return true;
            }
        }

        return false;
    };

    const quiesce = (alphaIn: number, beta: number, ply: number, deep: number): number =>
    {
        let alpha = alphaIn;

        nodes += 1;

        if (stopping())
        {
            return 0;
        }

        if (ply >= MOST_PLY - 2)
        {
            return evaluate(board, judge);
        }

        const checked = deep < 4 && board.inCheck();
        let stand = -INFINITE;

        if (!checked)
        {
            stand = evaluate(board, judge);

            if (stand >= beta)
            {
                return stand;
            }

            if (stand > alpha)
            {
                alpha = stand;
            }
        }

        const start = ply * MOVES_PER_PLY;
        const end = board.generate(moves, start, !checked);

        for (let at = start; at < end; at += 1)
        {
            ranks[at] = rank(moves[at], 0, ply);
        }

        let best = stand;
        let legal = 0;

        for (let at = start; at < end; at += 1)
        {
            const move = pick(at, end);

            if (!checked)
            {
                const promotion = promotionOf(move);

                if (promotion !== 0 && promotion !== QUEEN)
                {
                    continue;
                }

                // A capture that cannot lift the score near alpha even for free is not worth a look.
                if (promotion === 0 && stand + VALUE[board.takenBy(move) & 7] + 200 < alpha)
                {
                    continue;
                }
            }

            if (!board.make(move))
            {
                continue;
            }

            legal += 1;

            const score = -quiesce(-beta, -alpha, ply + 1, deep + 1);

            board.unmake();

            if (stopped)
            {
                return 0;
            }

            if (score > best)
            {
                best = score;

                if (score > alpha)
                {
                    alpha = score;

                    if (score >= beta)
                    {
                        return score;
                    }
                }
            }
        }

        if (checked && legal === 0)
        {
            return -MATE + ply;
        }

        return best;
    };

    const negamax = (depthIn: number, alphaIn: number, betaIn: number, ply: number, nullable: boolean): number =>
    {
        let depth = depthIn;
        let alpha = alphaIn;
        let beta = betaIn;

        nodes += 1;

        if (stopping())
        {
            return 0;
        }

        const checked = board.inCheck();

        if (board.halfmove >= 100)
        {
            return checked && !anyLegal(ply) ? -MATE + ply : drawn(ply);
        }

        if (board.repeated())
        {
            return drawn(ply);
        }

        alpha = Math.max(alpha, -MATE + ply);
        beta = Math.min(beta, MATE - ply - 1);

        if (alpha >= beta)
        {
            return alpha;
        }

        if (checked && ply < MOST_PLY - 20)
        {
            depth += 1;
        }

        if (depth <= 0 || ply >= MOST_PLY - 10)
        {
            return quiesce(alpha, beta, ply, 0);
        }

        const lo = board.keysLo[board.keyCount - 1];
        const hi = board.keysHi[board.keyCount - 1];
        const slot = lo & mask;
        let tableBest = 0;

        if (tableHi[slot] === hi && tableLo[slot] === lo)
        {
            tableBest = tableMove[slot];

            if (tableDepth[slot] >= depth)
            {
                let stored = tableScore[slot];

                stored = stored > MATE_BOUND ? stored - ply : (stored < -MATE_BOUND ? stored + ply : stored);

                const flag = tableFlag[slot];

                if (flag === EXACT || (flag === LOWER && stored >= beta) || (flag === UPPER && stored <= alpha))
                {
                    return stored;
                }
            }
        }

        const pv = beta - alpha > 1;

        if (nullable && !checked && !pv && depth >= 3 && beta < MATE_BOUND && hasPieces() && evaluate(board, judge) >= beta)
        {
            board.pass();

            const score = -negamax(depth - 3, -beta, -beta + 1, ply + 1, false);

            board.unpass();

            if (stopped)
            {
                return 0;
            }

            if (score >= beta)
            {
                return beta;
            }
        }

        const start = ply * MOVES_PER_PLY;
        const end = board.generate(moves, start, false);

        for (let at = start; at < end; at += 1)
        {
            ranks[at] = rank(moves[at], tableBest, ply);
        }

        const opened = alpha;
        let best = -INFINITE;
        let bestMove = 0;
        let legal = 0;

        for (let at = start; at < end; at += 1)
        {
            const move = pick(at, end);
            const quiet = board.takenBy(move) === 0 && promotionOf(move) === 0;
            const piece = board.squares[fromOf(move)];

            if (!board.make(move))
            {
                continue;
            }

            legal += 1;

            let score: number;

            if (legal === 1)
            {
                score = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
            }
            else
            {
                const reduce = quiet && depth >= 3 && legal > 4 && !checked && move !== killers[ply * 2] && move !== killers[ply * 2 + 1] && !board.inCheck()
                    ? (legal > 10 && depth >= 5 ? 2 : 1)
                    : 0;

                score = -negamax(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);

                if (score > alpha && reduce > 0 && !stopped)
                {
                    score = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
                }

                if (score > alpha && score < beta && !stopped)
                {
                    score = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
                }
            }

            board.unmake();

            if (stopped)
            {
                return 0;
            }

            if (score > best)
            {
                best = score;
                bestMove = move;

                if (score > alpha)
                {
                    alpha = score;

                    if (score >= beta)
                    {
                        if (quiet)
                        {
                            if (killers[ply * 2] !== move)
                            {
                                killers[ply * 2 + 1] = killers[ply * 2];
                                killers[ply * 2] = move;
                            }

                            history[piece * 128 + toOf(move)] = Math.min(1_000_000, history[piece * 128 + toOf(move)] + depth * depth);
                        }

                        break;
                    }
                }
            }
        }

        if (legal === 0)
        {
            return checked ? -MATE + ply : drawn(ply);
        }

        const flag = best >= beta ? LOWER : (best > opened ? EXACT : UPPER);
        const stored = best > MATE_BOUND ? best + ply : (best < -MATE_BOUND ? best - ply : best);

        tableHi[slot] = hi;
        tableLo[slot] = lo;
        tableMove[slot] = bestMove;
        tableScore[slot] = stored;
        tableDepth[slot] = depth;
        tableFlag[slot] = flag;

        return best;
    };

    // The root: the moves the engine allows, first ordered as any node orders its own.
    let order = [...rootMoves].sort((one, other) => rank(other, 0, 0) - rank(one, 0, 0));
    let scores = order.map(() => -INFINITE);
    let finished = 0;
    let best = -INFINITE;

    for (let depth = 1; depth <= limits.depth; depth += 1)
    {
        if (depth > 1 && nodes >= limits.nodes / 2)
        {
            break;
        }

        const found = order.map(() => -INFINITE);
        let top = -INFINITE;

        for (let at = 0; at < order.length; at += 1)
        {
            const move = order[at];

            if (!board.make(move))
            {
                continue;
            }

            let score: number;
            let exact = true;

            if (top === -INFINITE)
            {
                score = -negamax(depth - 1, -INFINITE, INFINITE, 1, true);
            }
            else
            {
                const bound = top - margin;

                score = -negamax(depth - 1, -bound - 1, -bound, 1, true);

                if (score > bound && !stopped)
                {
                    score = -negamax(depth - 1, -INFINITE, -bound, 1, true);
                }

                // A move that fails the bound is only known to be no better than it.
                exact = score > bound;
            }

            board.unmake();

            if (stopped)
            {
                break;
            }

            found[at] = exact ? score : -INFINITE;

            if (score > top)
            {
                top = score;
            }
        }

        if (stopped)
        {
            break;
        }

        const sorted = order.map((move, at) => ({ move, score: found[at], at })).sort((one, other) => other.score - one.score || one.at - other.at);

        order = sorted.map((one) => one.move);
        scores = sorted.map((one) => one.score);
        best = top;
        finished = depth;

        // A mate found within the depth searched will not be bettered by searching deeper.
        if (Math.abs(top) > MATE_BOUND && MATE - Math.abs(top) <= depth)
        {
            break;
        }
    }

    return { moves: order, scores, best, depth: finished, nodes };
}

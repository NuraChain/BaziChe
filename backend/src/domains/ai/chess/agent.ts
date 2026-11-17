import { chessEngine } from '../../match/engines/chess.ts';
import { attacked } from '../../match/chess/moves.ts';
import { colourOf, kindOf, opponent, type Colour } from '../../match/chess/board.ts';
import { colourOfSeat, turnSeat, type ChessAction, type ChessState } from '../../match/chess/state.ts';
import { MARGIN, playOf, type Agent, type Ask } from '../agent.ts';

/**
 * The baseline: one ply over every legal move, scored by material with the worst piece left
 * hanging taken off. Never flags, never resigns; it is replaced by a real search later, under the
 * same export.
 */

const VALUE: Readonly<Record<string, number>> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const MATE = 100_000;

const NO_DRAWS = { die: () => 1 };

/** Material for `colour`, less the most valuable of its pieces the other side attacks and nothing defends. */
function scoreOf(board: string, colour: Colour)
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
}

function decide(ask: Ask<ChessState>)
{
    const state = ask.input;
    const seat = ask.seat;

    if (state.over !== null || turnSeat(state) !== seat)
    {
        return null;
    }

    const colour = colourOfSeat(state, seat);
    const now = scoreOf(state.position.board, colour);

    // A draw offered to a side clearly behind is taken; otherwise the move below declines it.
    if (state.offer === 1 - seat && now <= -300)
    {
        return { kind: 'chess' as const, verb: 'accept' as const };
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
        const score = over === null
            ? scoreOf(after.state.position.board, colour)
            : (over.winner === seat ? MATE : (over.winner === null ? 0 : -MATE));

        scored.push({ move, score });
    }

    if (scored.length === 0)
    {
        return null;
    }

    const best = Math.max(...scored.map((one) => one.score));
    const margin = MARGIN[ask.skill] * 200 + 5;
    const near = scored.filter((one) => one.score >= best - margin);
    const picked = near[Math.floor(ask.random() * near.length)] ?? scored[0];

    return playOf('chess', picked.move);
}

export const chessAgent: Agent<ChessState> = {
    id: 'chess',
    version: 1,
    decide
};

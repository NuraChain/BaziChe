import { colourOf, kindOf } from '../match/chess/board.ts';
import { chessEngine } from '../match/engines/chess.ts';
import { colourOfSeat, turnSeat, type ChessState } from '../match/chess/state.ts';
import type { MatchPlay } from '../../schemas.ts';
import { playOf } from './agent.ts';

/**
 * The runtime's own cheap chess move, for when no decision arrived in time: chess's autoplay flags,
 * which is a loss and never a move. One ply by material, mate first, the first best kept. Separate
 * from the chess agent on purpose, which is replaced by a real search and must not take this with it.
 */

const VALUE: Readonly<Record<string, number>> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const NO_DRAWS = { die: () => 1 };

const materialOf = (board: string, white: boolean) =>
    [...board].reduce((sum, piece) => (piece === '.' ? sum : sum + ((colourOf(piece) === 'w') === white ? 1 : -1) * (VALUE[kindOf(piece)] ?? 0)), 0);

export function onePlyChess(state: unknown, seat: number): MatchPlay | null
{
    const chess = state as ChessState;

    if (chess.over !== null || turnSeat(chess) !== seat)
    {
        return null;
    }

    const white = colourOfSeat(chess, seat) === 'w';
    let best: { play: MatchPlay | null; score: number } | null = null;

    for (const move of chessEngine.legal(chess, seat))
    {
        const after = chessEngine.apply(chess, move, NO_DRAWS);

        if (!after.ok)
        {
            continue;
        }

        const score = after.state.over === null
            ? materialOf(after.state.position.board, white)
            : (after.state.over.winner === seat ? Number.MAX_SAFE_INTEGER : (after.state.over.winner === null ? 0 : Number.MIN_SAFE_INTEGER));

        if (best === null || score > best.score)
        {
            best = { play: playOf('chess', move), score };
        }
    }

    return best?.play ?? null;
}

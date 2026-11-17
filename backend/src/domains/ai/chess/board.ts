import type { Position } from '../../match/chess/board.ts';

/**
 * A compact board for the chess agent's search, and only for it: the engine's own generator works
 * on a 64-character string and tests every pseudo-move by copying it, which is right for judging one
 * move and far too slow to search with. This one is a 0x88 mailbox that makes and unmakes moves in
 * place and keeps a Zobrist key as it goes. It never decides what is legal in a game; the agent's
 * root moves always come from `engine.legal`, and the specs hold this generator to the same perft
 * counts and to `engine.legal` itself.
 *
 * Squares are 0x88 (`rank * 16 + file`, a1 = 0). A piece is its kind (1 pawn .. 6 king) with 8
 * added for Black. A move is one integer: from, to, the promotion kind and a flag.
 */

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const BLACK = 8;

export const FLAG_DOUBLE = 1;
export const FLAG_PASSANT = 2;
export const FLAG_CASTLE = 3;

const CASTLE_K = 1;
const CASTLE_Q = 2;
const CASTLE_k = 4;
const CASTLE_q = 8;

export const fromOf = (move: number) => move & 127;
export const toOf = (move: number) => (move >> 7) & 127;
export const promotionOf = (move: number) => (move >> 14) & 7;
export const flagOf = (move: number) => (move >> 17) & 3;

const encode = (from: number, to: number, promotion: number, flag: number) => from | (to << 7) | (promotion << 14) | (flag << 17);

export const toMailbox = (square: number) => ((square >> 3) << 4) | (square & 7);
export const toSquare = (square: number) => ((square >> 4) << 3) | (square & 7);

export const KNIGHT_STEPS: readonly number[] = [33, 31, 18, 14, -33, -31, -18, -14];
export const KING_STEPS: readonly number[] = [1, -1, 16, -16, 15, 17, -15, -17];
export const ROOK_STEPS: readonly number[] = [1, -1, 16, -16];
export const BISHOP_STEPS: readonly number[] = [15, 17, -15, -17];

const LETTERS = '.PNBRQK..pnbrqk';

const PROMOTION_KINDS: Readonly<Record<string, number>> = { n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN };

export const PROMOTION_LETTERS = ['', '', 'n', 'b', 'r', 'q'] as const;

/** Which castling rights survive a move from or to each square. */
const KEEPS = new Int8Array(128).fill(15);

KEEPS[0] = 15 & ~CASTLE_Q;
KEEPS[7] = 15 & ~CASTLE_K;
KEEPS[4] = 15 & ~(CASTLE_K | CASTLE_Q);
KEEPS[112] = 15 & ~CASTLE_q;
KEEPS[119] = 15 & ~CASTLE_k;
KEEPS[116] = 15 & ~(CASTLE_k | CASTLE_q);

/**
 * The Zobrist numbers, two 32-bit halves each, drawn once from a fixed xorshift so a key is the same
 * in every process. They are constants: nothing writes to them after this.
 */
const ZOBRIST = (() =>
{
    let state = 0x2545f491;
    const next = () =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;

        return state | 0;
    };
    const pieces = new Int32Array(16 * 128 * 2);
    const castling = new Int32Array(16 * 2);
    const passant = new Int32Array(8 * 2);

    for (let at = 0; at < pieces.length; at += 1)
    {
        pieces[at] = next();
    }

    for (let at = 0; at < castling.length; at += 1)
    {
        castling[at] = next();
    }

    for (let at = 0; at < passant.length; at += 1)
    {
        passant[at] = next();
    }

    return { pieces, castling, passant, side: [next(), next()] as const };
})();

const MOST_PLIES = 160;

const HISTORY_MOST = 1024;

export class Board
{
    readonly squares = new Int8Array(128);

    /** 0 for White to move, 1 for Black. */
    side = 0;
    castling = 0;

    /** The square passed over by the double step just played, or -1. */
    passant = -1;
    halfmove = 0;
    readonly kings = new Int16Array(2);

    /** The key without the side, castling or en passant parts, which `keyLo`/`keyHi` add. */
    private placedLo = 0;
    private placedHi = 0;

    /** Every key since the position the game history begins at, the current one last. */
    readonly keysLo = new Int32Array(HISTORY_MOST + MOST_PLIES);
    readonly keysHi = new Int32Array(HISTORY_MOST + MOST_PLIES);
    keyCount = 0;

    private readonly undoMove = new Int32Array(MOST_PLIES);
    private readonly undoTaken = new Int8Array(MOST_PLIES);
    private readonly undoCastling = new Int8Array(MOST_PLIES);
    private readonly undoPassant = new Int16Array(MOST_PLIES);
    private readonly undoHalfmove = new Int16Array(MOST_PLIES);
    depth = 0;

    /** The board of an engine position. `before` are the game's earlier repetition keys, the oldest first. */
    static of(position: Position, before: readonly string[] = []): Board
    {
        const board = new Board();

        board.load(position.board, position.turn, position.castling, position.ep, position.halfmove);

        const lo = new Int32Array(1);
        const hi = new Int32Array(1);

        for (const key of before.slice(-HISTORY_MOST + 1))
        {
            Board.keyOfText(key, lo, hi);
            board.keysLo[board.keyCount] = lo[0];
            board.keysHi[board.keyCount] = hi[0];
            board.keyCount += 1;
        }

        board.keysLo[board.keyCount] = board.keyLo();
        board.keysHi[board.keyCount] = board.keyHi();
        board.keyCount += 1;

        return board;
    }

    /** The key of one of the engine's repetition keys (`board turn castling ep`), as this board would make it. */
    private static keyOfText(text: string, lo: Int32Array, hi: Int32Array)
    {
        const [placement, turn, castling, ep] = text.split(' ');
        const board = new Board();

        board.load(placement, turn === 'b' ? 'b' : 'w', castling === '-' ? '' : castling, null, 0);

        let keyLo = board.keyLo();
        let keyHi = board.keyHi();

        if (ep !== undefined && ep !== '-')
        {
            const file = Number(ep) & 7;

            keyLo ^= ZOBRIST.passant[file * 2];
            keyHi ^= ZOBRIST.passant[file * 2 + 1];
        }

        lo[0] = keyLo;
        hi[0] = keyHi;
    }

    private load(text: string, turn: 'w' | 'b', castling: string, ep: number | null, halfmove: number)
    {
        this.squares.fill(0);
        this.placedLo = 0;
        this.placedHi = 0;

        for (let square = 0; square < 64; square += 1)
        {
            const piece = LETTERS.indexOf(text[square]);

            if (piece > 0)
            {
                this.place(toMailbox(square), piece);
            }
        }

        this.side = turn === 'w' ? 0 : 1;
        this.castling = (castling.includes('K') ? CASTLE_K : 0) | (castling.includes('Q') ? CASTLE_Q : 0) | (castling.includes('k') ? CASTLE_k : 0) | (castling.includes('q') ? CASTLE_q : 0);
        this.passant = ep === null ? -1 : toMailbox(ep);
        this.halfmove = halfmove;
    }

    private place(square: number, piece: number)
    {
        this.squares[square] = piece;
        this.placedLo ^= ZOBRIST.pieces[(piece * 128 + square) * 2];
        this.placedHi ^= ZOBRIST.pieces[(piece * 128 + square) * 2 + 1];

        if ((piece & 7) === KING)
        {
            this.kings[piece >> 3] = square;
        }
    }

    private lift(square: number)
    {
        const piece = this.squares[square];

        this.squares[square] = 0;
        this.placedLo ^= ZOBRIST.pieces[(piece * 128 + square) * 2];
        this.placedHi ^= ZOBRIST.pieces[(piece * 128 + square) * 2 + 1];
    }

    /** Whether the side to move could take en passant at all, which is when the square counts in the key, as in the engine's. */
    private passantCounts()
    {
        if (this.passant < 0)
        {
            return false;
        }

        const pawn = PAWN | (this.side === 0 ? 0 : BLACK);
        const from = this.side === 0 ? this.passant - 16 : this.passant + 16;

        return (((from - 1) & 0x88) === 0 && this.squares[from - 1] === pawn) || (((from + 1) & 0x88) === 0 && this.squares[from + 1] === pawn);
    }

    keyLo()
    {
        let key = this.placedLo ^ ZOBRIST.castling[this.castling * 2] ^ ZOBRIST.side[0] * this.side;

        if (this.passantCounts())
        {
            key ^= ZOBRIST.passant[(this.passant & 7) * 2];
        }

        return key | 0;
    }

    keyHi()
    {
        let key = this.placedHi ^ ZOBRIST.castling[this.castling * 2 + 1] ^ ZOBRIST.side[1] * this.side;

        if (this.passantCounts())
        {
            key ^= ZOBRIST.passant[(this.passant & 7) * 2 + 1];
        }

        return key | 0;
    }

    /** Whether a piece of `by` (0 White, 1 Black) attacks `square`. */
    attacked(square: number, by: number)
    {
        const squares = this.squares;
        const colour = by === 0 ? 0 : BLACK;
        const pawnFrom = by === 0 ? square - 16 : square + 16;

        if ((((pawnFrom - 1) & 0x88) === 0 && squares[pawnFrom - 1] === (PAWN | colour)) || (((pawnFrom + 1) & 0x88) === 0 && squares[pawnFrom + 1] === (PAWN | colour)))
        {
            return true;
        }

        for (let at = 0; at < 8; at += 1)
        {
            const knight = square + KNIGHT_STEPS[at];

            if ((knight & 0x88) === 0 && squares[knight] === (KNIGHT | colour))
            {
                return true;
            }

            const king = square + KING_STEPS[at];

            if ((king & 0x88) === 0 && squares[king] === (KING | colour))
            {
                return true;
            }
        }

        for (let at = 0; at < 4; at += 1)
        {
            const step = ROOK_STEPS[at];

            for (let to = square + step; (to & 0x88) === 0; to += step)
            {
                const piece = squares[to];

                if (piece !== 0)
                {
                    if (piece === (ROOK | colour) || piece === (QUEEN | colour))
                    {
                        return true;
                    }

                    break;
                }
            }
        }

        for (let at = 0; at < 4; at += 1)
        {
            const step = BISHOP_STEPS[at];

            for (let to = square + step; (to & 0x88) === 0; to += step)
            {
                const piece = squares[to];

                if (piece !== 0)
                {
                    if (piece === (BISHOP | colour) || piece === (QUEEN | colour))
                    {
                        return true;
                    }

                    break;
                }
            }
        }

        return false;
    }

    inCheck()
    {
        return this.attacked(this.kings[this.side], 1 - this.side);
    }

    /**
     * The pseudo-legal moves of the side to move into `moves` from `start`, or only its captures and
     * promotions; returns the index after the last. Castling is checked here for everything but the
     * landing square, which `make` checks with every other move.
     */
    generate(moves: Int32Array, start: number, noisyOnly: boolean): number
    {
        const squares = this.squares;
        const us = this.side === 0 ? 0 : BLACK;
        const forward = this.side === 0 ? 16 : -16;
        const startRank = this.side === 0 ? 1 : 6;
        const lastRank = this.side === 0 ? 7 : 0;
        let count = start;

        for (let from = 0; from < 128; from += 1)
        {
            if ((from & 0x88) !== 0)
            {
                from += 7;
                continue;
            }

            const piece = squares[from];

            if (piece === 0 || (piece & BLACK) !== us)
            {
                continue;
            }

            const kind = piece & 7;

            if (kind === PAWN)
            {
                const one = from + forward;

                if ((one & 0x88) === 0 && squares[one] === 0)
                {
                    if ((one >> 4) === lastRank)
                    {
                        moves[count++] = encode(from, one, QUEEN, 0);
                        moves[count++] = encode(from, one, ROOK, 0);
                        moves[count++] = encode(from, one, BISHOP, 0);
                        moves[count++] = encode(from, one, KNIGHT, 0);
                    }
                    else if (!noisyOnly)
                    {
                        moves[count++] = encode(from, one, 0, 0);

                        const two = one + forward;

                        if ((from >> 4) === startRank && squares[two] === 0)
                        {
                            moves[count++] = encode(from, two, 0, FLAG_DOUBLE);
                        }
                    }
                }

                for (let side = -1; side <= 1; side += 2)
                {
                    const to = one + side;

                    if ((to & 0x88) !== 0)
                    {
                        continue;
                    }

                    const target = squares[to];

                    if (target !== 0 && (target & BLACK) !== us)
                    {
                        if ((to >> 4) === lastRank)
                        {
                            moves[count++] = encode(from, to, QUEEN, 0);
                            moves[count++] = encode(from, to, ROOK, 0);
                            moves[count++] = encode(from, to, BISHOP, 0);
                            moves[count++] = encode(from, to, KNIGHT, 0);
                        }
                        else
                        {
                            moves[count++] = encode(from, to, 0, 0);
                        }
                    }
                    else if (to === this.passant)
                    {
                        moves[count++] = encode(from, to, 0, FLAG_PASSANT);
                    }
                }

                continue;
            }

            if (kind === KNIGHT || kind === KING)
            {
                const steps = kind === KNIGHT ? KNIGHT_STEPS : KING_STEPS;

                for (let at = 0; at < 8; at += 1)
                {
                    const to = from + steps[at];

                    if ((to & 0x88) !== 0)
                    {
                        continue;
                    }

                    const target = squares[to];

                    if (target === 0 ? !noisyOnly : (target & BLACK) !== us)
                    {
                        moves[count++] = encode(from, to, 0, 0);
                    }
                }

                continue;
            }

            const first = kind === BISHOP ? 4 : 0;
            const last = kind === ROOK ? 4 : 8;

            for (let at = first; at < last; at += 1)
            {
                const step = KING_STEPS[at];

                for (let to = from + step; (to & 0x88) === 0; to += step)
                {
                    const target = squares[to];

                    if (target === 0)
                    {
                        if (!noisyOnly)
                        {
                            moves[count++] = encode(from, to, 0, 0);
                        }

                        continue;
                    }

                    if ((target & BLACK) !== us)
                    {
                        moves[count++] = encode(from, to, 0, 0);
                    }

                    break;
                }
            }
        }

        if (!noisyOnly)
        {
            count = this.castles(moves, count);
        }

        return count;
    }

    private castles(moves: Int32Array, start: number)
    {
        const squares = this.squares;
        const home = this.side === 0 ? 4 : 116;
        const colour = this.side === 0 ? 0 : BLACK;
        const enemy = 1 - this.side;
        let count = start;

        if (squares[home] !== (KING | colour) || (this.castling & (this.side === 0 ? CASTLE_K | CASTLE_Q : CASTLE_k | CASTLE_q)) === 0 || this.attacked(home, enemy))
        {
            return count;
        }

        if ((this.castling & (this.side === 0 ? CASTLE_K : CASTLE_k)) !== 0 && squares[home + 3] === (ROOK | colour)
            && squares[home + 1] === 0 && squares[home + 2] === 0 && !this.attacked(home + 1, enemy))
        {
            moves[count++] = encode(home, home + 2, 0, FLAG_CASTLE);
        }

        if ((this.castling & (this.side === 0 ? CASTLE_Q : CASTLE_q)) !== 0 && squares[home - 4] === (ROOK | colour)
            && squares[home - 1] === 0 && squares[home - 2] === 0 && squares[home - 3] === 0 && !this.attacked(home - 1, enemy))
        {
            moves[count++] = encode(home, home - 2, 0, FLAG_CASTLE);
        }

        return count;
    }

    /** What a move would take, 0 for nothing. */
    takenBy(move: number)
    {
        return flagOf(move) === FLAG_PASSANT ? (PAWN | (this.side === 0 ? BLACK : 0)) : this.squares[toOf(move)];
    }

    /**
     * Plays a pseudo-legal move of the side to move. When it would leave the mover's own king
     * attacked it is taken back at once and the answer is false.
     */
    make(move: number): boolean
    {
        const from = fromOf(move);
        const to = toOf(move);
        const flag = flagOf(move);
        const promotion = promotionOf(move);
        const piece = this.squares[from];
        const colour = piece & BLACK;
        const depth = this.depth;
        let taken = this.squares[to];

        this.undoMove[depth] = move;
        this.undoCastling[depth] = this.castling;
        this.undoPassant[depth] = this.passant;
        this.undoHalfmove[depth] = this.halfmove;

        if (flag === FLAG_PASSANT)
        {
            const square = colour === 0 ? to - 16 : to + 16;

            taken = this.squares[square];
            this.lift(square);
        }
        else if (taken !== 0)
        {
            this.lift(to);
        }

        this.undoTaken[depth] = taken;
        this.lift(from);
        this.place(to, promotion === 0 ? piece : (promotion | colour));

        if (flag === FLAG_CASTLE)
        {
            const [corner, landing] = to > from ? [from + 3, from + 1] : [from - 4, from - 1];

            this.lift(corner);
            this.place(landing, ROOK | colour);
        }

        this.castling &= KEEPS[from] & KEEPS[to];
        this.passant = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
        this.halfmove = (piece & 7) === PAWN || taken !== 0 ? 0 : this.halfmove + 1;
        this.side = 1 - this.side;
        this.depth = depth + 1;

        if (this.attacked(this.kings[1 - this.side], this.side))
        {
            this.restore();

            return false;
        }

        this.keysLo[this.keyCount] = this.keyLo();
        this.keysHi[this.keyCount] = this.keyHi();
        this.keyCount += 1;

        return true;
    }

    /** Takes back the last move `make` kept. */
    unmake()
    {
        this.keyCount -= 1;
        this.restore();
    }

    private restore()
    {
        const depth = this.depth - 1;
        const move = this.undoMove[depth];
        const from = fromOf(move);
        const to = toOf(move);
        const flag = flagOf(move);
        const moved = this.squares[to];
        const colour = moved & BLACK;
        const taken = this.undoTaken[depth];

        this.lift(to);
        this.place(from, promotionOf(move) === 0 ? moved : (PAWN | colour));

        if (flag === FLAG_CASTLE)
        {
            const [corner, landing] = to > from ? [from + 3, from + 1] : [from - 4, from - 1];

            this.lift(landing);
            this.place(corner, ROOK | colour);
        }

        if (taken !== 0)
        {
            this.place(flag === FLAG_PASSANT ? (colour === 0 ? to - 16 : to + 16) : to, taken);
        }

        this.castling = this.undoCastling[depth];
        this.passant = this.undoPassant[depth];
        this.halfmove = this.undoHalfmove[depth];
        this.side = 1 - this.side;
        this.depth = depth;
    }

    /** Passes the move, for null-move pruning. The half-move count is zeroed so no repetition is seen through it. */
    pass()
    {
        const depth = this.depth;

        this.undoMove[depth] = 0;
        this.undoTaken[depth] = 0;
        this.undoCastling[depth] = this.castling;
        this.undoPassant[depth] = this.passant;
        this.undoHalfmove[depth] = this.halfmove;
        this.passant = -1;
        this.halfmove = 0;
        this.side = 1 - this.side;
        this.depth = depth + 1;
        this.keysLo[this.keyCount] = this.keyLo();
        this.keysHi[this.keyCount] = this.keyHi();
        this.keyCount += 1;
    }

    unpass()
    {
        const depth = this.depth - 1;

        this.keyCount -= 1;
        this.passant = this.undoPassant[depth];
        this.halfmove = this.undoHalfmove[depth];
        this.side = 1 - this.side;
        this.depth = depth;
    }

    /** Whether the current position stood before, since the last capture or pawn move, with the same side to move. */
    repeated()
    {
        const last = this.keyCount - 1;
        const lo = this.keysLo[last];
        const hi = this.keysHi[last];
        const reach = Math.min(this.halfmove, last);

        for (let back = 4; back <= reach; back += 2)
        {
            if (this.keysLo[last - back] === lo && this.keysHi[last - back] === hi)
            {
                return true;
            }
        }

        return false;
    }

    /** How often the current position stood before in the game's history and this line together. */
    seen()
    {
        const last = this.keyCount - 1;
        const lo = this.keysLo[last];
        const hi = this.keysHi[last];
        const reach = Math.min(this.halfmove, last);
        let times = 0;

        for (let back = 2; back <= reach; back += 2)
        {
            if (this.keysLo[last - back] === lo && this.keysHi[last - back] === hi)
            {
                times += 1;
            }
        }

        return times;
    }

    /** The legal moves of the side to move, for the specs and the root. */
    legal(): number[]
    {
        const buffer = new Int32Array(256);
        const count = this.generate(buffer, 0, false);
        const found: number[] = [];

        for (let at = 0; at < count; at += 1)
        {
            if (this.make(buffer[at]))
            {
                this.unmake();
                found.push(buffer[at]);
            }
        }

        return found;
    }

    /** Counts the move sequences of `depth`, as the engine's `perft` does. */
    perft(depth: number): number
    {
        if (depth === 0)
        {
            return 1;
        }

        const buffer = new Int32Array(256);
        const count = this.generate(buffer, 0, false);
        let total = 0;

        for (let at = 0; at < count; at += 1)
        {
            if (this.make(buffer[at]))
            {
                total += depth === 1 ? 1 : this.perft(depth - 1);
                this.unmake();
            }
        }

        return total;
    }
}

/** A move as the engine names it: the squares a1 = 0 and the promotion letter. */
export function moveName(move: number): { from: number; to: number; promotion?: 'q' | 'r' | 'b' | 'n' }
{
    const promotion = promotionOf(move);

    return {
        from: toSquare(fromOf(move)),
        to: toSquare(toOf(move)),
        ...(promotion === 0 ? {} : { promotion: PROMOTION_LETTERS[promotion] as 'q' | 'r' | 'b' | 'n' })
    };
}

export const promotionKind = (letter: string | undefined) => (letter === undefined ? 0 : (PROMOTION_KINDS[letter] ?? 0));

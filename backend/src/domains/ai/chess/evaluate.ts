import { BISHOP, BISHOP_STEPS, BLACK, KING, KING_STEPS, KNIGHT, KNIGHT_STEPS, PAWN, QUEEN, ROOK, ROOK_STEPS, type Board } from './board.ts';

/**
 * What the search thinks of a position, in centipawns for the side to move.
 *
 * Every skill counts material and where the pieces stand, blended from the middle game to the
 * endgame by how much is left on the board, and knows how to drive a bare king to the edge. The
 * other terms are what a stronger player also sees, and a skill turns them on: pawn structure,
 * the bishop pair, rooks on open files, then mobility and the safety of each king.
 */

export interface Terms
{
    pawns: boolean;
    pair: boolean;
    rooks: boolean;
    mobility: boolean;
    safety: boolean;
}

/** Tastes a style shifts, each near 1. */
export interface Tastes
{
    attack: number;
    activity: number;
    pushing: number;
}

/** What one decision evaluates with: its terms, its tastes, and scratch space of its own. */
export interface Judge
{
    terms: Terms;
    tastes: Tastes;
    files: Int8Array;
    most: Int8Array;
    least: Int8Array;
    active: Float64Array;
}

export const judgeOf = (terms: Terms, tastes: Tastes): Judge => ({
    terms,
    tastes,
    files: new Int8Array(16),
    most: new Int8Array(16),
    least: new Int8Array(16),
    active: new Float64Array(4)
});

const MATERIAL_MG = [0, 90, 320, 330, 480, 950, 0];
const MATERIAL_EG = [0, 120, 300, 320, 530, 950, 0];

/** How much each piece counts towards the middle game, out of `PHASE_FULL`. */
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const PHASE_FULL = 24;

export const VALUE = [0, 100, 320, 330, 500, 900, 20000];

// Tables from White's side, the eighth rank first, as they are usually written.
const PAWN_TABLE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0
];

const PAWN_LATE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    80, 80, 80, 80, 80, 80, 80, 80,
    50, 50, 50, 50, 50, 50, 50, 50,
    30, 30, 30, 30, 30, 30, 30, 30,
    15, 15, 15, 15, 15, 15, 15, 15,
    5, 5, 5, 5, 5, 5, 5, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0
];

const KNIGHT_TABLE = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
];

const BISHOP_TABLE = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
];

const ROOK_TABLE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0
];

const QUEEN_TABLE = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20
];

const KING_TABLE = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20
];

const KING_LATE = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50
];

const EARLY_TABLES = [null, PAWN_TABLE, KNIGHT_TABLE, BISHOP_TABLE, ROOK_TABLE, QUEEN_TABLE, KING_TABLE];
const LATE_TABLES = [null, PAWN_LATE, KNIGHT_TABLE, BISHOP_TABLE, ROOK_TABLE, QUEEN_TABLE, KING_LATE];

/** By piece code and 0x88 square, material and place for that piece's own side, middle game and endgame. */
const EARLY = new Int16Array(16 * 128);
const LATE = new Int16Array(16 * 128);

for (let kind = PAWN; kind <= KING; kind += 1)
{
    for (let square = 0; square < 64; square += 1)
    {
        const file = square & 7;
        const rank = square >> 3;
        const white = (7 - rank) * 8 + file;
        const black = rank * 8 + file;
        const mailbox = rank * 16 + file;

        EARLY[kind * 128 + mailbox] = MATERIAL_MG[kind] + (EARLY_TABLES[kind] as number[])[white];
        LATE[kind * 128 + mailbox] = MATERIAL_EG[kind] + (LATE_TABLES[kind] as number[])[white];
        EARLY[(kind | BLACK) * 128 + mailbox] = MATERIAL_MG[kind] + (EARLY_TABLES[kind] as number[])[black];
        LATE[(kind | BLACK) * 128 + mailbox] = MATERIAL_EG[kind] + (LATE_TABLES[kind] as number[])[black];
    }
}

/** A passed pawn's worth by how far it has come, from its own side. */
const PASSED = [0, 5, 10, 20, 35, 60, 100, 0];

/** The safety a king loses to the weight of pieces bearing on the squares around it. */
const ATTACK_WEIGHT = [0, 0, 2, 2, 3, 5, 0];

const TEMPO = 10;

const centreDistance = (square: number) =>
{
    const file = square & 7;
    const rank = square >> 4;

    return Math.max(3 - file, file - 4) + Math.max(3 - rank, rank - 4);
};

const kingDistance = (one: number, other: number) => Math.max(Math.abs((one & 7) - (other & 7)), Math.abs((one >> 4) - (other >> 4)));

export function evaluate(board: Board, judge: Judge): number
{
    const squares = board.squares;
    const terms = judge.terms;
    const { files, most, least } = judge;
    let early0 = 0;
    let early1 = 0;
    let late0 = 0;
    let late1 = 0;
    let phase = 0;
    let bishops0 = 0;
    let bishops1 = 0;
    let shade0 = 0;
    let shade1 = 0;
    let pawns0 = 0;
    let pawns1 = 0;
    let heavy0 = 0;
    let heavy1 = 0;
    let minors = 0;

    files.fill(0);
    most.fill(-1);
    least.fill(8);

    for (let square = 0; square < 120; square += 1)
    {
        if ((square & 0x88) !== 0)
        {
            square += 7;
            continue;
        }

        const piece = squares[square];

        if (piece === 0)
        {
            continue;
        }

        const kind = piece & 7;
        const side = piece >> 3;

        phase += PHASE[kind];

        if (side === 0)
        {
            early0 += EARLY[piece * 128 + square];
            late0 += LATE[piece * 128 + square];
        }
        else
        {
            early1 += EARLY[piece * 128 + square];
            late1 += LATE[piece * 128 + square];
        }

        if (kind === PAWN)
        {
            const file = square & 7;
            const rank = square >> 4;
            const at = side * 8 + file;

            files[at] += 1;
            most[at] = Math.max(most[at], rank);
            least[at] = Math.min(least[at], rank);

            if (side === 0)
            {
                pawns0 += 1;
            }
            else
            {
                pawns1 += 1;
            }
        }
        else if (kind === BISHOP || kind === KNIGHT)
        {
            minors += 1;

            if (kind === BISHOP)
            {
                const shade = 1 << (((square & 7) + (square >> 4)) & 1);

                if (side === 0)
                {
                    bishops0 += 1;
                    shade0 |= shade;
                }
                else
                {
                    bishops1 += 1;
                    shade1 |= shade;
                }
            }
        }
        else if (kind === ROOK || kind === QUEEN)
        {
            if (side === 0)
            {
                heavy0 += 1;
            }
            else
            {
                heavy1 += 1;
            }
        }
    }

    // Nothing left that could ever mate is a draw however the pieces stand, as the engine rules it.
    if (pawns0 + pawns1 + heavy0 + heavy1 === 0 && (minors <= 1 || (minors === bishops0 + bishops1 && (shade0 | shade1) !== 3)))
    {
        return 0;
    }

    if (terms.pawns)
    {
        const pushing = judge.tastes.pushing;

        for (let side = 0; side < 2; side += 1)
        {
            let early = 0;
            let late = 0;

            for (let file = 0; file < 8; file += 1)
            {
                const count = files[side * 8 + file];

                if (count === 0)
                {
                    continue;
                }

                if (count > 1)
                {
                    early -= 12 * (count - 1);
                    late -= 18 * (count - 1);
                }

                const left = file > 0 ? files[side * 8 + file - 1] : 0;
                const right = file < 7 ? files[side * 8 + file + 1] : 0;

                if (left === 0 && right === 0)
                {
                    early -= 12 * count;
                    late -= 15 * count;
                }

                // The front pawn of a file is the one that may be passed.
                const other = (1 - side) * 8;
                const front = side === 0 ? most[side * 8 + file] : least[side * 8 + file];
                let passed = true;

                for (let near = Math.max(0, file - 1); near <= Math.min(7, file + 1) && passed; near += 1)
                {
                    if (files[other + near] === 0)
                    {
                        continue;
                    }

                    passed = side === 0 ? most[other + near] <= front : least[other + near] >= front;
                }

                if (passed)
                {
                    const come = side === 0 ? front : 7 - front;

                    early += (PASSED[come] >> 1) * pushing;
                    late += PASSED[come] * pushing;
                }
            }

            if (side === 0)
            {
                early0 += early;
                late0 += late;
            }
            else
            {
                early1 += early;
                late1 += late;
            }
        }
    }

    if (terms.pair)
    {
        if (bishops0 >= 2)
        {
            early0 += 30;
            late0 += 50;
        }

        if (bishops1 >= 2)
        {
            early1 += 30;
            late1 += 50;
        }
    }

    if (terms.rooks || terms.mobility || terms.safety)
    {
        const active = activity(board, judge);

        early0 += active[0];
        late0 += active[1];
        early1 += active[2];
        late1 += active[3];
    }

    const middle = Math.min(phase, PHASE_FULL);
    let score = ((early0 - early1) * middle + (late0 - late1) * (PHASE_FULL - middle)) / PHASE_FULL;

    score += mopUp(board, late0 - late1, pawns0, pawns1);

    const own = board.side === 0 ? score : -score;

    return Math.round(own) + TEMPO;
}

/**
 * Where one side has a winning lead and the other only a king and no pawns, the king belongs at the
 * edge and the winning king close to it: the plan that mates with a queen or a rook, which no
 * depth this search reaches would find on its own.
 */
function mopUp(board: Board, lead: number, pawns0: number, pawns1: number)
{
    const strong = lead > 0 ? 0 : 1;
    const margin = Math.abs(lead);

    if (margin < 400 || (strong === 0 ? pawns1 : pawns0) > 0)
    {
        return 0;
    }

    const weakKing = board.kings[1 - strong];
    const strongKing = board.kings[strong];
    const bonus = 12 * centreDistance(weakKing) + 6 * (7 - kingDistance(weakKing, strongKing));

    return strong === 0 ? bonus : -bonus;
}

/** Rooks on open files, mobility and king safety, by side: White's middle game and endgame, then Black's. */
function activity(board: Board, judge: Judge): Float64Array
{
    const squares = board.squares;
    const { terms, tastes } = judge;
    const { active, files } = judge;

    active.fill(0);

    const pressure = [0, 0];
    const queens = [0, 0];

    for (let square = 0; square < 120; square += 1)
    {
        if ((square & 0x88) !== 0)
        {
            square += 7;
            continue;
        }

        const piece = squares[square];
        const kind = piece & 7;

        if (piece === 0 || kind === PAWN || kind === KING)
        {
            continue;
        }

        const side = piece >> 3;
        const us = side * 8;
        const enemyKing = board.kings[1 - side];
        let early = 0;
        let late = 0;

        if (kind === QUEEN)
        {
            queens[side] += 1;
        }

        if (kind === ROOK && terms.rooks)
        {
            const file = square & 7;

            if (files[us + file] === 0)
            {
                const open = files[(1 - side) * 8 + file] === 0;

                early += open ? 20 : 10;
                late += open ? 10 : 5;
            }
        }

        if (terms.mobility || terms.safety)
        {
            let reach = 0;
            let near = 0;

            if (kind === KNIGHT)
            {
                for (let at = 0; at < 8; at += 1)
                {
                    const to = square + KNIGHT_STEPS[at];

                    if ((to & 0x88) === 0 && (squares[to] === 0 || (squares[to] >> 3) !== side))
                    {
                        reach += 1;

                        if (kingDistance(to, enemyKing) <= 1)
                        {
                            near += 1;
                        }
                    }
                }
            }
            else
            {
                const steps = kind === BISHOP ? BISHOP_STEPS : (kind === ROOK ? ROOK_STEPS : KING_STEPS);

                for (let at = 0; at < steps.length; at += 1)
                {
                    const step = steps[at];

                    for (let to = square + step; (to & 0x88) === 0; to += step)
                    {
                        const target = squares[to];

                        if (target === 0 || (target >> 3) !== side)
                        {
                            reach += 1;

                            if (kingDistance(to, enemyKing) <= 1)
                            {
                                near += 1;
                            }
                        }

                        if (target !== 0)
                        {
                            break;
                        }
                    }
                }
            }

            if (terms.mobility)
            {
                const centred = kind === KNIGHT ? reach - 4 : (kind === BISHOP ? reach - 6 : (kind === ROOK ? reach - 7 : reach - 13));
                const [weightEarly, weightLate] = kind === QUEEN ? [1, 2] : (kind === ROOK ? [2, 4] : [4, 4]);

                early += centred * weightEarly * tastes.activity;
                late += centred * weightLate * tastes.activity;
            }

            pressure[side] += near * ATTACK_WEIGHT[kind];
        }

        active[side * 2] += early;
        active[side * 2 + 1] += late;
    }

    if (terms.safety)
    {
        for (let side = 0; side < 2; side += 1)
        {
            const king = board.kings[side];
            const units = pressure[1 - side];
            const scale = queens[1 - side] > 0 ? 1 : 0.5;
            const shelter = shelterOf(board, king, side, files);

            active[side * 2] += shelter - Math.min(400, (units * units) / 3) * scale * tastes.attack;
        }
    }

    return active;
}

/** The pawns in front of a king on its own back two ranks, less its open files. */
function shelterOf(board: Board, king: number, side: number, files: Int8Array)
{
    const rank = king >> 4;
    const home = side === 0 ? rank <= 1 : rank >= 6;

    if (!home)
    {
        return -20;
    }

    const squares = board.squares;
    const pawn = PAWN | (side * 8);
    const forward = side === 0 ? 16 : -16;
    const file = king & 7;
    let score = 0;

    for (let near = Math.max(0, file - 1); near <= Math.min(7, file + 1); near += 1)
    {
        const one = king - file + near + forward;
        const two = one + forward;

        if (squares[one] === pawn)
        {
            score += 12;
        }
        else if ((two & 0x88) === 0 && squares[two] === pawn)
        {
            score += 6;
        }
        else if (files[side * 8 + near] === 0)
        {
            score -= 15;
        }
    }

    return score;
}

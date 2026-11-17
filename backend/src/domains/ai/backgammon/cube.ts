import type { BackgammonState } from '../../match/backgammon/state.ts';
import type { Sight } from './judge.ts';

/**
 * The cube, decided in match-winning chances.
 *
 * The match table is worked out from the score for each decision: a cubeless game with a fifth of
 * the wins gammons, the Crawford game played without the cube, and after it the trailer doubling at
 * once. Against it the agent weighs no double, double and take, and double and pass, with what the
 * cube is worth to whoever would own it.
 */

/** The share of games, either way, that end in a gammon, for the match table. */
const GAMMONS = 0.2;

/** What owning a live cube is worth, as a share of the game's swing at the current cube. */
const OWNING = 0.17;

/** What a taker gains from being able to redouble, as a share of the swing at the doubled cube. */
const RECUBE = 0.035;

export type Table = (mine: number, theirs: number) => number;

/** Match-winning chances from two "away" scores, for the games after this one. */
export function tableOf(crawfordUsed: boolean): Table
{
    const known = new Map<string, number>();

    const chance = (mine: number, theirs: number, used: boolean): number =>
    {
        if (mine <= 0)
        {
            return 1;
        }

        if (theirs <= 0)
        {
            return 0;
        }

        if (mine === 1 && theirs === 1)
        {
            return 0.5;
        }

        const key = `${ mine }/${ theirs }/${ used }`;
        const seen = known.get(key);

        if (seen !== undefined)
        {
            return seen;
        }

        let value: number;

        if ((mine === 1 || theirs === 1) && used)
        {
            // After the Crawford game the trailer doubles at once: every game is worth two.
            value = mine === 1
                ? 0.5 + 0.5 * ((1 - GAMMONS) * chance(1, theirs - 2, true) + GAMMONS * chance(1, theirs - 4, true))
                : 0.5 * ((1 - GAMMONS) * chance(mine - 2, 1, true) + GAMMONS * chance(mine - 4, 1, true));
        }
        else
        {
            const next = used || mine === 1 || theirs === 1;

            value = 0.5 * ((1 - GAMMONS) * chance(mine - 1, theirs, next) + GAMMONS * chance(mine - 2, theirs, next))
                + 0.5 * ((1 - GAMMONS) * chance(mine, theirs - 1, next) + GAMMONS * chance(mine, theirs - 2, next));
        }

        known.set(key, value);

        return value;
    };

    return (mine, theirs) => chance(mine, theirs, crawfordUsed);
}

export interface Seat
{
    /** Points each side still needs. */
    mine: number;
    theirs: number;
    cube: number;
    table: Table;
}

export function seatOf(state: BackgammonState, seat: number): Seat
{
    return {
        mine: state.target - state.score[seat],
        theirs: state.target - state.score[1 - seat],
        cube: state.cube,
        table: tableOf(state.crawford !== 'before')
    };
}

/** Match-winning chances if this game is played out at `cube` with this sight. */
function played(at: Seat, sight: Sight, cube: number)
{
    const { mine, theirs, table } = at;
    const single = sight.win - sight.gammonWin;
    const lost = 1 - sight.win - sight.gammonLoss;

    return single * table(mine - cube, theirs)
        + sight.gammonWin * table(mine - 2 * cube, theirs)
        + lost * table(mine, theirs - cube)
        + sight.gammonLoss * table(mine, theirs - 2 * cube);
}

export interface Weighed
{
    hold: number;
    take: number;
    pass: number;
}

/** No double, double and take, and double and pass, for the side that would double. */
export function weigh(at: Seat, sight: Sight): Weighed
{
    return {
        hold: played(at, sight, at.cube),
        take: played(at, sight, 2 * at.cube),
        pass: at.table(at.mine - at.cube, at.theirs)
    };
}

/** Below the other side's pass point, how far the cube's ownership value fades out, in chance of winning. */
const WINDOW = 0.1;

/**
 * Whether to double. Not when playing on is worth more than the other side's pass (too good).
 * Otherwise when doubling gains more than the cube's ownership is worth to the side that would
 * own it: nothing once that side could not use it, and less the nearer the position is to its pass
 * point, past which a double is a cash.
 */
export function shouldDouble(at: Seat, sight: Sight)
{
    const { hold, take, pass } = weigh(at, sight);

    if (pass < hold - 1e-9)
    {
        return false;
    }

    // Where the other side's take and pass are worth the same, with the gammon shares held.
    const gammonWin = sight.win > 0 ? sight.gammonWin / sight.win : 0;
    const gammonLoss = sight.win < 1 ? sight.gammonLoss / (1 - sight.win) : 0;
    const doubled = 2 * at.cube;
    const won = (1 - gammonWin) * at.table(at.mine - doubled, at.theirs) + gammonWin * at.table(at.mine - 2 * doubled, at.theirs);
    const lost = (1 - gammonLoss) * at.table(at.mine, at.theirs - doubled) + gammonLoss * at.table(at.mine, at.theirs - 2 * doubled);
    const passPoint = won > lost ? (pass - lost) / (won - lost) : 1;
    const fade = Math.max(0, Math.min(1, (passPoint - sight.win) / WINDOW));

    const theirCubeLive = at.theirs > doubled;
    const swing = at.table(at.mine - at.cube, at.theirs) - at.table(at.mine, at.theirs - at.cube);
    const owning = theirCubeLive ? OWNING * swing * fade : 0;

    return Math.min(take, pass) >= hold + owning;
}

/** Whether to take, for the side being doubled; `sight` is its own. */
export function shouldTake(at: Seat, sight: Sight)
{
    const doubled = 2 * at.cube;
    const take = played(at, sight, doubled);
    const pass = at.table(at.mine, at.theirs - at.cube);
    const myCubeLive = at.mine > doubled;
    const recube = myCubeLive ? RECUBE * (at.table(at.mine - doubled, at.theirs) - at.table(at.mine, at.theirs - doubled)) : 0;

    return take + recube >= pass;
}

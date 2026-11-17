import { BAR, CHECKERS, HOME, OFF, type Side } from '../../match/backgammon/board.ts';
import { ROLLS } from './position.ts';

/**
 * What a position is worth to the side that has just moved, with the other side to roll.
 *
 * The answer is a chance of winning and of winning or losing a gammon, so a look-ahead can average
 * it over the dice and the cube can read it as it is. A race is read from the dice it will take
 * each side to bear off; a contact position from a score in pips (the race, the shots left, the
 * points, primes and anchors, the bar) turned into a chance by a logistic curve.
 */

export interface Sight
{
    /** The chance the side that has just moved wins the game. */
    win: number;

    /** The chance it wins a gammon, and loses one. */
    gammonWin: number;
    gammonLoss: number;
}

/** Small leanings from a player's style, each near 1. */
export interface Taste
{
    risk: number;
    prime: number;
    anchor: number;
}

export type Depth = 'plain' | 'full';

export const PLAIN_TASTE: Taste = Object.freeze({ risk: 1, prime: 1, anchor: 1 });

/** Pips per roll on average. */
const PIPS_PER_ROLL = 49 / 6;

/** Checkers borne off per roll on average, doubles counted. */
const OFF_PER_ROLL = 7 / 3;

/** The spread of a contact score, in pips, that turns it into a chance. */
const SPREAD = 24;

/** How much the side on roll's structure counts against the side that has just moved. */
const THEIR_STRUCTURE = 1;

/** The other side has the dice: worth about half a roll. */
const TEMPO = 4;

/** What a made point is worth to its owner while the other side still has checkers behind it. */
const POINT: readonly number[] = [0, 1, 1.6, 2.6, 4, 5.4, 5, 4.2, 2.6, 1.8, 1.4, 1, 0.8];

/** An anchor in the other side's board, by the point it stands on. */
const ANCHOR: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.5, 4, 6, 5, 3.5, 2.5, 2];

const normal = (x: number) =>
{
    // Abramowitz and Stegun 26.2.17, close enough to the normal curve for a chance.
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

    return x >= 0 ? 1 - tail : tail;
};

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

const clamp = (value: number, least: number, most: number) => Math.max(least, Math.min(most, value));

function pipsOf(me: readonly number[])
{
    let total = 0;

    for (let point = 1; point <= BAR; point += 1)
    {
        total += me[point] * point;
    }

    return total;
}

function backOf(me: readonly number[])
{
    for (let point = BAR; point >= 1; point -= 1)
    {
        if (me[point] > 0)
        {
            return point;
        }
    }

    return 0;
}

/** True while some checker of one side still has to pass one of the other's. */
export function inContact(side: Side)
{
    return backOf(side.me) + backOf(side.them) >= BAR;
}

/** Pips plus the waste a bear-off will pay: Keith's adjustments for stacks low and gaps high. */
export function keithOf(me: readonly number[])
{
    let count = pipsOf(me);

    count += 2 * Math.max(0, me[1] - 1) + Math.max(0, me[2] - 1) + Math.max(0, me[3] - 3);

    for (let point = 4; point <= HOME; point += 1)
    {
        if (me[point] === 0)
        {
            count += 1;
        }
    }

    return count;
}

/** About how many rolls a side needs to bear everything off, with nothing in its way. */
export function rollsToFinish(me: readonly number[])
{
    const left = CHECKERS - me[OFF];

    if (left === 0)
    {
        return 0;
    }

    const byPips = keithOf(me) / PIPS_PER_ROLL;
    const byCount = left / OFF_PER_ROLL;

    return Math.max(byPips, byCount) + 0.15 * Math.min(byPips, byCount);
}

/** Rolls a side still needs before it can bear off its first checker, when it has borne off none. */
function rollsToSave(me: readonly number[])
{
    let outside = 0;

    for (let point = HOME + 1; point <= BAR; point += 1)
    {
        outside += me[point] * (point - HOME);
    }

    return outside / PIPS_PER_ROLL + 1;
}

/** A race, read from the rolls each side needs; `them` is on roll. */
function raceSight(side: Side): Sight
{
    const mine = rollsToFinish(side.me);
    const theirs = rollsToFinish(side.them);
    const spread = Math.max(0.45, 0.55 * Math.sqrt(mine + theirs));
    const theyWin = normal((mine - theirs + 0.5) / spread);
    const gammonOf = (winner: number, loser: readonly number[]) =>
        loser[OFF] > 0 ? 0 : normal((rollsToSave(loser) - winner - 0.5) / spread);

    return {
        win: 1 - theyWin,
        gammonWin: Math.min(1 - theyWin, gammonOf(mine, side.them)),
        gammonLoss: Math.min(theyWin, gammonOf(theirs, side.me))
    };
}

/** Of the other side's 36 rolls, which hit a blot of `me`, and what each hit costs at worst, in pips. */
export function shotsOf(side: Side)
{
    const me = side.me;
    const them = side.them;
    const blots: number[] = [];
    const from: number[] = [];
    let theirBoard = 0;

    for (let point = 1; point <= 24; point += 1)
    {
        if (me[point] === 1)
        {
            blots.push(point);
        }

        if (them[point] > 0)
        {
            from.push(BAR - point);
        }

        if (point <= HOME && them[point] >= 2)
        {
            theirBoard += 1;
        }
    }

    const onBar = them[BAR];
    const result = { shots: 0, cost: 0, blots: blots.length };

    if (blots.length === 0)
    {
        return result;
    }

    const blocked = (at: number) => at >= 1 && at <= 24 && me[at] >= 2;
    const lossAt = (point: number) => (BAR - point) + 5 + 0.75 * theirBoard * theirBoard;
    const blotAt = (point: number) => point >= 1 && point <= 24 && me[point] === 1;

    for (const [high, low, weight] of ROLLS)
    {
        let worst = 0;
        const hit = (point: number) =>
        {
            if (blotAt(point))
            {
                worst = Math.max(worst, lossAt(point));
            }
        };

        if (high === low)
        {
            const die = high;
            let steps = 4;
            const sources = from.slice();

            if (onBar > 0)
            {
                if (blocked(die))
                {
                    continue;
                }

                hit(die);
                steps -= Math.min(4, onBar);
                sources.push(die);
            }

            for (const start of sources)
            {
                for (let step = 1; step <= steps; step += 1)
                {
                    const at = start + step * die;

                    if (at > 24 || blocked(at))
                    {
                        break;
                    }

                    hit(at);
                }
            }
        }
        else if (onBar >= 2)
        {
            hit(high);
            hit(low);
        }
        else if (onBar === 1)
        {
            for (const [enter, other] of [[high, low], [low, high]])
            {
                if (blocked(enter))
                {
                    continue;
                }

                hit(enter);

                for (const start of from)
                {
                    hit(start + other);
                }

                hit(enter + other);
            }
        }
        else
        {
            for (const start of from)
            {
                hit(start + high);
                hit(start + low);

                if (!blocked(start + high) || !blocked(start + low))
                {
                    hit(start + high + low);
                }
            }
        }

        if (worst > 0)
        {
            result.shots += weight;
            result.cost += weight * worst;
        }
    }

    return result;
}

/** A side's points made in its own board. */
function boardOf(me: readonly number[])
{
    let made = 0;

    for (let point = 1; point <= HOME; point += 1)
    {
        if (me[point] >= 2)
        {
            made += 1;
        }
    }

    return made;
}

/** The plain reading a casual player makes: the race, and blots within reach. */
function plainScore(side: Side)
{
    const me = side.me;
    const them = side.them;
    let score = pipsOf(them) - pipsOf(me) - TEMPO;
    let rear = BAR;

    if (them[BAR] === 0)
    {
        rear = backOf(them);
    }

    // Their rearmost checker in this side's numbering.
    const behind = BAR - rear;

    for (let point = 1; point <= 24; point += 1)
    {
        if (me[point] === 1)
        {
            let near = false;
            let far = false;

            for (let distance = 1; distance <= 12 && distance < point + 1; distance += 1)
            {
                const at = point - distance;
                const theirs = at === 0 ? them[BAR] : them[BAR - at];

                if (at >= 0 && theirs > 0)
                {
                    near ||= distance <= 6;
                    far ||= distance > 6;
                }
            }

            score -= near ? 7 : (far ? 2.5 : 0);
        }

        if (me[point] >= 2 && point <= HOME && point > behind)
        {
            score += 2;
        }
    }

    return score + them[BAR] * 6 - me[BAR] * 6;
}

/**
 * What one side's checkers are worth as structure, against the other side's: points, primes and
 * the checkers they hold, anchors, builders, stacks, and checkers left back when ahead.
 */
function structureOf(me: readonly number[], them: readonly number[], lead: number, taste: Taste)
{
    let score = 0;

    // The other side's rearmost checker, in this side's numbering: 0 when one is on the bar.
    const rear = them[BAR] > 0 ? 0 : BAR - backOf(them);

    // A point blocks only checkers still behind it.
    let run = 0;
    let best = 0;
    let bestStart = 0;

    for (let point = 1; point <= 24; point += 1)
    {
        if (me[point] >= 2)
        {
            run += 1;

            if (point < POINT.length && point > rear)
            {
                score += POINT[point] * (point <= HOME ? 1 + 0.12 * them[BAR] : 1);
            }

            if (run > best)
            {
                best = run;
                bestStart = point - run + 1;
            }
        }
        else
        {
            run = 0;
        }
    }

    if (best >= 3 && bestStart > rear)
    {
        let trapped = them[BAR];

        for (let at = 1; at < bestStart; at += 1)
        {
            trapped += them[BAR - at];
        }

        score += taste.prime * ((best - 2) * (best - 2) * 1.4 + (best >= 4 ? trapped * (best - 3) * 1.6 : 0));
    }

    // Anchors in the other side's board, worth more the further behind in the race.
    const holding = 1 + clamp(-lead / 40, 0, 1);

    for (let point = 18; point <= 24; point += 1)
    {
        if (me[point] >= 2)
        {
            score += taste.anchor * ANCHOR[point] * holding;
        }
    }

    // Builders for the points still open in the board, and stacks that do nothing.
    let builders = 0;

    for (let point = HOME; point <= 11; point += 1)
    {
        const spare = me[point] >= 2 ? me[point] - 2 : me[point];

        builders += point === HOME ? spare * 0.5 : spare;
    }

    score += Math.min(5, builders) * 0.6 * (boardOf(me) < 5 ? 1 : 0.4);

    for (let point = 1; point <= 24; point += 1)
    {
        if (me[point] > 3)
        {
            score -= (me[point] - 3) * (point <= 2 ? 1.6 : 0.9);
        }
    }

    score -= (me[1] + 0.5 * me[2]) * 0.7;

    // Ahead in the race, checkers left back are a liability; behind, they are the game.
    if (lead > 8)
    {
        let back = me[BAR];

        for (let point = 19; point <= 24; point += 1)
        {
            back += me[point];
        }

        score -= back * Math.min(2.5, lead / 12);
    }

    return score;
}

/** The full reading: the race, the shots left to the side on roll, the bar, and both sides' structure. */
function fullScore(side: Side, taste: Taste)
{
    const me = side.me;
    const them = side.them;
    const lead = pipsOf(them) - pipsOf(me);
    const myBoard = boardOf(me);
    const theirBoard = boardOf(them);
    let score = lead - TEMPO;

    score -= taste.risk * shotsOf(side).cost / 36;
    score += them[BAR] * (4 + 1.3 * myBoard) - me[BAR] * (4 + 1.3 * theirBoard);
    score += structureOf(me, them, lead, taste) - THEIR_STRUCTURE * structureOf(them, me, -lead, PLAIN_TASTE);

    return { score, myBoard, theirBoard };
}

/** How much of a contact position's winning ends in a gammon, from checkers stuck far back. */
function gammonShare(stuck: number, board: number, off: number, onBar: number)
{
    if (off > 0)
    {
        return 0;
    }

    return clamp(0.05 + 0.035 * stuck + 0.025 * board * (onBar > 0 ? 1 : 0.4), 0, 0.6);
}

function stuckOf(them: readonly number[])
{
    let stuck = them[BAR];

    for (let point = 19; point <= 24; point += 1)
    {
        stuck += them[point];
    }

    return stuck;
}

/** The sight of `side` for the side that has just moved; `depth` picks which terms are read. */
export function sightOf(side: Side, depth: Depth, taste: Taste = PLAIN_TASTE): Sight
{
    if (side.me[OFF] === CHECKERS || side.them[OFF] === CHECKERS)
    {
        const won = side.me[OFF] === CHECKERS;
        const loser = won ? side.them : side.me;
        const gammon = loser[OFF] === 0 ? 1 : 0;

        return { win: won ? 1 : 0, gammonWin: won ? gammon : 0, gammonLoss: won ? 0 : gammon };
    }

    if (!inContact(side))
    {
        return raceSight(side);
    }

    if (depth === 'plain')
    {
        const win = logistic(plainScore(side) / SPREAD);

        return { win, gammonWin: win * 0.12, gammonLoss: (1 - win) * 0.12 };
    }

    const { score, myBoard, theirBoard } = fullScore(side, taste);
    const win = logistic(score / SPREAD);

    return {
        win,
        gammonWin: win * gammonShare(stuckOf(side.them), myBoard, side.them[OFF], side.them[BAR]),
        gammonLoss: (1 - win) * gammonShare(stuckOf(side.me), theirBoard, side.me[OFF], side.me[BAR])
    };
}

/** What gammons are worth to each side: nothing once a single game would end the match. */
export interface Stakes
{
    mine: number;
    theirs: number;
}

export const equityOf = (sight: Sight, stakes: Stakes) =>
    2 * sight.win - 1 + stakes.mine * sight.gammonWin - stakes.theirs * sight.gammonLoss;

/** The same sight from the other side. */
export const flipped = (sight: Sight): Sight => ({ win: 1 - sight.win, gammonWin: sight.gammonLoss, gammonLoss: sight.gammonWin });

import { backgammonEngine } from '../../match/engines/backgammon.ts';
import { CHECKERS, OFF, type Side } from '../../match/backgammon/board.ts';
import { sideOf } from '../../match/backgammon/engine.ts';
import type { BackgammonAction, BackgammonState } from '../../match/backgammon/state.ts';
import type { Skill } from '../../system/rules.ts';
import type { MatchPlay } from '../../../schemas.ts';
import { MARGIN, playOf, type Ask } from '../agent.ts';
import { seatOf, shouldDouble, shouldTake } from './cube.ts';
import { equityOf, flipped, inContact, sightOf, type Depth, type Sight, type Stakes, type Taste } from './judge.ts';
import { ROLLS, positionsAfter, stepped, turned } from './position.ts';

/**
 * How a system player chooses in backgammon.
 *
 * Every whole-turn move the engine offers is read one ply deep. An advanced player then looks at
 * the other side's 21 rolls for its best few candidates, each roll answered with the reply that
 * reads best for the other side; a semi-pro goes one roll further on its best two or three. Skill
 * also sets which terms the reading uses and how wide a margin of near-equal moves it picks among.
 * The work is counted in positions read, capped per skill; the clock is only the safety stop.
 */

export interface Plan
{
    depth: Depth;

    /** Candidates looked at over the other side's rolls, and one roll further. */
    wide: number;
    deep: number;

    /** Only candidates this close to the best, in equity, are looked at further. */
    window: number;

    /** Positions read at most in one decision, the safety stop on top of the clock. */
    cap: number;

    /** Whether the cube is read after a look over the dice rather than from the position. */
    rolledCube: boolean;
}

export const PLANS: Readonly<Record<Skill, Plan>> = {
    casual: { depth: 'plain', wide: 0, deep: 0, window: 0, cap: 2_000, rolledCube: false },
    intermediate: { depth: 'full', wide: 0, deep: 0, window: 0, cap: 4_000, rolledCube: false },
    advanced: { depth: 'full', wide: 4, deep: 0, window: 0.2, cap: 30_000, rolledCube: true },
    'semi-pro': { depth: 'full', wide: 6, deep: 2, window: 0.2, cap: 100_000, rolledCube: true }
};

/** A margin from `MARGIN` (0..0.3) in equity. */
const MARGIN_EQUITY = 0.2;

/** Of the budget, the share the look-ahead may use before it stops and answers with what it has. */
const BUDGET_SHARE = 0.75;

export interface Chosen
{
    play: MatchPlay | null;

    /** Positions read. */
    nodes: number;
}

/** The style number as small leanings: how much shots worry it, how much it likes primes and anchors. */
export function tasteOf(style: number): Taste
{
    const lean = (value: number, span: number) => 1 + ((value % span) / (span - 1) - 0.5) * 0.24;

    return {
        risk: lean(style, 7),
        prime: lean(Math.floor(style / 7), 11),
        anchor: lean(Math.floor(style / 77), 13)
    };
}

interface Look
{
    nodes: number;
    plan: Plan;
    taste: Taste;
    ask: Ask<BackgammonState>;
}

function stopped(look: Look)
{
    return look.nodes >= look.plan.cap || look.ask.spent() >= look.ask.budget * BUDGET_SHARE;
}

/** The side seen by the player who has just moved, read and counted. */
function read(look: Look, side: Side, stakes: Stakes)
{
    look.nodes += 1;

    return equityOf(sightOf(side, look.plan.depth, look.taste), stakes);
}

const swapped = (stakes: Stakes): Stakes => ({ mine: stakes.theirs, theirs: stakes.mine });

/** The best equity the mover can reach with one roll, from a side where the mover is `side.me`. */
function bestReply(look: Look, side: Side, high: number, low: number, stakes: Stakes)
{
    const options = positionsAfter(side, high, low);
    let best = -Infinity;
    let chosen = options[0];

    // Null when reading every option would pass the cap.
    if (look.nodes + options.length > look.plan.cap)
    {
        return null;
    }

    for (const option of options)
    {
        const value = read(look, option, stakes);

        if (value > best)
        {
            best = value;
            chosen = option;
        }
    }

    return { best, chosen };
}

/** A candidate's equity averaged over the other side's rolls, each answered with its best reply. */
function overTheirRolls(look: Look, after: Side, stakes: Stakes): number | null
{
    const theirs = turned(after);
    const flip = swapped(stakes);
    let total = 0;

    for (const [high, low, weight] of ROLLS)
    {
        const reply = stopped(look) ? null : bestReply(look, theirs, high, low, flip);

        if (reply === null)
        {
            return null;
        }

        total -= weight * reply.best;
    }

    return total / 36;
}

/** One roll further: their best reply to each of their rolls, then the mover's best answer to each of its own. */
function overBothRolls(look: Look, after: Side, stakes: Stakes): number | null
{
    const theirs = turned(after);
    const flip = swapped(stakes);
    let total = 0;

    for (const [high, low, weight] of ROLLS)
    {
        const reply = stopped(look) ? null : bestReply(look, theirs, high, low, flip);

        if (reply === null)
        {
            return null;
        }

        const mine = turned(reply.chosen);
        let inner = 0;

        for (const [mineHigh, mineLow, mineWeight] of ROLLS)
        {
            const answer = stopped(look) ? null : bestReply(look, mine, mineHigh, mineLow, stakes);

            if (answer === null)
            {
                return null;
            }

            inner += mineWeight * answer.best;
        }

        total += weight * inner / 36;
    }

    return total / 36;
}

interface Candidate
{
    move: BackgammonAction;
    after: Side;
    value: number;
}

/** The side a whole-turn move leaves, from the engine's own hops. */
function sideAfter(side: Side, move: BackgammonAction): Side
{
    let at = side;

    if (move.kind === 'move')
    {
        for (const hop of move.hops)
        {
            at = stepped(at, hop.from, hop.from - hop.to);
        }
    }

    return at;
}

export function stakesOf(state: BackgammonState, seat: number): Stakes
{
    // A gammon is worth something only while a single game would not already settle the match.
    const mine = state.target - state.score[seat];
    const theirs = state.target - state.score[1 - seat];

    return { mine: mine > state.cube ? 1 : 0, theirs: theirs > state.cube ? 1 : 0 };
}

/** Picks among the best, within the skill's margin, with the seeded random. */
function pick(ask: Ask<BackgammonState>, ranked: readonly Candidate[]): Candidate
{
    const best = ranked.reduce((top, one) => (one.value > top.value ? one : top), ranked[0]);
    const near = ranked.filter((one) => one.value >= best.value - MARGIN[ask.skill] * MARGIN_EQUITY - 1e-9);

    return near[Math.floor(ask.random() * near.length)] ?? best;
}

function chooseMove(look: Look, state: BackgammonState, legal: readonly BackgammonAction[]): BackgammonAction
{
    const seat = look.ask.seat;
    const side = sideOf(state, seat);
    const stakes = stakesOf(state, seat);
    let ranked: Candidate[] = legal.map((move) =>
    {
        const after = sideAfter(side, move);
        const value = after.me[OFF] === CHECKERS ? 10 : read(look, after, stakes);

        return { move, after, value };
    });

    if (ranked.length === 1)
    {
        return ranked[0].move;
    }

    const plan = look.plan;
    const contact = inContact(side);

    if (plan.wide > 0 && contact)
    {
        ranked.sort((one, other) => other.value - one.value);

        const top = ranked.filter((one, index) => index < plan.wide && one.value >= ranked[0].value - plan.window);

        if (top.length > 1)
        {
            const deeper: Candidate[] = [];

            for (const one of top)
            {
                const value = one.value >= 10 ? 10 : overTheirRolls(look, one.after, stakes);

                if (value === null)
                {
                    break;
                }

                deeper.push({ ...one, value });
            }

            if (deeper.length === top.length)
            {
                ranked = deeper;

                if (plan.deep > 0)
                {
                    ranked.sort((one, other) => other.value - one.value);

                    // A third candidate joins the deepest look when it is close to the best.
                    const close = ranked[plan.deep] !== undefined && ranked[0].value - ranked[plan.deep].value < 0.04;
                    const few = ranked.slice(0, plan.deep + (close ? 1 : 0));
                    const deepest: Candidate[] = [];

                    for (const one of few)
                    {
                        const value = one.value >= 10 ? 10 : overBothRolls(look, one.after, stakes);

                        if (value === null)
                        {
                            break;
                        }

                        deepest.push({ ...one, value });
                    }

                    if (deepest.length === few.length && few.length > 1)
                    {
                        ranked = deepest;
                    }
                }
            }
        }
    }

    return pick(look.ask, ranked).move;
}

/** The chance of winning for `seat`, about to roll with the cube in hand. */
function sightOnRoll(look: Look, state: BackgammonState, seat: number): Sight
{
    const side = sideOf(state, seat);
    const still = () =>
    {
        look.nodes += 1;

        return flipped(sightOf(turned(side), look.plan.depth, look.taste));
    };

    if (!look.plan.rolledCube)
    {
        return still();
    }

    // Each of its rolls answered with its best move, and the readings of those moves averaged.
    const stakes = stakesOf(state, seat);
    const sum = { win: 0, gammonWin: 0, gammonLoss: 0 };

    for (const [high, low, weight] of ROLLS)
    {
        const reply = stopped(look) ? null : bestReply(look, side, high, low, stakes);

        if (reply === null)
        {
            return still();
        }

        const sight = sightOf(reply.chosen, look.plan.depth, look.taste);

        sum.win += weight * sight.win;
        sum.gammonWin += weight * sight.gammonWin;
        sum.gammonLoss += weight * sight.gammonLoss;
    }

    return { win: sum.win / 36, gammonWin: sum.gammonWin / 36, gammonLoss: sum.gammonLoss / 36 };
}

/** The plain cube a casual player keeps: money thresholds, whatever the score. */
const CASUAL_DOUBLE = 0.7;
const CASUAL_TAKE = 0.25;

function wantsDouble(look: Look, state: BackgammonState, seat: number)
{
    const sight = sightOnRoll(look, state, seat);

    if (look.ask.skill === 'casual')
    {
        return sight.win >= CASUAL_DOUBLE;
    }

    return shouldDouble(seatOf(state, seat), sight);
}

function wantsTake(look: Look, state: BackgammonState, seat: number)
{
    const sight = flipped(sightOnRoll(look, state, 1 - seat));

    if (look.ask.skill === 'casual')
    {
        return sight.win >= CASUAL_TAKE;
    }

    return shouldTake(seatOf(state, seat), sight);
}

export function choose(ask: Ask<BackgammonState>, plan: Plan = PLANS[ask.skill]): Chosen
{
    const state = ask.input;
    const seat = ask.seat;
    const legal = backgammonEngine.legal(state, seat);
    const look: Look = { nodes: 0, plan, taste: tasteOf(ask.style), ask };

    if (legal.length === 0)
    {
        return { play: null, nodes: 0 };
    }

    const has = (kind: BackgammonAction['kind']) => legal.find((one) => one.kind === kind);
    const answer = (action: BackgammonAction | undefined): Chosen => ({ play: playOf('backgammon', action ?? legal[0]), nodes: look.nodes });

    if (state.phase === 'opening')
    {
        return answer(has('roll'));
    }

    if (state.phase === 'double')
    {
        return answer(has(wantsTake(look, state, seat) ? 'take' : 'drop'));
    }

    if (state.phase === 'roll')
    {
        return answer(has('double') !== undefined && wantsDouble(look, state, seat) ? has('double') : has('roll'));
    }

    return answer(chooseMove(look, state, legal));
}

import { ludoEngine } from '../../match/engines/ludo.ts';
import type { Draws } from '../../match/engine.ts';
import type { EngineAction, LudoState } from '../../match/ludo/state.ts';
import type { Skill } from '../../system/rules.ts';
import type { MatchPlay } from '../../../schemas.ts';
import { MARGIN, playOf, type Ask } from '../agent.ts';
import { PLAIN_TASTE, WEIGHTS, WIN, worthOf, type Taste, type Terms } from './judge.ts';

/**
 * How a system player chooses in ludo.
 *
 * Every token it may move is read by the position the move leaves. An advanced player then looks
 * over the next roll - an opponent's turn, or its own when it moved a six - with each opponent
 * answering the way that reads best for that opponent, and takes the expectation over the six
 * faces. A semi-pro looks one roll further, so it sees its own answer to the opponent's turn, and
 * counts the exact rolls of the endgame. Skill also sets which terms the reading uses and how wide
 * a margin of near-equal moves it picks among. The work is counted in positions read, capped per
 * skill; the clock is only the safety stop.
 *
 * A second look by played-out continuations (a dozen sampled dice runs over the best candidates,
 * the same runs for each) was tried for the semi-pro and measured weaker than the exact second roll,
 * 0.49-0.53 against 0.58 over the advanced player, so it is not here.
 */

export interface Plan
{
    terms: Terms;

    /** Rolls looked over after the move, each one expanded over all six faces. */
    depth: number;

    /** Positions read at most in one decision, the safety stop on top of the clock. */
    cap: number;
}

const PLAIN: Terms = { danger: false, stretch: false, race: false, weights: WEIGHTS };

const FULL: Terms = { danger: true, stretch: true, race: false, weights: WEIGHTS };

const EXPERT: Terms = { danger: true, stretch: true, race: true, weights: WEIGHTS };

export const PLANS: Readonly<Record<Skill, Plan>> = {
    casual: { terms: PLAIN, depth: 0, cap: 8 },
    intermediate: { terms: FULL, depth: 0, cap: 8 },
    advanced: { terms: FULL, depth: 1, cap: 400 },
    'semi-pro': { terms: EXPERT, depth: 2, cap: 12_000 }
};

/** A margin from `MARGIN` (0..0.3) in squares. */
const MARGIN_SQUARES = 10;

/** Of the budget, the share the look-ahead may use before it stops and answers with what it has. */
const BUDGET_SHARE = 0.75;

const FACES: readonly Draws[] = [1, 2, 3, 4, 5, 6].map((face) => ({ die: () => face }));

/** A move needs no die; the one it was rolled with is already in the state. */
const NO_DRAWS: Draws = { die: () => 1 };

export interface Chosen
{
    play: MatchPlay | null;

    /** Positions read. */
    nodes: number;
}

/** The style number as small leanings: how much being hit worries it, how much it hunts, how much it likes tokens out. */
export function tasteOf(style: number): Taste
{
    const lean = (value: number, span: number) => 1 + ((value % span) / (span - 1) - 0.5) * 0.24;

    return {
        risk: lean(style, 7),
        threat: lean(Math.floor(style / 7), 11),
        out: lean(Math.floor(style / 77), 13)
    };
}

interface Look
{
    nodes: number;
    plan: Plan;
    taste: Taste;
    side: number;
    ask: Ask<LudoState>;
    halted: boolean;
}

function stopped(look: Look)
{
    if (!look.halted && (look.nodes >= look.plan.cap || look.ask.spent() >= look.ask.budget * BUDGET_SHARE))
    {
        look.halted = true;
    }

    return look.halted;
}

const sideOfSeat = (state: LudoState, seat: number) => state.players.find((player) => player.seat === seat)?.side ?? seat;

/** The position read for `side`, and counted. Only this player reads with its own leanings. */
function read(look: Look, state: LudoState, side: number)
{
    look.nodes += 1;

    return worthOf(state, side, look.plan.terms, side === look.side ? look.taste : PLAIN_TASTE);
}

function moved(state: LudoState, action: EngineAction)
{
    const applied = ludoEngine.apply(state, action, NO_DRAWS);

    return applied.ok ? applied.state : null;
}

/** The positions the side to move may choose among, once it has rolled. */
function choicesOf(state: LudoState)
{
    const seat = state.players[state.turn].seat;

    return ludoEngine.legal(state, seat).map((action) => moved(state, action)).filter((one): one is LudoState => one !== null);
}

/** The move an opponent makes: the one that reads best for its own side. */
function reply(look: Look, choices: readonly LudoState[], side: number)
{
    if (choices.length === 1)
    {
        return choices[0];
    }

    let best = -Infinity;
    let chosen = choices[0];

    for (const choice of choices)
    {
        const value = read(look, choice, side);

        if (value > best)
        {
            best = value;
            chosen = choice;
        }
    }

    return chosen;
}

/** The position averaged over the next roll's six faces, `depth` rolls deep. */
function overRolls(look: Look, state: LudoState, depth: number): number
{
    if (state.winner !== null)
    {
        return state.winner === look.side ? WIN : -WIN;
    }

    if (depth === 0 || stopped(look))
    {
        return read(look, state, look.side);
    }

    const roller = state.players[state.turn].seat;
    let total = 0;

    for (const face of FACES)
    {
        const rolled = ludoEngine.apply(state, { kind: 'roll', seat: roller, die: 0 }, face);

        total += rolled.ok ? afterRoll(look, rolled.state, depth - 1) : read(look, state, look.side);
    }

    return total / FACES.length;
}

/** After a roll: a pass goes on to the next roll, a choice is made by whoever has it. */
function afterRoll(look: Look, state: LudoState, depth: number): number
{
    if (state.winner !== null || state.die === null)
    {
        return overRolls(look, state, depth);
    }

    const choices = choicesOf(state);
    const side = state.players[state.turn].side;

    if (choices.length === 0)
    {
        return read(look, state, look.side);
    }

    if (side !== look.side)
    {
        return overRolls(look, reply(look, choices, side), depth);
    }

    // Its own extra roll after a six, or its partner's turn in teams: the side's best.
    let best = -Infinity;

    for (const choice of choices)
    {
        best = Math.max(best, overRolls(look, choice, depth));
    }

    return best;
}

interface Candidate
{
    action: EngineAction;
    after: LudoState;
    value: number;
}

/** Picks among the best, within the skill's margin, with the seeded random. */
function pick(ask: Ask<LudoState>, ranked: readonly Candidate[]): Candidate
{
    const best = ranked.reduce((top, one) => (one.value > top.value ? one : top), ranked[0]);
    const near = ranked.filter((one) => one.value >= best.value - MARGIN[ask.skill] * MARGIN_SQUARES - 1e-9);

    return near[Math.floor(ask.random() * near.length)] ?? best;
}

function chooseMove(look: Look, state: LudoState, legal: readonly EngineAction[]): EngineAction
{
    const ranked: Candidate[] = [];

    for (const action of legal)
    {
        const after = moved(state, action);

        if (after !== null)
        {
            ranked.push({ action, after, value: read(look, after, look.side) });
        }
    }

    if (ranked.length === 0)
    {
        return legal[0];
    }

    // A move that wins needs no look ahead; the reading already says so.
    if (look.plan.depth > 0 && ranked.length > 1 && !ranked.some((one) => one.after.winner !== null))
    {
        const deeper = ranked.map((one) => ({ ...one, value: overRolls(look, one.after, look.plan.depth) }));

        // A look cut short by the clock compares candidates read to different depths, so it is dropped whole.
        if (!look.halted)
        {
            return pick(look.ask, deeper).action;
        }
    }

    return pick(look.ask, ranked).action;
}

/** The play for this seat: a roll or a single choice answered at once, otherwise the token the plan reads best. */
export function choose(ask: Ask<LudoState>): Chosen
{
    const state = ask.input;
    const legal = ludoEngine.legal(state, ask.seat);

    if (legal.length === 0)
    {
        return { play: null, nodes: 0 };
    }

    if (legal.length === 1)
    {
        return { play: playOf('ludo', legal[0]), nodes: 0 };
    }

    const look: Look = { nodes: 0, plan: PLANS[ask.skill], taste: tasteOf(ask.style), side: sideOfSeat(state, ask.seat), ask, halted: false };

    return { play: playOf('ludo', chooseMove(look, state, legal)), nodes: look.nodes };
}

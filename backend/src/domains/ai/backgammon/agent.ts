import { backgammonEngine } from '../../match/engines/backgammon.ts';
import { BAR, OFF, facing, pips } from '../../match/backgammon/board.ts';
import type { BackgammonAction, BackgammonState } from '../../match/backgammon/state.ts';
import { MARGIN, playOf, type Agent, type Ask } from '../agent.ts';

/**
 * The baseline: one ply over every whole-turn move, scored by the race, blots left where the other
 * side can hit them, points made and checkers sent to the bar. The cube is offered with a clear race
 * lead and taken unless far behind. Replaced by a real strategy later, under the same export.
 */

const NO_DRAWS = { die: () => 1 };

/** How far ahead in the race, as a share of the other side's pips, offers the cube. */
const DOUBLE_LEAD = 0.12;

/** How far behind, as a share, still takes it. */
const TAKE_BEHIND = 0.2;

function scoreOf(state: BackgammonState, seat: number)
{
    const me = state.checkers[seat];
    const them = state.checkers[1 - seat];
    let score = (pips(them) - pips(me)) + me[OFF] * 6 - them[OFF] * 6 + them[BAR] * 12 - me[BAR] * 12;

    for (let point = 1; point < BAR; point += 1)
    {
        if (me[point] >= 2)
        {
            score += point <= 6 ? 4 : 2;
        }

        // A lone checker the other side has checkers behind: theirs at `facing(p)` count down from their own side.
        if (me[point] === 1)
        {
            const exposed = them.some((count, from) => count > 0 && from > facing(point) && from !== OFF);

            score -= exposed ? 6 + (BAR - point) / 4 : 1;
        }
    }

    return score;
}

function decide(ask: Ask<BackgammonState>)
{
    const state = ask.input;
    const seat = ask.seat;
    const legal = backgammonEngine.legal(state, seat);

    if (legal.length === 0)
    {
        return null;
    }

    const kinds = new Set(legal.map((one) => one.kind));
    const race = (mine: number, theirs: number) => (theirs - mine) / Math.max(1, theirs);
    const lead = race(pips(state.checkers[seat]), pips(state.checkers[1 - seat]));

    if (kinds.has('take'))
    {
        return playOf('backgammon', { kind: lead >= -TAKE_BEHIND ? 'take' : 'drop', seat });
    }

    if (kinds.has('roll'))
    {
        return playOf('backgammon', { kind: kinds.has('double') && lead >= DOUBLE_LEAD ? 'double' : 'roll', seat });
    }

    const scored: { move: BackgammonAction; score: number }[] = [];

    for (const move of legal)
    {
        const after = backgammonEngine.apply(state, move, NO_DRAWS);

        if (after.ok)
        {
            const won = after.state.winner === seat || after.state.score[seat] > state.score[seat];

            scored.push({ move, score: won ? 10_000 : scoreOf(after.state, seat) });
        }
    }

    if (scored.length === 0)
    {
        return playOf('backgammon', legal[0]);
    }

    const best = Math.max(...scored.map((one) => one.score));
    const near = scored.filter((one) => one.score >= best - MARGIN[ask.skill] * 20);

    return playOf('backgammon', (near[Math.floor(ask.random() * near.length)] ?? scored[0]).move);
}

export const backgammonAgent: Agent<BackgammonState> = {
    id: 'backgammon',
    version: 1,
    decide
};

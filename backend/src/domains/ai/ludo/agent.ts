import { ludoEngine } from '../../match/engines/ludo.ts';
import { FINISHED, RING_STEPS, YARD, isSafeRing, ringIndex } from '../../match/ludo/board.ts';
import type { EngineAction, LudoState } from '../../match/ludo/state.ts';
import { MARGIN, playOf, type Agent, type Ask } from '../agent.ts';

/**
 * The baseline: roll when a roll is due, and otherwise one ply over the tokens it may move (its own,
 * or its partner's once its own are home), scored by how far its side has come against everybody
 * else, with a little for standing on a safe square. A capture is simply the other side's progress
 * going back to the yard. Replaced by a real strategy later, under the same export.
 */

const NO_DRAWS = { die: () => 1 };

/** Out of the yard counts for a few squares on its own: it is the move a six is for. */
const OUT_OF_YARD = 6;

const progressOf = (at: number) => (at === YARD ? 0 : at + OUT_OF_YARD) + (at === FINISHED ? 10 : 0);

function scoreOf(state: LudoState, side: number)
{
    let score = 0;

    for (const player of state.players)
    {
        for (const at of player.pieces)
        {
            const mine = player.side === side;
            const safe = at !== YARD && at < RING_STEPS && isSafeRing(ringIndex(player.colour, at)) ? 2 : 0;

            score += mine ? progressOf(at) + safe : -progressOf(at) / Math.max(1, state.players.length - 1);
        }
    }

    return score;
}

function decide(ask: Ask<LudoState>)
{
    const state = ask.input;
    const legal = ludoEngine.legal(state, ask.seat);

    if (legal.length === 0)
    {
        return null;
    }

    if (legal[0].kind === 'roll')
    {
        return playOf('ludo', legal[0]);
    }

    const side = state.players.find((player) => player.seat === ask.seat)?.side ?? ask.seat;
    const scored: { move: EngineAction; score: number }[] = [];

    for (const move of legal)
    {
        const after = ludoEngine.apply(state, move, NO_DRAWS);

        if (after.ok)
        {
            scored.push({ move, score: after.state.winner === side ? 10_000 : scoreOf(after.state, side) });
        }
    }

    if (scored.length === 0)
    {
        return playOf('ludo', legal[0]);
    }

    const best = Math.max(...scored.map((one) => one.score));
    const near = scored.filter((one) => one.score >= best - MARGIN[ask.skill] * 10);

    return playOf('ludo', (near[Math.floor(ask.random() * near.length)] ?? scored[0]).move);
}

export const ludoAgent: Agent<LudoState> = {
    id: 'ludo',
    version: 1,
    decide
};

import { describe, expect, it } from 'vitest';

import { AI_ENGINES, OPENNESS, inputOf, seededRandom, type SeatLog } from '../src/domains/ai/agent.ts';
import { AGENTS } from '../src/domains/ai/agents.ts';
import { DECK } from '../src/domains/match/cards/cards.ts';
import type { Draws, Engine } from '../src/domains/match/engine.ts';
import type { HokmState } from '../src/domains/match/hokm/state.ts';
import type { PokerState } from '../src/domains/match/poker/state.ts';
import type { Format } from '../src/domains/match/sides.ts';

/**
 * What a hidden game's agent is given is what its seat's client is given, so two states that differ
 * only in what that seat cannot see (the other hands, the stock, the other hole cards) must give it
 * the same input and the same decision for the same seed.
 */

function seeded(seed: number): { draws: Draws; next: () => number }
{
    let state = (seed * 2654435761) >>> 0 || 1;

    const next = () =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;

        return (state >>> 0) / 4294967296;
    };

    return { draws: { die: (sides) => 1 + Math.floor(next() * sides) }, next };
}

const shuffled = <T>(items: readonly T[], next: () => number) =>
{
    const out = [...items];

    for (let at = out.length - 1; at > 0; at -= 1)
    {
        const other = Math.floor(next() * (at + 1));

        [out[at], out[other]] = [out[other], out[at]];
    }

    return out;
};

/** The same hokm table with every card the seat cannot see dealt again among the places it cannot see. */
function redealHokm(state: HokmState, seat: number, next: () => number): HokmState
{
    const others = state.hands.map((_, at) => at).filter((at) => at !== seat);
    const unseen = shuffled([...others.flatMap((at) => state.hands[at]), ...state.stock], next);
    const hands = state.hands.map((hand) => [...hand]);
    let taken = 0;

    for (const at of others)
    {
        hands[at] = unseen.slice(taken, taken + state.hands[at].length).sort((a, b) => a - b);
        taken += state.hands[at].length;
    }

    return { ...state, hands, stock: unseen.slice(taken).sort((a, b) => a - b) };
}

/** The same poker table with the other seats' hole cards drawn again from every card the seat cannot see. */
function redealPoker(state: PokerState, seat: number, next: () => number): PokerState
{
    const seen = new Set([...state.holes[seat], ...state.board, ...(state.last?.shown.flatMap((row) => row.cards) ?? [])]);
    const unseen = shuffled(DECK.filter((card) => !seen.has(card)), next);
    let taken = 0;
    const holes = state.holes.map((hole, at) =>
    {
        if (at === seat || hole.length === 0)
        {
            return [...hole];
        }

        taken += hole.length;

        return unseen.slice(taken - hole.length, taken);
    });

    return { ...state, holes };
}

const REDEAL: Readonly<Record<string, (state: never, seat: number, next: () => number) => unknown>> = {
    hokm: redealHokm,
    poker: redealPoker
};

describe('a hidden game\'s agent sees only its own seat', () =>
{
    it('the runtime table names hokm and poker hidden and the board games open', () =>
    {
        expect(OPENNESS).toEqual({ chess: 'open', backgammon: 'open', ludo: 'open', hokm: 'hidden', poker: 'hidden' });
    });

    for (const game of ['hokm', 'poker'])
    {
        const engine = AI_ENGINES[game] as Engine;

        for (const format of engine.formats as readonly Format[])
        {
            it(`${ game }, ${ format.seats } seats: a state that differs only where the seat cannot look gives the same input and decision`, () =>
            {
                const seed = format.seats * 31 + game.length;
                const { draws } = seeded(seed);
                const { next } = seeded(seed + 1);
                let state = engine.create(Array.from({ length: format.seats }, (_, seat) => seat), draws, { target: 0, cube: false, blinds: 'low', variant: format.variant }).state;
                const history: { rev: number; seat: number; events: unknown[] }[] = [];
                let compared = 0;
                let differed = 0;

                const logOf = (reader: number): SeatLog[] => history.slice(-30).map((entry) => ({ rev: entry.rev, seat: entry.seat, log: engine.log(entry.events, reader) }));

                for (let step = 0; step < 400 && engine.finish(state) === null; step += 1)
                {
                    const seat = engine.turnOf(state) as number;
                    const other = REDEAL[game](state as never, seat, next);

                    differed += JSON.stringify(other) === JSON.stringify(state) ? 0 : 1;

                    const mine = inputOf(game, state, seat, logOf);
                    const theirs = inputOf(game, other, seat, logOf);

                    expect(Object.keys(mine as object).sort()).toEqual(['log', 'view']);
                    expect(theirs).toEqual(mine);

                    for (const seed of [1, 2, 3])
                    {
                        const ask = (input: unknown) => ({
                            seat,
                            format,
                            input,
                            skill: 'advanced' as const,
                            style: 500,
                            random: seededRandom(seed),
                            spent: () => 0,
                            budget: 500
                        });

                        expect(AGENTS[game].decide(ask(theirs))).toEqual(AGENTS[game].decide(ask(mine)));
                    }

                    compared += 1;

                    const legal = engine.legal(state, seat);
                    const applied = engine.apply(state, legal[Math.floor(next() * legal.length)], draws);

                    expect(applied.ok).toBe(true);

                    if (applied.ok)
                    {
                        state = applied.state;
                        history.push({ rev: (state as { rev: number }).rev, seat, events: applied.events });
                    }
                }

                expect(compared).toBeGreaterThan(5);
                expect(differed).toBeGreaterThan(compared / 2);
            }, 30_000);
        }
    }
});

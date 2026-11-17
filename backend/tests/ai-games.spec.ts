import { describe, expect, it } from 'vitest';

import { AI_ENGINES, inputOf, playOf, seededRandom, type SeatLog } from '../src/domains/ai/agent.ts';
import { AGENTS } from '../src/domains/ai/agents.ts';
import { fallbackOf } from '../src/domains/ai/runtime.ts';
import type { Draws, Engine, TableConfig } from '../src/domains/match/engine.ts';
import type { Format } from '../src/domains/match/sides.ts';
import { SKILLS } from '../src/domains/system/rules.ts';
import type { MatchPlay } from '../src/schemas.ts';

/** The same xorshift `Draws` `engine-contract.spec.ts` plays its random games with. */
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

/** Actions per game at most, as `engine-contract.spec.ts` bounds a random game. */
const BOUND: Readonly<Record<string, number>> = { ludo: 12_000, hokm: 4000, backgammon: 3000, poker: 20_000, chess: 12_000 };

const GAMES: Readonly<Record<string, number>> = { ludo: 4, hokm: 4, backgammon: 3, poker: 3, chess: 2 };

/** The tail of the log a hidden game's agent is shown here; the whole log every move would make a long poker game quadratic. */
const LOG_TAIL = 40;

const tableOf = (game: string, format: Format, next: () => number): TableConfig => ({
    target: game === 'backgammon' ? 3 : 0,
    cube: true,
    blinds: 'low',
    variant: format.variant,
    clock: game === 'chess' && next() < 0.5 ? { base: 300_000, increment: 2_000 } : null
});

interface Played
{
    actions: number;
    verbs: Map<string, number>;
}

/** One whole game of baseline agents, every seat a system player, every play through the engine's own `parse` and `apply`. */
function playOut(engine: Engine, format: Format, game: number): Played
{
    const { draws, next } = seeded(game * 97 + format.seats * 13 + engine.id.length);
    const seats = Array.from({ length: format.seats }, (_, seat) => seat);
    let state = engine.create(seats, draws, tableOf(engine.id, format, next)).state;
    const history: { rev: number; seat: number; events: unknown[] }[] = [];
    const verbs = new Map<string, number>();
    let actions = 0;

    const logOf = (reader: number): SeatLog[] =>
        history.slice(-LOG_TAIL).map((entry) => ({ rev: entry.rev, seat: entry.seat, log: engine.log(entry.events, reader) }));

    const step = (seat: number, action: unknown) =>
    {
        const applied = engine.apply(state, action, draws);

        expect(applied.ok, `${ engine.id } apply at action ${ actions }: ${ applied.ok ? '' : applied.reason }`).toBe(true);

        if (applied.ok)
        {
            state = applied.state;
            history.push({ rev: (state as { rev: number }).rev, seat, events: applied.events });
        }

        actions += 1;
    };

    while (engine.finish(state) === null)
    {
        const seat = engine.turnOf(state);

        expect(seat, `${ engine.id } has a seat to move`).not.toBeNull();

        // Now and then the side waiting offers a draw, so the side to move has to answer one.
        if (engine.id === 'chess' && next() < 0.05)
        {
            const offered = engine.apply(state, { kind: 'offer', seat: 1 - (seat as number) }, draws);

            if (offered.ok)
            {
                state = offered.state;
            }
        }

        const play: MatchPlay | null = AGENTS[engine.id].decide({
            seat: seat as number,
            format,
            input: inputOf(engine.id, state, seat as number, logOf),
            skill: SKILLS[(game + (seat as number)) % SKILLS.length],
            style: (game * 131 + (seat as number) * 7) % 1000,
            random: seededRandom(game * 1009 + actions),
            spent: () => 0,
            budget: 1000
        });

        expect(play, `${ engine.id } agent answers at action ${ actions }`).not.toBeNull();

        const action = engine.parse(play as MatchPlay, seat as number);

        expect(action, `${ engine.id } play parses: ${ JSON.stringify(play) }`).not.toBeNull();
        verbs.set((play as { verb: string }).verb, (verbs.get((play as { verb: string }).verb) ?? 0) + 1);
        step(seat as number, action);

        expect(actions).toBeLessThan(BOUND[engine.id]);

        if (actions >= BOUND[engine.id])
        {
            break;
        }
    }

    return { actions, verbs };
}

describe('baseline agents play whole games', () =>
{
    for (const engine of Object.values(AI_ENGINES))
    {
        for (const format of engine.formats)
        {
            it(`${ engine.id }, ${ format.seats }-seat ${ format.variant }: every game ends and every play is accepted`, () =>
            {
                const verbs = new Map<string, number>();

                for (let game = 1; game <= GAMES[engine.id]; game += 1)
                {
                    const played = playOut(engine, format, game);

                    expect(engine.id === 'chess' || played.actions > 0).toBe(true);

                    for (const [verb, count] of played.verbs)
                    {
                        verbs.set(verb, (verbs.get(verb) ?? 0) + count);
                    }
                }

                // Chess makes real moves and never flags.
                if (engine.id === 'chess')
                {
                    expect(verbs.get('move') ?? 0).toBeGreaterThan(0);
                    expect(verbs.has('flag')).toBe(false);
                }
            }, 120_000);
        }
    }

    it('answer every phase their games have', () =>
    {
        const seen = new Map<string, Set<string>>();

        for (const engine of Object.values(AI_ENGINES))
        {
            const verbs = new Set<string>();

            for (const format of engine.formats)
            {
                for (let game = 1; game <= 2; game += 1)
                {
                    for (const verb of playOut(engine, format, game + 50).verbs.keys())
                    {
                        verbs.add(verb);
                    }
                }
            }

            seen.set(engine.id, verbs);
        }

        expect([...(seen.get('hokm') as Set<string>)].sort()).toEqual(expect.arrayContaining(['card', 'discard', 'trump']));
        expect(seen.get('hokm')?.has('keep') || seen.get('hokm')?.has('reject')).toBe(true);
        expect(seen.get('ludo')).toEqual(new Set(['roll', 'move']));
        expect(seen.get('backgammon')?.has('roll') && seen.get('backgammon')?.has('move')).toBe(true);
        expect(seen.get('poker')?.has('allin')).toBe(true);
        expect(seen.get('poker')?.has('raise')).toBe(true);
    }, 240_000);
});

describe('the fallback', () =>
{
    it('is a legal move in every game, and a real move in chess', () =>
    {
        for (const engine of Object.values(AI_ENGINES))
        {
            const { draws } = seeded(7);
            const format = engine.formats[0];
            const state = engine.create(Array.from({ length: format.seats }, (_, seat) => seat), draws, { target: 0, cube: true, blinds: 'low', variant: format.variant }).state;
            const seat = engine.turnOf(state) as number;
            const play = fallbackOf(engine.id, state, seat);

            expect(play, engine.id).not.toBeNull();

            const action = engine.parse(play as MatchPlay, seat);

            expect(action, engine.id).not.toBeNull();
            expect(engine.apply(state, action, draws).ok, engine.id).toBe(true);

            if (engine.id === 'chess')
            {
                expect((play as { verb: string }).verb).toBe('move');
            }
        }
    });

    it('takes a capture in chess when one is there', () =>
    {
        const engine = AI_ENGINES.chess;
        let state = engine.create([0, 1], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state;

        // 1. e4 d5: white to move can take on d5.
        for (const play of [{ from: 12, to: 28 }, { from: 51, to: 35 }])
        {
            const seat = engine.turnOf(state) as number;
            const applied = engine.apply(state, engine.parse({ kind: 'chess', verb: 'move', ...play }, seat), { die: () => 1 });

            expect(applied.ok).toBe(true);
            state = applied.ok ? applied.state : state;
        }

        expect(fallbackOf('chess', state, engine.turnOf(state) as number)).toEqual({ kind: 'chess', verb: 'move', from: 28, to: 35 });
    });
});

describe('playOf', () =>
{
    it('turns every legal action of every engine back into a play the engine parses to the same action', () =>
    {
        for (const engine of Object.values(AI_ENGINES))
        {
            for (const format of engine.formats)
            {
                const { draws, next } = seeded(format.seats);
                let state = engine.create(Array.from({ length: format.seats }, (_, seat) => seat), draws, { target: 3, cube: true, blinds: 'low', variant: format.variant }).state;

                for (let step = 0; step < 60 && engine.finish(state) === null; step += 1)
                {
                    const seat = engine.turnOf(state) as number;
                    const legal = engine.legal(state, seat);

                    for (const action of legal)
                    {
                        expect(engine.parse(playOf(engine.id, action) as MatchPlay, seat), `${ engine.id } ${ JSON.stringify(action) }`).toEqual(action);
                    }

                    const applied = engine.apply(state, legal[Math.floor(next() * legal.length)], draws);

                    state = applied.ok ? applied.state : state;
                }
            }
        }
    });
});

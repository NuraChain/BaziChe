import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { gameRandomness } from '../src/domains/match/randomness-server.ts';
import { shuffle } from '../src/domains/match/randomness.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import { deckFor } from '../src/domains/match/hokm/cards.ts';
import { DECK } from '../src/domains/match/cards/cards.ts';
import { matchPlayInput } from '../src/schemas.ts';

const TABLE = { target: 1, cube: false, blinds: 'low', variant: 'standard' } as const;

const chiSquare = (counts: readonly number[], samples: number) =>
{
    const expected = samples / counts.length;

    return counts.reduce((score, count) => score + (count - expected) ** 2 / expected, 0);
};

describe('authoritative randomness', () =>
{
    it('enumerates all six three-card permutations using the correct bounds', () =>
    {
        const cards = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const orders = new Set<string>();

        for (const high of [0, 1, 2])
        {
            for (const low of [0, 1])
            {
                const picks = [low, high];
                const bounds: number[] = [];
                const order = shuffle(cards, (limit) =>
                {
                    bounds.push(limit);
                    return picks.pop()!;
                });

                expect(bounds).toEqual([3, 2]);
                expect(order).not.toBe(cards);
                expect(new Set(order)).toEqual(new Set(cards));
                orders.add(order.map(({ id }) => id).join(''));
            }
        }

        expect(cards.map(({ id }) => id)).toEqual([1, 2, 3]);
        expect(orders.size).toBe(6);
    });

    it('records ranges and sampled values and propagates entropy failures', () =>
    {
        const rng = gameRandomness('server-v2', 1, (limit) => limit - 1);

        expect(rng.draws.die(20)).toBe(20);
        expect(rng.draws.shuffle!([5, 8, 9])).toEqual([5, 8, 9]);
        expect(rng.audit()?.draws).toEqual([
            { kind: 'die', sides: 20, face: 20 },
            { kind: 'shuffle', count: 3, swaps: [2, 1] }
        ]);
        for (const sides of [0, -1, 1.5, NaN, Infinity, 2 ** 32 + 1])
        {
            expect(() => rng.draws.die(sides)).toThrow(RangeError);
        }

        const failed = gameRandomness('server-v2', 2, () => { throw new Error('entropy unavailable'); });
        expect(() => failed.draws.die(6)).toThrow();
        expect(failed.audit()).toBeNull();
    });

    it('checks Ludo roll eligibility before sampling a die', () =>
    {
        const opened = ludoEngine.create([0, 1], { die: () => 1 }, { target: 1, cube: false, blinds: 'low', variant: 'standard' });
        const rng = gameRandomness('server-v2', 2, () => 5);
        const action = ludoEngine.parse({ kind: 'ludo', verb: 'roll' }, 1)!;

        expect(ludoEngine.apply(opened.state, action, rng.draws)).toEqual({ ok: false, reason: 'not-your-turn' });
        expect(rng.audit()).toBeNull();
    });

    it.each([2, 6, 8, 10, 12, 20])('samples the D%i within conservative chi-square limits', (sides) =>
    {
        const samples = 60_000;
        const counts = Array<number>(sides).fill(0);
        const { draws } = gameRandomness('server-v2', 2);

        for (let n = 0; n < samples; n += 1)
        {
            counts[draws.die(sides) - 1] += 1;
        }

        expect(counts.reduce((sum, count) => sum + count, 0)).toBe(samples);
        // Upper-tail probability is below 1e-6 for each tested degree of freedom.
        expect(chiSquare(counts, samples)).toBeLessThan(35 + 2 * (sides - 1));
    });

    it('samples every three-card order without detectable positional bias', () =>
    {
        const samples = 30_000;
        const keys = ['012', '021', '102', '120', '201', '210'];
        const counts = new Map(keys.map((key) => [key, 0]));
        const { draws } = gameRandomness('server-v2', 1);

        for (let n = 0; n < samples; n += 1)
        {
            const key = draws.shuffle!([0, 1, 2]).join('');

            counts.set(key, counts.get(key)! + 1);
        }

        expect(counts.size).toBe(6);
        expect(chiSquare([...counts.values()], samples)).toBeLessThan(45);
    });

    it('rejects missing or invalid command revisions at the gameplay boundary', () =>
    {
        const command = { key: 'a', play: { kind: 'ludo', verb: 'roll' } };

        expect(matchPlayInput.safeParse(command).ok).toBe(false);
        expect(matchPlayInput.safeParse({ ...command, rev: 2 ** 31 }).ok).toBe(false);
        expect(matchPlayInput.safeParse({ ...command, rev: 1 }).ok).toBe(true);
    });

    it('keeps insecure entropy out of the authoritative randomness entry points', () =>
    {
        const directory = new URL('../src/domains/match/', import.meta.url);
        const adapters = readdirSync(new URL('engines/', directory)).filter((file) => file.endsWith('.ts'));

        for (const file of ['service.ts', 'randomness.ts', 'fair.ts', ...adapters.map((name) => `engines/${ name }`)])
        {
            const source = readFileSync(new URL(file, directory), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

            expect(source, file).not.toMatch(/\b(?:Math\s*\.\s*random|Date\s*\.\s*now|performance\s*\.\s*now)\b/);
        }
    });

    it.each([2, 3, 4])('deals the %i-seat Hokm deck once and keeps the unseen stock private', (seats) =>
    {
        const opening = gameRandomness('server-v2', 1, () => 0);
        const { state } = hokmEngine.create(Array.from({ length: seats }, (_, index) => index), opening.draws, TABLE);
        const { hands, stock, hakem } = state;

        expect([...hands.flat(), ...stock].sort((a, b) => a - b)).toEqual(deckFor(seats));
        expect(hokmEngine.view(state, null)).toMatchObject({ hand: [] });
        expect(hokmEngine.view(state, (hakem + 1) % seats)).toMatchObject({ hand: seats === 2 ? hands[1] : [] });
        expect(opening.audit()?.draws.map((draw) => draw.kind)).toEqual(['die', 'shuffle']);

        const next = gameRandomness('server-v2', 2, () => { throw new Error('unexpected draw'); });
        const outcome = hokmEngine.apply(state, { kind: 'trump', seat: hakem, suit: 'spades' }, next.draws);

        if (!outcome.ok)
        {
            throw new Error(outcome.reason);
        }

        expect(next.audit()).toBeNull();
        expect([...outcome.state.hands.flat(), ...outcome.state.stock].sort((a, b) => a - b)).toEqual(deckFor(seats));
    });

    it('consumes both cards of each two-player Hokm draw and never recycles discards', () =>
    {
        const opening = gameRandomness('server-v2', 1, () => 0);
        let { state } = hokmEngine.create([0, 1], opening.draws, TABLE);
        const discarded: number[] = [];
        const apply = (action: Parameters<typeof hokmEngine.apply>[1]) =>
        {
            const next = hokmEngine.apply(state, action, gameRandomness('server-v2', state.rev + 1,
                () => { throw new Error('unexpected draw'); }).draws);

            if (!next.ok)
            {
                throw new Error(next.reason);
            }

            state = next.state;
        };

        apply({ kind: 'trump', seat: state.hakem, suit: 'spades' });
        for (const count of [3, 2])
        {
            const cards = state.hands[state.turn].slice(0, count);

            discarded.push(...cards);
            apply({ kind: 'discard', seat: state.turn, cards });
        }

        for (let draw = 0; draw < 21; draw += 1)
        {
            const seat = state.turn;
            const keep = draw % 2 === 0;
            const [first, second] = [state.offer!, state.stock[0]];

            discarded.push(keep ? second : first);
            apply({ kind: keep ? 'keep' : 'reject', seat });
            expect(state.hands[seat]).toContain(keep ? first : second);
        }

        expect(state.phase).toBe('tricks');
        expect(state.stock).toEqual([]);
        expect(state.hands.map((hand) => hand.length)).toEqual([13, 13]);
        expect([...discarded, ...state.hands.flat()].sort((a, b) => a - b)).toEqual(DECK);
    });

    it.each([2, 3, 4, 5, 6, 7, 8, 9])('conserves the %i-seat Poker deck across each street and projects private cards per seat', (seats) =>
    {
        const rng = gameRandomness('server-v2', 1, () => 0);
        const opened = pokerEngine.create(Array.from({ length: seats }, (_, index) => index), rng.draws, TABLE);
        const testDeck = (state: typeof opened.state) =>
        {
            expect([...state.holes.flat(), ...state.board, ...state.stock!].sort((a, b) => a - b)).toEqual(DECK);
            expect(pokerEngine.view(state, null)).toMatchObject({ hole: [] });
            expect(pokerEngine.view(state, null)).not.toHaveProperty('stock');
        };

        expect(rng.audit()?.draws.map((draw) => draw.kind)).toEqual(['die', 'shuffle']);
        expect(pokerEngine.log(opened.events, null)).toMatchObject({ moves: expect.not.arrayContaining([expect.objectContaining({ e: 'hole' })]) });
        let state = opened.state;
        for (let i = 0; state.street !== 'river' && i < seats * 4; i += 1)
        {
            testDeck(state);
            const seat = pokerEngine.turnOf(state)!;
            const action = pokerEngine.legal(state, seat).find((one) => one.kind === 'check' || one.kind === 'call')!;
            const next = pokerEngine.apply(state, action, gameRandomness('server-v2', state.rev + 1, () => { throw new Error('unexpected draw'); }).draws);

            if (!next.ok)
            {
                throw new Error(next.reason);
            }

            state = next.state;
        }

        expect(state.street).toBe('river');
        testDeck(state);
    });
});

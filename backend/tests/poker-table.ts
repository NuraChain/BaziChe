import { expect } from 'vitest';

import { cardOf, type Rank, type Suit } from '../src/domains/match/cards/cards.ts';
import { apply, create, type Die } from '../src/domains/match/poker/engine.ts';
import type { PokerAction, PokerEvent, PokerState } from '../src/domains/match/poker/state.ts';

const SUIT_OF: Readonly<Record<string, Suit>> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

export function card(name: string)
{
    const rank = name.slice(0, -1);

    return cardOf(SUIT_OF[name.slice(-1)], (rank === 'T' ? '10' : rank) as Rank);
}

export function hand(names: string): number[]
{
    return names.split(' ').map(card);
}

export function seeded(seed: number): Die & { next: () => number }
{
    let value = (seed * 2654435761) >>> 0 || 1;

    const next = () =>
    {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;

        return (value >>> 0) / 4294967296;
    };

    return Object.assign((sides: number) => 1 + Math.floor(next() * sides), { next });
}

function rig(button: number, ...hands: number[][]): Die
{
    const queue = [...hands];

    return Object.assign(() => button + 1, {
        shuffle: <T>(deck: readonly T[]) =>
        {
            const order = queue.shift() ?? [];
            const dealt = new Set(order);

            if (dealt.size !== order.length)
            {
                throw new Error('Duplicate card in the test deck.');
            }

            return [...order.map((card) => deck[card]), ...deck.filter((_, index) => !dealt.has(index))];
        }
    });
}

export function dealOrder(seats: number, button: number): number[]
{
    return Array.from({ length: seats }, (_, step) => (button + 1 + step) % seats);
}

export function seated(
    stacks: readonly number[],
    button: number,
    holes: readonly string[],
    board = '',
    opening: 'low' | 'mid' | 'high' = 'low',
    later: readonly number[] = []
): { state: PokerState; die: Die }
{
    const order = dealOrder(stacks.length, button);
    const dealt = holes.map(hand);
    const sequence = [
        ...order.map((seat) => dealt[seat][0]),
        ...order.map((seat) => dealt[seat][1]),
        ...(board === '' ? [] : hand(board))
    ];
    const die = rig(button, sequence, [...later]);
    const state = create(stacks.length, opening, die).state;

    state.stacks = stacks.map((chips, seat) => chips - state.put[seat]);
    state.start = [...stacks];

    return { state, die };
}

export function play(state: PokerState, action: PokerAction, die: Die): { state: PokerState; events: PokerEvent[] }
{
    const applied = apply(state, action, die);

    expect(applied.ok, `${ action.kind } by seat ${ action.seat } was refused: ${ applied.ok ? '' : applied.reason }`).toBe(true);

    if (!applied.ok)
    {
        throw new Error(applied.reason);
    }

    return { state: applied.state, events: applied.events };
}

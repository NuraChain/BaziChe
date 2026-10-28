import type { Choice } from './policy.ts';

/**
 * What a market on one game asks: an outcome a seat, or a side at a table where seats play
 * together, and a draw last where the game can end level. The sides are the engine's own
 * (`sideOf`), so they are the seats the game itself scores together.
 */
export function choicesOf(seats: number, sideOf: (seat: number) => number, drawable: boolean)
{
    const sides = new Map<number, number[]>();

    for (let seat = 0; seat < seats; seat += 1)
    {
        const side = sideOf(seat);
        sides.set(side, [...(sides.get(side) ?? []), seat]);
    }

    const grouped = [...sides.entries()].sort(([a], [b]) => a - b).map(([, members]) => members);
    const choices: Choice[] = grouped.every((members) => members.length === 1)
        ? grouped.map(([seat]) => ({ kind: 'seat', seat }))
        : grouped.map((members) => ({ kind: 'side', seats: members }));

    return drawable ? [...choices, { kind: 'draw' } satisfies Choice] : choices;
}

const named = (seats: readonly number[]) => [...seats].sort((a, b) => a - b).join();

/**
 * The outcome that happened, from the game's own ending: the seat or the side the engine named as
 * its winners, or the draw for a game that ended level with nobody named. Null for anything else
 * (nobody named and no draw, a draw the market does not offer, winners that are no one outcome),
 * which calls the market off.
 */
export function outcomeOf(choices: readonly Choice[], winners: readonly number[], drawn: boolean)
{
    if (winners.length === 0)
    {
        const draw = choices.findIndex((choice) => choice.kind === 'draw');

        return drawn && draw !== -1 ? draw : null;
    }

    const won = named(winners);
    const found = choices.findIndex((choice) =>
        (choice.kind === 'seat' && String(choice.seat) === won) || (choice.kind === 'side' && named(choice.seats) === won));

    return found === -1 ? null : found;
}

/** A finished game, as a market is settled from it: every time in milliseconds of this server's clock. */
export interface Ended
{
    finishedAt: number;
    voided: boolean;
    winners: readonly number[];
    drawn: boolean;
}

/**
 * Whether a market is settled, and on which outcome, or called off. Settled only when its game
 * ended after NuraChain had stopped taking positions in it: a ticket signed before the end can be
 * placed until the chain's own clock reaches the close, and the chain's clock can run behind this
 * server's, so a game that ended earlier by the chain's clock would pay whoever placed one knowing
 * the result. The chain's clock at the end is worked out from both clocks read now (`chainNow`
 * from its newest block, which can only be behind it, so the doubt falls toward calling off).
 */
export function verdictOf(choices: readonly Choice[], closesAt: number, ended: Ended, chainNow: number, serverNow: number)
{
    if (ended.voided || ended.finishedAt + (chainNow - serverNow) < closesAt)
    {
        return null;
    }

    return outcomeOf(choices, ended.winners, ended.drawn);
}

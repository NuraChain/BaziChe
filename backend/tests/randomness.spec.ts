import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deckFor } from '../src/domains/match/hokm/cards.ts';
import { apply, create } from '../src/domains/match/hokm/engine.ts';
import type { HokmState } from '../src/domains/match/hokm/state.ts';
import { pickBelow, rollDie } from '../src/lib/crypto.ts';

/**
 * The randomness a game outcome rests on, and the files that are allowed to decide it.
 *
 * `ludo-purity.spec.ts` already fails an ENGINE that names `Math.random`, and `fair.spec.ts` checks
 * the staked seed against an independent HMAC. What neither covers is the layer that actually draws:
 * a service that reaches for `Math.random` is outside every engine's purity rule, and one of them
 * did - the code on a table, which is not a game outcome but is how somebody finds a table that was
 * meant to be by invitation. This spec holds the drawing layer to the same rule the engines are held
 * to, and checks the two properties a player can be wronged by: a die that is not level, and a deal
 * that loses or repeats a card.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** A source file with its comments removed, so a sentence about `Math.random` is not read as a call. */
const read = (name: string) => readFileSync(join(HERE, '..', 'src', name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

/**
 * A stand-in for the server's generator that a spec can replay: whole numbers in `[1, sides]`.
 *
 * Not `Math.random`, and not shipped anywhere - it exists so a deal can be made twice from the same
 * numbers, which is how a staked match is worked out again afterwards.
 */
const counted = (start = 20261120) =>
{
    let state = start;

    return (sides: number) =>
    {
        state = (state * 1103515245 + 12345) % 2147483648;

        return 1 + (state % sides);
    };
};

const SEATS = 4;

const TARGET = 7;

const filled = (deal: (sides: number) => number) =>
{
    const { state } = create(SEATS, TARGET, deal);
    const called = apply(state, { kind: 'trump', seat: state.hakem, suit: 'clubs' }, deal);

    expect(called.ok).toBe(true);

    return (called as { ok: true; state: HokmState }).state;
};

describe('a die', () =>
{
    it('lands on each of its six faces as often as on any other', () =>
    {
        const draws = 60_000;
        const counts = [0, 0, 0, 0, 0, 0];

        for (let draw = 0; draw < draws; draw += 1)
        {
            counts[rollDie() - 1] += 1;
        }

        const expected = draws / 6;
        const chi = counts.reduce((sum, seen) => sum + ((seen - expected) ** 2) / expected, 0);

        /**
         * Six faces are five degrees of freedom. 20.515 is the 0.1% point of that distribution, so a
         * fair die fails this about once in a thousand runs and a die that favours one face by a
         * fraction of a percent fails it nearly always. A tighter threshold would be a flaky test
         * rather than a better one.
         */
        expect(chi, `faces ${ counts.join(', ') }`).toBeLessThan(20.515);
    });

    it('never answers outside the range it was asked for', () =>
    {
        expect(pickBelow(0)).toBe(0);
        expect(pickBelow(1)).toBe(0);

        const seen = new Set<number>();

        for (let draw = 0; draw < 4_000; draw += 1)
        {
            const at = pickBelow(6);

            expect(Number.isInteger(at)).toBe(true);
            expect(at).toBeGreaterThanOrEqual(0);
            expect(at).toBeLessThan(6);
            seen.add(at);
        }

        expect(seen.size).toBe(6);
    });
});

describe('a deal', () =>
{
    it('asks a Fisher-Yates step for the range it takes, once per card', () =>
    {
        const asked: number[] = [];
        const counting = counted();
        const deck = deckFor(SEATS).length;

        create(SEATS, TARGET, (sides: number) =>
        {
            asked.push(sides);

            return counting(sides);
        });

        // The Hâkem first, then the shuffle from the last card down to the second.
        expect(asked).toEqual([SEATS, ...Array.from({ length: deck - 1 }, (_, index) => deck - index)]);
    });

    it('holds every card exactly once and loses none when the hands are filled', () =>
    {
        const held = filled(counted()).hands.flat().sort((one, other) => one - other);

        expect(held).toHaveLength(52);
        expect(held).toEqual([...deckFor(SEATS)].sort((one, other) => one - other));
        expect(new Set(held).size, 'a card was dealt twice').toBe(52);
    });

    it('is the same deal from the same draws, so a match played for NURA can be worked out again', () =>
    {
        expect(filled(counted()).hands).toEqual(filled(counted()).hands);
        expect(filled(counted()).hands).not.toEqual(filled(counted(7)).hands);
    });
});

describe('the files that draw', () =>
{
    /**
     * Where a random value becomes something a person is affected by: the dice, the seed a staked
     * match draws from, the code that finds a table, an invite and a tournament's draw. A file here
     * either takes its randomness from `lib/crypto.ts` or is handed it, and a new one belongs on this
     * list deliberately rather than by arriving with a `Math.random` in it.
     */
    const AUTHORITATIVE = [
        'lib/crypto.ts',
        'domains/match/fair.ts',
        'domains/match/service.ts',
        'domains/table/service.ts',
        'domains/tournament/service.ts',
        'domains/invite/service.ts'
    ];

    it.each(AUTHORITATIVE)('takes %s\'s randomness from the server generator', (name) =>
    {
        const source = read(name);

        expect(source, `${ name } calls Math.random`).not.toMatch(/Math\.random/);
        expect(source, `${ name } reads a clock as entropy`).not.toMatch(/performance\.now/);
    });

    it('still finds the table code, so the rule above is not about an empty file', () =>
    {
        const source = read('domains/table/service.ts');

        expect(source).toMatch(/function codeFrom\(\)/);
        expect(source).toMatch(/ALPHABET\[pickBelow\(ALPHABET\.length\)\]/);
        expect(source).not.toMatch(/codeFrom\(Math\.random\)/);
    });
});

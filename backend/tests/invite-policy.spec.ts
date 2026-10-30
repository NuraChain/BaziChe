import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';

import '../src/entities/index.ts';
import { CAMPAIGN_STATES, CODE_ALPHABET, CODE_LENGTH, INVITE_FLAGS, REWARD_KINDS, REWARD_STATES, VISITOR_SHAPE, codeFrom } from '../src/domains/invite/policy.ts';

const expressionOf = (name: string) => getMetadataArgsStorage().checks.find((one) => one.name === name)?.expression ?? '';

const wordsIn = (name: string) => [...expressionOf(name).matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

describe('an invite\'s rules, in the database and in the code', () =>
{
    it('name the same states, kinds and flags', () =>
    {
        expect(wordsIn('invite_campaigns_state_known')).toEqual([...CAMPAIGN_STATES]);
        expect(wordsIn('invite_rewards_kind_known')).toEqual([...REWARD_KINDS]);
        expect(wordsIn('invite_rewards_state_known')).toEqual([...REWARD_STATES]);
        expect(wordsIn('referrals_flags_known')).toEqual([...INVITE_FLAGS]);
    });

    it('make a code of the alphabet\'s letters and nothing else, as long as a code is', () =>
    {
        const shape = new RegExp(/'(\^.*\$)'/.exec(expressionOf('invite_codes_shape'))?.[1] ?? '$^');
        const letters = Array.from({ length: 36 }, (_, at) => at.toString(36).toUpperCase());

        expect(letters.filter((one) => shape.test(one.repeat(CODE_LENGTH))).join(''), 'every letter of the alphabet, and only those').toBe(CODE_ALPHABET);
        expect(CODE_ALPHABET).toHaveLength(31);
        expect(shape.test('2'.repeat(CODE_LENGTH - 1)), 'one short').toBe(false);
        expect(shape.test('2'.repeat(CODE_LENGTH + 1)), 'one long').toBe(false);
        expect(shape.test('a'.repeat(CODE_LENGTH)), 'in capitals only').toBe(false);
    });

    it('read a code from a link or a sign-in in capitals, and nothing that cannot be one', () =>
    {
        expect(codeFrom('ABCD2345')).toBe('ABCD2345');
        expect(codeFrom(' abcd2345 '), 'as somebody typed or pasted it').toBe('ABCD2345');
        expect(codeFrom(undefined)).toBeNull();
        expect(codeFrom('')).toBeNull();
        expect(codeFrom('ABCD234'), 'one short').toBeNull();
        expect(codeFrom('ABCD23456'), 'one long').toBeNull();
        expect(codeFrom('ABCD0345'), 'a nought').toBeNull();
        expect(codeFrom('ABCDO345'), 'an O').toBeNull();
        expect(codeFrom('ABCD 345'), 'a space inside').toBeNull();
        expect(codeFrom('sara.k'), 'a handle').toBeNull();
    });

    it('take a visitor as the database takes one', () =>
    {
        expect(/'(\^.*\$)'/.exec(expressionOf('invite_visits_visitor_shape'))?.[1]).toBe(VISITOR_SHAPE.source);
    });
});

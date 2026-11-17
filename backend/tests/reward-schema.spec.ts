import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';

import '../src/entities/index.ts';

const expressionOf = (name: string) => getMetadataArgsStorage().checks.find((one) => one.name === name)?.expression ?? '';
const wordsIn = (name: string) => [...expressionOf(name).matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

describe('the reward schema', () =>
{
    it('registers the reward tables and the new setting keys', () =>
    {
        const targetName = (one: { target?: string | Function }) => typeof one.target === 'function' ? one.target.name : String(one.target ?? '');

        expect(getMetadataArgsStorage().tables.some((one) => targetName(one) === 'RewardStreak')).toBe(true);
        expect(getMetadataArgsStorage().tables.some((one) => targetName(one) === 'RewardCheckin')).toBe(true);
        expect(getMetadataArgsStorage().tables.some((one) => targetName(one) === 'RewardGrant')).toBe(true);
        expect(getMetadataArgsStorage().tables.some((one) => targetName(one) === 'RewardPayout')).toBe(true);
        expect(getMetadataArgsStorage().tables.some((one) => targetName(one) === 'RewardCycleTotal')).toBe(true);
        expect(wordsIn('settings_key_known')).toContain('reward-config');
        expect(wordsIn('settings_key_known')).toContain('reward-budget');
    });

    it('keeps the freezes in a table of their own, so freezing touches no existing row', () =>
    {
        const targetName = (one: { target?: string | Function }) => typeof one.target === 'function' ? one.target.name : String(one.target ?? '');
        const freezes = getMetadataArgsStorage().tables.find((one) => targetName(one) === 'RewardFreeze');

        expect(freezes?.name).toBe('reward_freezes');
        expect(expressionOf('reward_freezes_reason_length')).toBe('char_length(reason) between 3 and 500');
    });

    it('knows the staff actions of rewards, and holds the whole config in its setting', () =>
    {
        expect(wordsIn('staff_actions_kind_known')).toEqual(expect.arrayContaining(['reward-config', 'reward-freeze']));
        expect(expressionOf('settings_value_length')).toBe('char_length(value) between 1 and 4000');
    });

    it('adds the reward day to a grant as a nullable, indexed column, which rows written before it can hold', () =>
    {
        const target = (one: { target?: string | Function }) => typeof one.target === 'function' ? one.target.name : '';
        const day = getMetadataArgsStorage().columns.find((one) => target(one) === 'RewardGrant' && one.propertyName === 'day');
        const index = getMetadataArgsStorage().indices.find((one) => one.name === 'reward_grants_day_idx');

        expect(day?.options).toMatchObject({ type: 'integer', nullable: true });
        expect(index?.columns).toEqual(['day']);
    });
});

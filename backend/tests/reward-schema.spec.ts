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
});

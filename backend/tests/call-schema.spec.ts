import 'reflect-metadata';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import '../src/entities/index.ts';
import { CALL_ENDINGS, CALL_KINDS, CALL_STATES } from '../src/domains/call/rules.ts';

const wordsIn = (check: string) =>
    [...(getMetadataArgsStorage().checks.find((one) => one.name === check)?.expression ?? '').matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

describe('the words a call is written in', () =>
{
    it('are one list each, and the table names the same ones', () =>
    {
        expect(wordsIn('calls_kind_known').sort()).toEqual([...CALL_KINDS].sort());
        expect(wordsIn('calls_state_known').sort()).toEqual([...CALL_STATES].sort());
        expect(wordsIn('calls_ending_known').sort()).toEqual([...CALL_ENDINGS].sort());
    });
});

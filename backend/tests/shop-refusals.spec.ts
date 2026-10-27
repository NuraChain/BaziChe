import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HttpError, ValidationError } from '@azerothjs/http';

import { REFUSALS } from '../src/domains/match/refusals.ts';
import { SHOP_REFUSALS, isShopRefusal, type ShopRefusal } from '../src/domains/shop/refusals.ts';
import { shopRefusal } from '../src/domains/shop/service.ts';
import { TABLE_REFUSALS } from '../src/domains/table/refusals.ts';

const WORDS = Object.keys(SHOP_REFUSALS) as ShopRefusal[];

const FRAMEWORK = [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 499, 500, 502, 503, 599]
    .map((status) => new HttpError(status, 'x').code)
    .concat(new ValidationError({}).code);

const HERE = dirname(fileURLToPath(import.meta.url));

const THROWERS = ['domains/shop/service.ts'];

const sourceOf = (path: string) => readFileSync(join(HERE, '..', 'src', path), 'utf8');

describe('a shop refusal', () =>
{
    it.each(Object.entries(SHOP_REFUSALS) as [ShopRefusal, number][])('answers %s with that word as its code, at the status the list gives it', (word, status) =>
    {
        expect(shopRefusal(word, 'Why not.')).toMatchObject({ status, code: word, message: 'Why not.', expose: true });
    });

    it('is a word in kebab case, a mistake a reader is told about, and nobody else\'s word', () =>
    {
        for (const word of WORDS)
        {
            expect(word).toMatch(/^shop-[a-z]+(-[a-z]+)*$/);
            expect(SHOP_REFUSALS[word]).toBeGreaterThanOrEqual(400);
            expect(SHOP_REFUSALS[word]).toBeLessThan(500);
        }

        expect(WORDS.filter((word) => FRAMEWORK.includes(word) || Object.hasOwn(TABLE_REFUSALS, word) || Object.hasOwn(REFUSALS, word))).toEqual([]);
    });

    it('knows its own words and nothing an object merely inherits', () =>
    {
        expect(WORDS.every(isShopRefusal)).toBe(true);
        expect(['', 'shop', 'paid-funds', 'toString', 'constructor', '__proto__'].some(isShopRefusal)).toBe(false);
    });

    it('is thrown somewhere for every word on the list', () =>
    {
        const source = THROWERS.map(sourceOf).join('\n');

        for (const word of WORDS)
        {
            expect(source, word).toContain(`shopRefusal('${ word }'`);
        }
    });
});

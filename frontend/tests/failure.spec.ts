import { afterEach, describe, expect, it } from 'vitest';

import { whyDonate } from '../src/lib/donate.ts';
import { whyFailed } from '../src/lib/failure.ts';
import { whyMarket } from '../src/lib/market.ts';
import { whyShop } from '../src/lib/shop.ts';
import { en, type MessageKey } from '../src/locales/en.ts';
import { fa } from '../src/locales/fa.ts';
import { ApiError } from './fake-api.ts';

const answered = (status: number, code: string) => new ApiError(status, code, 'x', undefined);

const offline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !on });

afterEach(() =>
{
    Reflect.deleteProperty(navigator, 'onLine');
});

describe('a request that never got an answer', () =>
{
    it('says the server could not be reached, in each browser\'s words for it', () =>
    {
        for (const said of [
            'Failed to fetch',
            'NetworkError when attempting to fetch resource.',
            'Load failed',
            'Failed to fetch dynamically imported module: https://baziche.com/assets/sheet.js',
            'error loading dynamically imported module: https://baziche.com/assets/sheet.js',
            'Importing a module script failed.'
        ])
        {
            expect(whyFailed(new TypeError(said)), said).toBe('failure.unreached');
        }
    });

    it('says the reader is offline when the browser says so', () =>
    {
        offline(true);

        expect(whyFailed(new TypeError('Failed to fetch'))).toBe('failure.offline');
    });

    it('blames no connection for a fault in the page', () =>
    {
        offline(true);

        expect(whyFailed(new TypeError('Cannot read properties of undefined (reading \'id\')'))).toBe('common.actionFailed');
        expect(whyFailed(new Error('Failed to fetch'))).toBe('common.actionFailed');
    });

    it('says one that took too long may or may not have gone through, and a cancelled one nothing more', () =>
    {
        expect(whyFailed(new DOMException('signal timed out', 'TimeoutError'))).toBe('failure.timeout');
        expect(en['failure.timeout']).toContain('may or may not have gone through');
        expect(whyFailed(new DOMException('The operation was aborted.', 'AbortError'))).toBe('common.actionFailed');
    });
});

describe('a server that failed or did not answer', () =>
{
    it('is down behind the proxy, and failed in itself', () =>
    {
        for (const status of [502, 503, 504])
        {
            expect(whyFailed(answered(status, 'unknown')), String(status)).toBe('failure.down');
        }

        expect(whyFailed(answered(500, 'internal'))).toBe('failure.server');
        expect(whyFailed(answered(507, 'server-error'))).toBe('failure.server');
    });

    it('was the limiter, or a proxy with no envelope, and never a cooldown of a domain', () =>
    {
        expect(whyFailed(answered(429, 'too-many-requests'))).toBe('failure.busy');
        expect(whyFailed(answered(429, 'unknown'))).toBe('failure.busy');
        expect(whyFailed(answered(429, 'party-cooldown'))).toBe('common.actionFailed');
        expect(whyFailed(answered(429, 'party-cooldown'), 'party.refused.party-cooldown')).toBe('party.refused.party-cooldown');
    });

    it('is NuraChain out of reach, which the server answered and is no failure of its own', () =>
    {
        expect(whyFailed(answered(503, 'chain-unreachable'))).toBe('failure.chain');
        expect(whyFailed(answered(503, 'chain-unreachable'), 'shop.unreached')).toBe('shop.unreached');
    });
});

describe('a refusal nobody has words of their own for', () =>
{
    it('says what kind of refusal it was', () =>
    {
        expect(whyFailed(answered(401, 'unauthorized'))).toBe('failure.session');
        expect(whyFailed(answered(403, 'forbidden'))).toBe('failure.forbidden');
        expect(whyFailed(answered(404, 'not-found'))).toBe('failure.missing');
        expect(whyFailed(answered(409, 'conflict'))).toBe('failure.conflict');
        expect(whyFailed(answered(400, 'bad-request'))).toBe('failure.invalid');
        expect(whyFailed(answered(413, 'payload-too-large'))).toBe('failure.invalid');
        expect(whyFailed(answered(422, 'validation-failed'))).toBe('failure.invalid');
    });

    it('is the plain sentence where its kind says nothing to the reader', () =>
    {
        expect(whyFailed(answered(405, 'method-not-allowed'))).toBe('common.actionFailed');
        expect(whyFailed(answered(415, 'unsupported-media-type'))).toBe('common.actionFailed');
        expect(whyFailed('refused')).toBe('common.actionFailed');
        expect(whyFailed(undefined)).toBe('common.actionFailed');
    });
});

describe('a reader that knows the refusal', () =>
{
    it('keeps its words for a refusal, a 401 included', () =>
    {
        expect(whyFailed(answered(404, 'not-found'), 'play.openFailed')).toBe('play.openFailed');
        expect(whyFailed(answered(409, 'shop-owned'), 'shop.refused.shop-owned')).toBe('shop.refused.shop-owned');
        expect(whyFailed(answered(401, 'unauthorized'), 'devices.refused')).toBe('devices.refused');
    });

    it('gives its words up to what went wrong on the way', () =>
    {
        expect(whyFailed(new TypeError('Failed to fetch'), 'play.openFailed')).toBe('failure.unreached');
        expect(whyFailed(answered(503, 'unavailable'), 'vault.unavailable')).toBe('failure.down');
        expect(whyFailed(new DOMException('signal timed out', 'TimeoutError'), 'settings.safety.saveFailed')).toBe('failure.timeout');
    });

    it('that knew nothing more than the plain sentence is told the kind of refusal', () =>
    {
        expect(whyFailed(answered(404, 'not-found'), 'common.actionFailed')).toBe('failure.missing');
        expect(whyFailed(answered(403, 'forbidden'), 'common.actionFailed')).toBe('failure.forbidden');
        expect(whyFailed(answered(405, 'method-not-allowed'), 'common.actionFailed')).toBe('common.actionFailed');
    });

    it('keeps its words for a refusal of permission it knows', () =>
    {
        expect(whyFailed(answered(403, 'forbidden'), 'play.close.refused')).toBe('play.close.refused');
    });
});

describe('the readers of what the shop, a gift and a market refuse', () =>
{
    const READERS = [
        ['the shop', whyShop, answered(409, 'shop-owned'), 'shop.refused.shop-owned', 'shop.unreached'],
        ['a gift', whyDonate, answered(409, 'donate-playing'), 'donate.refused.donate-playing', 'donate.unreached'],
        ['a market', whyMarket, answered(409, 'market-closed'), 'market.refused.market-closed', 'market.unreached']
    ] as const;

    it.each(READERS)('%s keeps its own words for its refusals and for NuraChain', (_, why, refusal, own, chain) =>
    {
        expect(why(refusal)).toBe(own);
        expect(why(answered(503, 'chain-unreachable'))).toBe(chain);
    });

    it.each(READERS)('%s says what went wrong on the way, and the kind of a refusal it has no word for', (_, why) =>
    {
        expect(why(new TypeError('Failed to fetch'))).toBe('failure.unreached');
        expect(why(answered(500, 'internal'))).toBe('failure.server');
        expect(why(answered(404, 'not-found'))).toBe('failure.missing');
        expect(why(answered(404, 'not-found'), 'vault.unavailable')).toBe('vault.unavailable');
        expect(why(new Error('the wallet said no'))).toBe('common.actionFailed');
    });
});

describe('the words', () =>
{
    it('say what happened and what to do, in English and in Persian', () =>
    {
        const kinds = Object.keys(en).filter((key) => key.startsWith('failure.'));

        expect(kinds.sort()).toEqual(['failure.busy', 'failure.chain', 'failure.conflict', 'failure.down', 'failure.forbidden', 'failure.invalid',
            'failure.missing', 'failure.offline', 'failure.server', 'failure.session', 'failure.timeout', 'failure.unreached']);

        for (const kind of kinds)
        {
            const key = kind as MessageKey;

            expect(en[key], kind).not.toBe(en['common.actionFailed']);
            expect(fa[key], kind).not.toBe(en[key]);
            expect(String(fa[key]), kind).toMatch(/[؀-ۿ]/);
        }
    });
});

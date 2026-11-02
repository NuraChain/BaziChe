import { describe, expect, it } from 'vitest';

import { BUNDLES, LOOKS, NURA } from '../src/domains/shop/catalogue.ts';
import { isRepricePercent, movedBy, repriced, type Priced } from '../src/domains/shop/reprice.ts';

/**
 * Every price in the shop moved by one percentage: each look to a whole NURA and never under one,
 * each bundle priced again from its looks, a running sale moved with its look, and two changes in a
 * row compounding as the owner would see them.
 */

const nura = (n: number) => BigInt(n) * NURA;

const shop = () => new Map<string, Priced>([...LOOKS, ...BUNDLES].map((item) => [item.id, { price: item.price, sale: null }]));

describe('every price moved at once', () =>
{
    it('moves a look by the percentage, to the nearest whole NURA, never under one', () =>
    {
        expect(movedBy(nura(5), 20)).toBe(nura(6));
        expect(movedBy(nura(12), 20)).toBe(nura(14));
        expect(movedBy(nura(25), -10)).toBe(nura(23));
        expect(movedBy(nura(5), -90)).toBe(nura(1));
        expect(movedBy(nura(100), 500)).toBe(nura(600));
    });

    it('prices every bundle again from its looks\' new prices, 30% under their sum, in whole NURA', () =>
    {
        const next = repriced(shop(), 20);

        for (const bundle of BUNDLES)
        {
            const whole = bundle.looks.reduce((sum, look) => sum + next.get(look)!.price, 0n);

            expect(next.get(bundle.id)!.price, bundle.id).toBe(whole * 7_000n / 10_000n / NURA * NURA);
        }
        expect(next.size).toBe(LOOKS.length + BUNDLES.length);
    });

    it('compounds two changes as the owner sees them: up a fifth then down a tenth is up about 8%', () =>
    {
        const once = repriced(shop(), 20);
        const twice = repriced(once, -10);

        expect(twice.get('dice.shiraz')!.price).toBe(movedBy(movedBy(LOOKS.find((look) => look.id === 'dice.shiraz')!.price, 20), -10));
    });

    it('moves a running sale with its look, and ends one rounding left no cheaper than the look', () =>
    {
        const items = new Map<string, Priced>([['dice.shiraz', { price: nura(25), sale: nura(20) }], ['back.neon', { price: nura(2), sale: nura(1) }]]);
        const next = repriced(items, 20);

        expect(next.get('dice.shiraz')).toEqual({ price: nura(30), sale: nura(24) });
        expect(repriced(new Map([['back.neon', { price: nura(1), sale: nura(1) - 1n }]]), -50).get('back.neon'), 'a sale no cheaper than its look').toEqual({ price: nura(1), sale: null });
    });

    it('takes a whole percentage from -90 to +500 that moves something', () =>
    {
        expect([20, -10, -90, 500].every(isRepricePercent)).toBe(true);
        expect([0, -91, 501, 2.5, Number.NaN].some(isRepricePercent)).toBe(false);
    });
});

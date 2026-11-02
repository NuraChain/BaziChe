import { BUNDLES, BUNDLE_OFF_BPS, NURA, lookOf } from './catalogue.ts';

/** The furthest one change may move every price: down by nine tenths, up to six times. */
export const REPRICE_LEAST = -90;

export const REPRICE_MOST = 500;

export const isRepricePercent = (percent: number) =>
    Number.isInteger(percent) && percent !== 0 && percent >= REPRICE_LEAST && percent <= REPRICE_MOST;

/** A price moved by `percent`, to the nearest whole NURA, never under one. */
export function movedBy(price: bigint, percent: number)
{
    const scaled = price * BigInt(100 + percent);
    const whole = (scaled + 50n * NURA) / (100n * NURA);

    return (whole < 1n ? 1n : whole) * NURA;
}

/** A shop item as a reprice reads and writes it: its price, and its sale while one runs. */
export interface Priced
{
    price: bigint;
    sale: bigint | null;
}

/**
 * Every price in the shop moved by one percentage at once, the way the owner raises or lowers the
 * whole shop: each look by `percent` to a whole NURA; each bundle priced again from its looks' new
 * prices, `BUNDLE_OFF_BPS` under their sum, as the catalogue prices it; a running sale moved by the
 * same percentage, so a sale that was a fifth off stays about a fifth off, and ended if rounding left
 * it no cheaper than its look. Changes one after another compound: +20% then -10% is +8%.
 */
export function repriced(items: ReadonlyMap<string, Priced>, percent: number)
{
    const next = new Map<string, Priced>();

    const withSale = (price: bigint, sale: bigint | null): Priced =>
    {
        const moved = sale === null ? null : movedBy(sale, percent);

        return { price, sale: moved !== null && moved < price ? moved : null };
    };

    for (const [id, item] of items)
    {
        if (lookOf(id) !== undefined)
        {
            next.set(id, withSale(movedBy(item.price, percent), item.sale));
        }
    }

    for (const bundle of BUNDLES)
    {
        const held = items.get(bundle.id);

        if (held === undefined)
        {
            continue;
        }

        const whole = bundle.looks.reduce((sum, look) => sum + (next.get(look)?.price ?? items.get(look)?.price ?? 0n), 0n);
        const priced = (whole * BigInt(10_000 - BUNDLE_OFF_BPS)) / 10_000n / NURA * NURA;

        next.set(bundle.id, withSale(priced < NURA ? NURA : priced, held.sale));
    }

    return next;
}

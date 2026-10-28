import { ApiError } from '../api.ts';
import { isMarketRefusal } from '../../../backend/src/domains/market/refusals.ts';
import type { MarketChoice, MarketPositionView } from '../api.ts';
import type { MessageKey } from '../locales/en.ts';

/** The most positions one claim names: what the claim route takes. */
const CLAIM_MOST = 50;

const LIMITS = ['bettor', 'day', 'pool'] as const;

const detailOf = (error: ApiError, name: string) =>
{
    const value: unknown = typeof error.details === 'object' && error.details !== null ? Reflect.get(error.details, name) : undefined;

    return typeof value === 'string' ? value : null;
};

/** The sentence for a position or a claim the server or NuraChain would not take. */
export function whyMarket(error: unknown, otherwise: MessageKey = 'common.actionFailed'): MessageKey
{
    if (!(error instanceof ApiError))
    {
        return otherwise;
    }

    if (error.code === 'chain-unreachable')
    {
        return 'market.unreached';
    }

    const limit = error.code === 'market-limit' ? LIMITS.find((one) => one === detailOf(error, 'limit')) : undefined;

    if (limit !== undefined)
    {
        return `market.limit.${ limit }`;
    }

    return isMarketRefusal(error.code) ? `market.refused.${ error.code }` : otherwise;
}

/** What a wallet short of a position holds, in wei, as its refusal says. */
export function heldOf(error: unknown)
{
    return error instanceof ApiError && error.code === 'market-funds' ? detailOf(error, 'held') : null;
}

/** Who an outcome is, in handles: a seat's player, a side's players, or nobody for a draw. */
export const handlesOf = (choice: MarketChoice) => (choice.kind === 'seat' ? [choice.who] : choice.kind === 'side' ? choice.who : []);

type Named = (handle: string) => { displayName: string } | null;

const firstOf = (handle: string, named: Named) => named(handle)?.displayName.split(' ')[0] || handle;

/**
 * What an outcome is called: a player's first name, two partners', or a draw, which a sentence
 * (`label` false) spells as it would be said inside one.
 */
export function choiceName(choice: MarketChoice, t: (key: MessageKey, vars?: Record<string, string>) => string, named: Named, label: boolean)
{
    if (choice.kind === 'draw')
    {
        return t(label ? 'market.draw' : 'market.drawWord');
    }

    if (choice.kind === 'seat')
    {
        return firstOf(choice.who, named);
    }

    return t('market.pair', { first: firstOf(choice.who[0] ?? '', named), second: firstOf(choice.who[1] ?? '', named) });
}

/** A share of a pool, as a fraction of one, for a bar and a percentage: nothing in an empty pool. */
export function shareOf(part: string, pool: string)
{
    const whole = BigInt(pool);

    return whole === 0n ? 0 : Number((BigInt(part) * 10_000n) / whole) / 10_000;
}

/**
 * What a stake on an outcome would bring back if it won, in wei, as the pool stands: the pool with
 * the stake in it, less the fee, shared by everybody behind that outcome by what each put in. It
 * moves as others back the game, so it is an estimate and is only ever said as one.
 */
export function estimateOf(pool: string, backing: string, stake: string, feeBps: number)
{
    const whole = BigInt(pool) + BigInt(stake);
    const left = whole - (whole * BigInt(feeBps)) / 10_000n;

    return (left * BigInt(stake)) / (BigInt(backing) + BigInt(stake));
}

/**
 * When a position can be claimed, by the server's clock: at once for a stake that goes back, from the
 * end of the dispute window for a winner. Null when it never can: lost, claimed, or a claim on its way.
 */
export function claimFrom(position: MarketPositionView)
{
    if (position.claimedAt !== undefined || position.claimHash !== undefined || position.payout === undefined)
    {
        return null;
    }

    if (position.result === 'refund')
    {
        return 0;
    }

    return position.result === 'won' && position.claimableAt !== undefined ? Date.parse(position.claimableAt) : null;
}

/**
 * The positions that can be claimed now, a claim for each wallet that placed them (the contract pays
 * the wallet that placed a position), with what each claim pays, in wei. `due` answers whether a
 * moment of the server's clock has come on this one.
 */
export function claimsOf(positions: readonly MarketPositionView[], due: (serverAt: number) => boolean)
{
    const claims = new Map<string, { address: string; ids: string[]; total: bigint }>();

    for (const position of positions)
    {
        const from = claimFrom(position);
        const claim = claims.get(position.address) ?? { address: position.address, ids: [], total: 0n };

        if (from === null || !due(from) || claim.ids.length === CLAIM_MOST)
        {
            continue;
        }

        claim.ids.push(position.id);
        claim.total += BigInt(position.payout!);
        claims.set(position.address, claim);
    }

    return [...claims.values()];
}

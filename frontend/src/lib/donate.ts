import { ApiError } from '../api.ts';
import { isDonateRefusal } from '../../../backend/src/domains/donate/refusals.ts';
import type { MessageKey } from '../locales/en.ts';
import { parseNura } from './nura.ts';

/** The smallest part of a NURA a gift is written in: four places, as every NURA figure here is said. */
const PLACE = 10n ** 14n;

/** A typed amount as wei, or null when it is not one a gift can be: the range the server gave, and four places at most. */
export function amountOf(text: string, least: string, most: string)
{
    const wei = parseNura(text);

    return wei === null || wei % PLACE !== 0n || wei < BigInt(least) || wei > BigInt(most) ? null : wei.toString();
}

/** The sentence for a donation the server or NuraChain would not make. */
export function whyDonate(error: unknown, otherwise: MessageKey = 'common.actionFailed'): MessageKey
{
    if (!(error instanceof ApiError))
    {
        return otherwise;
    }

    if (error.code === 'chain-unreachable')
    {
        return 'donate.unreached';
    }

    return isDonateRefusal(error.code) ? `donate.refused.${ error.code }` : otherwise;
}

/** What a wallet short of a gift holds, in wei, as its refusal says. */
export function heldOf(error: unknown)
{
    if (!(error instanceof ApiError) || error.code !== 'donate-funds')
    {
        return null;
    }

    const held: unknown = typeof error.details === 'object' && error.details !== null ? Reflect.get(error.details, 'held') : undefined;

    return typeof held === 'string' ? held : null;
}

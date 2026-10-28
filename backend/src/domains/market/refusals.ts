/**
 * What a market answers when it will not do something: one word each, with its status. The browser
 * reads the same list. A country markets are not offered in is 451, the status for a refusal made
 * for a legal reason.
 */
export const MARKET_REFUSALS = {
    'market-off': 404,
    'market-region': 451,
    'market-wallet': 409,
    'market-minor': 409,
    'market-terms': 409,
    'market-break': 409,
    'market-disclosure': 409,
    'market-playing': 409,
    'market-missing': 404,
    'market-closed': 409,
    'market-outcome': 422,
    'market-amount': 422,
    'market-limit': 409,
    'market-funds': 409,
    'market-paused': 409,
    'market-refused': 409,
    'market-unclaimable': 409,
    'market-hash': 409
} as const satisfies Record<string, 404 | 409 | 422 | 451>;

export type MarketRefusal = keyof typeof MARKET_REFUSALS;

export const isMarketRefusal = (value: string): value is MarketRefusal => Object.hasOwn(MARKET_REFUSALS, value);

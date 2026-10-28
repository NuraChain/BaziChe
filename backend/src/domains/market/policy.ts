/**
 * Where a market is here: taking positions (`open`), its game over and its result on its way to the
 * chain (`closing`, with the outcome, or none for a cancel), settled with winners (`settled`),
 * settled with every stake going back (`refunded`), called off (`cancelled`), expired on the chain
 * because nobody resolved it (`expired`), or closed with no position ever placed, so nothing was
 * sent (`empty`).
 */
export const MARKET_STATES = ['open', 'closing', 'settled', 'refunded', 'cancelled', 'expired', 'empty'] as const;

export type MarketState = (typeof MARKET_STATES)[number];

/**
 * Where a position is: written with its ticket (`prepared`), its transaction handed in (`sent`),
 * held by the contract (`confirmed`), refused by the chain (`reverted`), or run out unplaced
 * (`expired`).
 */
export const POSITION_STATES = ['prepared', 'sent', 'confirmed', 'reverted', 'expired'] as const;

export type PositionState = (typeof POSITION_STATES)[number];

/** What one outcome of a market is: a seat winning, a side winning, or a draw. */
export type Choice = { kind: 'seat'; seat: number } | { kind: 'side'; seats: number[] } | { kind: 'draw' };

/** How long a market takes positions once its game has started. */
export const MARKET_WINDOW_MS = 90_000;

/** How long a ticket may be placed for, at most: never past its market's close. */
export const TICKET_LIFE_MS = 120_000;

export const LEAST_STAKE_NURA = 1;

export const MAX_STAKE_NURA = 500;

export const MAX_PER_BETTOR_NURA = 1_000;

/** The most one person may stake in every market of a day, counted over the last day by Postgres's clock. */
export const MAX_PER_DAY_NURA = 2_000;

export const MAX_POOL_NURA = 100_000;

/** The fewest people, and the fewest outcomes backed, for a market's winners to be paid; fewer refunds it. */
export const MIN_BETTORS = 2;

export const MIN_OUTCOMES = 2;

/** No fee is taken until the owner sets one (MK-D6). */
export const MARKET_FEE_BPS = 0;

/** The amounts the sheet offers, in NURA. */
export const MARKET_PRESETS_NURA = [1, 5, 10, 25, 50, 100] as const;

/**
 * Whether the reader may take a position: yes, or the refusal one would meet, asked in this order:
 * where they are first, because nothing else matters where markets are not offered.
 */
export const MARKET_MAY = ['yes', 'market-region', 'market-wallet', 'market-minor', 'market-terms', 'market-break', 'market-disclosure'] as const;

export type MarketMay = (typeof MARKET_MAY)[number];

/**
 * What the chain mirrors (docs/design/2026-11-02-nft-design.md): the looks people own, in
 * `ArcadeLooks`, and the legendary achievements they earned, in `ArcadeAchievements`. Imports
 * nothing of the server's, so the browser can name a token's state from the same words.
 */
export const NFT_COLLECTIONS = ['look', 'achievement'] as const;

export type NftCollection = typeof NFT_COLLECTIONS[number];

/**
 * Where one token stands.
 *
 * - `minting`: owed, or sent and not yet mined.
 * - `minted`: in its owner's wallet.
 * - `burning`: a look no longer theirs, owed a burn, or one sent and not yet mined.
 * - `burned`: taken back; the row is history, and the look may be minted again.
 * - `failed`: the chain refused it for a reason that will not pass (a wallet that takes no
 *   ERC-1155, say), kept with that reason for the staff, and not tried again by itself.
 */
export const NFT_STATES = ['minting', 'minted', 'burning', 'burned', 'failed'] as const;

export type NftState = typeof NFT_STATES[number];

/** The states a token is still somebody's in, or on its way to being: one of them per owner and key. */
export const NFT_LIVE: readonly NftState[] = ['minting', 'minted', 'burning', 'failed'];

/** How many times a send the chain refused for a passing reason is tried before the token is `failed`. */
export const NFT_ATTEMPTS_MOST = 5;

/**
 * How long a sent transaction may go without a receipt before it is taken for lost: dropped from the
 * pool, replaced, or forgotten by a node that restarted. The token is then read again, and sent again
 * only if the chain says it still needs it, so one that mines late is never sent twice to any effect.
 */
export const NFT_LOST_AFTER_MS = 30 * 60_000;

/** How many transactions one pass of the worker sends at most, so a backfill never empties the gas wallet at once. */
export const NFT_SENDS_PER_PASS = 6;

/** How many looks one `mintBatch` carries at most: a bundle, or an owner's backfill a slice at a time. */
export const NFT_BATCH_MOST = 20;

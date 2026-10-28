/**
 * Where a donation is: written with its id and the call the giver's wallet sends (`prepared`), its
 * transaction handed in (`sent`), held by the contract under its giver and id (`confirmed`), its
 * transaction refused by the chain (`reverted`), run out unsent (`expired`), or recorded under its
 * id as something other than the gift that was prepared (`failed`), which only a call made by hand
 * can do.
 */
export const DONATION_STATES = ['prepared', 'sent', 'confirmed', 'reverted', 'expired', 'failed'] as const;

export type DonationState = (typeof DONATION_STATES)[number];

/** The amounts the sheet offers, in NURA. */
export const PRESETS_NURA = [1, 5, 10, 25, 50, 100] as const;

export const LEAST_NURA = 1;

export const MOST_NURA = 1_000;

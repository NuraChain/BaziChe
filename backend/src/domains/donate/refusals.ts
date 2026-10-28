/** What a donation answers when it will not do something: one word each, with its status. The browser reads the same list. */
export const DONATE_REFUSALS = {
    'donate-off': 404,
    'donate-closed': 409,
    'donate-wallet': 409,
    'donate-minor': 409,
    'donate-terms': 409,
    'donate-break': 409,
    'donate-playing': 409,
    'donate-nobody': 404,
    'donate-amount': 422,
    'donate-funds': 409,
    'donate-refused': 409,
    'donate-missing': 404,
    'donate-hash': 409
} as const satisfies Record<string, 404 | 409 | 422>;

export type DonateRefusal = keyof typeof DONATE_REFUSALS;

export const isDonateRefusal = (value: string): value is DonateRefusal => Object.hasOwn(DONATE_REFUSALS, value);

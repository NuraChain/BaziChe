/** What a disagreement is about: a record of one of the four families of money, or a contract's own books. */
export const CHECK_FAMILIES = ['escrow', 'order', 'donation', 'market', 'position', 'contract'] as const;

export type CheckFamily = (typeof CHECK_FAMILIES)[number];

export const CHECK_KINDS = [
    'escrow-state',
    'escrow-stakes',
    'escrow-winners',
    'order-state',
    'order-sale',
    'donation-state',
    'donation-gift',
    'market-state',
    'market-winner',
    'market-claimable',
    'position-state',
    'position-ticket',
    'position-claim',
    'solvency'
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

/** How a disagreement ended: the two sides came to agree, a worker's own write put it right, or somebody on the staff closed it. */
export const CHECK_RESOLUTIONS = ['agreed', 'put-right', 'staff'] as const;

export type CheckResolution = (typeof CHECK_RESOLUTIONS)[number];

export const CHECK_LISTS = ['open', 'closed', 'all'] as const;

export type CheckList = (typeof CHECK_LISTS)[number];

export const CHECKS_PAGE = 50;

/** The contracts whose books are read: the gifts contract holds nothing, so it keeps none. */
export const HOLDERS = ['vault', 'shop', 'markets'] as const;

export type Holder = (typeof HOLDERS)[number];

/** Whether the shop offers a look or a bundle: on sale, kept off the shelves for now, or for good. */
export const SHOP_ITEM_STATUSES = ['on-sale', 'hidden', 'retired'] as const;

export type ShopItemStatus = (typeof SHOP_ITEM_STATUSES)[number];

/**
 * Where an order is: priced and signed (`quoted`), its transaction handed in (`sent`), sold on
 * the chain and delivered (`paid`), its quote run out unpaid (`expired`), its transaction refused
 * by the chain (`failed`), or given back by the owner (`refunded`).
 */
export const ORDER_STATES = ['quoted', 'sent', 'paid', 'expired', 'failed', 'refunded'] as const;

export type OrderState = (typeof ORDER_STATES)[number];

/** Whether the reader may buy: yes, or the refusal a purchase would meet, asked in this order. */
export const SHOP_MAY = ['yes', 'shop-wallet', 'shop-minor'] as const;

export type ShopMay = (typeof SHOP_MAY)[number];

/** How somebody came to own a look. */
export const OWNED_VIA = ['purchase', 'gift', 'grant'] as const;

export type OwnedVia = (typeof OWNED_VIA)[number];

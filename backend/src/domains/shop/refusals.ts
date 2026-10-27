/** What the shop answers when it will not do something: one word each, with its status. The browser reads the same list. */
export const SHOP_REFUSALS = {
    'shop-slot': 422,
    'shop-not-owned': 409,
    'shop-off': 404,
    'shop-closed': 409,
    'shop-wallet': 409,
    'shop-minor': 409,
    'shop-item': 404,
    'shop-owned': 409,
    'shop-pending': 409,
    'shop-friend': 404,
    'shop-order': 404,
    'shop-hash': 409,
    'shop-funds': 409,
    'shop-refused': 409,
    'shop-nothing': 409
} as const satisfies Record<string, 404 | 409 | 422>;

export type ShopRefusal = keyof typeof SHOP_REFUSALS;

export const isShopRefusal = (value: string): value is ShopRefusal => Object.hasOwn(SHOP_REFUSALS, value);

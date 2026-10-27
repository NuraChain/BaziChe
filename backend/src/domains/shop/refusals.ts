/** What the shop answers when it will not do something: one word each, with its status. The browser reads the same list. */
export const SHOP_REFUSALS = {
    'shop-slot': 422,
    'shop-not-owned': 409
} as const satisfies Record<string, 404 | 409 | 422>;

export type ShopRefusal = keyof typeof SHOP_REFUSALS;

export const isShopRefusal = (value: string): value is ShopRefusal => Object.hasOwn(SHOP_REFUSALS, value);

import { ApiError, type ShopState } from '../api.ts';
import {
    BUNDLES,
    COLLECTION_NAMES,
    GAME_SLOTS,
    LOOKS,
    PROFILE_SLOTS,
    SHOP_COLLECTIONS,
    SHOP_KINDS,
    SHOP_SLOTS,
    CELEBRATION_SLOT,
    bundleOf,
    lookOf,
    type LookId,
    type ShopCollection,
    type ShopGame,
    type ShopKind,
    type ShopSlot
} from '../../../backend/src/domains/shop/catalogue.ts';
import { isShopRefusal } from '../../../backend/src/domains/shop/refusals.ts';
import type { MessageKey } from '../locales/en.ts';
import type { LocaleApi } from '../stores/locale.store.ts';

export const SHOP_FILTERS = ['all', 'profile', 'ludo', 'hokm', 'poker', 'backgammon', 'chess'] as const;

export type ShopFilter = (typeof SHOP_FILTERS)[number];

export const isShopFilter = (value: string): value is ShopFilter => (SHOP_FILTERS as readonly string[]).includes(value);

const kindsIn = (slots: readonly ShopSlot[]) => [...new Set(slots.map((slot) => SHOP_SLOTS[slot]))];

/** The kinds a filter keeps, in the catalogue's order. */
export function kindsFor(filter: ShopFilter): readonly ShopKind[]
{
    if (filter === 'all')
    {
        return SHOP_KINDS;
    }

    const wanted = kindsIn(filter === 'profile' ? PROFILE_SLOTS : [...GAME_SLOTS[filter], CELEBRATION_SLOT]);

    return SHOP_KINDS.filter((kind) => wanted.includes(kind));
}

export const GAME_LOOKS = 4;

/**
 * What a game's page offers of the shop: the featured collection's looks for that game, its
 * table's and then its celebration, filled with the game's first kind from the other collections.
 */
export function looksForGame(game: ShopGame, featured: ShopCollection)
{
    const kinds = kindsIn([...GAME_SLOTS[game], CELEBRATION_SLOT]);
    const others = SHOP_COLLECTIONS.filter((collection) => collection !== featured);
    const looks: LookId[] = [...kinds.map((kind) => `${ kind }.${ featured }` as const), ...others.map((collection) => `${ kinds[0] }.${ collection }` as const)];

    return looks.slice(0, GAME_LOOKS);
}

/** Every slot a look of `kind` may be chosen for: a card back is chosen at Hokm and at poker. */
export const slotsFor = (kind: ShopKind) => (Object.keys(SHOP_SLOTS) as ShopSlot[]).filter((slot) => SHOP_SLOTS[slot] === kind);

/** The game a slot belongs to, or null for the profile's and the celebration every table plays. */
export function gameOfSlot(slot: ShopSlot)
{
    const [area] = slot.split('.');

    return Object.hasOwn(GAME_SLOTS, area) ? area as ShopGame : null;
}

export const collectionName = (collection: ShopCollection, locale: Pick<LocaleApi, 'text'>) => locale.text(COLLECTION_NAMES[collection]);

/** A look named by its kind alone, "Dice", where its collection is chosen beside it: a whole name repeats the collection and a phone cuts the kind off. */
export function kindLabel(kind: ShopKind, locale: Pick<LocaleApi, 't' | 'tag'>)
{
    const word = locale.t(`shop.kind.${ kind }`);

    return word.charAt(0).toLocaleUpperCase(locale.tag()) + word.slice(1);
}

/** A look's name, "Shiraz Garden dice", or a bundle's, in the reader's words. */
export function itemName(id: string, locale: Pick<LocaleApi, 't' | 'text'>)
{
    const look = lookOf(id);

    if (look !== undefined)
    {
        return locale.t('shop.look.name', { collection: collectionName(look.collection, locale), kind: locale.t(`shop.kind.${ look.kind }`) });
    }

    const bundle = bundleOf(id);

    return bundle === undefined ? id : locale.t('shop.bundle.name', { collection: collectionName(bundle.collection, locale) });
}

export interface Price
{
    price: bigint;

    /** What it cost before a sale that is running, and when the sale ends. */
    was?: bigint;
    until?: string;
}

/** What the shop asks for an item now, or null for one it does not sell. */
export function priceOf(state: ShopState | null, id: string): Price | null
{
    if (state === null)
    {
        return null;
    }

    const item = state.items.find((one) => one.id === id);

    if (item === undefined)
    {
        return null;
    }

    return item.sale === undefined
        ? { price: BigInt(item.price) }
        : { price: BigInt(item.sale.price), was: BigInt(item.price), until: item.sale.until };
}

/** What a bundle saves on its looks bought one by one, as a share. */
export function bundleSaving(state: ShopState | null, id: string)
{
    const bundle = BUNDLES.find((one) => one.id === id);
    const asked = priceOf(state, id);

    if (bundle === undefined || asked === null)
    {
        return 0;
    }

    const whole = bundle.looks.reduce((sum, look) => sum + (priceOf(state, look)?.price ?? 0n), 0n);

    return whole === 0n || asked.price >= whole ? 0 : Number(whole - asked.price) / Number(whole);
}

export const looksOf = (kind: ShopKind) => LOOKS.filter((look) => look.kind === kind);

const FAILURE: Readonly<Record<string, MessageKey>> = {
    QuoteExpired: 'shop.failure.expired',
    QuoteTooLong: 'shop.failure.expired',
    EnforcedPause: 'shop.failure.paused',
    InsufficientFunds: 'shop.failure.funds',
    InsufficientBalance: 'shop.failure.funds'
};

/** What a payment the chain refused is said as: the contract's word when it has a sentence of its own. */
export const failureOf = (word: string | undefined): MessageKey => (word === undefined ? undefined : FAILURE[word]) ?? 'shop.failure.other';

/** What a refused request is said as: the shop's own word, NuraChain out of reach, or `otherwise`. */
export function whyShop(error: unknown, otherwise: MessageKey = 'common.actionFailed'): MessageKey
{
    if (!(error instanceof ApiError))
    {
        return otherwise;
    }

    if (error.code === 'chain-unreachable')
    {
        return 'shop.unreached';
    }

    return isShopRefusal(error.code) ? `shop.refused.${ error.code }` : otherwise;
}

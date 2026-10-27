/**
 * What the shop sells, read by both halves: the kinds of look, the slots each is chosen for, the
 * collections, the tiers, and what each costs until the staff set another price.
 *
 * A look's id is its kind and its collection (`dice.shiraz`), a bundle's is `bundle.` and its
 * collection. Classic has no id: it is a slot with nothing chosen in it.
 */

export const SHOP_KINDS = ['decoration', 'effect', 'theme', 'nameplate', 'dice', 'pawns', 'yard', 'back', 'face', 'felt', 'chips', 'checkers', 'home', 'pieces', 'celebration'] as const;

export type ShopKind = (typeof SHOP_KINDS)[number];

export const SHOP_COLLECTIONS = ['glow', 'shiraz', 'neon', 'gold', 'inferno', 'storm', 'astral', 'void', 'jade', 'frost', 'phoenix', 'oni'] as const;

export type ShopCollection = (typeof SHOP_COLLECTIONS)[number];

/** The legendary line: collections whose looks are priced by `LEGENDARY_TIER_OF`, the most of them mythic. */
export const LEGENDARY_COLLECTIONS = ['inferno', 'storm', 'astral', 'void', 'jade', 'frost', 'phoenix', 'oni'] as const satisfies readonly ShopCollection[];

export const SHOP_TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;

export type ShopTier = (typeof SHOP_TIERS)[number];

/** Each place a look is chosen for, and the kind it takes. A card back is one look chosen at two games. */
export const SHOP_SLOTS = {
    'profile.decoration': 'decoration',
    'profile.effect': 'effect',
    'profile.theme': 'theme',
    'profile.nameplate': 'nameplate',
    'ludo.dice': 'dice',
    'ludo.pawns': 'pawns',
    'ludo.yard': 'yard',
    'hokm.back': 'back',
    'hokm.face': 'face',
    'hokm.felt': 'felt',
    'poker.back': 'back',
    'poker.face': 'face',
    'poker.felt': 'felt',
    'poker.chips': 'chips',
    'backgammon.dice': 'dice',
    'backgammon.checkers': 'checkers',
    'backgammon.home': 'home',
    'chess.pieces': 'pieces',
    'table.celebration': 'celebration'
} as const satisfies Record<string, ShopKind>;

export type ShopSlot = keyof typeof SHOP_SLOTS;

export const SLOT_IDS = Object.keys(SHOP_SLOTS) as ShopSlot[];

export const PROFILE_SLOTS = ['profile.decoration', 'profile.effect', 'profile.theme', 'profile.nameplate'] as const satisfies readonly ShopSlot[];

/** The slots each game's table has besides the celebration, which every table plays. */
export const GAME_SLOTS = {
    ludo: ['ludo.dice', 'ludo.pawns', 'ludo.yard'],
    hokm: ['hokm.back', 'hokm.face', 'hokm.felt'],
    poker: ['poker.back', 'poker.face', 'poker.felt', 'poker.chips'],
    backgammon: ['backgammon.dice', 'backgammon.checkers', 'backgammon.home'],
    chess: ['chess.pieces']
} as const satisfies Record<string, readonly ShopSlot[]>;

export type ShopGame = keyof typeof GAME_SLOTS;

export const CELEBRATION_SLOT = 'table.celebration' satisfies ShopSlot;

/** The tier of every look of a kind in the collections the shop opened with: what it does sets what it costs. */
export const TIER_OF = {
    theme: 'common',
    face: 'common',
    chips: 'common',
    checkers: 'common',
    home: 'common',
    nameplate: 'rare',
    back: 'rare',
    felt: 'rare',
    dice: 'rare',
    pawns: 'rare',
    pieces: 'rare',
    yard: 'epic',
    decoration: 'epic',
    effect: 'legendary',
    celebration: 'legendary'
} as const satisfies Record<ShopKind, ShopTier>;

/**
 * The tier of every look of a kind in a legendary collection: what lies still (a theme, faces,
 * chips, checkers, a home board) is epic, a table's pieces are legendary, and what plays on a
 * profile or at a win is mythic.
 */
export const LEGENDARY_TIER_OF = {
    theme: 'epic',
    face: 'epic',
    chips: 'epic',
    checkers: 'epic',
    home: 'epic',
    nameplate: 'legendary',
    back: 'legendary',
    felt: 'legendary',
    dice: 'legendary',
    pawns: 'legendary',
    pieces: 'legendary',
    yard: 'legendary',
    decoration: 'mythic',
    effect: 'mythic',
    celebration: 'mythic'
} as const satisfies Record<ShopKind, ShopTier>;

/** What each tier costs, in whole NURA, until the staff set another price. */
export const TIER_PRICE = { common: 5, rare: 12, epic: 25, legendary: 50, mythic: 100 } as const satisfies Record<ShopTier, number>;

/** A look's tier: by its kind, on its collection's line. */
export function tierOf(kind: ShopKind, collection: ShopCollection)
{
    return (LEGENDARY_COLLECTIONS as readonly ShopCollection[]).includes(collection) ? LEGENDARY_TIER_OF[kind] : TIER_OF[kind];
}

/** A bundle costs its looks' prices less this share, in basis points. */
export const BUNDLE_OFF_BPS = 3_000;

export const NURA = 10n ** 18n;

/** The newest collection is featured until the staff feature another. */
export const FEATURED_FIRST: ShopCollection = 'inferno';

export const COLLECTION_NAMES = {
    glow: { en: 'Nura Glow', fa: 'درخشش نورا' },
    shiraz: { en: 'Shiraz Garden', fa: 'باغ شیراز' },
    neon: { en: 'Midnight Neon', fa: 'نئون نیمه‌شب' },
    gold: { en: 'Royal Gold', fa: 'طلای سلطنتی' },
    inferno: { en: 'Infernal Sovereign', fa: 'سلطان دوزخ' },
    storm: { en: 'Stormforged Monarch', fa: 'پادشاه طوفان' },
    astral: { en: 'Astral Rift', fa: 'شکاف کیهانی' },
    void: { en: 'Void Emperor', fa: 'امپراتور خلأ' },
    jade: { en: 'Jade Dragon Dynasty', fa: 'دودمان اژدهای یشم' },
    frost: { en: 'Frost Revenant', fa: 'شبح یخبندان' },
    phoenix: { en: 'Solar Phoenix', fa: 'ققنوس خورشید' },
    oni: { en: 'Neon Oni', fa: 'دیو نئونی' }
} as const satisfies Record<ShopCollection, { en: string; fa: string }>;

export const COLLECTION_BLURBS = {
    glow: {
        en: 'Navy and blue light with white-gold sparkles: the light Nura is named for.',
        fa: 'سرمه‌ای و نور آبی با برق‌های طلایی‌سفید؛ همون نوری که اسم نورا ازش اومده.'
    },
    shiraz: {
        en: 'Turquoise and lapis tiles, girih stars and gold lines, from the gardens of Shiraz.',
        fa: 'کاشی فیروزه‌ای و لاجوردی، ستاره‌های گره و خط‌های طلایی، از باغ‌های شیراز.'
    },
    neon: {
        en: 'Black glass with magenta and cyan edges that glow after dark.',
        fa: 'شیشه‌ی مشکی با لبه‌های سرخابی و فیروزه‌ای که توی تاریکی می‌درخشن.'
    },
    gold: {
        en: 'Polished gold on black, with fine filigree.',
        fa: 'طلای براق روی مشکی، با ملیله‌کاری ظریف.'
    },
    inferno: {
        en: 'Obsidian cracked with molten gold, crowned in fire that smoulders and then erupts.',
        fa: 'ابسیدین ترک‌خورده با طلای مذاب و تاجی از آتیش که آروم می‌سوزه و یهو فوران می‌کنه.'
    },
    storm: {
        en: 'Forged steel charged with the storm: arcs that gather, crawl and strike.',
        fa: 'فولاد آب‌دیده که طوفان توشه؛ صاعقه‌ای که جمع می‌شه، می‌خزه و فرود میاد.'
    },
    astral: {
        en: 'Dark glass full of stars, worlds in orbit and a rift of light that opens in the night.',
        fa: 'شیشه‌ی تیره پر از ستاره، سیاره‌هایی که می‌چرخن و شکافی از نور که وسط شب باز می‌شه.'
    },
    void: {
        en: 'Matte black split by violet fractures, drawing the light in and letting it go.',
        fa: 'مشکیِ مات با ترک‌های بنفش که نور رو می‌کشه تو خودش و دوباره ولش می‌کنه.'
    },
    jade: {
        en: 'Carved jade inlaid with gold, and a dragon coiled round its pearl.',
        fa: 'یشم کنده‌کاری‌شده با منبت طلا و اژدهایی که دور مرواریدش پیچیده.'
    },
    frost: {
        en: 'Faceted ice and six-fold crystals growing in a brittle stillness.',
        fa: 'یخ تراش‌خورده و بلورهای شش‌پر که توی یه سکوت شکننده رشد می‌کنن.'
    },
    phoenix: {
        en: 'Gilded feathers on burnished bronze, rising to a sun that never sets.',
        fa: 'پرهای طلایی روی برنز صیقلی که تا خورشیدی که هیچ‌وقت غروب نمی‌کنه اوج می‌گیرن.'
    },
    oni: {
        en: 'Black chrome under holographic film, circuits and a horned mask that glitches.',
        fa: 'کروم مشکی زیر لایه‌ی هولوگرامی، مدار و یه نقاب شاخ‌دار که هی پرش می‌کنه.'
    }
} as const satisfies Record<ShopCollection, { en: string; fa: string }>;

export type LookId = `${ ShopKind }.${ ShopCollection }`;

export type BundleId = `bundle.${ ShopCollection }`;

export type ItemId = LookId | BundleId;

export interface ShopLook
{
    id: LookId;
    kind: ShopKind;
    collection: ShopCollection;
    tier: ShopTier;

    /** Its price in wei until the staff set another. */
    price: bigint;
}

export interface ShopBundle
{
    id: BundleId;
    collection: ShopCollection;
    looks: readonly LookId[];
    price: bigint;
}

export const LOOKS: readonly ShopLook[] = SHOP_COLLECTIONS.flatMap((collection) => SHOP_KINDS.map((kind) => ({
    id: `${ kind }.${ collection }` as LookId,
    kind,
    collection,
    tier: tierOf(kind, collection),
    price: BigInt(TIER_PRICE[tierOf(kind, collection)]) * NURA
})));

/** A collection's bundle: every look of it, at their prices less `BUNDLE_OFF_BPS`, in whole NURA. */
export const BUNDLES: readonly ShopBundle[] = SHOP_COLLECTIONS.map((collection) =>
{
    const looks = LOOKS.filter((look) => look.collection === collection);
    const whole = looks.reduce((sum, look) => sum + look.price, 0n);

    return {
        id: `bundle.${ collection }` as BundleId,
        collection,
        looks: looks.map((look) => look.id),
        price: (whole * BigInt(10_000 - BUNDLE_OFF_BPS)) / 10_000n / NURA * NURA
    };
});

const LOOK_BY_ID = new Map<string, ShopLook>(LOOKS.map((look) => [look.id, look]));

const BUNDLE_BY_ID = new Map<string, ShopBundle>(BUNDLES.map((bundle) => [bundle.id, bundle]));

export function lookOf(id: string)
{
    return LOOK_BY_ID.get(id);
}

export function bundleOf(id: string)
{
    return BUNDLE_BY_ID.get(id);
}

export function isItemId(id: string): id is ItemId
{
    return LOOK_BY_ID.has(id) || BUNDLE_BY_ID.has(id);
}

export function isSlot(slot: string): slot is ShopSlot
{
    return Object.hasOwn(SHOP_SLOTS, slot);
}

/** Whether a look may be chosen for a slot: it is a look, of the kind the slot takes. */
export function fitsSlot(slot: ShopSlot, id: string)
{
    return lookOf(id)?.kind === SHOP_SLOTS[slot];
}

/** The slots a table of `game` draws: its own and the celebration every table plays. */
export function tableSlotsOf(game: string): readonly ShopSlot[]
{
    return Object.hasOwn(GAME_SLOTS, game) ? [...GAME_SLOTS[game as ShopGame], CELEBRATION_SLOT] : [];
}

/**
 * What a bundle costs somebody who owns some of its looks: its price times the share of its
 * looks' prices they lack, rounded down to the wei. Owning all of it leaves nothing to pay.
 */
export function bundlePriceFor(price: bigint, looks: readonly { price: bigint; owned: boolean }[])
{
    const whole = looks.reduce((sum, look) => sum + look.price, 0n);
    const lacking = looks.reduce((sum, look) => sum + (look.owned ? 0n : look.price), 0n);

    return whole === 0n ? 0n : (price * lacking) / whole;
}

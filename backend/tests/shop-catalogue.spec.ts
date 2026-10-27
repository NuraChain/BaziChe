import 'reflect-metadata';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import '../src/entities/index.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import {
    BUNDLES, BUNDLE_OFF_BPS, CELEBRATION_SLOT, COLLECTION_BLURBS, COLLECTION_NAMES, FEATURED_FIRST, GAME_SLOTS, LEGENDARY_COLLECTIONS, LEGENDARY_TIER_OF, LOOKS, NURA,
    PROFILE_SLOTS, SHOP_COLLECTIONS, SHOP_KINDS, SHOP_SLOTS, SHOP_TIERS, TIER_OF, TIER_PRICE, bundleOf, bundlePriceFor, fitsSlot, isItemId, isSlot, lookOf, tableSlotsOf,
    tierOf
} from '../src/domains/shop/catalogue.ts';
import { ORDER_STATES, OWNED_VIA, SHOP_ITEM_STATUSES } from '../src/domains/shop/policy.ts';
import { tableLook } from '../src/schemas.ts';

const expressionOf = (name: string) => getMetadataArgsStorage().checks.find((one) => one.name === name)?.expression ?? '';

const wordsIn = (name: string) => [...expressionOf(name).matchAll(/'([a-z.-]+)'/g)].map((match) => match[1]);

describe('what the shop sells', () =>
{
    it('is every kind in every collection, one look each, at its kind\'s tier on its collection\'s line', () =>
    {
        expect(LOOKS).toHaveLength(SHOP_KINDS.length * SHOP_COLLECTIONS.length);
        expect(new Set(LOOKS.map((look) => look.id)).size).toBe(LOOKS.length);

        for (const look of LOOKS)
        {
            expect(look.id).toBe(`${ look.kind }.${ look.collection }`);
            expect(look.tier).toBe(tierOf(look.kind, look.collection));
            expect(look.price).toBe(BigInt(TIER_PRICE[look.tier]) * NURA);
            expect(lookOf(look.id)).toBe(look);
            expect(isItemId(look.id)).toBe(true);
        }

        expect(Object.keys(TIER_OF).sort()).toEqual([...SHOP_KINDS].sort());
        expect(Object.keys(LEGENDARY_TIER_OF).sort()).toEqual([...SHOP_KINDS].sort());
        expect(Object.keys(TIER_PRICE)).toEqual([...SHOP_TIERS]);
        expect(SHOP_TIERS.map((tier) => TIER_PRICE[tier])).toEqual([5, 12, 25, 50, 100]);
    });

    it('prices a legendary collection by its own line: still looks epic, a table\'s pieces legendary, a profile\'s decoration and effect and a win\'s celebration mythic', () =>
    {
        expect(SHOP_COLLECTIONS.slice(4)).toEqual([...LEGENDARY_COLLECTIONS]);

        for (const collection of LEGENDARY_COLLECTIONS)
        {
            const tiers = Object.fromEntries(SHOP_KINDS.map((kind) => [kind, lookOf(`${ kind }.${ collection }`)!.tier]));

            expect(tiers, collection).toEqual({
                theme: 'epic', face: 'epic', chips: 'epic', checkers: 'epic', home: 'epic',
                nameplate: 'legendary', back: 'legendary', felt: 'legendary', dice: 'legendary', pawns: 'legendary', pieces: 'legendary', yard: 'legendary',
                decoration: 'mythic', effect: 'mythic', celebration: 'mythic'
            });
            expect(lookOf(`effect.${ collection }`)!.price).toBe(100n * NURA);
        }

        for (const collection of SHOP_COLLECTIONS.slice(0, 4))
        {
            expect(SHOP_KINDS.map((kind) => lookOf(`${ kind }.${ collection }`)!.tier), collection).not.toContain('mythic');
        }
    });

    it('has a bundle for each collection holding all of it, 30% under its parts in whole NURA', () =>
    {
        expect(BUNDLES.map((bundle) => bundle.collection)).toEqual([...SHOP_COLLECTIONS]);

        for (const bundle of BUNDLES)
        {
            const looks = LOOKS.filter((look) => look.collection === bundle.collection);
            const whole = looks.reduce((sum, look) => sum + look.price, 0n);

            expect(bundle.id).toBe(`bundle.${ bundle.collection }`);
            expect([...bundle.looks]).toEqual(looks.map((look) => look.id));
            expect(bundle.price % NURA).toBe(0n);
            expect(bundle.price).toBeLessThanOrEqual((whole * BigInt(10_000 - BUNDLE_OFF_BPS)) / 10_000n);
            expect(bundle.price).toBeGreaterThan((whole * BigInt(10_000 - BUNDLE_OFF_BPS)) / 10_000n - NURA);
            expect(bundleOf(bundle.id)).toBe(bundle);
            expect(isItemId(bundle.id)).toBe(true);
        }

        expect(BUNDLES[0].price).toBe(172n * NURA);
        expect(isItemId('bundle.velvet')).toBe(false);
        expect(isItemId('dice')).toBe(false);
        expect(isItemId('dice.velvet')).toBe(false);
    });

    it('prices a bundle down for the looks its buyer already owns', () =>
    {
        const looks = [{ price: 5n, owned: false }, { price: 15n, owned: false }];

        expect(bundlePriceFor(14n, looks)).toBe(14n);
        expect(bundlePriceFor(14n, [{ price: 5n, owned: true }, { price: 15n, owned: false }])).toBe(10n);
        expect(bundlePriceFor(14n, [{ price: 5n, owned: false }, { price: 15n, owned: true }])).toBe(3n);
        expect(bundlePriceFor(14n, looks.map((look) => ({ ...look, owned: true })))).toBe(0n);
        expect(bundlePriceFor(14n, [])).toBe(0n);
    });

    it('names each collection in English and in Persian, and says what it is in each', () =>
    {
        for (const collection of SHOP_COLLECTIONS)
        {
            expect(COLLECTION_NAMES[collection].en).not.toBe(COLLECTION_NAMES[collection].fa);
            expect(COLLECTION_BLURBS[collection].en).not.toBe(COLLECTION_BLURBS[collection].fa);
        }

        expect(SHOP_COLLECTIONS).toContain(FEATURED_FIRST);
    });
});

describe('where a look is chosen', () =>
{
    it('is a slot named for its place and its kind, for every kind', () =>
    {
        for (const [slot, kind] of Object.entries(SHOP_SLOTS))
        {
            expect(slot.split('.')[1]).toBe(kind);
            expect(isSlot(slot)).toBe(true);
        }

        expect(new Set(Object.values(SHOP_SLOTS))).toEqual(new Set(SHOP_KINDS));
        expect(isSlot('ludo.cards')).toBe(false);
        expect(isSlot('constructor')).toBe(false);
    });

    it('takes a look of the slot\'s own kind and nothing else', () =>
    {
        expect(fitsSlot('ludo.dice', 'dice.shiraz')).toBe(true);
        expect(fitsSlot('backgammon.dice', 'dice.shiraz')).toBe(true);
        expect(fitsSlot('hokm.back', 'back.neon')).toBe(true);
        expect(fitsSlot('poker.back', 'back.neon')).toBe(true);
        expect(fitsSlot('ludo.dice', 'pawns.shiraz')).toBe(false);
        expect(fitsSlot('ludo.dice', 'bundle.shiraz')).toBe(false);
        expect(fitsSlot('ludo.dice', 'dice')).toBe(false);
    });

    it('gives every game its own slots and the celebration every table plays, and the profile four', () =>
    {
        expect(Object.keys(GAME_SLOTS).sort()).toEqual(GAME_SEEDS.map((game) => game.id).sort());

        for (const game of Object.keys(GAME_SLOTS))
        {
            const slots = tableSlotsOf(game);

            expect(slots.at(-1)).toBe(CELEBRATION_SLOT);
            expect(slots.every((slot) => slot.startsWith(`${ game }.`) || slot === CELEBRATION_SLOT)).toBe(true);
        }

        expect(tableSlotsOf('checkers')).toEqual([]);
        expect(tableSlotsOf('toString')).toEqual([]);
        expect(PROFILE_SLOTS.every((slot) => slot.startsWith('profile.'))).toBe(true);
        expect(new Set([...PROFILE_SLOTS, ...Object.values(GAME_SLOTS).flat(), CELEBRATION_SLOT])).toEqual(new Set(Object.keys(SHOP_SLOTS)));
    });
});

describe('a game\'s look on the wire', () =>
{
    it('carries every kind a table draws and none a profile does, since a kind it does not name is dropped', () =>
    {
        const drawn = new Set([...Object.values(GAME_SLOTS).flat(), CELEBRATION_SLOT].filter(isSlot).map((slot) => SHOP_SLOTS[slot]));

        for (const kind of SHOP_KINDS)
        {
            const read = tableLook.safeParse({ [kind]: `${ kind }.glow` });

            expect(read.ok, kind).toBe(true);
            expect(read.ok && kind in read.value, kind).toBe(drawn.has(kind));
        }
    });
});

describe('the shop\'s rows', () =>
{
    it('name the same slots, states, ways of owning and statuses as the code', () =>
    {
        expect(wordsIn('equipped_items_slot_known')).toEqual(Object.keys(SHOP_SLOTS));
        expect(wordsIn('shop_orders_state_known')).toEqual([...ORDER_STATES]);
        expect(wordsIn('owned_items_via_known')).toEqual([...OWNED_VIA]);
        expect(wordsIn('shop_items_status_known')).toEqual([...SHOP_ITEM_STATUSES]);
    });

    it('hold a chosen look to its slot\'s kind, and an owned look to a look', () =>
    {
        expect(expressionOf('equipped_items_fits')).toBe(`split_part(slot, '.', 2) = split_part(item_id, '.', 1)`);
        expect(expressionOf('owned_items_look')).toBe(`item_id not like 'bundle.%'`);
    });
});

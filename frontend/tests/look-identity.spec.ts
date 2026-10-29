import { describe, expect, it } from 'vitest';

import { LEGENDARY_COLLECTIONS, SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { AURAS, REVEALS } from '../src/game/looks/aura.ts';
import { BORNE, ENTRIES } from '../src/game/looks/backgammon.ts';
import { CASTLES, CHECKS, FINALES } from '../src/game/looks/chess.ts';
import { playAt } from '../src/game/looks/cards.ts';
import { LIGHTS } from '../src/game/looks/lights.ts';
import { TRAILS } from '../src/game/looks/ludo.ts';
import { CAPTURES, CRITICALS, burstOf, lightOf } from '../src/game/looks/table.ts';

describe('a legendary collection\'s motion', () =>
{
    it.each([...LEGENDARY_COLLECTIONS])('plays %s’s own aura round a picture and its own burst at a table, which no other collection plays', (collection) =>
    {
        const others = SHOP_COLLECTIONS.filter((one) => one !== collection);

        expect(others.map((one) => AURAS[one].stream)).not.toContain(AURAS[collection].stream);
        expect(others.map((one) => burstOf(one).effect)).not.toContain(burstOf(collection).effect);
    });

    it.each([...LEGENDARY_COLLECTIONS])('opens %s’s profile with a reveal of its own, whose first layer no other collection plays', (collection) =>
    {
        const others = SHOP_COLLECTIONS.filter((one) => one !== collection);

        expect(others.map((one) => REVEALS[one][0].effect)).not.toContain(REVEALS[collection][0].effect);
    });

    it.each([...LEGENDARY_COLLECTIONS])('lays a card of %s with a signature of its own, whose first layer no other collection\'s card plays', (collection) =>
    {
        const card = { x: 0, y: 0, width: 60, height: 85 };
        const others = SHOP_COLLECTIONS.filter((one) => one !== collection);

        expect(others.map((one) => playAt(one, card).steps[0].effect)).not.toContain(playAt(collection, card).steps[0].effect);
    });
});

describe('a collection\'s light', () =>
{
    it.each([...SHOP_COLLECTIONS])('plays every effect of %s in one light, round a picture and at a table alike', (collection) =>
    {
        expect(lightOf(collection)).toBe(LIGHTS[collection]);
        expect(AURAS[collection].tune.colors).toBe(LIGHTS[collection]);
    });

    it.each([...LEGENDARY_COLLECTIONS])('gives %s a light no other collection plays in', (collection) =>
    {
        const lightAs = (one: (typeof SHOP_COLLECTIONS)[number]) => [...LIGHTS[one]].sort().join(' ');
        const others = SHOP_COLLECTIONS.filter((one) => one !== collection);

        expect(others.map(lightAs)).not.toContain(lightAs(collection));
    });
});

describe('a legendary collection at a Ludo table', () =>
{
    const others = (collection: (typeof SHOP_COLLECTIONS)[number]) => SHOP_COLLECTIONS.filter((one) => one !== collection);

    it.each([...LEGENDARY_COLLECTIONS])('walks a pawn of %s shedding a stream no other collection’s pawn sheds', (collection) =>
    {
        const own = TRAILS[collection].at(-1)!;

        expect(own, 'it sheds the trail every collection draws').not.toBe('trail');
        expect(others(collection).flatMap((one) => [...TRAILS[one]])).not.toContain(own);
    });

    it.each([...LEGENDARY_COLLECTIONS])('throws a six of %s and takes a pawn of it with signatures whose first layers no other collection opens with', (collection) =>
    {
        expect(others(collection).map((one) => CRITICALS[one][0].effect)).not.toContain(CRITICALS[collection][0].effect);
        expect(others(collection).map((one) => CAPTURES[one][0].effect)).not.toContain(CAPTURES[collection][0].effect);
    });
});

describe('a collection’s moments at a backgammon table', () =>
{
    const others = (collection: (typeof SHOP_COLLECTIONS)[number]) => SHOP_COLLECTIONS.filter((one) => one !== collection);

    it.each([...LEGENDARY_COLLECTIONS])('brings a checker of %s in from the bar and bears one off with signatures whose first layers no other collection opens with', (collection) =>
    {
        expect(others(collection).map((one) => ENTRIES[one][0].effect)).not.toContain(ENTRIES[collection][0].effect);
        expect(others(collection).map((one) => BORNE[one][0].effect)).not.toContain(BORNE[collection][0].effect);
    });

    it.each([...SHOP_COLLECTIONS])('brings a checker of %s in from the bar otherwise than it takes a blot', (collection) =>
    {
        expect(ENTRIES[collection].map((step) => step.effect)).not.toEqual(CAPTURES[collection].map((step) => step.effect));
    });
});

describe('a collection’s moments at a chess table', () =>
{
    const others = (collection: (typeof SHOP_COLLECTIONS)[number]) => SHOP_COLLECTIONS.filter((one) => one !== collection);

    it.each([...LEGENDARY_COLLECTIONS])('castles in %s and gives check in it with signatures whose first layers no other collection opens with', (collection) =>
    {
        expect(others(collection).map((one) => CASTLES[one][0].effect)).not.toContain(CASTLES[collection][0].effect);
        expect(others(collection).map((one) => CHECKS[one][0].effect)).not.toContain(CHECKS[collection][0].effect);
    });

    it.each([...SHOP_COLLECTIONS])('castles in %s otherwise than it takes a piece', (collection) =>
    {
        expect(CASTLES[collection].map((step) => step.effect)).not.toEqual(CAPTURES[collection].map((step) => step.effect));
    });

    it.each([...SHOP_COLLECTIONS])('ends a mate in %s one layer after its promotion has played its last', (collection) =>
    {
        const last = Math.max(...CRITICALS[collection].map((step: { after?: number }) => step.after ?? 0));

        expect(FINALES[collection].after).toBeGreaterThan(last);
    });
});

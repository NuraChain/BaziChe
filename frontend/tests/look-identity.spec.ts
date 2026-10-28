import { describe, expect, it } from 'vitest';

import { LEGENDARY_COLLECTIONS, SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { AURAS, REVEALS } from '../src/game/looks/aura.ts';
import { playAt } from '../src/game/looks/cards.ts';
import { LIGHTS } from '../src/game/looks/lights.ts';
import { burstOf, lightOf } from '../src/game/looks/table.ts';

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

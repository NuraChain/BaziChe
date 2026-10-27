import { describe, expect, it } from 'vitest';

import { LEGENDARY_COLLECTIONS, SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import { AURAS } from '../src/game/looks/frames.ts';
import { burstOf } from '../src/game/looks/table.ts';

describe('a legendary collection\'s motion', () =>
{
    it.each([...LEGENDARY_COLLECTIONS])('plays %s’s own aura round a picture and its own burst at a table, which no other collection plays', (collection) =>
    {
        const others = SHOP_COLLECTIONS.filter((one) => one !== collection);

        expect(others.map((one) => AURAS[one].stream)).not.toContain(AURAS[collection].stream);
        expect(others.map((one) => burstOf(one).effect)).not.toContain(burstOf(collection).effect);
    });
});

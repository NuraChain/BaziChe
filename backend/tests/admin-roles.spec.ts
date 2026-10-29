import { describe, expect, it } from 'vitest';

import { ABILITIES, GRANTED_ROLES, OWNER_WALLET, STAFF_ROLES, may, ownersOf, outranks, shownOwnersOf, type Ability, type StaffRole } from '../src/domains/admin/roles.ts';
import { STAFF_REFUSALS, isStaffRefusal } from '../src/domains/admin/refusals.ts';

const ROLES: (StaffRole | null)[] = [null, ...STAFF_ROLES];

describe('who on the staff may do what', () =>
{
    it('lets each role reach exactly the sections its rank opens', () =>
    {
        const reach = (role: StaffRole | null) => (Object.keys(ABILITIES) as Ability[]).filter((ability) => may(role, ability)).sort();

        expect(reach(null)).toEqual([]);
        expect(reach('moderator')).toEqual(['live', 'overview', 'people', 'reports']);
        expect(reach('admin')).toEqual(['health', 'live', 'log', 'money', 'notice', 'overview', 'people', 'play', 'reports', 'shop', 'staff']);
        expect(reach('owner')).toEqual(['health', 'live', 'log', 'money', 'notice', 'overview', 'people', 'play', 'reports', 'shop', 'staff', 'wallet']);
    });

    it('puts the owner above an admin, an admin above a moderator, and every role above somebody who is none', () =>
    {
        const above = ROLES.map((actor) => ROLES.filter((other) => outranks(actor, other)));

        expect(above).toEqual([
            [],
            [null],
            [null, 'moderator'],
            [null, 'moderator', 'admin']
        ]);
    });

    it('never puts a role above itself', () =>
    {
        for (const role of ROLES)
        {
            expect(outranks(role, role), String(role)).toBe(false);
        }
    });

    it('grants in the page only the roles below the owner, whom the server names', () =>
    {
        expect([...GRANTED_ROLES]).toEqual(['moderator', 'admin']);
        expect(GRANTED_ROLES.every((role) => outranks('owner', role))).toBe(true);
    });
});

describe('who the owners are', () =>
{
    const NAMED = '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc';

    it('is the wallet written into the server, and beside it the one .env names, lowercase and once each', () =>
    {
        expect(ownersOf('')).toEqual([OWNER_WALLET]);
        expect(ownersOf('   ')).toEqual([OWNER_WALLET]);
        expect(ownersOf(` ${ NAMED.toUpperCase().replace('0X', '0x') } `)).toEqual([OWNER_WALLET, NAMED]);
        expect(ownersOf(OWNER_WALLET.toUpperCase().replace('0X', '0x'))).toEqual([OWNER_WALLET]);
    });

    it('shows the staff the one .env names alone, lowercase, and nobody when it names nobody', () =>
    {
        expect(shownOwnersOf('')).toEqual([]);
        expect(shownOwnersOf('   ')).toEqual([]);
        expect(shownOwnersOf(` ${ NAMED.toUpperCase().replace('0X', '0x') } `)).toEqual([NAMED]);
        expect(shownOwnersOf(OWNER_WALLET.toUpperCase().replace('0X', '0x'))).toEqual([OWNER_WALLET]);
    });

    it('writes the server\'s own owner as an address, lowercase', () =>
    {
        expect(OWNER_WALLET).toMatch(/^0x[0-9a-f]{40}$/);
    });
});

describe('what the staff are refused in words', () =>
{
    it('lists each word once with its status, and answers a word it does not have as none', () =>
    {
        expect(STAFF_REFUSALS).toEqual({ 'staff-nobody': 404, 'staff-owner': 409, 'staff-self': 409, 'staff-rank': 409, 'staff-not-suspended': 409, 'staff-match-over': 409, 'staff-in-game': 409, 'staff-seated': 409, 'staff-table-closed': 409, 'staff-table-playing': 409, 'staff-no-notice': 409, 'staff-check-closed': 409, 'staff-shop-one': 422, 'staff-shop-sale': 409 });
        expect(isStaffRefusal('staff-rank')).toBe(true);
        expect(isStaffRefusal('toString')).toBe(false);
        expect(isStaffRefusal('not-found')).toBe(false);
    });
});

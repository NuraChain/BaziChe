import { describe, expect, it } from 'vitest';

import { OWNER_WALLET } from '../src/domains/admin/roles.ts';
import { isAdminAddress } from '../src/domains/identity/admin.ts';

const ADMIN = '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc';

describe('who may open /admin', () =>
{
    it('is the configured wallet, whatever case either side is written in', () =>
    {
        expect(isAdminAddress(ADMIN, ADMIN)).toBe(true);
        expect(isAdminAddress(ADMIN.toUpperCase().replace('0X', '0x'), ADMIN)).toBe(true);
        expect(isAdminAddress(ADMIN, ADMIN.toUpperCase().replace('0X', '0x'))).toBe(true);
    });

    it('is the wallet written into the server too, whether .env names another or none', () =>
    {
        const shouted = OWNER_WALLET.toUpperCase().replace('0X', '0x');

        expect(isAdminAddress(OWNER_WALLET, ADMIN)).toBe(true);
        expect(isAdminAddress(shouted, ADMIN)).toBe(true);
        expect(isAdminAddress(OWNER_WALLET, '')).toBe(true);
        expect(isAdminAddress(shouted, '')).toBe(true);
    });

    it('is nobody else and no guest, and the wallet .env names only while it names it', () =>
    {
        expect(isAdminAddress('0x1111111111111111111111111111111111111111', ADMIN)).toBe(false);
        expect(isAdminAddress(null, ADMIN)).toBe(false);
        expect(isAdminAddress(null, '')).toBe(false);
        expect(isAdminAddress(ADMIN, '')).toBe(false);
        expect(isAdminAddress('', '')).toBe(false);
    });
});

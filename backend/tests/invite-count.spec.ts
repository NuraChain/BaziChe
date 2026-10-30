import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SERVICES = readFileSync(fileURLToPath(new URL('../src/services.ts', import.meta.url)), 'utf8');

describe('counting an invite after a finish', () =>
{
    it('makes whoever the game established one before it counts, with the owners the server names', () =>
    {
        const counting = SERVICES.slice(SERVICES.indexOf('const countInvites = async'), SERVICES.indexOf('const finished = async'));
        const established = counting.indexOf('await invites.establish(matchId);');

        expect(established).toBeGreaterThan(-1);
        expect(established).toBeLessThan(counting.indexOf('invites.countedBy(matchId)'));
        expect(SERVICES).toContain('createInviteService(db, () => ownersOf(config.adminWallet))');
    });
});

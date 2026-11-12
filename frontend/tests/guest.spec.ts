import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { signInText, verifySignature } from '../../backend/src/domains/identity/signature.ts';
import {
    GuestFileError,
    forgetGuest,
    guestAddress,
    guestFileAddress,
    guestKey,
    guestProvider,
    heldGuest,
    isGuestProvider,
    openGuest,
    sealGuest,
    signAsGuest
} from '../src/lib/guest.ts';
import { failureOf, personalSign, sendTransaction, signTypedData } from '../src/lib/wallet.ts';
import { memoryStorage } from './memory-storage.ts';

const SECRET = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const storage = memoryStorage();

describe('the guest key', () =>
{
    beforeEach(() =>
    {
        storage.fresh();
        forgetGuest();
    });

    afterEach(() => storage.restore());

    it('is the address a wallet holding the same key would be', () =>
    {
        expect(guestAddress(SECRET)).toBe(privateKeyToAccount(SECRET).address.toLowerCase());
    });

    it('signs exactly what a wallet signs, so the server reads it as a wallet', async () =>
    {
        const message = signInText('baziche.test', 'nonce-1', 'device-id-0123456789ab');
        const ours = signAsGuest(SECRET, message);

        expect(ours).toBe(await privateKeyToAccount(SECRET).signMessage({ message }));
        await expect(verifySignature({ address: guestAddress(SECRET), message, signature: ours })).resolves.toEqual({ ok: true, attestation: 'wallet' });
    });

    it('is made once and kept, and the same key comes back after', () =>
    {
        expect(heldGuest()).toBeNull();

        const made = guestKey();

        expect(made).toMatch(/^0x[0-9a-f]{64}$/);
        expect(guestKey()).toBe(made);
        expect(heldGuest()).toBe(made);
    });
});

describe('the guest provider', () =>
{
    it('answers the sign-in with the guest address and signature', async () =>
    {
        const provider = guestProvider(SECRET);
        const address = guestAddress(SECRET);

        expect(isGuestProvider(provider)).toBe(true);
        await expect(provider.request({ method: 'eth_requestAccounts' })).resolves.toEqual([address]);
        await expect(personalSign(provider, address, 'hello')).resolves.toBe(signAsGuest(SECRET, 'hello'));
    });

    it('refuses everything on chain, as a refusal rather than a crash', async () =>
    {
        const provider = guestProvider(SECRET);
        const address = guestAddress(SECRET);

        const sent = await sendTransaction(provider, address, address, '0x').catch((error: unknown) => error);
        const typed = await signTypedData(provider, address, '{}').catch((error: unknown) => error);

        expect((sent as { code?: number }).code).toBe(4200);
        expect((typed as { code?: number }).code).toBe(4200);
        expect(failureOf(sent)).toBe('unknown');
    });

    it('will not sign for an address that is not its own', async () =>
    {
        const provider = guestProvider(SECRET);
        const refused = await personalSign(provider, '0x0000000000000000000000000000000000000001', 'hi').catch((error: unknown) => error);

        expect(failureOf(refused)).toBe('unauthorized');
    });
});

describe('the guest file', () =>
{
    it('opens with its password and gives back the same key', async () =>
    {
        const file = await sealGuest(SECRET, 'correct horse');

        expect(file).not.toContain(SECRET.slice(2));
        expect(guestFileAddress(file)).toBe(guestAddress(SECRET));
        await expect(openGuest(file, 'correct horse')).resolves.toBe(SECRET);
    }, 30_000);

    it('does not open with another password', async () =>
    {
        const file = await sealGuest(SECRET, 'correct horse');

        await expect(openGuest(file, 'wrong horse')).rejects.toEqual(new GuestFileError('wrong-password'));
    }, 30_000);

    it('does not open once its address was changed', async () =>
    {
        const file = JSON.parse(await sealGuest(SECRET, 'pw-123456')) as { address: string };

        file.address = '0x0000000000000000000000000000000000000001';

        await expect(openGuest(JSON.stringify(file), 'pw-123456')).rejects.toBeInstanceOf(GuestFileError);
    }, 30_000);

    it('says a file that is not one is not one', async () =>
    {
        expect(guestFileAddress('{"kind":"other"}')).toBeNull();
        await expect(openGuest('not json', 'x')).rejects.toEqual(new GuestFileError('not-a-file'));
    });
});

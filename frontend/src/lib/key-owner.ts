/**
 * Whose chat keys this browser holds: the account id they were made and learned for.
 *
 * Signing out used to throw the keys away, so the same person signing back in was a new device,
 * and every line sent before it was "Locked. This browser was not given the key for this part of
 * the conversation." The keys stay now, and what keeps them from reaching anybody else is this
 * note: the moment a different account signs in at this browser, the last one's keys are wiped
 * before anything reads them (`session.store.ts`).
 *
 * It authorises nothing. A key opens only what the server hands an account it has signed in, and a
 * forged note costs at most keys being wiped, which is what happened on every sign-out before.
 */
export const KEYS_OF = 'nura.keys-of';

export function keysOwner(): string | null
{
    try
    {
        return localStorage.getItem(KEYS_OF);
    }
    catch
    {
        return null;
    }
}

export function ownKeys(accountId: string)
{
    try
    {
        localStorage.setItem(KEYS_OF, accountId);
    }
    catch
    {
        // A browser that keeps no notes keeps whatever keys it has unclaimed, as before this note.
    }
}

export function disownKeys()
{
    try
    {
        localStorage.removeItem(KEYS_OF);
    }
    catch
    {
        // Nothing was written, so nothing is there to take back.
    }
}

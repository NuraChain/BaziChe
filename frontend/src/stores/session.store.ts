import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { rememberBeenHere } from '../lib/been-here.ts';
import { ApiError, client, onUnauthorized, type Account } from '../api.ts';
import { keyStore } from '../lib/device-keys.ts';
import { forgetEpochKeys } from '../lib/epoch-keys.ts';
import { disownKeys, keysOwner, ownKeys } from '../lib/key-owner.ts';
import { setHeldUp } from '../lib/held-up.ts';
import { runtime } from '../lib/runtime.ts';
import { forgetSigners } from '../lib/sealing.ts';
import { forgetArchive } from '../services/chat.source.ts';
import { forgetWallets } from '../lib/wallet.ts';
import { forgetSearchTerms } from '../lib/search-terms.ts';
import { useRealtime } from './realtime.store.ts';
import { useSettings } from './settings.store.ts';

export const ASK_AGAIN_MS = 1000;

export const ASK_AGAIN_MAX_MS = 8000;

export interface SessionApi
{
    account: Getter<Account | null>;
    signedIn: Getter<boolean>;

    ready(): Promise<void>;

    establish(account: Account): void;

    signOut(): Promise<void>;
    signOutEverywhere(): Promise<number>;

    /**
     * The session ended while this tab still showed it: signed out in another tab, everywhere from
     * another device, or run out. Told once the server has said nobody is signed in here, never on
     * a refusal alone, because a 401 is also a signature that did not match.
     */
    onEnded(listener: () => void): () => void;

    start(): () => void;
    reset(): void;
}

/**
 * What this tab showed and held for the person, dropped when their session ends. The keys stay.
 *
 * The plaintext is the thing a person can actually read without any key at all: sign-out is a
 * client-side navigation - no reload, same module, same Map - so leaving the messages this browser
 * had opened in memory would let the next person to sign in on this tab search them.
 */
const dropWhatWasShown = () =>
{
    forgetArchive();
    forgetSearchTerms();
    useSettings().update({ voiceLevels: {} });
    forgetSigners();

    // The providers themselves, which are live objects belonging to the person who was signed in.
    // Small and bounded - one per installed extension - but there is no reason for the next person
    // at this keyboard to inherit a handle to the last one's wallet.
    forgetWallets();
};

/**
 * The keyring, thrown away: the epoch keys and the archive key, and with `device` the browser's
 * own keypairs too. Each is best-effort and independent: a browser that refuses IndexedDB must
 * still be able to sign out, and one failure must not strand the rest.
 *
 * This used to happen on every sign-out, and it is why signing back in read nothing: the same
 * person came back as a new device, and every line sent before was locked to them. Now it happens
 * when it protects somebody:
 *
 * - **The session was ended from elsewhere** (`ended: 'revoked'`): signed out everywhere after a
 *   laptop went missing, this device revoked, or the staff signing the person out. This browser may
 *   be the one being cut off, so it keeps nothing, device and all.
 * - **Another account signs in here** (`claimKeys`): the last person's epoch keys go before the new
 *   one reads anything. Not the device keypair, which the sign-in that got here made for the new
 *   account when the old one's was not theirs (`wallet.store.ts`, the challenge that names it).
 *
 * A session that only ran out keeps them: nobody ended it, and the same person signs back in.
 */
const wipeKeys = async (device: boolean) =>
{
    disownKeys();
    await forgetEpochKeys().catch(() => undefined);

    if (device)
    {
        await keyStore().forget().catch(() => undefined);
    }
};

/** Writes down whose keys these are, wiping the last account's first when it was somebody else. */
const claimKeys = (accountId: string) =>
{
    const owner = keysOwner();

    ownKeys(accountId);

    if (owner !== null && owner !== accountId)
    {
        void wipeKeys(false).then(() => ownKeys(accountId));
    }
};

export const useSession = createStore((): SessionApi =>
{
    const [account, setAccount] = createSignal<Account | null>(null);

    let settled: Promise<void> | null = null;

    const refused = (error: unknown) => error instanceof ApiError && error.status < 500 && error.status !== 429;

    const load = async () =>
    {
        for (let wait = ASK_AGAIN_MS; ; wait = Math.min(wait * 2, ASK_AGAIN_MAX_MS))
        {
            try
            {
                const state = await client.auth.me();

                if (state.account != null)
                {
                    claimKeys(state.account.id);
                }
                else if (state.ended === 'revoked')
                {
                    await wipeKeys(true);
                }

                setAccount(state.account ?? null);
                rememberBeenHere(state.account != null);
                setHeldUp(false);

                return;
            }
            catch (error)
            {
                if (refused(error))
                {
                    setAccount(null);
                    setHeldUp(false);

                    return;
                }

                setHeldUp(wait > ASK_AGAIN_MS);
                await new Promise<void>((resolve) => runtime().clock.after(wait, resolve));
            }
        }
    };

    const ready = () =>
    {
        settled ??= load();
        return settled;
    };

    /**
     * Signed out HERE, before the network is asked and before the keyring is dropped, so anything
     * reading `signedIn()` while the rest finishes already sees the answer. The caller then LOADS
     * `/sign-in` rather than navigating to it: every store in this tab holds the last person's
     * drafts, board, notifications and names in module memory, and a page load is the one reset
     * that cannot forget one of them.
     */
    const forget = () =>
    {
        setAccount(null);
        rememberBeenHere(false);
        settled = Promise.resolve();
    };

    const endings = new Set<() => void>();
    let asking = false;

    const end = (ended: 'revoked' | undefined) =>
    {
        forget();
        dropWhatWasShown();

        if (ended === 'revoked')
        {
            void wipeKeys(true);
        }

        for (const listener of [...endings])
        {
            listener();
        }
    };

    const confirm = () =>
    {
        const held = untrack(account);

        if (held === null || asking)
        {
            return;
        }

        asking = true;

        void client.auth.me()
            .then((state) =>
            {
                if (untrack(account)?.id === held.id && state.account?.id !== held.id)
                {
                    end(state.ended);
                }
            })
            .catch(() => undefined)
            .finally(() =>
            {
                asking = false;
            });
    };

    return {
        account,
        signedIn: () => account() !== null,
        ready,

        establish(next)
        {
            claimKeys(next.id);
            setAccount(next);
            rememberBeenHere(true);
            settled = Promise.resolve();
        },

        async signOut()
        {
            forget();
            await client.auth.signOut().catch(() => undefined);
            dropWhatWasShown();
        },

        async signOutEverywhere()
        {
            forget();
            const result = await client.auth.signOutEverywhere().catch(() => ({ ended: 0 }));
            dropWhatWasShown();
            return result.ended;
        },

        onEnded(listener)
        {
            endings.add(listener);

            return () =>
            {
                endings.delete(listener);
            };
        },

        start()
        {
            const live = useRealtime();
            const stops = [
                onUnauthorized(confirm),
                live.onStatus((status) =>
                {
                    if (status === 'down' && untrack(live.stalled))
                    {
                        confirm();
                    }
                }),
                live.onNudge((scope, id) =>
                {
                    if (scope === 'me' && (id === undefined || id === 'profile'))
                    {
                        const asked = untrack(account)?.id;

                        void client.auth.me()
                            .then((state) =>
                            {
                                const current = untrack(account);
                                const next = state.account;

                                if (current === null || current.id !== asked)
                                {
                                    return;
                                }

                                if (next == null || next.id !== asked)
                                {
                                    end(state.ended);
                                    return;
                                }

                                if (JSON.stringify(next) !== JSON.stringify(current))
                                {
                                    setAccount(next);
                                }
                            })
                            .catch(() => undefined);
                    }
                })
            ];

            return () =>
            {
                for (const stop of stops)
                {
                    stop();
                }
            };
        },

        reset()
        {
            setAccount(null);
            setHeldUp(false);
            settled = null;
            endings.clear();
            asking = false;
        }
    };
});

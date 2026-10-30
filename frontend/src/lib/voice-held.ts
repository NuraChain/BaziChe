/**
 * Recordings this tab holds in the clear, by file id: what the reader has just recorded and sent, and
 * what they have just played. The player plays from here before it fetches anything, so a sender hears
 * their own message at once and nothing is fetched twice. Bounded, and emptied at sign-out with the
 * rest of the plaintext this tab holds (`forgetArchive`).
 */
export const HELD_MOST = 8;

const held = new Map<string, Uint8Array>();

const listeners = new Set<(id: string | null) => void>();

export function holdAudio(id: string, bytes: Uint8Array)
{
    held.delete(id);
    held.set(id, bytes);

    for (const oldest of held.keys())
    {
        if (held.size <= HELD_MOST)
        {
            break;
        }
        held.delete(oldest);
    }
}

export function heldAudio(id: string)
{
    const bytes = held.get(id);

    if (bytes !== undefined)
    {
        held.delete(id);
        held.set(id, bytes);
    }

    return bytes ?? null;
}

/** Lets go of one recording, or of every one, and tells whoever plays them. */
export function forgetAudio(id?: string)
{
    if (id === undefined)
    {
        held.clear();
    }
    else
    {
        held.delete(id);
    }

    for (const listener of listeners)
    {
        listener(id ?? null);
    }
}

/** Hears each recording let go, by its id, and null when every one goes at once. */
export function onForgotten(listener: (id: string | null) => void)
{
    listeners.add(listener);

    return () =>
    {
        listeners.delete(listener);
    };
}

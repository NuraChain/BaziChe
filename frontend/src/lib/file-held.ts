/**
 * Photos, videos and files this tab holds opened, by file id, as object URLs: what the reader has
 * just sent, and what they have downloaded. A bubble shows from here before it fetches anything, so a
 * sender sees their own photo at once and nothing is fetched twice. Bounded, and emptied at sign-out
 * with the rest of the plaintext this tab holds (`forgetArchive`), each URL revoked as it goes.
 */
export const FILES_HELD_MOST = 12;

interface Held
{
    url: string;
    type: string;
    bytes: number;
}

const held = new Map<string, Held>();

const listeners = new Set<(id: string | null) => void>();

const revoke = (one: Held) => URL.revokeObjectURL(one.url);

/**
 * Keeps a file opened under its id, as the type it may be shown as (one found from its bytes for a
 * photo or a video, `application/octet-stream` for anything else, so nothing is shown that was not
 * found to be a picture or a film).
 */
export function holdFile(id: string, bytes: Uint8Array, type: string)
{
    const before = held.get(id);

    if (before !== undefined)
    {
        revoke(before);
        held.delete(id);
    }

    held.set(id, { url: URL.createObjectURL(new Blob([bytes as BlobPart], { type })), type, bytes: bytes.byteLength });

    for (const [oldest, one] of held)
    {
        if (held.size <= FILES_HELD_MOST)
        {
            break;
        }

        revoke(one);
        held.delete(oldest);

        for (const listener of listeners)
        {
            listener(oldest);
        }
    }

    for (const listener of listeners)
    {
        listener(id);
    }
}

export function heldFile(id: string)
{
    const one = held.get(id);

    if (one !== undefined)
    {
        held.delete(id);
        held.set(id, one);
    }

    return one ?? null;
}

/** Lets go of one file, or of every one, revoking what it was shown from, and tells whoever shows them. */
export function forgetFile(id?: string)
{
    if (id === undefined)
    {
        for (const one of held.values())
        {
            revoke(one);
        }
        held.clear();
    }
    else
    {
        const one = held.get(id);

        if (one !== undefined)
        {
            revoke(one);
            held.delete(id);
        }
    }

    for (const listener of listeners)
    {
        listener(id ?? null);
    }
}

/** Hears each file kept or let go, by its id, and null when every one goes at once. */
export function onFileHeld(listener: (id: string | null) => void)
{
    listeners.add(listener);

    return () =>
    {
        listeners.delete(listener);
    };
}

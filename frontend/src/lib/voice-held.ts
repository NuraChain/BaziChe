/**
 * Recordings this tab holds in the clear, by file id: what the reader has just recorded and sent, and
 * what they have just played. The player plays from here before it fetches anything, so a sender hears
 * their own message at once and nothing is fetched twice. Bounded, and emptied at sign-out with the
 * rest of the plaintext this tab holds (`forgetArchive`).
 */
export const HELD_MOST = 8;

const held = new Map<string, Uint8Array>();

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
}

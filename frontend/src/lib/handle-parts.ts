/**
 * Kept apart from `staff-words.ts` because group pages use it too: importing it from there put the
 * staff vocabulary, and the backend rules files it reads, in chunks a player loads.
 */
const SLOT = /(\{[a-z]+\})/;

const slotOf = (part: string) => /^\{([a-z]+)\}$/.exec(part)?.[1] ?? null;

export function handleParts(said: string, handles: Readonly<Record<string, string>>)
{
    return said
        .split(SLOT)
        .filter((part) => part !== '')
        .map((part, at) =>
        {
            const slot = slotOf(part);
            const handle = slot !== null && Object.hasOwn(handles, slot) ? handles[slot] : undefined;

            return handle === undefined ? { at, text: part, handle: false } : { at, text: handle, handle: true };
        });
}

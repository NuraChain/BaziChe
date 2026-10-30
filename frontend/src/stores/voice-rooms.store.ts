import { createSignal, createStore } from 'azerothjs';

export interface VoiceRoomsApi
{
    /** Whether a room holds a recording, on its way, made or waiting to be sent: its composer is the recorder's. */
    has(room: string): boolean;
    set(room: string, on: boolean): void;
    reset(): void;
}

/**
 * Which rooms hold a recording, read by every composer. The recorder is a chunk of its own, fetched at
 * the first press on a microphone, so this is all a thread carries of it until then.
 */
export const useVoiceRooms = createStore((): VoiceRoomsApi =>
{
    const [rooms, setRooms] = createSignal<ReadonlySet<string>>(new Set());

    return {
        has: (room) => rooms().has(room),

        set(room, on)
        {
            setRooms((current) =>
            {
                if (current.has(room) === on)
                {
                    return current;
                }

                return on ? new Set([...current, room]) : new Set([...current].filter((one) => one !== room));
            });
        },

        reset: () => setRooms(new Set())
    };
});

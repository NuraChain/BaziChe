import { createSignal, createStore, untrack } from 'azerothjs';

import type { Message } from '../data/chat.ts';
import { openSent } from '../lib/chat-file.ts';
import { forgetFile, heldFile, holdFile, onFileHeld } from '../lib/file-held.ts';
import { ChatFileError, chatFiles } from '../services/chat-files.ts';

/**
 * Why a photo, a video or a file is not there to show or save: gone from the server, could not be
 * fetched, does not open under the key its sender signed, or is said to be a picture or a film and is
 * neither.
 */
export type FileFault = 'gone' | 'failed' | 'tampered' | 'unshowable' | 'refused';

export type FileState = { at: 'loading'; fraction: number } | { at: 'ready'; url: string; type: string } | { at: 'fault'; fault: FileFault };

export interface FileLoadsApi
{
    /** Where a message's file is: nothing (not asked for), coming, here, or why not. */
    stateOf(message: Message): FileState | null;

    /** Fetches a message's file, opens it under its key and holds it; a second press while it comes stops it. */
    toggle(message: Message): void;

    /** Fetches every one of several files that is neither here nor on its way, one after another, until the reader stops one. */
    all(messages: readonly Message[]): Promise<void>;

    /** Fetches a message's file unless it is here, on its way or refused; answers whether it began a fetch. */
    ensure(message: Message): boolean;

    /** Lets go of a message's file: stopped if it is on its way, forgotten if it is here. */
    forget(message: Message): void;

    reset(): void;
}

const without = <T>(record: Readonly<Record<string, T>>, key: string) =>
    (key in record ? Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)) : record);

/**
 * Every file a thread has asked for, by its id: nothing is fetched before a press, so a reader is told
 * a file's size before choosing to spend it. One fetched comes with its progress, is opened under the
 * key sealed in its message, and is held as the type its own bytes say (`file-held.ts`): a photo or a
 * video that its bytes do not show to be one is refused rather than shown as what it claims.
 */
export const useFileLoads = createStore((): FileLoadsApi =>
{
    const [loads, setLoads] = createSignal<Readonly<Record<string, { fraction: number } | FileFault>>>({});

    /** Bumped when a held file is kept or let go, so a bubble showing it hears the change. */
    const [held, setHeld] = createSignal(0);

    const stops = new Map<string, AbortController>();

    // Every file let go at once is a sign-out: whatever is still coming is stopped, so nothing opened
    // lands in a tab that has signed out.
    onFileHeld((id) =>
    {
        if (id === null)
        {
            for (const stop of stops.values())
            {
                stop.abort();
            }

            stops.clear();
            setLoads({});
        }

        setHeld((count) => count + 1);
    });

    const fetchOne = async (message: Message) =>
    {
        const file = message.file;

        if (file === undefined)
        {
            return;
        }

        const stop = new AbortController();

        stops.set(file.id, stop);
        setLoads((current) => ({ ...current, [file.id]: { fraction: 0 } }));

        try
        {
            const body = await chatFiles().download(file.id, (fraction) =>
            {
                if (!stop.signal.aborted)
                {
                    setLoads((current) => ({ ...current, [file.id]: { fraction } }));
                }
            }, stop.signal);

            const opened = await openSent(body, file);

            if (typeof opened === 'string')
            {
                setLoads((current) => ({ ...current, [file.id]: opened }));
                return;
            }

            holdFile(file.id, opened.plain, opened.type);
            setLoads((current) => without(current, file.id));
        }
        catch (error)
        {
            if (error instanceof ChatFileError && error.failure === 'cancelled')
            {
                setLoads((current) => without(current, file.id));
                return;
            }

            setLoads((current) => ({ ...current, [file.id]: error instanceof ChatFileError && error.failure === 'file-missing' ? 'gone' : 'failed' }));
        }
        finally
        {
            if (stops.get(file.id) === stop)
            {
                stops.delete(file.id);
            }
        }
    };

    return {
        stateOf(message)
        {
            const id = message.file?.id;

            if (id === undefined)
            {
                return null;
            }

            held();

            const one = untrack(() => heldFile(id));

            if (one !== null)
            {
                return { at: 'ready', url: one.url, type: one.type };
            }

            const load = loads()[id];

            if (load === undefined)
            {
                return null;
            }

            return typeof load === 'string' ? { at: 'fault', fault: load } : { at: 'loading', fraction: load.fraction };
        },

        toggle(message)
        {
            const id = message.file?.id;

            if (id === undefined || heldFile(id) !== null)
            {
                return;
            }

            const going = stops.get(id);

            if (going !== undefined)
            {
                going.abort();
                return;
            }

            void fetchOne(message);
        },

        async all(messages)
        {
            for (const message of messages)
            {
                const id = message.file?.id;

                if (id === undefined || heldFile(id) !== null || stops.has(id))
                {
                    continue;
                }

                await fetchOne(message);

                // Neither here nor refused: the reader stopped it, or signed out, and wants none of the rest.
                if (heldFile(id) === null && untrack(loads)[id] === undefined)
                {
                    return;
                }
            }
        },

        ensure(message)
        {
            const id = message.file?.id;

            if (id === undefined || heldFile(id) !== null || stops.has(id) || untrack(loads)[id] !== undefined)
            {
                return false;
            }

            void fetchOne(message);
            return true;
        },

        forget(message)
        {
            const id = message.file?.id;

            if (id === undefined)
            {
                return;
            }

            stops.get(id)?.abort();

            if (heldFile(id) !== null)
            {
                forgetFile(id);
            }
        },

        reset()
        {
            for (const stop of stops.values())
            {
                stop.abort();
            }

            stops.clear();
            setLoads({});
        }
    };
});

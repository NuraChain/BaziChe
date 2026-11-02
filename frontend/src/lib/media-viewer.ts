import { createSignal } from 'azerothjs';

import type { Message } from '../data/chat.ts';
import { useChat } from '../stores/chat.store.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

/** What the viewer walks: a list, and the way to the older ones past its first where there are any. */
export interface Walk
{
    list: () => readonly Message[];
    older?: () => Promise<boolean>;
}

/**
 * A thread's own walk: the lines it has read, and past them the room's photos and videos as the
 * gallery lists them, read a page at a time when the reader steps back past the oldest, every page
 * the thread holds already passed over for the next.
 */
export function threadWalk(conversationId: string): Walk
{
    const chat = useChat();
    const [ read, setRead ] = createSignal<readonly Message[]>([]);
    let cursor: string | undefined;
    let begun = false;

    const list = () =>
    {
        const held = chat.messages();
        const ids = new Set(held.map((one) => one.id));

        return [ ...held, ...read().filter((one) => !ids.has(one.id)) ];
    };

    return {
        list,
        async older()
        {
            const before = new Set(list().map((one) => one.id));

            do
            {
                const page = await chat.media(conversationId, 'media', begun ? cursor : undefined);

                begun = true;
                cursor = page.cursor;
                setRead((now) => [ ...now, ...page.messages ]);
            }
            while (cursor !== undefined && list().every((one) => before.has(one.id)));

            return cursor !== undefined;
        }
    };
}

/**
 * Opens a photo or a video over the conversation, the viewer fetched at the press, walking the
 * thread it was pressed in and past it the room's older ones, or the walk it was pressed in (the
 * gallery's); a video carried on from its bubble begins where it was. Settles once the viewer is
 * closed.
 */
export async function openViewer(start: Message, carried?: { from: number; playing: boolean }, walk?: Walk)
{
    try
    {
        const module = await import('../components/chat/media-viewer.component.azeroth');
        const { list, older } = walk ?? threadWalk(start.conversationId);

        await useOverlay().open(
            module.default,
            { start, list, ...(older === undefined ? {} : { older }), ...carried },
            { label: useLocale().t('chat.viewer.label'), kind: 'full', id: 'media-viewer' }
        ).closed;
    }
    catch (error)
    {
        useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'media-viewer' });
    }
}

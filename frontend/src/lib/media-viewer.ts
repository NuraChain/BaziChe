import type { Message } from '../data/chat.ts';
import { useChat } from '../stores/chat.store.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

/**
 * Opens a photo or a video over the conversation, the viewer fetched at the press, walking the
 * thread it was pressed in, or the list it was pressed in (the gallery's); a video carried on from
 * its bubble begins where it was. Settles once the viewer is closed.
 */
export async function openViewer(start: Message, carried?: { from: number; playing: boolean }, list?: () => readonly Message[])
{
    try
    {
        const module = await import('../components/chat/media-viewer.component.azeroth');
        const chat = useChat();

        await useOverlay().open(
            module.default,
            { start, list: list ?? (() => chat.messages()), ...carried },
            { label: useLocale().t('chat.viewer.label'), kind: 'full', id: 'media-viewer' }
        ).closed;
    }
    catch (error)
    {
        useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'media-viewer' });
    }
}

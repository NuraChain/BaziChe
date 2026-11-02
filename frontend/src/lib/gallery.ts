import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

const SHEET = 'chat-gallery';

/** Opens a conversation's photos and videos, files and voice messages, the gallery fetched at the press. */
export function openGallery(conversationId: string)
{
    void import('../components/chat/gallery.component.azeroth')
        .then((module) => useOverlay().open(module.default, { conversationId }, { label: useLocale().t('chat.gallery.title'), id: SHEET }))
        .catch((error: unknown) => useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: SHEET }));
}

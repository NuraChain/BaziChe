import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

const SHEET = 'call-view';

/**
 * Opens the view of the live call: who is in it and how their line is doing, the microphone and the
 * speaker. A chunk of its own, fetched at the press, because it carries the voice settings' panels.
 */
export function openCallView()
{
    void import('../components/call/call-view.component.azeroth')
        .then((module) => useOverlay().open(module.default, {}, { label: useLocale().t('call.view.label'), id: SHEET }))
        .catch((error: unknown) => useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: SHEET }));
}

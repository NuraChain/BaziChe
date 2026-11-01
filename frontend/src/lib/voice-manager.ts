import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

const SHEET = 'voice-manager';

export function manageVoice(table: string)
{
    void import('../components/voice/voice-manager.component.azeroth')
        .then((module) => useOverlay().open(module.default, { table }, { label: useLocale().t('voice.manager.open'), id: SHEET }))
        .catch((error: unknown) => useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: SHEET }));
}

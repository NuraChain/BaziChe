import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

export function inviteTo(tableId: string)
{
    void import('../components/games/invite-sheet.component.azeroth')
        .then((module) => useOverlay().open(module.default, { tableId }, { label: useLocale().t('play.lobby.invite') }))
        .catch((error: unknown) => useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'invite-sheet' }));
}

import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

export function addFriend()
{
    void import('../components/social/add-friend.component.azeroth')
        .then((module) => useOverlay().open(module.default, {}, { label: useLocale().t('friends.add.title'), id: 'add-friend' }))
        .catch((error: unknown) => useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'add-friend' }));
}

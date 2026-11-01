import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

/** Opens the form that makes a group, fetched at the press, and goes to the group it made. */
export function openGroupForm(go: (path: string) => void)
{
    void import('../components/social/group-form.component.azeroth')
        .then((module) => useOverlay().open(module.default, {}, { label: useLocale().t('groups.createTitle'), id: 'group-form' }).closed)
        .then((made) =>
        {
            if (made !== undefined && made !== null)
            {
                go(`/app/groups/${ (made as { slug: string }).slug }`);
            }
        })
        .catch((error: unknown) => useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'group-form' }));
}

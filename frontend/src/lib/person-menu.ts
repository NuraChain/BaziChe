import type { MatchPlayer } from '../data/match.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

const SHEET = 'person-menu';

/** Opens the sheet about a person; from their plate at a table it is handed what they wear there. */
export function aboutPerson(personId: string, look?: MatchPlayer['look'])
{
    void import('../components/social/person-actions.component.azeroth')
        .then((module) => useOverlay().open(module.default, { personId, ...(look === undefined ? {} : { look }) }, { label: useLocale().t('actions.title'), id: SHEET }))
        .catch(() => useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: SHEET }));
}

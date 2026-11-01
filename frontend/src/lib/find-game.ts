import type { GameId } from '../data/games.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

export function findGame(game: GameId)
{
    void import('../components/games/quick-finder.component.azeroth')
        .then((module) => useOverlay().open(module.default, { game }, { label: useLocale().t('quickMatch.title'), id: 'quick-finder' }))
        .catch((error: unknown) => useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'quick-finder' }));
}

import type { GameId } from '../data/games.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

/**
 * Opens a game's full rules. The sheet and its words are fetched on the first open, so neither the
 * game's page nor its table carries every game's rule book before anybody asks for one.
 */
export async function openRules(game: GameId)
{
    try
    {
        const module = await import('../components/games/rules-sheet.component.azeroth');

        await useOverlay().open(module.default, { game }, { label: useLocale().t('rules.title'), id: 'rules-sheet' }).closed;
    }
    catch (error)
    {
        useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'rules-sheet' });
    }
}

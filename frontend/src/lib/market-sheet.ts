import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

/** Opens the market on a game the reader watches, and settles once it is closed. */
export async function openMarket(match: string)
{
    try
    {
        const module = await import('../components/market/market-sheet.component.azeroth');

        await useOverlay().open(module.default, { match }, { label: useLocale().t('market.title'), id: 'market-sheet' }).closed;
    }
    catch (error)
    {
        useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'market-sheet' });
    }
}

import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

/** Opens the sheet that sends NURA to a player of the game the reader watches, and settles once it is closed. */
export async function giveTo(match: string, to: string, name: string)
{
    try
    {
        const module = await import('../components/donate/donate-sheet.component.azeroth');

        await useOverlay().open(module.default, { match, to }, { label: useLocale().t('donate.action', { name }), id: 'donate-sheet' }).closed;
    }
    catch (error)
    {
        useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error)), dedupe: 'donate-sheet' });
    }
}

import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { itemName } from './shop.ts';

/** Opens the sheet about a look or a bundle, and settles once it is closed. */
export async function openLook(item: string)
{
    try
    {
        const module = await import('../components/shop/look-sheet.component.azeroth');

        await useOverlay().open(module.default, { item }, { label: itemName(item, useLocale()), id: 'look-sheet' }).closed;
    }
    catch
    {
        useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: 'look-sheet' });
    }
}

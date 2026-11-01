import type { MessageKey } from '../locales/en.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useToasts, type ToastKind } from '../stores/toasts.store.ts';
import { whyFailed } from './failure.ts';

export interface Done
{
    text: string;
    kind?: ToastKind;
}

export async function attempt(work: Promise<unknown>, done?: Done | string, why?: (error: unknown) => MessageKey)
{
    try
    {
        await work;

        if (done !== undefined)
        {
            const said = typeof done === 'string' ? { text: done } : done;
            useToasts().show({ kind: said.kind ?? 'success', text: said.text });
        }

        return true;
    }
    catch (error)
    {
        console.error('[attempt]', error);
        useToasts().show({ kind: 'warning', text: useLocale().t(whyFailed(error, why?.(error))), dedupe: 'attempt' });
        return false;
    }
}

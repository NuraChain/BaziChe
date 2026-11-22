import type { LocaleApi } from '../stores/locale.store.ts';

/** Compact player lists have room for the name and the same AI label shown on the seat. */
export function playerName(name: string, ai: boolean | undefined, locale: LocaleApi): string
{
    return ai ? locale.t('play.ai.name', { name, ai: locale.t('play.ai.badge') }) : name;
}

import type { LocaleApi } from '../stores/locale.store.ts';
import { runtime } from './runtime.ts';

/** By its time alone when it ends today, and with its date on any other day: "until 14:45" for tomorrow reads as today. */
const untilOf = (locale: LocaleApi, at: number) =>
    locale.date(at, new Date(at).toDateString() === new Date(runtime().clock.now()).toDateString() ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' });

/** A mute on the reader, in their words: until a time today, a date and a time further off, or until somebody lifts it. */
export const mutedWordsOf = (locale: LocaleApi, muted: { until?: string }) =>
    muted.until === undefined
        ? locale.t('groups.youMutedForGood')
        : locale.t('groups.youMuted', { time: untilOf(locale, Date.parse(muted.until)) });

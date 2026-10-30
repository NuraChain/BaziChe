import type { Message } from '../../data/chat.ts';
import { plainOf } from '../../lib/markdown.ts';
import type { LocaleApi } from '../../stores/locale.store.ts';

/** A length or a place as a clock, minutes and then two digits of seconds, in the reader's own digits. */
export function voiceClock(seconds: number, n: LocaleApi['n'])
{
    const whole = Math.max(0, Math.floor(seconds));

    return `${ n(Math.floor(whole / 60), { useGrouping: false }) }:${ n(whole % 60, { minimumIntegerDigits: 2, useGrouping: false }) }`;
}

/** How long a voice message is, as its clock says it whole. */
export const voiceLength = (message: Message, n: LocaleApi['n']) => voiceClock(Math.round((message.voice?.ms ?? 0) / 1000), n);

/** A line as a sentence quotes it: its words, a spoiler hidden, or that it is a voice message and, once opened, how long. */
export function gistOf(message: Message, locale: Pick<LocaleApi, 't' | 'n' | 'text'>)
{
    if (message.kind === 'voice')
    {
        return message.voice === undefined ? locale.t('chat.voiceGistLocked') : locale.t('chat.voiceGist', { time: voiceLength(message, locale.n) });
    }

    return plainOf(locale.text(message.text), locale.t('chat.spoilerPreview'));
}

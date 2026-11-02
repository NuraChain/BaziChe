import type { AlbumMark } from '../../../../backend/src/domains/chat/files.ts';
import type { Message } from '../../data/chat.ts';
import { plainOf } from '../../lib/markdown.ts';
import type { LocaleApi } from '../../stores/locale.store.ts';

/** A length or a place as a clock, minutes and then two digits of seconds, in the reader's own digits. */
export function voiceClock(seconds: number, n: LocaleApi['n'])
{
    const whole = Math.max(0, Math.floor(seconds));

    return `${ n(Math.floor(whole / 60), { useGrouping: false }) }:${ n(whole % 60, { minimumIntegerDigits: 2, useGrouping: false }) }`;
}

/**
 * How large a file is, as its bubble says it before it is fetched: bytes, then KB, then MB to one
 * place, in the reader's own digits. Binary units, as every platform's file sizes are counted.
 */
export function sizeSaid(bytes: number, locale: Pick<LocaleApi, 't' | 'n'>)
{
    if (bytes < 1024)
    {
        return locale.t('chat.file.size.b', { n: locale.n(bytes) });
    }

    if (bytes < 1024 * 1024)
    {
        const kb = bytes / 1024;

        return locale.t('chat.file.size.kb', { n: locale.n(kb, { maximumFractionDigits: kb < 10 ? 1 : 0 }) });
    }

    return locale.t('chat.file.size.mb', { n: locale.n(bytes / (1024 * 1024), { maximumFractionDigits: 1 }) });
}

/** What an album holds, counted: "4 photos", "3 videos", "5 photos and videos". */
export const albumSaid = (album: AlbumMark, t: LocaleApi['t']) => t(`chat.albumGist.${ album.holds }`, { count: album.of });

/** How long a voice message is, as its clock says it whole. */
export const voiceLength = (message: Message, n: LocaleApi['n']) => voiceClock(Math.round((message.voice?.ms ?? 0) / 1000), n);

/**
 * A line as a sentence quotes it: its words, a spoiler hidden, that it is a voice message and, once
 * opened, how long, or a photo, a video or a file by its caption, or by what it is when it has none:
 * an album's item by what the album holds ("4 photos").
 */
export function gistOf(message: Message, locale: Pick<LocaleApi, 't' | 'n' | 'text'>)
{
    if (message.kind === 'voice')
    {
        return message.voice === undefined ? locale.t('chat.voiceGistLocked') : locale.t('chat.voiceGist', { time: voiceLength(message, locale.n) });
    }

    if (message.kind === 'file')
    {
        const file = message.file;

        if (file === undefined)
        {
            return locale.t('chat.fileGistLocked');
        }

        if (message.text.trim() !== '')
        {
            return plainOf(locale.text(message.text), locale.t('chat.spoilerPreview'));
        }

        if (message.album !== undefined)
        {
            return albumSaid(message.album, locale.t);
        }

        return file.as === 'file' ? locale.t('chat.fileGist.file', { name: file.name }) : locale.t(file.as === 'photo' ? 'chat.fileGist.photo' : 'chat.fileGist.video');
    }

    return plainOf(locale.text(message.text), locale.t('chat.spoilerPreview'));
}

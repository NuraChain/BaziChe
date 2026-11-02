import type { ChannelPost } from '../../api.ts';
import { plainOf } from '../../lib/markdown.ts';
import type { LocaleApi } from '../../stores/locale.store.ts';

/** A post as one line says it: its words, its caption, what its file is, or a poll's question. */
export function postGist(post: ChannelPost, locale: Pick<LocaleApi, 't' | 'text'>)
{
    if (post.kind === 'poll')
    {
        return locale.t('channels.pollGist', { question: post.poll?.question ?? '' });
    }

    if (post.text.trim() !== '')
    {
        return plainOf(locale.text(post.text), locale.t('chat.spoilerPreview'));
    }

    const file = post.file;

    if (file === undefined)
    {
        return '';
    }

    return file.as === 'file' ? locale.t('chat.fileGist.file', { name: file.name }) : locale.t(file.as === 'photo' ? 'chat.fileGist.photo' : 'chat.fileGist.video');
}

import type { MessageKey } from '../../locales/en.ts';
import type { FileFault } from '../../stores/file-loads.store.ts';

export const FILE_FAULTS: Record<FileFault, MessageKey> = {
    gone: 'chat.file.gone',
    failed: 'chat.file.failed',
    tampered: 'chat.file.tampered',
    unshowable: 'chat.file.unshowable',
    refused: 'chat.file.refused'
};

/** A thumb as the picture its bytes are: base64url in the document, base64 in an address. */
export const thumbOf = (thumb: string | undefined) =>
{
    if (thumb === undefined)
    {
        return null;
    }

    const plain = thumb.replaceAll('-', '+').replaceAll('_', '/');

    return `data:image/jpeg;base64,${ plain }${ '='.repeat((4 - (plain.length % 4)) % 4) }`;
};

/** A name cut in its middle, so a long one still shows how it ends: `holiday-photos-…-final.pdf`. */
export const middleOf = (name: string, most = 32) =>
{
    if (name.length <= most)
    {
        return name;
    }

    const tail = Math.min(12, Math.floor(most / 2));

    return `${ name.slice(0, most - tail - 1) }…${ name.slice(-tail) }`;
};

/** What the type or the name says the file is, in a few capitals: PDF, ZIP, MP3. */
export const extensionOf = (name: string, mime: string) =>
{
    const dot = name.lastIndexOf('.');
    const said = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : (mime.split('/')[1] ?? '');

    return said.slice(0, 6).toUpperCase();
};

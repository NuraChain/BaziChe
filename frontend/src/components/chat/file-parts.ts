import type { MessageKey } from '../../locales/en.ts';
import type { FileFault } from '../../stores/file-loads.store.ts';

export const FILE_FAULTS: Record<FileFault, MessageKey> = {
    gone: 'chat.file.gone',
    failed: 'chat.file.failed',
    tampered: 'chat.file.tampered',
    unshowable: 'chat.file.unshowable'
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

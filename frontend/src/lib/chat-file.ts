import { fileAad } from '../../../backend/src/domains/chat/envelope.ts';
import { fromBase64Url, toBase64Url } from './device-id.ts';

/**
 * A photo, a video or a file, sealed under a key made for it alone and bound to its own id, so it is
 * ciphertext wherever it is kept and a file put in another's place does not open. The key travels
 * only inside the sealed document of the message that names it.
 */
export interface SealedFile
{
    key: string;
    iv: string;
    body: Uint8Array;
}

const utf8 = new TextEncoder();

export async function sealFile(plain: Uint8Array, fileId: string): Promise<SealedFile>
{
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    try
    {
        const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt']);
        const body = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv as BufferSource, additionalData: utf8.encode(fileAad(fileId)) as BufferSource },
            key,
            plain as BufferSource
        ));

        return { key: toBase64Url(raw), iv: toBase64Url(iv), body };
    }
    finally
    {
        raw.fill(0);
    }
}

/** The file, or null for one that does not open under its key: another file, or one changed. */
export async function openFile(body: Uint8Array, key: string, iv: string, fileId: string): Promise<Uint8Array | null>
{
    const raw = fromBase64Url(key);

    try
    {
        const imported = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt']);

        return new Uint8Array(await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64Url(iv) as BufferSource, additionalData: utf8.encode(fileAad(fileId)) as BufferSource },
            imported,
            body as BufferSource
        ));
    }
    catch
    {
        return null;
    }
    finally
    {
        raw.fill(0);
    }
}

/**
 * What a photo or a video may be shown as, from its first bytes rather than from the type its sender
 * named: the type a reader's page hands to `<img>` or `<video>` is one it found, never one it was told.
 * Anything else is a file, saved and never shown.
 */
export type ShownType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm' | 'video/quicktime';

export function sniffShown(bytes: Uint8Array): ShownType | null
{
    const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);

    if (at(0, 0xff, 0xd8, 0xff))
    {
        return 'image/jpeg';
    }

    if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    {
        return 'image/png';
    }

    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    {
        return 'image/webp';
    }

    if (at(0, 0x1a, 0x45, 0xdf, 0xa3))
    {
        return 'video/webm';
    }

    // An ISO media file: a box size, then `ftyp`, then its brand.
    if (at(4, 0x66, 0x74, 0x79, 0x70))
    {
        return at(8, 0x71, 0x74, 0x20, 0x20) ? 'video/quicktime' : 'video/mp4';
    }

    return null;
}

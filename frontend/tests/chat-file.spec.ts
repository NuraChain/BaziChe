import { describe, expect, it } from 'vitest';

import { FILE_CAPTION_MOST, FILE_MOST, FILE_NAME_MOST, FILE_PHOTO_MOST, FILE_THUMB_MOST } from '../../backend/src/domains/chat/files.ts';
import { decodeDisclosed, decodeFile, encodeFile, type FileBody } from '../src/lib/body.ts';
import { openFile, sealFile, sniffShown } from '../src/lib/chat-file.ts';

/**
 * A photo, a video or a file's sealed document, exactly, and the file itself sealed under a key of its
 * own: what a reader acts on, and every way a document or a file that is not what it says is refused.
 */

const ID = '0f8b5d2c-7a41-4c3e-9b6d-2e1f0a9c8b7d';

const body = (over: Partial<FileBody['file']> = {}, rest: Omit<FileBody, 'file'> = {}): FileBody => ({
    file: {
        id: ID,
        key: 'k'.repeat(43),
        iv: 'i'.repeat(16),
        as: 'photo',
        mime: 'image/jpeg',
        name: 'beach.jpg',
        bytes: 2_400_000,
        w: 1600,
        h: 1200,
        thumb: 'AbC_-9',
        ...over
    },
    ...rest
});

/** A document with one field of the file set to what no sender of ours writes. */
const withFile = (field: string, value: unknown) =>
{
    const raw = JSON.parse(encodeFile(body())) as { file: Record<string, unknown> };

    raw.file[field] = value;
    return JSON.stringify(raw);
};

describe('a file message’s document', () =>
{
    it('reads back what was written: the file, its caption, the line it answers and that it was forwarded', () =>
    {
        const written = body({}, { caption: 'At the beach 🌊', reply: 'line-1', fwd: true });

        expect(decodeFile(encodeFile(written))).toEqual(written);
        expect(decodeFile(encodeFile(body({ as: 'video', mime: 'video/mp4', ms: 42_000 })))?.file.ms).toBe(42_000);
        expect(decodeFile(encodeFile(body({ as: 'file', mime: 'application/pdf', name: 'report.pdf', w: undefined, h: undefined, thumb: undefined })))?.file)
            .toEqual({ id: ID, key: 'k'.repeat(43), iv: 'i'.repeat(16), as: 'file', mime: 'application/pdf', name: 'report.pdf', bytes: 2_400_000 });
    });

    it('writes no caption for empty words', () =>
    {
        expect(JSON.parse(encodeFile(body({}, { caption: '' })))).not.toHaveProperty('caption');
    });

    it('refuses a document that is not exactly a file’s', () =>
    {
        expect(decodeFile('not json'), 'not a document').toBeNull();
        expect(decodeFile(JSON.stringify({ text: 'hi' })), 'a line').toBeNull();
        expect(decodeFile(withFile('extra', 1)), 'a field no sender writes').toBeNull();
        expect(decodeFile(withFile('id', 'not-an-id')), 'no file id').toBeNull();
        expect(decodeFile(withFile('key', 'short')), 'no key').toBeNull();
        expect(decodeFile(withFile('iv', 'short')), 'no iv').toBeNull();
        expect(decodeFile(withFile('as', 'album')), 'sent as nothing we draw').toBeNull();
        expect(decodeFile(withFile('mime', 'text/html; charset=utf-8')), 'a type with parameters').toBeNull();
        expect(decodeFile(withFile('bytes', 0)), 'no size').toBeNull();
        expect(decodeFile(withFile('bytes', FILE_MOST + 1)), 'larger than may be sent').toBeNull();
        expect(decodeFile(withFile('bytes', 1.5)), 'a size that is not whole').toBeNull();
        expect(decodeFile(withFile('bytes', FILE_PHOTO_MOST + 1)), 'a photo larger than a photo may be').toBeNull();
        expect(decodeFile(encodeFile(body({ as: 'video', mime: 'video/mp4', bytes: FILE_PHOTO_MOST + 1 })))?.file.bytes, 'which a video may be').toBe(FILE_PHOTO_MOST + 1);
        expect(decodeFile(withFile('w', undefined)), 'a width without its height').toBeNull();
        expect(decodeFile(withFile('ms', 1000)), 'a photo with a length').toBeNull();
        expect(decodeFile(withFile('thumb', 'x'.repeat(FILE_THUMB_MOST + 1))), 'a thumb too large').toBeNull();
        expect(decodeFile(withFile('thumb', 'not base64url!')), 'a thumb that is not one').toBeNull();
        expect(decodeFile(encodeFile(body({ as: 'file', w: undefined, h: undefined }))), 'a file with a thumb').toBeNull();
        expect(decodeFile(JSON.stringify({ ...JSON.parse(encodeFile(body())), caption: 'x'.repeat(FILE_CAPTION_MOST + 1) })), 'a caption too long').toBeNull();
        expect(decodeFile(JSON.stringify({ ...JSON.parse(encodeFile(body())), caption: 7 })), 'a caption that is no words').toBeNull();
    });

    it('refuses a name a save dialog or a screen should never be handed', () =>
    {
        expect(decodeFile(withFile('name', '')), 'no name').toBeNull();
        expect(decodeFile(withFile('name', 'x'.repeat(FILE_NAME_MOST + 1))), 'too long').toBeNull();
        expect(decodeFile(withFile('name', '../../etc/passwd')), 'a path').toBeNull();
        expect(decodeFile(withFile('name', 'C:\\Windows\\x.exe')), 'a Windows path').toBeNull();
        expect(decodeFile(withFile('name', 'invoice\u202Efdp.exe')), 'a name that turns its own direction round').toBeNull();
        expect(decodeFile(withFile('name', 'line\nbreak.txt')), 'a control character').toBeNull();
        expect(decodeFile(withFile('name', 'گزارش ۱۴۰۵.pdf'))?.file.name, 'a Persian name is a name').toBe('گزارش ۱۴۰۵.pdf');
    });

    it('is disclosed to a report as its caption, or its name when it has none', () =>
    {
        expect(decodeDisclosed(encodeFile(body({}, { caption: 'Look' })))).toEqual({ text: 'Look' });
        expect(decodeDisclosed(encodeFile(body()))).toEqual({ text: 'beach.jpg' });
    });
});

describe('a file sealed under a key of its own', () =>
{
    it('opens under its key and its id, and under nothing else', async () =>
    {
        const plain = new Uint8Array(Array.from({ length: 5000 }, (_, at) => at % 256));
        const sealed = await sealFile(plain, ID);
        const other = await sealFile(plain, ID);

        expect(sealed.body).toHaveLength(plain.length + 16);
        expect(sealed.key, 'a fresh key each time').not.toBe(other.key);
        expect(await openFile(sealed.body, sealed.key, sealed.iv, ID)).toEqual(plain);
        expect(await openFile(sealed.body, other.key, sealed.iv, ID), 'another key').toBeNull();
        expect(await openFile(sealed.body, sealed.key, sealed.iv, crypto.randomUUID()), 'put in another file’s place').toBeNull();

        const changed = sealed.body.slice();

        changed[10] ^= 1;
        expect(await openFile(changed, sealed.key, sealed.iv, ID), 'one bit changed').toBeNull();
    });
});

describe('what a file may be shown as', () =>
{
    const bytes = (...values: number[]) => new Uint8Array([...values, ...Array.from({ length: 16 }, () => 0)]);

    it('is found from its first bytes, and anything else is a file', () =>
    {
        expect(sniffShown(bytes(0xff, 0xd8, 0xff, 0xe1))).toBe('image/jpeg');
        expect(sniffShown(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
        expect(sniffShown(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
        expect(sniffShown(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video/webm');
        expect(sniffShown(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe('video/mp4');
        expect(sniffShown(bytes(0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20))).toBe('video/quicktime');
        expect(sniffShown(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'an SVG is never shown').toBeNull();
        expect(sniffShown(new TextEncoder().encode('<html><script>')), 'nor a page').toBeNull();
        expect(sniffShown(bytes(0x47, 0x49, 0x46, 0x38)), 'nor a GIF').toBeNull();
    });
});

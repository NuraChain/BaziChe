import {
    FILE_MOST,
    FILE_NAME_MOST,
    FILE_PHOTO_MOST,
    FILE_PHOTO_SIDE,
    FILE_THUMB_MOST
} from '../../../backend/src/domains/chat/files.ts';
import type { FileDraft } from '../data/chat.ts';
import { toBase64Url } from './device-id.ts';
import { bareGif } from './gif.ts';
import { redraw, type Drawing } from './redraw.ts';

/** The longest side of a thumb, in pixels: a few hundred bytes of JPEG, drawn blurred. */
const THUMB_SIDE = 40;

/** How long a video is given to say what it is before it is sent as a file instead. */
const VIDEO_WAIT_MS = 8000;

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/**
 * A name as a file may keep it: its last part only, no control or direction-changing character, at
 * most the length a document takes, and the extension kept when it has to be cut. A reader's
 * document refuses anything else (`decodeFile`), so a sender never writes one.
 */
export function nameOf(raw: string)
{
    const last = raw.split(/[/\\]/).pop() ?? '';
    // eslint-disable-next-line no-control-regex
    const clean = last.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim();

    if (clean === '' || clean === '.' || clean === '..')
    {
        return 'file';
    }

    if (clean.length <= FILE_NAME_MOST)
    {
        return clean;
    }

    const dot = clean.lastIndexOf('.');
    const extension = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';

    return `${ clean.slice(0, FILE_NAME_MOST - extension.length) }${ extension }`;
}

/** A type as a document takes it, or the one that says nothing. */
export const typeOf = (raw: string) => (MIME.test(raw) ? raw.toLowerCase() : 'application/octet-stream');

/** The most a draft may be as it is sent: a photo 10 MiB, a video or a file 50 MiB. */
export const mostOf = (draft: Pick<FileDraft, 'as'>) => (draft.as === 'photo' ? FILE_PHOTO_MOST : FILE_MOST);

/** Whether a draft is over what may be sent as it is. */
export const tooLarge = (draft: Pick<FileDraft, 'as' | 'plain'>) => draft.plain.byteLength > mostOf(draft);

/** What a picture may be re-drawn from: everything a browser decodes, except a GIF (which would stop moving) and an SVG. */
const drawable = (type: string) => type.startsWith('image/') && type !== 'image/gif' && type !== 'image/svg+xml';

const canvasOf = (width: number, height: number) =>
{
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;
    return canvas;
};

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** Scaled to fit `side` on its longest side, never up. */
const fit = (width: number, height: number, side: number) =>
{
    const scale = Math.min(1, side / Math.max(width, height));

    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/** A thumb at most `THUMB_SIDE` on its longest side, encoded as a document keeps it. */
const thumbSized = (width: number, height: number, ground?: string): Drawing => ({ ...fit(width, height, THUMB_SIDE), type: 'image/jpeg', quality: 0.6, ground });

/** A thumb as base64url JPEG, or nothing when it would be larger than a document takes. */
const thumbOf = async (blob: Blob | null) =>
{
    const text = blob === null ? '' : toBase64Url(await bytesOf(blob));

    return text === '' || text.length > FILE_THUMB_MOST ? undefined : text;
};

/** Whether any pixel of a small copy of the picture is not fully opaque. */
const seeThrough = (bitmap: ImageBitmap) =>
{
    const size = fit(bitmap.width, bitmap.height, 64);
    const canvas = canvasOf(size.width, size.height);
    const context = canvas.getContext('2d');

    if (context === null)
    {
        return false;
    }

    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const pixels = context.getImageData(0, 0, size.width, size.height).data;

    for (let at = 3; at < pixels.length; at += 4)
    {
        if (pixels[at] < 255)
        {
            return true;
        }
    }

    return false;
};

/**
 * A photo re-drawn on a canvas, which is what makes it safe to send: its EXIF block, its GPS fix and
 * its camera's serial do not survive one. JPEG at 0.86, PNG when it is see-through, the longest side
 * at most 2560px. Null when the browser cannot decode it.
 */
async function photoOf(file: File): Promise<FileDraft | null>
{
    let bitmap: ImageBitmap;

    try
    {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    catch
    {
        return null;
    }

    try
    {
        const size = fit(bitmap.width, bitmap.height, FILE_PHOTO_SIDE);
        const clear = (file.type === 'image/png' || file.type === 'image/webp') && seeThrough(bitmap);
        const type = clear ? 'image/png' : 'image/jpeg';
        const ground = clear ? undefined : '#fff';
        const [blob, small] = await redraw(bitmap, [
            { ...size, type, quality: clear ? undefined : 0.86, ground },
            thumbSized(size.width, size.height, ground)
        ]);

        if (blob === null)
        {
            return null;
        }

        const stem = nameOf(file.name).replace(/\.[^.]{1,8}$/, '');
        const thumb = await thumbOf(small);

        return {
            plain: await bytesOf(blob),
            as: 'photo',
            mime: type,
            name: nameOf(`${ stem }.${ clear ? 'png' : 'jpg' }`),
            w: size.width,
            h: size.height,
            ...(thumb === undefined ? {} : { thumb })
        };
    }
    finally
    {
        bitmap.close();
    }
}

/**
 * A video as it is, with what its own element says of it: its first frame for a thumb, its size and
 * its length. Null when this browser cannot play it, or it says nothing in time.
 */
async function videoOf(file: File): Promise<FileDraft | null>
{
    const video = document.createElement('video');

    if (video.canPlayType(file.type) === '')
    {
        return null;
    }

    const url = URL.createObjectURL(file);

    try
    {
        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;

        const ready = await new Promise<boolean>((done) =>
        {
            const timer = setTimeout(() => done(false), VIDEO_WAIT_MS);
            const finish = (value: boolean) =>
            {
                clearTimeout(timer);
                done(value);
            };

            video.addEventListener('loadeddata', () =>
            {
                video.addEventListener('seeked', () => finish(true), { once: true });
                video.currentTime = Math.min(0.1, Number.isFinite(video.duration) ? video.duration / 2 : 0);
            }, { once: true });
            video.addEventListener('error', () => finish(false), { once: true });
            video.src = url;
        });

        if (!ready || video.videoWidth === 0 || video.videoHeight === 0)
        {
            return null;
        }

        const frame = await createImageBitmap(video).catch(() => null);
        const thumb = frame === null ? undefined : await thumbOf((await redraw(frame, [thumbSized(video.videoWidth, video.videoHeight)]))[0]);

        return {
            plain: new Uint8Array(await file.arrayBuffer()),
            as: 'video',
            mime: typeOf(file.type),
            name: nameOf(file.name),
            w: video.videoWidth,
            h: video.videoHeight,
            ...(Number.isFinite(video.duration) ? { ms: Math.round(video.duration * 1000) } : {}),
            ...(thumb === undefined ? {} : { thumb })
        };
    }
    finally
    {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
    }
}

/** A GIF as it moves, with nothing in it but its frames (`bareGif`), its first frame for a thumb. Null for one that is not a whole GIF or this browser cannot draw. */
async function gifOf(file: File): Promise<FileDraft | null>
{
    const bare = bareGif(new Uint8Array(await file.arrayBuffer()));

    if (bare === null)
    {
        return null;
    }

    const frame = await createImageBitmap(new Blob([bare as BlobPart], { type: 'image/gif' })).catch(() => null);

    if (frame === null)
    {
        return null;
    }

    const { width, height } = frame;
    const thumb = await thumbOf((await redraw(frame, [thumbSized(width, height, '#fff')]))[0]);
    const stem = nameOf(file.name).replace(/\.[^.]{1,8}$/, '');

    return {
        plain: bare,
        as: 'photo',
        mime: 'image/gif',
        name: nameOf(`${ stem }.gif`),
        w: width,
        h: height,
        ...(thumb === undefined ? {} : { thumb })
    };
}

/** Anything as a file: its bytes and its name as they are, never shown. */
export const fileOf = async (file: File): Promise<FileDraft> => ({
    plain: new Uint8Array(await file.arrayBuffer()),
    as: 'file',
    mime: typeOf(file.type),
    name: nameOf(file.name)
});

/**
 * What a file picked, pasted or dropped is sent as: a photo re-drawn, a video as it is, or a file,
 * and a file whenever the sender asks for one or the browser cannot make anything else of it.
 */
export async function prepare(file: File, asFile: boolean)
{
    if (!asFile && drawable(file.type))
    {
        const photo = await photoOf(file);

        if (photo !== null)
        {
            return photo;
        }
    }

    if (!asFile && file.type === 'image/gif')
    {
        const gif = await gifOf(file);

        if (gif !== null)
        {
            return gif;
        }
    }

    if (!asFile && file.type.startsWith('video/'))
    {
        const video = await videoOf(file);

        if (video !== null)
        {
            return video;
        }
    }

    return fileOf(file);
}

/** Whether a file is one that may be sent as something other than a file at all. */
export const showable = (file: File) => drawable(file.type) || file.type === 'image/gif' || file.type.startsWith('video/');

/**
 * A file too large to send that need not be read to know it: anything going as it is (a video, a
 * file) over 50 MiB. A photo is re-drawn first, and only what that makes is measured, so a large
 * original can still go as a photo once it is smaller.
 */
export const overUnread = (file: File, asFile: boolean) => file.size > FILE_MOST && (asFile || !drawable(file.type));

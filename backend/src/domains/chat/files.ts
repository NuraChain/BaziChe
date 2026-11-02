/**
 * A photo, a video or a file sent in the chat: the bounds both halves read. Imports nothing, so the
 * browser can take it whole.
 */

const MIB = 1024 * 1024;

/** The largest photo, as sent (after the browser has re-drawn it). Held by the browser: the server cannot tell a photo from a file. */
export const FILE_PHOTO_MOST = 10 * MIB;

/** The largest video or file, as sent. */
export const FILE_MOST = 50 * MIB;

/** The largest ciphertext the server keeps: the largest file and its GCM tag, with room to spare. */
export const FILE_SEALED_MOST = FILE_MOST + 1024;

/** Less than this is no file: the GCM tag alone is sixteen bytes. */
export const FILE_SEALED_LEAST = 17;

/** What one account may upload in a day. */
export const FILE_DAY_BYTES = 1024 * MIB;

/** Uploads one account may hold that no message names yet. */
export const FILE_PENDING_MOST = 10;

/** How long an upload no message names is kept for its sender to send, in minutes. */
export const FILE_HOLD_MINUTES = 60;

/** The fewest and the most photos and videos one album holds (MS-D46). */
export const FILE_ALBUM_LEAST = 2;

export const FILE_ALBUM_MOST = 10;

/** The longest caption, in characters. */
export const FILE_CAPTION_MOST = 1024;

/** The longest name a file keeps, in characters. */
export const FILE_NAME_MOST = 180;

/** The largest thumb a document carries, as base64url characters (about 3 KB of JPEG). */
export const FILE_THUMB_MOST = 4096;

/** The longest side of a photo once it is re-drawn, in pixels. */
export const FILE_PHOTO_SIDE = 2560;

/** What a file is sent as: which says how the bubble draws it, and nothing the server can see. */
export const FILE_AS = ['photo', 'video', 'file'] as const;

export type FileAs = typeof FILE_AS[number];

/** What an upload or a fetch of a file answers when it will not: one word each, with its status. */
export const FILE_REFUSALS = {
    'file-size': 413,
    'file-type': 415,
    'file-taken': 409,
    'file-budget': 429,
    'file-pending': 429,
    'file-missing': 404
} as const satisfies Record<string, 404 | 409 | 413 | 415 | 429>;

export type FileRefusal = keyof typeof FILE_REFUSALS;

/**
 * What a reader is told about a file before fetching it: the file it names and the key that opens
 * it, what it is sent as, its name, type and size, a picture's size and a video's length, and a thumb
 * a few hundred bytes long. Sealed in a chat message's document; in the clear in a channel's post.
 */
export interface SentFile
{
    id: string;
    key: string;
    iv: string;
    as: FileAs;
    mime: string;
    name: string;
    bytes: number;
    w?: number;
    h?: number;
    ms?: number;
    thumb?: string;
}

const FILE_KEYS = new Set(['id', 'key', 'iv', 'as', 'mime', 'name', 'bytes', 'w', 'h', 'ms', 'thumb']);

/** The longest side a picture may claim, in pixels: far past any camera, short of a number that breaks a layout. */
const SIDE_MOST = 20_000;

/** The longest video, in milliseconds: a day, which no 50 MiB file holds watchably. */
const FILM_MOST = 24 * 60 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/** Anything a name could carry that a save dialog or a screen should never be handed. */
const UNSAFE_NAME = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069/\\]/;

const whole = (value: unknown, least: number, most: number): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= least && value <= most;

/**
 * A file's fields, exactly, or null: the one check both halves hold a file to, the browser opening a
 * sealed message and the server taking a channel's post, because a reader acts on every field (fetches
 * the file it names, opens it with the key, says its size, saves it under its name).
 */
export function sentFileOf(value: unknown): SentFile | null
{
    if (typeof value !== 'object' || value === null || Array.isArray(value))
    {
        return null;
    }

    const fields = value as Record<string, unknown>;

    if (Object.keys(fields).some((one) => !FILE_KEYS.has(one)))
    {
        return null;
    }

    const { id, key, iv, as, mime, name, bytes, w, h, ms, thumb } = fields;

    if (typeof id !== 'string' || !UUID.test(id)
        || typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)
        || typeof iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(iv)
        || typeof as !== 'string' || !(FILE_AS as readonly string[]).includes(as)
        || typeof mime !== 'string' || !MIME.test(mime)
        || typeof name !== 'string' || name.trim() === '' || name.length > FILE_NAME_MOST || UNSAFE_NAME.test(name)
        || !whole(bytes, 1, FILE_MOST)
        || (w !== undefined && !whole(w, 1, SIDE_MOST))
        || (h !== undefined && !whole(h, 1, SIDE_MOST))
        || ((w === undefined) !== (h === undefined))
        || (ms !== undefined && !whole(ms, 0, FILM_MOST))
        || (thumb !== undefined && (typeof thumb !== 'string' || thumb.length > FILE_THUMB_MOST || !/^[A-Za-z0-9_-]+$/.test(thumb))))
    {
        return null;
    }

    if ((as === 'file' && (w !== undefined || ms !== undefined || thumb !== undefined)) || (as === 'photo' && ms !== undefined) || (as === 'photo' && bytes > FILE_PHOTO_MOST))
    {
        return null;
    }

    return {
        id, key, iv, as: as as FileAs, mime, name, bytes,
        ...(typeof w === 'number' && typeof h === 'number' ? { w, h } : {}),
        ...(typeof ms === 'number' ? { ms } : {}),
        ...(typeof thumb === 'string' ? { thumb } : {})
    };
}

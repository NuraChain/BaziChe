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

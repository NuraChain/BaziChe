/**
 * The largest file, as ciphertext. Ten minutes of 32 kbps Opus is 2.4 MB; the rest is room for a
 * browser that records at a higher bitrate than it was asked for.
 */
export const VOICE_FILE_MOST = 6 * 1024 * 1024;

/** Less than this is no recording: the GCM tag alone is sixteen bytes. */
export const VOICE_FILE_LEAST = 128;

/** What one account may upload in a day. */
export const VOICE_DAY_BYTES = 200 * 1024 * 1024;

/** Uploads one account may hold that no message names yet. */
export const VOICE_PENDING_MOST = 10;

/** How long an upload no message names is kept for its sender to send, in minutes. */
export const VOICE_HOLD_MINUTES = 60;

/** What an upload or a fetch of a voice file answers when it will not: one word each, with its status. */
export const VOICE_REFUSALS = {
    'voice-size': 413,
    'voice-type': 415,
    'voice-taken': 409,
    'voice-budget': 429,
    'voice-pending': 429,
    'voice-missing': 404
} as const satisfies Record<string, 404 | 409 | 413 | 415 | 429>;

export type VoiceRefusal = keyof typeof VOICE_REFUSALS;

/**
 * The largest file, as ciphertext. Ten minutes of 32 kbps Opus is 2.4 MB; the rest is room for a
 * browser that records at a higher bitrate than it was asked for.
 */
export const VOICE_FILE_MOST = 6 * 1024 * 1024;

/** Less than this is no recording: the GCM tag alone is sixteen bytes. */
export const VOICE_FILE_LEAST = 128;

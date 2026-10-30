import { voiceAad } from '../../../backend/src/domains/chat/envelope.ts';
import { VOICE_WAVE_BARS } from '../../../backend/src/domains/chat/voice.ts';
import { fromBase64Url, toBase64Url } from './device-id.ts';

/** What a recorder is asked to make, in order: Opus first, the smallest for a voice, then AAC. */
export const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'] as const;

/** The first type this browser's MediaRecorder says it can make, or none. Nothing is assumed. */
export const recordingType = (supported: (type: string) => boolean) => VOICE_TYPES.find((type) => supported(type)) ?? null;

export type VoiceContainer = 'audio/webm' | 'audio/ogg' | 'audio/mp4';

/**
 * What a file is, read from its own first bytes and never from the type its sender named: a sender
 * can claim anything, and these are the bytes a browser is about to hand its decoder.
 */
export function sniffAudio(bytes: Uint8Array): VoiceContainer | null
{
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    {
        return 'audio/webm';
    }

    if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53)
    {
        return 'audio/ogg';
    }

    if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
    {
        return 'audio/mp4';
    }

    return null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The loudness under which a whole recording is called silence and drawn flat. */
const SILENCE = 0.01;

/** Levels from 0 to 63, one base64url character each. */
export const encodeWave = (levels: readonly number[]) =>
    levels.map((level) => ALPHABET[Math.max(0, Math.min(63, Math.round(level)))]).join('');

export function decodeWave(text: string): number[] | null
{
    if (text.length === 0 || text.length > VOICE_WAVE_BARS)
    {
        return null;
    }

    const levels = [...text].map((char) => ALPHABET.indexOf(char));

    return levels.includes(-1) ? null : levels;
}

/**
 * Loudness to a bar's height: scaled to the recording's own loudest slice, on a square root so a
 * quiet word still shows beside a loud one. A recording of silence stays flat rather than being
 * stretched into waves it does not have.
 */
const scaled = (loudness: readonly number[]) =>
{
    const loudest = Math.max(0, ...loudness);

    return loudest < SILENCE ? loudness.map(() => 0) : loudness.map((value) => Math.round(Math.sqrt(value / loudest) * 63));
};

/** The loudness of each of `bars` slices of the decoded recording. */
export function waveOf(samples: Float32Array, bars = VOICE_WAVE_BARS)
{
    const loudness: number[] = [];
    const size = samples.length / bars;

    for (let bar = 0; bar < bars; bar += 1)
    {
        const from = Math.floor(bar * size);
        const to = Math.min(samples.length, Math.max(from + 1, Math.floor((bar + 1) * size)));
        let sum = 0;

        for (let at = from; at < to; at += 1)
        {
            sum += samples[at] * samples[at];
        }

        loudness.push(to > from ? Math.sqrt(sum / (to - from)) : 0);
    }

    return scaled(loudness);
}

/** The levels the microphone gave while recording, put into `bars` slices the same way. */
export function waveOfLevels(levels: readonly number[], bars = VOICE_WAVE_BARS)
{
    if (levels.length === 0)
    {
        return Array.from({ length: bars }, () => 0);
    }

    const loudness: number[] = [];
    const size = levels.length / bars;

    for (let bar = 0; bar < bars; bar += 1)
    {
        const from = Math.floor(bar * size);
        const to = Math.min(levels.length, Math.max(from + 1, Math.floor((bar + 1) * size)));
        const slice = levels.slice(from, to);

        loudness.push(slice.length === 0 ? 0 : slice.reduce((sum, level) => sum + level, 0) / slice.length);
    }

    return scaled(loudness);
}

/** How tall a drawn waveform is in its own units, which are the screen's pixels up and down. */
export const WAVE_HEIGHT = 24;

const PITCH = 3;

/** How wide a drawn waveform is in its own units; it is stretched across whatever room it is given. */
export const WAVE_WIDTH = VOICE_WAVE_BARS * PITCH;

const tidy = (value: number) => Math.round(value * 100) / 100;

/**
 * A waveform as one path, a line a bar for its SVG to stroke with round caps: silence is a row of
 * dots and the loudest slice nearly fills the height. Fewer levels than bars are spread over them.
 */
export function wavePath(levels: readonly number[])
{
    const parts: string[] = [];

    for (let bar = 0; bar < VOICE_WAVE_BARS; bar += 1)
    {
        const level = levels.length === 0 ? 0 : levels[Math.floor(bar * levels.length / VOICE_WAVE_BARS)];
        const length = Math.max(0, Math.min(63, level)) / 63 * (WAVE_HEIGHT - 4);

        parts.push(`M${ tidy(bar * PITCH + PITCH / 2) } ${ tidy((WAVE_HEIGHT - length) / 2) }v${ tidy(length) }`);
    }

    return parts.join('');
}

export interface SealedAudio
{
    /** The file's key, which travels only inside the sealed document of the message that names it. */
    key: string;
    iv: string;
    body: Uint8Array;
}

const utf8 = new TextEncoder();

/**
 * Encrypts a recording under a key made for it alone, bound to the file's id, so the file is
 * ciphertext wherever it is kept and a file put in another's place does not open.
 */
export async function sealAudio(plain: Uint8Array, fileId: string): Promise<SealedAudio>
{
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    try
    {
        const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt']);
        const body = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv as BufferSource, additionalData: utf8.encode(voiceAad(fileId)) as BufferSource },
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

/** The recording, or null for a file that does not open under its key: another file, or one changed. */
export async function openAudio(body: Uint8Array, key: string, iv: string, fileId: string): Promise<Uint8Array | null>
{
    const raw = fromBase64Url(key);

    try
    {
        const imported = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt']);

        return new Uint8Array(await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64Url(iv) as BufferSource, additionalData: utf8.encode(voiceAad(fileId)) as BufferSource },
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

import { FILE_AS, FILE_CAPTION_MOST, FILE_MOST, FILE_NAME_MOST, FILE_THUMB_MOST, type FileAs } from '../../../backend/src/domains/chat/files.ts';
import { VOICE_FILE_MOST, VOICE_MOST_MS, VOICE_WAVE_BARS } from '../../../backend/src/domains/chat/voice.ts';

export interface TextBody
{
    text: string;
    reply?: string;
    fwd?: true;
}

export interface ReactionBody
{
    react: string;
    on: string;
}

/**
 * A voice message: the file it plays and the key that opens it, what its recorder made, how long it
 * is and its loudness in levels, all sealed with the message so only the room can read them.
 */
export interface VoiceBody
{
    voice: { id: string; key: string; iv: string; mime: string; ms: number; wave: string; bytes: number };
    reply?: string;
    fwd?: true;
}

/**
 * A photo, a video or a file: the file it names and the key that opens it, what it is sent as, its
 * name, type and size (what its bubble says before anything is fetched), a picture's size and a
 * video's length, and a thumb a few hundred bytes long, all sealed with the message; and the words
 * under it.
 */
export interface FileBody
{
    file: {
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
    };
    caption?: string;
    reply?: string;
    fwd?: true;
}

/** What a line says now, sealed by whoever wrote it and naming the line it changes. */
export interface EditBody
{
    edit: string;
    on: string;
}

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function isEmoji(value: string)
{
    return value.length > 0
        && value.length <= 32
        && EMOJI.test(value)
        && [...graphemes.segment(value)].length === 1;
}

const documentOf = (raw: string): Record<string, unknown> | null =>
{
    try
    {
        const value: unknown = JSON.parse(raw);

        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
    }
    catch
    {
        return null;
    }
};

export function encodeText(body: TextBody)
{
    return JSON.stringify({
        text: body.text,
        ...(body.reply === undefined ? {} : { reply: body.reply }),
        ...(body.fwd === true ? { fwd: true } : {})
    });
}

export function encodeVoice(body: VoiceBody)
{
    const { id, key, iv, mime, ms, wave, bytes } = body.voice;

    return JSON.stringify({
        voice: { id, key, iv, mime, ms, wave, bytes },
        ...(body.reply === undefined ? {} : { reply: body.reply }),
        ...(body.fwd === true ? { fwd: true } : {})
    });
}

export function encodeFile(body: FileBody)
{
    const { id, key, iv, as, mime, name, bytes, w, h, ms, thumb } = body.file;

    return JSON.stringify({
        file: {
            id, key, iv, as, mime, name, bytes,
            ...(w === undefined ? {} : { w }),
            ...(h === undefined ? {} : { h }),
            ...(ms === undefined ? {} : { ms }),
            ...(thumb === undefined ? {} : { thumb })
        },
        ...(body.caption === undefined || body.caption === '' ? {} : { caption: body.caption }),
        ...(body.reply === undefined ? {} : { reply: body.reply }),
        ...(body.fwd === true ? { fwd: true } : {})
    });
}

export function encodeReaction(body: ReactionBody)
{
    return JSON.stringify({ react: body.react, on: body.on });
}

export function encodeEdit(body: EditBody)
{
    return JSON.stringify({ edit: body.edit, on: body.on });
}

export function decodeText(raw: string): TextBody | null
{
    const found = documentOf(raw);

    if (found === null || typeof found.text !== 'string')
    {
        return null;
    }

    if ((found.reply !== undefined && typeof found.reply !== 'string') || (found.fwd !== undefined && found.fwd !== true))
    {
        return null;
    }

    return {
        text: found.text,
        ...(typeof found.reply === 'string' ? { reply: found.reply } : {}),
        ...(found.fwd === true ? { fwd: true as const } : {})
    };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const WAVE = new RegExp(`^[A-Za-z0-9_-]{1,${ VOICE_WAVE_BARS }}$`);

/** A recorder measures a little past its own stop; more than this is no recording of ours. */
const LONGEST = VOICE_MOST_MS + 2000;

const whole = (value: unknown, least: number, most: number): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= least && value <= most;

/**
 * A voice message's document, exactly: anything else in its place opens as tampered, because a reader
 * acts on every field of it (fetches the file it names, opens it with the key, draws the waveform).
 */
export function decodeVoice(raw: string): VoiceBody | null
{
    const found = documentOf(raw);
    const voice = found?.voice;

    if (found === null || typeof voice !== 'object' || voice === null || Array.isArray(voice))
    {
        return null;
    }

    const { id, key, iv, mime, ms, wave, bytes } = voice as Record<string, unknown>;

    if (typeof id !== 'string' || !UUID.test(id)
        || typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)
        || typeof iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(iv)
        || typeof mime !== 'string' || mime.length > 64 || !/^audio\/[a-z0-9.+-]+(?:;codecs=[a-z0-9.]+)?$/i.test(mime)
        || !whole(ms, 1, LONGEST)
        || typeof wave !== 'string' || !WAVE.test(wave)
        || !whole(bytes, 1, VOICE_FILE_MOST))
    {
        return null;
    }

    if ((found.reply !== undefined && typeof found.reply !== 'string') || (found.fwd !== undefined && found.fwd !== true))
    {
        return null;
    }

    return {
        voice: { id, key, iv, mime, ms, wave, bytes },
        ...(typeof found.reply === 'string' ? { reply: found.reply } : {}),
        ...(found.fwd === true ? { fwd: true as const } : {})
    };
}

const FILE_KEYS = new Set(['id', 'key', 'iv', 'as', 'mime', 'name', 'bytes', 'w', 'h', 'ms', 'thumb']);

/** The longest side a picture may claim, in pixels: far past any camera, short of a number that breaks a layout. */
const SIDE_MOST = 20_000;

/** The longest video, in milliseconds: a day, which no 50 MiB file holds watchably. */
const FILM_MOST = 24 * 60 * 60_000;

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/** Anything a name could carry that a save dialog or a screen should never be handed. */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069/\\]/;

/**
 * A photo, a video or a file's document, exactly: anything else in its place opens as tampered,
 * because a reader acts on every field of it (fetches the file it names, opens it with the key,
 * says its size, saves it under its name).
 */
export function decodeFile(raw: string): FileBody | null
{
    const found = documentOf(raw);
    const file = found?.file;

    if (found === null || typeof file !== 'object' || file === null || Array.isArray(file))
    {
        return null;
    }

    const fields = file as Record<string, unknown>;

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

    if ((as === 'file' && (w !== undefined || ms !== undefined || thumb !== undefined)) || (as === 'photo' && ms !== undefined))
    {
        return null;
    }

    if ((found.caption !== undefined && (typeof found.caption !== 'string' || found.caption === '' || found.caption.length > FILE_CAPTION_MOST))
        || (found.reply !== undefined && typeof found.reply !== 'string')
        || (found.fwd !== undefined && found.fwd !== true))
    {
        return null;
    }

    return {
        file: {
            id, key, iv, as: as as FileAs, mime, name, bytes,
            ...(typeof w === 'number' && typeof h === 'number' ? { w, h } : {}),
            ...(typeof ms === 'number' ? { ms } : {}),
            ...(typeof thumb === 'string' ? { thumb } : {})
        },
        ...(typeof found.caption === 'string' ? { caption: found.caption } : {}),
        ...(typeof found.reply === 'string' ? { reply: found.reply } : {}),
        ...(found.fwd === true ? { fwd: true as const } : {})
    };
}

export function decodeReaction(raw: string, target: string): string | null
{
    const found = documentOf(raw);

    if (found === null || typeof found.react !== 'string' || found.on !== target || !isEmoji(found.react))
    {
        return null;
    }

    return found.react;
}

/**
 * A line as a report disclosed it: its words, or the edit that gave it the words it had when it was
 * reported, which the report carries in the line's place. Franking checked the document at filing.
 */
export function decodeDisclosed(raw: string): (TextBody & { edited?: true }) | null
{
    const said = decodeText(raw);

    if (said !== null)
    {
        return said;
    }

    const sent = decodeFile(raw);

    if (sent !== null)
    {
        return { text: sent.caption ?? sent.file.name };
    }

    const found = documentOf(raw);

    return found === null || typeof found.edit !== 'string' || typeof found.on !== 'string' || found.edit.trim() === ''
        ? null
        : { text: found.edit, edited: true };
}

/**
 * The words an edit gives its line, or null. The line it names is checked against the line it was
 * handed with, because that column is in the clear and a server could move an edit onto another.
 */
export function decodeEdit(raw: string, target: string): string | null
{
    const found = documentOf(raw);

    if (found === null || typeof found.edit !== 'string' || found.on !== target || found.edit.trim() === '')
    {
        return null;
    }

    return found.edit;
}

import { describe, expect, it } from 'vitest';

import { VOICE_FILE_MOST, VOICE_MOST_MS, VOICE_WAVE_BARS } from '../../backend/src/domains/chat/voice.ts';
import { decodeText, decodeVoice, encodeVoice, type VoiceBody } from '../src/lib/body.ts';
import { decodeWave, encodeWave, openAudio, recordingType, sealAudio, sniffAudio, waveOf, waveOfLevels } from '../src/lib/voice-note.ts';

const WEBM = [0x1a, 0x45, 0xdf, 0xa3];

const recording = (size = 200) => new Uint8Array([...WEBM, ...Array.from({ length: size }, (_, at) => at % 251)]);

describe('a recording’s container', () =>
{
    it('is read from its own first bytes', () =>
    {
        expect(sniffAudio(new Uint8Array([...WEBM, 1, 2]))).toBe('audio/webm');
        expect(sniffAudio(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2]))).toBe('audio/ogg');
        expect(sniffAudio(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41]))).toBe('audio/mp4');
    });

    it('is nothing for bytes that are no recording, however they begin', () =>
    {
        expect(sniffAudio(new Uint8Array([]))).toBeNull();
        expect(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf]))).toBeNull();
        expect(sniffAudio(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]))).toBeNull();
        expect(sniffAudio(new TextEncoder().encode('<html><body>'))).toBeNull();
    });
});

describe('the type a recorder is asked for', () =>
{
    it('is the first this browser can make, Opus before AAC', () =>
    {
        expect(recordingType(() => true)).toBe('audio/webm;codecs=opus');
        expect(recordingType((type) => type.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus');
        expect(recordingType((type) => type.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
        expect(recordingType((type) => type === 'audio/mp4')).toBe('audio/mp4');
    });

    it('is none where nothing is offered', () =>
    {
        expect(recordingType(() => false)).toBeNull();
    });
});

describe('a waveform', () =>
{
    it('is one character a level, 0 to 63, and back', () =>
    {
        const levels = Array.from({ length: VOICE_WAVE_BARS }, (_, at) => at);

        expect(decodeWave(encodeWave(levels))).toEqual(levels);
        expect(encodeWave([-5, 70, 31.6])).toBe(encodeWave([0, 63, 32]));
    });

    it('is refused empty, too long, or with a character no level is', () =>
    {
        expect(decodeWave('')).toBeNull();
        expect(decodeWave('A'.repeat(VOICE_WAVE_BARS + 1))).toBeNull();
        expect(decodeWave('AB=')).toBeNull();
    });

    it('is the loudness of each slice of the recording, scaled to its loudest', () =>
    {
        const samples = new Float32Array(8000);

        for (let at = 0; at < samples.length; at += 1)
        {
            samples[at] = (at < 4000 ? 0.8 : 0.1) * Math.sin(at / 5);
        }

        const wave = waveOf(samples, 8);

        expect(wave).toHaveLength(8);
        expect(Math.max(...wave)).toBe(63);
        expect(wave.slice(0, 4).every((level) => level > wave[7]), 'the loud half above the quiet half').toBe(true);
        expect(wave[7], 'a quiet word still shows').toBeGreaterThan(0);
    });

    it('is flat for silence, never stretched into waves it does not have', () =>
    {
        expect(waveOf(new Float32Array(8000), 8)).toEqual(Array(8).fill(0));
        expect(waveOf(new Float32Array(8000).fill(0.001), 8)).toEqual(Array(8).fill(0));
    });

    it('is drawn from the levels the microphone gave where the recording could not be decoded', () =>
    {
        expect(waveOfLevels([0.5, 0.5, 0.1, 0.1], 2)).toEqual([63, Math.round(Math.sqrt(0.1 / 0.5) * 63)]);
        expect(waveOfLevels([], 4)).toEqual([0, 0, 0, 0]);
    });
});

describe('a voice file', () =>
{
    it('is sealed into ciphertext that opens under its key as the recording it was', async () =>
    {
        const plain = recording();
        const sealed = await sealAudio(plain, 'file-a');

        expect(sealed.body).toHaveLength(plain.length + 16);
        expect(sniffAudio(sealed.body), 'nothing of the recording shows').toBeNull();
        expect(await openAudio(sealed.body, sealed.key, sealed.iv, 'file-a')).toEqual(plain);
    });

    it('does not open under another key, as another file, or once a byte of it has changed', async () =>
    {
        const plain = recording();
        const sealed = await sealAudio(plain, 'file-a');
        const other = await sealAudio(plain, 'file-a');
        const changed = sealed.body.slice();

        changed[10] ^= 1;

        expect(await openAudio(sealed.body, other.key, sealed.iv, 'file-a'), 'another key').toBeNull();
        expect(await openAudio(sealed.body, sealed.key, sealed.iv, 'file-b'), 'another file').toBeNull();
        expect(await openAudio(changed, sealed.key, sealed.iv, 'file-a'), 'a byte changed').toBeNull();
        expect(await openAudio(sealed.body, sealed.key, other.iv, 'file-a'), 'another nonce').toBeNull();
    });

    it('is sealed under a key of its own every time', async () =>
    {
        const plain = recording();
        const [first, second] = await Promise.all([sealAudio(plain, 'file-a'), sealAudio(plain, 'file-a')]);

        expect(first.key).not.toBe(second.key);
        expect(first.iv).not.toBe(second.iv);
        expect(first.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(first.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    });
});

describe('a voice message’s document', () =>
{
    const document: VoiceBody = {
        voice: {
            id: '0b5b0d47-5a3c-4f8e-9a51-6f0b3c2d1e7a',
            key: 'A'.repeat(43),
            iv: 'B'.repeat(16),
            mime: 'audio/webm;codecs=opus',
            ms: 12_345,
            wave: encodeWave([0, 10, 63]),
            bytes: 49_000
        }
    };

    it('is read back as it was written, with a reply and a forward', () =>
    {
        expect(decodeVoice(encodeVoice(document))).toEqual(document);
        expect(decodeVoice(encodeVoice({ ...document, reply: 'a-line', fwd: true }))).toEqual({ ...document, reply: 'a-line', fwd: true });
    });

    it('is refused with any field that is not what a recorder makes', () =>
    {
        const wrong: [string, Record<string, unknown>][] = [
            ['an id that is none', { id: 'nope' }],
            ['a short key', { key: 'A'.repeat(42) }],
            ['a key of another alphabet', { key: '+'.repeat(43) }],
            ['a short nonce', { iv: 'B'.repeat(15) }],
            ['a type that is not audio', { mime: 'text/html' }],
            ['a type with more in it', { mime: 'audio/webm; script=1' }],
            ['no length', { ms: 0 }],
            ['a length in pieces', { ms: 1.5 }],
            ['longer than a recording may be', { ms: VOICE_MOST_MS + 2001 }],
            ['no waveform', { wave: '' }],
            ['too long a waveform', { wave: 'A'.repeat(VOICE_WAVE_BARS + 1) }],
            ['a waveform of another alphabet', { wave: 'A=A' }],
            ['no bytes', { bytes: 0 }],
            ['more bytes than a file may be', { bytes: VOICE_FILE_MOST + 1 }],
            ['a field missing', { ms: undefined }]
        ];

        for (const [name, change] of wrong)
        {
            expect(decodeVoice(JSON.stringify({ voice: { ...document.voice, ...change } })), name).toBeNull();
        }

        expect(decodeVoice(JSON.stringify({ text: 'words' })), 'words').toBeNull();
        expect(decodeVoice('not a document'), 'not json').toBeNull();
        expect(decodeVoice(JSON.stringify({ ...document, reply: 5 })), 'a reply that is no id').toBeNull();
        expect(decodeVoice(JSON.stringify({ ...document, fwd: 'yes' })), 'a forward that is no flag').toBeNull();
        expect(decodeVoice(JSON.stringify({ voice: [document.voice] })), 'a list').toBeNull();
    });

    it('is never read as words', () =>
    {
        expect(decodeText(encodeVoice(document))).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';

import { saidOf } from '../src/domains/group/reports.ts';

describe('what a group\'s staff are shown of a line reported in its room', () =>
{
    it('is the words of a line, or the new words of an edit', () =>
    {
        expect(saidOf(JSON.stringify({ text: 'meet at nine', reply: 'm-1' }))).toEqual({ text: 'meet at nine' });
        expect(saidOf(JSON.stringify({ edit: 'meet at ten', on: 'm-1' }))).toEqual({ text: 'meet at ten' });
    });

    it('is how long a voice message is, never the key that opens it', () =>
    {
        expect(saidOf(JSON.stringify({ voice: { id: 'v', key: 'k', iv: 'i', mime: 'audio/webm', ms: 3_400.6, wave: 'AA', bytes: 9 } }))).toEqual({ voice: 3_401 });
        expect(saidOf(JSON.stringify({ voice: { id: 'v', key: 'k', ms: -5 } }))).toEqual({ voice: 0 });
    });

    it('is what a file is and its caption, never its key or its thumb', () =>
    {
        const file = { id: 'f', key: 'k', iv: 'i', mime: 'application/pdf', name: 'rules.pdf', bytes: 9, thumb: 'T' };

        expect(saidOf(JSON.stringify({ file: { ...file, as: 'file' } }))).toEqual({ file: { name: 'rules.pdf', as: 'file' } });
        expect(saidOf(JSON.stringify({ file: { ...file, as: 'video' }, caption: 'watch' }))).toEqual({ file: { name: 'rules.pdf', as: 'video' }, text: 'watch' });
        expect(saidOf(JSON.stringify({ file: { ...file, as: 'video' }, caption: '   ' }))).toEqual({ file: { name: 'rules.pdf', as: 'video' } });
    });

    it('is nothing for a document it does not know, or nothing at all', () =>
    {
        expect(saidOf(null)).toEqual({});
        expect(saidOf('not a document')).toEqual({});
        expect(saidOf('["text"]')).toEqual({});
        expect(saidOf(JSON.stringify({ text: 5 }))).toEqual({});
        expect(saidOf(JSON.stringify({ file: { name: 'a.exe', as: 'program' } }))).toEqual({});
        expect(saidOf(JSON.stringify({ voice: { ms: '9' } }))).toEqual({});
    });
});

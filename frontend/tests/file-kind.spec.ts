import { describe, expect, it } from 'vitest';

import { judgeFile } from '../src/lib/file-kind.ts';

/**
 * Which files may go, read from their bytes (MS-D22): documents, text, pictures, sounds and videos;
 * never a box, a program, a page or an Office file with macros, whatever it is called, and never a
 * name a computer would run or open as a page, whatever is in it.
 */

const ascii = (words: string) => [...words].map((letter) => letter.charCodeAt(0));

const bytes = (...parts: readonly (string | number | readonly number[])[]) => new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? ascii(part) : (typeof part === 'number' ? [ part ] : [ ...part ]))));

const le16 = (value: number) => [ value & 0xff, value >> 8 ];

const le32 = (value: number) => [ value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24 ];

/** A ZIP of stored entries with its central directory, as an archiver writes one. */
const zip = (entries: readonly (readonly [ string, string ])[]) =>
{
    const local: number[] = [];
    const central: number[] = [];

    for (const [ name, body ] of entries)
    {
        const offset = local.length;

        local.push(...ascii('PK\u0003\u0004'), ...le16(10), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(body.length), ...le32(body.length), ...le16(name.length), ...le16(0), ...ascii(name), ...ascii(body));
        central.push(...ascii('PK\u0001\u0002'), ...le16(20), ...le16(10), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(body.length), ...le32(body.length), ...le16(name.length), ...le16(0), ...le16(0), 0, 0, 0, 0, 0, 0, 0, 0, ...le32(offset), ...ascii(name));
    }

    return new Uint8Array([ ...local, ...central, ...ascii('PK\u0005\u0006'), 0, 0, 0, 0, ...le16(entries.length), ...le16(entries.length), ...le32(central.length), ...le32(local.length), 0, 0 ]);
};

const wide = (words: string) => [...words].flatMap((letter) => [ letter.charCodeAt(0), 0 ]);

const COMPOUND = [ 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1 ];

const DOCX = zip([ [ '[Content_Types].xml', '<Types/>' ], [ 'word/document.xml', '<w:document/>' ] ]);

describe('a file that may go', () =>
{
    it('is a document: a PDF, an RTF, a Word, Excel or PowerPoint file, an OpenDocument, an older Office file under its own name', () =>
    {
        expect(judgeFile(bytes('%PDF-1.7\n'), 'report.pdf')).toEqual({ goes: true, kind: 'document' });
        expect(judgeFile(bytes('{\\rtf1\\ansi'), 'letter.rtf')).toEqual({ goes: true, kind: 'document' });
        expect(judgeFile(DOCX, 'plan.docx')).toEqual({ goes: true, kind: 'document' });
        expect(judgeFile(zip([ [ '[Content_Types].xml', '' ], [ 'xl/workbook.xml', '' ] ]), 'sums.xlsx')).toEqual({ goes: true, kind: 'document' });
        expect(judgeFile(zip([ [ 'mimetype', 'application/vnd.oasis.opendocument.text' ], [ 'content.xml', '' ] ]), 'notes.odt')).toEqual({ goes: true, kind: 'document' });
        expect(judgeFile(bytes(COMPOUND, new Array(40).fill(0), wide('WordDocument')), 'old.doc')).toEqual({ goes: true, kind: 'document' });
    });

    it('is text, in UTF-8 or after a UTF-16 mark, whatever it is called but a name that runs', () =>
    {
        expect(judgeFile(bytes('name,score\nsara,12\n'), 'scores.csv')).toEqual({ goes: true, kind: 'text' });
        expect(judgeFile(new TextEncoder().encode('سلام، این یادداشته.\n'), 'یادداشت.txt')).toEqual({ goes: true, kind: 'text' });
        expect(judgeFile(bytes(0xff, 0xfe, wide('hello')), 'wide.txt')).toEqual({ goes: true, kind: 'text' });
        expect(judgeFile(bytes('{ "a": 1 }'), 'README')).toEqual({ goes: true, kind: 'text' });
        expect(judgeFile(bytes('\u001b[31mred\u001b[0m\n'), 'build.log'), 'a log keeps its colours').toEqual({ goes: true, kind: 'text' });
        expect(judgeFile(new Uint8Array(), 'empty.txt')).toEqual({ goes: true, kind: 'text' });
    });

    it('is a picture, a sound or a video kept as a file', () =>
    {
        expect(judgeFile(bytes(0xff, 0xd8, 0xff, 0xe0), 'p.jpg')).toEqual({ goes: true, kind: 'picture' });
        expect(judgeFile(bytes(0x89, 'PNG\r\n'), 'p.png')).toEqual({ goes: true, kind: 'picture' });
        expect(judgeFile(bytes('GIF89a'), 'p.gif')).toEqual({ goes: true, kind: 'picture' });
        expect(judgeFile(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '), 'p.webp')).toEqual({ goes: true, kind: 'picture' });
        expect(judgeFile(bytes(0, 0, 0, 24, 'ftypheic'), 'p.heic')).toEqual({ goes: true, kind: 'picture' });
        expect(judgeFile(bytes('8BPS'), 'art.psd')).toEqual({ goes: true, kind: 'picture' });
        expect(judgeFile(bytes('ID3', 4, 0), 'song.mp3')).toEqual({ goes: true, kind: 'audio' });
        expect(judgeFile(bytes(0xff, 0xfb, 0x90, 0x64), 'bare.mp3'), 'a frame with no tag').toEqual({ goes: true, kind: 'audio' });
        expect(judgeFile(bytes(0xff, 0xf1, 0x50, 0x80), 'a.aac')).toEqual({ goes: true, kind: 'audio' });
        expect(judgeFile(bytes('OggS'), 'song.ogg')).toEqual({ goes: true, kind: 'audio' });
        expect(judgeFile(bytes('RIFF', 0, 0, 0, 0, 'WAVEfmt '), 'a.wav')).toEqual({ goes: true, kind: 'audio' });
        expect(judgeFile(bytes(0, 0, 0, 32, 'ftypM4A '), 'a.m4a')).toEqual({ goes: true, kind: 'audio' });
        expect(judgeFile(bytes('#!AMR\n'), 'voice.amr'), 'not a script').toEqual({ goes: true, kind: 'audio' });
        expect(judgeFile(bytes(0, 0, 0, 32, 'ftypisom'), 'clip.mp4')).toEqual({ goes: true, kind: 'video' });
        expect(judgeFile(bytes(0x1a, 0x45, 0xdf, 0xa3), 'clip.webm')).toEqual({ goes: true, kind: 'video' });
        expect(judgeFile(bytes('RIFF', 0, 0, 0, 0, 'AVI LIST'), 'clip.avi')).toEqual({ goes: true, kind: 'video' });
    });
});

describe('a file that may not go', () =>
{
    it('is a program whatever it is called: Windows, Linux, a Mac, Java, Android, WebAssembly, a shortcut, a script', () =>
    {
        for (const [ head, name ] of [
            [ bytes('MZ', 0x90, 0), 'holiday.jpg' ],
            [ bytes(0x7f, 'ELF', 2, 1), 'notes.txt' ],
            [ bytes(0xcf, 0xfa, 0xed, 0xfe), 'song.mp3' ],
            [ bytes(0xfe, 0xed, 0xfa, 0xce), 'report.pdf' ],
            [ bytes(0xca, 0xfe, 0xba, 0xbe), 'a.doc' ],
            [ bytes('dex\n035', 0), 'b.txt' ],
            [ bytes(0, 'asm', 1, 0, 0, 0), 'c.txt' ],
            [ bytes(0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0x00), 'photo.png' ],
            [ bytes('#!/bin/sh\nrm -rf ~\n'), 'readme.txt' ]
        ] as const)
        {
            expect(judgeFile(head, name), name).toEqual({ goes: false, why: 'program' });
        }
    });

    it('is a box nobody here can look inside: any ZIP but an Office file or an OpenDocument, and the rest', () =>
    {
        expect(judgeFile(zip([ [ 'a.txt', 'a' ], [ 'b.exe', 'MZ' ] ]), 'photos.jpg')).toEqual({ goes: false, why: 'archive' });
        expect(judgeFile(zip([ [ 'mimetype', 'application/epub+zip' ] ]), 'book.pdf')).toEqual({ goes: false, why: 'archive' });
        expect(judgeFile(bytes('PK', 3, 4, 'cut short'), 'cut.docx'), 'a ZIP that cannot be read').toEqual({ goes: false, why: 'archive' });

        for (const head of [
            bytes('Rar!', 0x1a, 0x07, 0x01),
            bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c),
            bytes(0x1f, 0x8b, 0x08),
            bytes('BZh9'),
            bytes(0xfd, '7zXZ', 0),
            bytes(0x28, 0xb5, 0x2f, 0xfd),
            bytes('MSCF', 0, 0, 0, 0),
            bytes('!<arch>\n'),
            bytes(new Array(257).fill(0x41), 'ustar'),
            bytes(new Array(0x8001).fill(0), 'CD001')
        ])
        {
            expect(judgeFile(head, 'thing.dat'), String(head.slice(0, 4))).toEqual({ goes: false, why: 'archive' });
        }
    });

    it('is a page: HTML, SVG or XML, whatever it is called', () =>
    {
        expect(judgeFile(bytes('<!DOCTYPE html><script>alert(1)</script>'), 'notes.txt')).toEqual({ goes: false, why: 'page' });
        expect(judgeFile(bytes(0xef, 0xbb, 0xbf, '  \n<svg onload="x()"/>'), 'logo.png.txt')).toEqual({ goes: false, why: 'page' });
        expect(judgeFile(bytes('<?xml version="1.0"?><a/>'), 'data.csv')).toEqual({ goes: false, why: 'page' });
    });

    it('is an Office file or an OpenDocument that carries macros, whatever it is called', () =>
    {
        expect(judgeFile(zip([ [ '[Content_Types].xml', '' ], [ 'word/document.xml', '' ], [ 'word/vbaProject.bin', '' ] ]), 'plan.docx')).toEqual({ goes: false, why: 'macro' });
        expect(judgeFile(zip([ [ '[Content_Types].xml', '' ], [ 'xl/workbook.xml', '' ], [ 'xl/macrosheets/sheet1.xml', '' ] ]), 'sums.xlsx')).toEqual({ goes: false, why: 'macro' });
        expect(judgeFile(zip([ [ '[Content_Types].xml', '' ], [ 'ppt/presentation.xml', '' ], [ 'ppt/activeX/activeX1.xml', '' ] ]), 'deck.pptx')).toEqual({ goes: false, why: 'macro' });
        expect(judgeFile(zip([ [ 'mimetype', 'application/vnd.oasis.opendocument.text' ], [ 'Basic/Standard/Module1.xml', '' ] ]), 'notes.odt')).toEqual({ goes: false, why: 'macro' });
        expect(judgeFile(bytes(COMPOUND, new Array(40).fill(0), wide('_VBA_PROJECT')), 'old.doc')).toEqual({ goes: false, why: 'macro' });
    });

    it('is a compound file under any name but an older Office file’s, which could be an installer or a mail', () =>
    {
        expect(judgeFile(bytes(COMPOUND, 0, 0), 'cheque.dat')).toEqual({ goes: false, why: 'other' });
    });

    it('is anything under a name a computer runs, mounts or opens as a page, whatever is in it', () =>
    {
        expect(judgeFile(bytes('echo hello'), 'hello.bat')).toEqual({ goes: false, why: 'program' });
        expect(judgeFile(bytes('hello'), 'Setup.EXE')).toEqual({ goes: false, why: 'program' });
        expect(judgeFile(bytes('hello'), 'evil.exe. '), 'the dots and spaces a disk drops').toEqual({ goes: false, why: 'program' });
        expect(judgeFile(bytes(0xff, 0xd8, 0xff), 'photo.jpg.lnk')).toEqual({ goes: false, why: 'program' });
        expect(judgeFile(bytes('hello'), 'disk.iso')).toEqual({ goes: false, why: 'program' });
        expect(judgeFile(bytes('hello'), 'page.htm')).toEqual({ goes: false, why: 'page' });
        expect(judgeFile(bytes('hello'), 'logo.svg')).toEqual({ goes: false, why: 'page' });
        expect(judgeFile(DOCX, 'plan.docm')).toEqual({ goes: false, why: 'macro' });
        expect(judgeFile(bytes('%PDF-1.7'), 'files.zip')).toEqual({ goes: false, why: 'archive' });
    });

    it('is bytes that are none of what may go', () =>
    {
        expect(judgeFile(bytes(0x00, 0x01, 0x02, 0x03, 0x00), 'data.dat')).toEqual({ goes: false, why: 'other' });
        expect(judgeFile(bytes('looks like words', 0x00, 'until here'), 'notes.dat'), 'a single NUL').toEqual({ goes: false, why: 'other' });
        expect(judgeFile(bytes('looks like words', 0x7f, 'until here'), 'notes.dat'), 'a DEL').toEqual({ goes: false, why: 'other' });
        expect(judgeFile(bytes(0xc3, 0x28, 'not utf-8'), 'broken.txt')).toEqual({ goes: false, why: 'other' });
    });
});

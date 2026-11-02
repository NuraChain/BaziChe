import { describe, expect, it } from 'vitest';

import { bareGif } from '../src/lib/gif.ts';

/** A GIF goes as a photo as it is, but with nothing in it beside its frames, how they are timed and how they loop. */

const ascii = (words: string) => [...words].map((letter) => letter.charCodeAt(0));

const HEAD = [ ...ascii('GIF89a'), 2, 0, 2, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255 ];

const LOOP = [ 0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0 ];

const TIMING = [ 0x21, 0xf9, 4, 0, 10, 0, 0, 0 ];

const FRAME = [ 0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 2, 2, 0x44, 0x01, 0 ];

const COMMENT = [ 0x21, 0xfe, 6, ...ascii('secret'), 0 ];

const XMP = [ 0x21, 0xff, 11, ...ascii('XMP DataXMP'), 16, ...ascii('GPSLatitude 35.7'), 0 ];

const WORDS = [ 0x21, 0x01, 12, 0, 0, 0, 0, 2, 0, 2, 0, 1, 1, 0, 1, 4, ...ascii('word'), 0 ];

const gif = (...blocks: readonly (readonly number[])[]) => new Uint8Array([ ...HEAD, ...blocks.flat(), 0x3b ]);

const holds = (bytes: Uint8Array, words: string) => new TextDecoder('latin1').decode(bytes).includes(words);

describe('a GIF as a photo goes', () =>
{
    it('keeps every frame, how it is timed and how it loops, and leaves out comments, words and what made it', () =>
    {
        const bare = bareGif(gif(LOOP, COMMENT, XMP, TIMING, FRAME, WORDS, TIMING, FRAME))!;

        expect([ ...bare ]).toEqual([ ...HEAD, ...LOOP, ...TIMING, ...FRAME, ...TIMING, ...FRAME, 0x3b ]);
        expect(holds(bare, 'secret')).toBe(false);
        expect(holds(bare, 'GPSLatitude')).toBe(false);
        expect(holds(bare, 'word')).toBe(false);
    });

    it('comes out byte for byte when there is nothing to leave out, an older GIF and a frame with colours of its own included', () =>
    {
        const older = new Uint8Array([ ...ascii('GIF87a'), 1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80, 0, 0, 0, 255, 255, 255, 2, 2, 0x44, 0x01, 0, 0x3b ]);

        expect([ ...bareGif(older)! ]).toEqual([ ...older ]);
        expect([ ...bareGif(gif(LOOP, TIMING, FRAME))! ]).toEqual([ ...gif(LOOP, TIMING, FRAME) ]);
    });

    it('is nothing for bytes that are not a whole GIF', () =>
    {
        expect(bareGif(new Uint8Array(ascii('PNG not a gif at all')))).toBeNull();
        expect(bareGif(gif(LOOP, TIMING, FRAME).subarray(0, HEAD.length + LOOP.length + 5)), 'cut short').toBeNull();
        expect(bareGif(new Uint8Array([ ...HEAD, ...FRAME ])), 'no end').toBeNull();
        expect(bareGif(new Uint8Array([ ...HEAD, 0x99, 0x3b ])), 'a block that is none').toBeNull();
        expect(bareGif(new Uint8Array([ ...HEAD, 0x99, 0xfe, 3, ...ascii('abc'), 0, 0x3b ])), 'one that only looks like an extension').toBeNull();
        expect(bareGif(new Uint8Array(ascii('GIF89a')).subarray(0, 6)), 'no screen').toBeNull();
    });
});

const LOOPS = [ 'NETSCAPE2.0', 'ANIMEXTS1.0' ];

const ascii = (bytes: Uint8Array, from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length));

/** Where the run of data sub-blocks starting at `at` ends, past its empty last one, or -1 where the bytes end first. */
function subBlocksEnd(bytes: Uint8Array, at: number)
{
    let place = at;

    while (place < bytes.length)
    {
        const size = bytes[place];

        place += 1 + size;

        if (size === 0)
        {
            return place;
        }
    }

    return -1;
}

/**
 * A GIF as a photo goes, which cannot be drawn again without stopping it moving: every frame and
 * how it is timed and looped kept, and every block that could carry words or anything about where
 * and with what it was made (comments, plain text, every application block but the one that
 * loops it, XMP and colour profiles with the rest) left out. Null for bytes that are not a whole GIF.
 */
export function bareGif(bytes: Uint8Array): Uint8Array | null
{
    if (bytes.length < 13 || !/^GIF8[79]a$/.test(ascii(bytes, 0, 6)))
    {
        return null;
    }

    const kept: Uint8Array[] = [];
    const flags = bytes[10];
    let place = 13 + ((flags & 0x80) === 0 ? 0 : 3 * 2 ** ((flags & 0x07) + 1));

    if (place > bytes.length)
    {
        return null;
    }

    kept.push(bytes.subarray(0, place));

    while (place < bytes.length)
    {
        const block = bytes[place];

        if (block === 0x3b)
        {
            kept.push(bytes.subarray(place, place + 1));

            const whole = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
            let at = 0;

            for (const part of kept)
            {
                whole.set(part, at);
                at += part.length;
            }

            return whole;
        }

        if (block === 0x2c)
        {
            const local = bytes[place + 9];
            const data = place + 10 + ((local & 0x80) === 0 ? 0 : 3 * 2 ** ((local & 0x07) + 1)) + 1;
            const end = data > bytes.length ? -1 : subBlocksEnd(bytes, data);

            if (end < 0)
            {
                return null;
            }

            kept.push(bytes.subarray(place, end));
            place = end;
            continue;
        }

        if (block !== 0x21 || place + 2 > bytes.length)
        {
            return null;
        }

        const label = bytes[place + 1];
        const end = subBlocksEnd(bytes, place + 2);

        if (end < 0)
        {
            return null;
        }

        if (label === 0xf9 || (label === 0xff && bytes[place + 2] === 11 && LOOPS.includes(ascii(bytes, place + 3, 11))))
        {
            kept.push(bytes.subarray(place, end));
        }

        place = end;
    }

    return null;
}

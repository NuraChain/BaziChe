/**
 * WebM files built by hand, laid out as browsers' MediaRecorders write them: a segment and clusters of
 * unknown size, a SimpleBlock per Opus packet. Firefox's marks no block a keyframe and says its
 * Duration is 0; Chromium's marks every block and writes no Duration.
 */

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

const sizeOf = (length: number) => (length < 127 ? [0x80 | length] : [0x40 | (length >> 8), length & 0xff]);

const element = (id: number[], body: number[]) => [...id, ...sizeOf(body.length), ...body];

const unsized = (id: number[], body: number[]) => [...id, ...UNKNOWN, ...body];

const ID = {
    ebml: [0x1a, 0x45, 0xdf, 0xa3],
    segment: [0x18, 0x53, 0x80, 0x67],
    seekHead: [0x11, 0x4d, 0x9b, 0x74],
    info: [0x15, 0x49, 0xa9, 0x66],
    scale: [0x2a, 0xd7, 0xb1],
    duration: [0x44, 0x89],
    app: [0x4d, 0x80],
    tracks: [0x16, 0x54, 0xae, 0x6b],
    cluster: [0x1f, 0x43, 0xb6, 0x75],
    timecode: [0xe7],
    block: [0xa3],
    group: [0xa0],
    groupBlock: [0xa1]
};

/** A SimpleBlock of track 2 at a time in its cluster, with the flags given, and an Opus packet of a few bytes. */
const block = (at: number, flags: number) => element(ID.block, [0x82, (at >> 8) & 0xff, at & 0xff, flags, 0xfc, at & 0x7f, 0x33, 0x44]);

const float64 = (value: number) =>
{
    const bytes = new Uint8Array(8);

    new DataView(bytes.buffer).setFloat64(0, value);
    return [...bytes];
};

const float32 = (value: number) =>
{
    const bytes = new Uint8Array(4);

    new DataView(bytes.buffer).setFloat32(0, value);
    return [...bytes];
};

export interface Shape
{
    /** The flags every SimpleBlock is written with: 0 as Firefox writes them, 0x80 as Chromium does. */
    flags: number;

    /** The Info's Duration: none, or a float of 8 or 4 bytes. */
    duration: { value: number; width: 8 | 4 } | null;

    /** Whether the clusters say how long they are. */
    sized: boolean;

    /** A BlockGroup, whose Block carries no keyframe flag, in the first cluster. */
    group: boolean;
}

const FIREFOX: Shape = { flags: 0x00, duration: { value: 0, width: 8 }, sized: false, group: false };

/** A recording as a MediaRecorder writes it: Firefox's unless told otherwise. */
export function webm(shape: Partial<Shape> = {})
{
    const made = { ...FIREFOX, ...shape };
    const duration = made.duration === null ? [] : element(ID.duration, made.duration.width === 8 ? float64(made.duration.value) : float32(made.duration.value));
    const info = element(ID.info, [...element(ID.scale, [0x0f, 0x42, 0x40]), ...duration, ...element(ID.app, [0x51, 0x54])]);
    const tracks = element(ID.tracks, [0xae, 0x84, 0xd7, 0x81, 0x02, 0x00]);
    const first = [
        ...element(ID.timecode, [0x06]),
        ...block(0, made.flags),
        ...(made.group ? element(ID.group, element(ID.groupBlock, [0x82, 0x00, 0x14, 0x00, 0xfc, 0x01])) : []),
        ...block(20, made.flags),
        ...block(40, made.flags)
    ];
    const second = [...element(ID.timecode, [0x83, 0xee]), ...block(0, made.flags), ...block(20, made.flags)];
    const cluster = (body: number[]) => (made.sized ? element(ID.cluster, body) : unsized(ID.cluster, body));

    return new Uint8Array([
        ...element(ID.ebml, [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]),
        ...unsized(ID.segment, [...element(ID.seekHead, []), ...info, ...tracks, ...cluster(first), ...cluster(second)])
    ]);
}

/** The flags of every SimpleBlock, in order, found by its own ID and the track number and time before its flags. */
export function blockFlags(bytes: Uint8Array)
{
    const flags: number[] = [];

    for (let at = 0; at + 4 < bytes.length; at += 1)
    {
        if (bytes[at] === 0xa3 && bytes[at + 1] === 0x88 && bytes[at + 2] === 0x82 && bytes[at + 6] === 0xfc)
        {
            flags.push(bytes[at + 5]);
        }
    }

    return flags;
}

/** Where the Duration's ID is, if one is still there. */
export const durationAt = (bytes: Uint8Array) => bytes.findIndex((byte, at) => byte === 0x44 && bytes[at + 1] === 0x89);

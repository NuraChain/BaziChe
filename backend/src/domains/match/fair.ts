import { shuffle } from './randomness.ts';

export type Mac = (key: Uint8Array, message: Uint8Array) => Uint8Array;

export type Hash = (data: Uint8Array) => Uint8Array;

export const OPENING = 1;

const SPAN = 2 ** 32;

const text = new TextEncoder();

export function bytesOf(hex: string)
{
    const body = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(body.length >> 1);

    for (let at = 0; at < bytes.length; at += 1)
    {
        bytes[at] = Number.parseInt(body.slice(at * 2, at * 2 + 2), 16);
    }

    return bytes;
}

export function hexOf(bytes: Uint8Array)
{
    return `0x${ Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') }`;
}

export function seedOf(hash: Hash, secrets: readonly string[], signatures: readonly string[], version: 1 | 2 = 1)
{
    if (version === 2)
    {
        return hash(text.encode(JSON.stringify(['baziche', 'stake-v2', secrets.map((part) => part.toLowerCase()), signatures.map((part) => part.toLowerCase())])));
    }

    const parts = [...secrets, ...signatures].map(bytesOf);
    const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let at = 0;

    for (const part of parts)
    {
        joined.set(part, at);
        at += part.length;
    }

    return hash(joined);
}

export function stakeMatchId(hash: Hash, game: string, seats: readonly { commitment: string; nonce: string }[])
{
    const digest = hash(text.encode(JSON.stringify(['baziche', 'stake-v2-match-id', game,
        seats.map((seat) => [seat.commitment.toLowerCase(), seat.nonce.toLowerCase()])])));
    const id = digest.slice(0, 16);

    id[6] = (id[6] & 0x0f) | 0x80;
    id[8] = (id[8] & 0x3f) | 0x80;

    const hex = hexOf(id).slice(2);

    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function drawOf(mac: Mac, seed: Uint8Array, rev: number, index: number, sides: number, domain?: readonly string[])
{
    if (!Number.isSafeInteger(sides) || sides > SPAN)
    {
        throw new RangeError('Random range is outside the supported bounds.');
    }

    if (sides <= 1)
    {
        return 1;
    }

    const ceiling = SPAN - (SPAN % sides);

    for (let round = 0; ; round += 1)
    {
        const message = domain === undefined ? `${ rev }.${ index }.${ round }` : JSON.stringify([...domain, rev, index, round]);
        const out = mac(seed, text.encode(message));
        const value = new DataView(out.buffer, out.byteOffset, out.byteLength).getUint32(0);

        if (value < ceiling)
        {
            return (value % sides) + 1;
        }
    }
}

export function drawsOf(mac: Mac, seed: Uint8Array, rev: number, match?: { id: string; game: string })
{
    let index = 0;
    const domain = match === undefined ? undefined : ['baziche', 'stake-v2', match.game, match.id];

    const die = (sides: number) =>
    {
        const drawn = drawOf(mac, seed, rev, index, sides, domain);

        index += 1;

        return drawn;
    };

    return {
        die,
        ...(domain === undefined ? {} : { shuffle: <T>(items: readonly T[]) => shuffle(items, (limit) => die(limit) - 1) })
    };
}

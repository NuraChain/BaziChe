import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { bytesOf, hexOf } from '../../../backend/src/domains/match/fair.ts';
import { fromBase64Url, toBase64Url } from './device-id.ts';
import { forget, remember } from './storage.ts';
import type { Eip1193Provider } from './wallet.ts';

/**
 * A guest: an account whose key this browser made and holds, instead of a wallet.
 *
 * The key is an ordinary secp256k1 secret, so a guest signs in exactly as a wallet does - the
 * server's challenge, `personal_sign`, the same recovery - and nothing on the server has a second
 * way in to get wrong. What it cannot do is anything on chain: the provider below signs messages
 * and refuses every transaction and every typed signature, and the session it opens is marked a
 * guest one, which the server keeps off chain on its own (`offChain` in `backend/src/http/auth.ts`).
 *
 * The key lives in this browser only. Losing it loses the account, which is why settings offer it
 * as a file to keep (`sealGuest`) and the sign-in page takes that file back (`openGuest`).
 */

/** What a guest's provider announces itself as, and what the server is told signed in. */
export const GUEST_RDNS = 'app.baziche.guest';

const KEY = 'baziche.guest.key';

const FILE_KIND = 'baziche-guest';

const FILE_VERSION = 1;

/** OWASP's floor for PBKDF2-HMAC-SHA256. A file is opened once; the wait is the point. */
const ITERATIONS = 600_000;

const SECRET_SHAPE = /^0x[0-9a-f]{64}$/;

const GUEST_MARK = Symbol('guest');

export type GuestFailure = 'not-a-file' | 'wrong-password';

export class GuestFileError extends Error
{
    public readonly why: GuestFailure;

    constructor(why: GuestFailure)
    {
        super(why);
        this.why = why;
    }
}

const isSecret = (value: unknown): value is string => typeof value === 'string' && SECRET_SHAPE.test(value) && secp256k1.utils.isValidSecretKey(bytesOf(value));

export function guestAddress(secret: string)
{
    const point = secp256k1.getPublicKey(bytesOf(secret), false);

    return hexOf(keccak_256(point.slice(1)).slice(-20));
}

/** The key this browser holds for its guest, if it has one. */
export function heldGuest(): string | null
{
    try
    {
        const held = localStorage.getItem(KEY);

        return isSecret(held) ? held : null;
    }
    catch
    {
        return null;
    }
}

/** The key this browser holds, made the first time it is asked for. Null where nothing can be kept. */
export function guestKey(): string | null
{
    const held = heldGuest();

    if (held !== null)
    {
        return held;
    }

    const minted = hexOf(secp256k1.utils.randomSecretKey());

    return remember(KEY, minted) ? minted : null;
}

export function keepGuest(secret: string)
{
    return remember(KEY, secret);
}

export function forgetGuest()
{
    forget(KEY);
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** EIP-191 `personal_sign`: what every wallet signs, so the server's `verifyMessage` reads it unchanged. */
export function signAsGuest(secret: string, message: string)
{
    const body = message.startsWith('0x') && /^0x([0-9a-fA-F]{2})*$/.test(message) ? bytesOf(message) : utf8(message);
    const prefix = utf8(`\x19Ethereum Signed Message:\n${ body.length }`);
    const joined = new Uint8Array(prefix.length + body.length);

    joined.set(prefix);
    joined.set(body, prefix.length);

    const signature = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(joined), bytesOf(secret), { prehash: false, format: 'recovered' }), 'recovered');
    const out = new Uint8Array(65);

    out.set(signature.toBytes('compact'));
    out[64] = 27 + (signature.recovery ?? 0);

    return hexOf(out);
}

/** EIP-1193's "this provider does not do that", which `failureOf` reads as a plain refusal. */
const unsupported = (method: string) => Object.assign(new Error(`A guest account is offline from the blockchain: ${ method } is not available.`), { code: 4200 });

/**
 * A provider for the guest key, with everything a wallet does on chain taken out.
 *
 * It answers just enough for `wallet.store.ts` to sign in with it and sign the device messages
 * that follow, and nothing that would move a coin or prove a stake: those are refused here, and the
 * server refuses them again for the session whatever a browser sends.
 */
export function guestProvider(secret: string): Eip1193Provider
{
    const address = guestAddress(secret);

    const provider: Eip1193Provider = {
        async request({ method, params })
        {
            switch (method)
            {
                case 'eth_requestAccounts':
                case 'eth_accounts':
                    return [address];
                case 'eth_chainId':
                    return '0x0';
                case 'personal_sign':
                {
                    const [message, signer] = (params ?? []) as [unknown, unknown];

                    if (typeof message !== 'string' || typeof signer !== 'string' || signer.toLowerCase() !== address)
                    {
                        throw Object.assign(new Error('That is not this guest’s address.'), { code: 4100 });
                    }
                    return signAsGuest(secret, message);
                }
                case 'wallet_getPermissions':
                    return [{ parentCapability: 'eth_accounts' }];
                default:
                    throw unsupported(method);
            }
        }
    };

    return Object.assign(provider, { [GUEST_MARK]: true });
}

/** Whether a provider is a guest's, which the wallet store tells apart from any extension's. */
export function isGuestProvider(provider: Eip1193Provider | null)
{
    return provider !== null && Reflect.get(provider, GUEST_MARK) === true;
}

interface GuestFile
{
    kind: typeof FILE_KIND;
    version: typeof FILE_VERSION;
    address: string;
    kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
    cipher: { name: 'AES-GCM'; iv: string; data: string };
}

const aesKey = async (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) =>
{
    const base = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);

    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

/**
 * The guest key as a file, locked with a password.
 *
 * The address travels in the clear so a person with three files can tell them apart, and it is
 * also the additional data of the seal: a file whose address was edited does not open.
 */
export async function sealGuest(secret: string, password: string)
{
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const address = guestAddress(secret);
    const key = await aesKey(password, salt, ITERATIONS);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(address) }, key, bytesOf(secret)));

    const file: GuestFile = {
        kind: FILE_KIND,
        version: FILE_VERSION,
        address,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64Url(salt) },
        cipher: { name: 'AES-GCM', iv: toBase64Url(iv), data: toBase64Url(data) }
    };

    return JSON.stringify(file, null, 2);
}

const fileOf = (text: string) =>
{
    let parsed: unknown;

    try
    {
        parsed = JSON.parse(text);
    }
    catch
    {
        throw new GuestFileError('not-a-file');
    }

    const file = parsed as Partial<GuestFile> | null;
    const iterations = file?.kdf?.iterations;

    if (
        file?.kind !== FILE_KIND || file.version !== FILE_VERSION || typeof file.address !== 'string'
        || typeof file.kdf?.salt !== 'string' || typeof iterations !== 'number' || !Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 10_000_000
        || typeof file.cipher?.iv !== 'string' || typeof file.cipher.data !== 'string'
    )
    {
        throw new GuestFileError('not-a-file');
    }

    return file as GuestFile;
};

/** The address a file holds, without its password, to show before asking for one. */
export function guestFileAddress(text: string)
{
    try
    {
        return fileOf(text).address;
    }
    catch
    {
        return null;
    }
}

/** The key inside a file `sealGuest` wrote. Throws `GuestFileError` for anything else. */
export async function openGuest(text: string, password: string)
{
    const file = fileOf(text);

    let opened: Uint8Array;

    try
    {
        const key = await aesKey(password, fromBase64Url(file.kdf.salt) as Uint8Array<ArrayBuffer>, file.kdf.iterations);

        opened = new Uint8Array(await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64Url(file.cipher.iv) as Uint8Array<ArrayBuffer>, additionalData: utf8(file.address) },
            key,
            fromBase64Url(file.cipher.data) as Uint8Array<ArrayBuffer>
        ));
    }
    catch
    {
        throw new GuestFileError('wrong-password');
    }

    const secret = hexOf(opened);

    if (!isSecret(secret) || guestAddress(secret) !== file.address.toLowerCase())
    {
        throw new GuestFileError('not-a-file');
    }

    return secret;
}

/** A file name a person can find again: the product, the word guest, and the address's end. */
export function guestFileName(secret: string)
{
    return `baziche-guest-${ guestAddress(secret).slice(-6) }.json`;
}

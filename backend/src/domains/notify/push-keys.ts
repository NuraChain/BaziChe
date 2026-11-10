import { generateKeyPairSync } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { Setting } from '../../entities/setting.entity.ts';
import type { VapidKeys } from './push.ts';

const KEYS_KEY = 'push-keys';

/** The two halves of a VAPID pair, as the browser and `push.ts` want them: base64url, uncompressed point and raw scalar. */
export function makePushKeys(): Pick<VapidKeys, 'publicKey' | 'privateKey'>
{
    const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });

    return {
        publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url'),
        privateKey: jwk.d!
    };
}

const parsed = (value: string) =>
{
    try
    {
        const held = JSON.parse(value) as { publicKey?: unknown; privateKey?: unknown };

        return typeof held.publicKey === 'string' && typeof held.privateKey === 'string' ? { publicKey: held.publicKey, privateKey: held.privateKey } : null;
    }
    catch
    {
        return null;
    }
};

/**
 * The push service's own say on who is sending. It takes a `mailto:` or an https address, and the
 * site's address is the honest one; a server on plain http, which is only ever a developer's, says
 * so with an address nobody is asked to write.
 */
export const subjectOf = (origin: string) => (origin.startsWith('https://') ? origin : 'mailto:push@localhost');

/**
 * The server's push keys, made the first time they are asked for and kept in the database, so
 * nobody has to write any into `.env` and every server behind the same database signs alike.
 *
 * Two servers starting at once may both make a pair: the first insert wins, and both read back
 * the one that was kept, so no browser is ever subscribed to a key that is thrown away.
 */
export async function pushKeys(db: DataSource, origin: string): Promise<VapidKeys>
{
    const read = async () =>
    {
        const held = await db.getRepository(Setting).findOneBy({ key: KEYS_KEY });

        return held === null ? null : parsed(held.value);
    };

    const kept = await read() ?? await (async () =>
    {
        await db.query(`insert into settings (key, value) values ($1, $2) on conflict (key) do nothing`, [KEYS_KEY, JSON.stringify(makePushKeys())]);

        return await read();
    })();

    if (kept === null)
    {
        throw new Error('The push keys could not be kept.');
    }

    return { ...kept, subject: subjectOf(origin) };
}

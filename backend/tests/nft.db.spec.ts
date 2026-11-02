import 'reflect-metadata';

import type { Address, Hex } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { tokenIdOf, type NftChain, type Sent } from '../src/chain/minting.ts';
import type { Mined } from '../src/chain/vault.ts';
import { RUNGS } from '../src/domains/achieve/families.ts';
import { createNftService, LEGENDARY } from '../src/domains/nft/service.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { OwnedItem, User, entities } from '../src/entities/index.ts';
import { rowsOf } from '../src/lib/rows.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const OLD_WALLET = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const NEW_WALLET = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;

const NORMAL = RUNGS.find((rung) => rung.rarity === 'normal')!.id;

/**
 * The mirror against a real database: what is owed is written from `owned_items` and the legendary
 * rows of `user_achievements` alone, once, to the wallet last signed in with; a look taken back is
 * owed a burn unless its mint is still waiting on a receipt; and a pass against a chain that answers
 * as told moves a token from owed to minted.
 */

interface World
{
    held: Set<string>;
    mined: Mined;
    sent: string[];
}

const chainOf = (w: World): NftChain =>
{
    const send = (call: string): Promise<Sent> =>
    {
        w.sent.push(call);
        return Promise.resolve({ ok: true, hash: HASH });
    };

    return {
        configured: true,
        chainId: 31337,
        looks: NEW_WALLET as Address,
        achievements: NEW_WALLET as Address,
        holdsLook: (_owner, id) => Promise.resolve(w.held.has(id)),
        earned: () => Promise.resolve(false),
        defined: () => Promise.resolve(true),
        mintLooks: () => send('mintLooks'),
        burnLook: () => send('burnLook'),
        define: () => send('define'),
        award: () => send('award'),
        mined: () => Promise.resolve(w.mined)
    };
};

let db: DataSource;
let seq = 0;

const person = async () =>
{
    seq += 1;
    const made = await db.getRepository(User).save({ handle: `n${ seq }x${ Math.floor(Math.random() * 100000) }`, displayName: `Person ${ seq }`, hue: seq % 360, kind: 'wallet' });

    await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now() - interval '1 day')`, [made.id, OLD_WALLET]);
    await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`, [made.id, NEW_WALLET]);

    return made.id;
};

const tokens = async () => rowsOf<{ collection: string; key: string; address: string; state: string; token_id: string; hash: string | null }>(
    await db.query('select collection, key, address, state, token_id, hash from nft_tokens order by collection, key')
);

describe.skipIf(!active)('the NFT mirror, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query('truncate table users cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate table users cascade');
    });

    it('owes a token for every look owned and every legendary achievement, once, to the wallet last signed in with', async () =>
    {
        const owner = await person();
        const mirror = createNftService(db, chainOf({ held: new Set(), mined: 'pending', sent: [] }));

        await db.getRepository(OwnedItem).insert({ userId: owner, itemId: 'dice.shiraz', via: 'purchase' });
        await db.query('insert into user_achievements (user_id, achievement_id) values ($1, $2), ($1, $3)', [owner, LEGENDARY[0], NORMAL]);

        expect(await mirror.reconcile()).toBe(2);
        expect(await mirror.reconcile(), 'owed once').toBe(0);

        expect(await tokens()).toEqual([
            { collection: 'achievement', key: LEGENDARY[0], address: NEW_WALLET, state: 'minting', token_id: tokenIdOf(LEGENDARY[0]), hash: null },
            { collection: 'look', key: 'dice.shiraz', address: NEW_WALLET, state: 'minting', token_id: tokenIdOf('dice.shiraz'), hash: null }
        ]);
    });

    it('owes a burn for a look no longer owned, but leaves a mint waiting on its receipt until it is mined', async () =>
    {
        const owner = await person();
        const mirror = createNftService(db, chainOf({ held: new Set(), mined: 'pending', sent: [] }));

        await db.getRepository(OwnedItem).insert([{ userId: owner, itemId: 'dice.shiraz', via: 'purchase' }, { userId: owner, itemId: 'back.neon', via: 'purchase' }]);
        await mirror.reconcile();
        await db.query(`update nft_tokens set state = 'minted', hash = $1 where key = 'dice.shiraz'`, [HASH]);
        await db.query(`update nft_tokens set hash = $1 where key = 'back.neon'`, [HASH]);

        await db.getRepository(OwnedItem).delete({ userId: owner });
        await mirror.reconcile();

        expect((await tokens()).map((one) => [one.key, one.state])).toEqual([['back.neon', 'minting'], ['dice.shiraz', 'burning']]);
    });

    it('mints what is owed on a pass and calls it minted once its receipt says so', async () =>
    {
        const owner = await person();
        const w: World = { held: new Set(), mined: 'pending', sent: [] };
        const mirror = createNftService(db, chainOf(w));

        await db.getRepository(OwnedItem).insert({ userId: owner, itemId: 'dice.shiraz', via: 'purchase' });

        expect((await mirror.pass()).sent).toBe(1);
        expect(w.sent).toEqual(['mintLooks']);
        expect((await tokens())[0]).toMatchObject({ state: 'minting', hash: HASH });

        w.mined = 'success';
        expect((await mirror.pass()).minted).toBe(1);
        expect(await mirror.of(owner)).toEqual([{ collection: 'look', key: 'dice.shiraz', state: 'minted', hash: HASH }]);
    });

    it('keeps a token the account is gone from, so a look still owed a burn is burned', async () =>
    {
        const owner = await person();
        const mirror = createNftService(db, chainOf({ held: new Set([tokenIdOf('dice.shiraz')]), mined: 'pending', sent: [] }));

        await db.getRepository(OwnedItem).insert({ userId: owner, itemId: 'dice.shiraz', via: 'purchase' });
        await mirror.reconcile();
        await db.query(`update nft_tokens set state = 'minted', hash = $1`, [HASH]);

        await db.query('delete from users where id = $1', [owner]);
        await mirror.reconcile();

        expect((await tokens()).map((one) => [one.key, one.state, one.address])).toEqual([['dice.shiraz', 'burning', NEW_WALLET]]);
    });
});

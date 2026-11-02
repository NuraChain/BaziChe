import type { Address, Hex } from 'viem';
import type { DataSource } from 'typeorm';

import { tokenIdOf, type NftChain } from '../../chain/minting.ts';
import { rowsOf } from '../../lib/rows.ts';
import { RUNGS } from '../achieve/families.ts';
import { NFT_BATCH_MOST, NFT_SENDS_PER_PASS, type NftCollection, type NftState } from './rules.ts';
import { awardAchievement, burnLook, mintLooks, settleSent, type Change, type TokenRow } from './steps.ts';

/** The achievements minted: the legendary rungs, the top tenth of every ladder (`rarityAt`). */
export const LEGENDARY: readonly string[] = RUNGS.filter((rung) => rung.rarity === 'legendary').map((rung) => rung.id);

/** How many owed tokens one reconcile writes at most, so a backfill is spread over passes. */
const OWED_PER_PASS = 200;

/** What one pass did, for the log and the monitor. */
export interface NftSweep
{
    owed: number;
    sent: number;
    minted: number;
    burned: number;
    failed: number;
}

interface Row
{
    id: string;
    collection: NftCollection;
    key: string;
    token_id: Hex;
    address: Address;
    state: NftState;
    hash: Hex | null;
    attempts: number;
    updated_at: Date;
}

const asToken = (row: Row): TokenRow => ({
    id: row.id,
    collection: row.collection,
    key: row.key,
    tokenId: row.token_id,
    address: row.address,
    state: row.state,
    hash: row.hash,
    attempts: row.attempts,
    sentAt: new Date(row.updated_at).getTime()
});

/** The wallet a token goes to: the one its owner last signed in with. */
const LAST_WALLET = (owner: string) => `join lateral (
        select w.address::text as address from wallets w
         where w.user_id = ${ owner }
         order by w.last_used_at desc nulls last, w.created_at desc
         limit 1
    ) wallet on true`;

/**
 * Keeps `nft_tokens` (docs/design/2026-11-02-nft-design.md) true to what people own, and the chain
 * true to it. `reconcile` writes what is owed from the database alone; `pass` asks the chain about
 * a few owed tokens and sends what they need. Nothing here decides what Baziche draws.
 */
export function createNftService(db: DataSource, chain: NftChain)
{
    const apply = async (id: string, change: Change) =>
    {
        const sets: string[] = [];
        const values: unknown[] = [id];

        for (const [column, value] of Object.entries(change))
        {
            values.push(value);
            sets.push(`${ column } = $${ values.length }`);
        }

        if (sets.length > 0)
        {
            await db.query(`update nft_tokens set ${ sets.join(', ') }, updated_at = now() where id = $1`, values);
        }
    };

    /** Writes a row for every look owned and every legendary achievement earned that has no live token, a slice at a time. */
    const owe = async () =>
    {
        const looks = rowsOf<{ user_id: string; key: string; address: string }>(await db.query(
            `select o.user_id, o.item_id as key, wallet.address
               from owned_items o
               ${ LAST_WALLET('o.user_id') }
              where not exists (select 1 from nft_tokens t
                                 where t.collection = 'look' and t.user_id = o.user_id and t.key = o.item_id and t.state <> 'burned')
              order by o.acquired_at
              limit $1`,
            [OWED_PER_PASS]
        ));
        const legends = rowsOf<{ user_id: string; key: string; address: string }>(await db.query(
            `select ua.user_id, ua.achievement_id as key, wallet.address
               from user_achievements ua
               ${ LAST_WALLET('ua.user_id') }
              where ua.achievement_id = any($2::text[])
                and not exists (select 1 from nft_tokens t
                                 where t.collection = 'achievement' and t.user_id = ua.user_id and t.key = ua.achievement_id and t.state <> 'burned')
              order by ua.earned_at
              limit $1`,
            [OWED_PER_PASS, LEGENDARY]
        ));

        const owed = [
            ...looks.map((one) => ({ ...one, collection: 'look' as const })),
            ...legends.map((one) => ({ ...one, collection: 'achievement' as const }))
        ];

        for (const one of owed)
        {
            await db.query(
                `insert into nft_tokens (collection, user_id, key, token_id, address)
                 values ($1, $2, $3, $4, lower($5))
                 on conflict (collection, user_id, key) where state <> 'burned' do nothing`,
                [one.collection, one.user_id, one.key, tokenIdOf(one.key), one.address]
            );
        }

        return owed.length;
    };

    /**
     * A look no longer owned, its token owed a burn; one owned again before its burn was sent, kept.
     * A mint waiting on its receipt is left until it is mined, so a receipt can never turn a burn
     * into a `minted`. Achievements are never burned.
     */
    const disown = async () =>
    {
        const gone = `not exists (select 1 from owned_items o where o.user_id = t.user_id and o.item_id = t.key)`;

        await db.query(
            `update nft_tokens t set state = 'burning', attempts = 0, failure = null, updated_at = now()
              where t.collection = 'look'
                and (t.state = 'minted' or (t.state = 'minting' and t.hash is null))
                and ${ gone }`
        );
        await db.query(
            `update nft_tokens t set state = 'minted', updated_at = now()
              where t.collection = 'look' and t.state = 'burning' and t.hash is null
                and not ${ gone }`
        );
    };

    /** What the database says is owed; no chain is asked. */
    const reconcile = async () =>
    {
        const owed = await owe();
        await disown();
        return owed;
    };

    return {
        configured: chain.configured,

        reconcile,

        /** A few owed tokens asked of the chain and sent what they need: receipts first, then mints, burns and awards. */
        async pass()
        {
            const sweep: NftSweep = { owed: 0, sent: 0, minted: 0, burned: 0, failed: 0 };
            const counted = (change: Change | null) =>
            {
                if (change?.state === 'minted')
                {
                    sweep.minted += 1;
                }
                else if (change?.state === 'burned')
                {
                    sweep.burned += 1;
                }
                else if (change?.state === 'failed')
                {
                    sweep.failed += 1;
                }
            };

            if (!chain.configured)
            {
                return sweep;
            }

            sweep.owed = await reconcile();

            const waiting = rowsOf<Row>(await db.query(
                `select id, collection, key, token_id, address, state, hash, attempts, updated_at from nft_tokens
                  where state in ('minting', 'burning') and hash is not null
                  order by updated_at limit 50`
            )).map(asToken);

            for (const row of waiting)
            {
                const change = await settleSent(row, chain);

                if (change !== null)
                {
                    await apply(row.id, change);
                    counted(change);
                }
            }

            const owed = rowsOf<Row>(await db.query(
                `select id, collection, key, token_id, address, state, hash, attempts, updated_at from nft_tokens
                  where state in ('minting', 'burning') and hash is null
                  order by updated_at limit 100`
            )).map(asToken);

            const mints = new Map<string, TokenRow[]>();

            for (const row of owed)
            {
                if (sweep.sent >= NFT_SENDS_PER_PASS)
                {
                    break;
                }

                if (row.collection === 'look' && row.state === 'minting')
                {
                    const batch = mints.get(row.address) ?? [];

                    if (batch.length < NFT_BATCH_MOST)
                    {
                        batch.push(row);
                        mints.set(row.address, batch);
                    }
                    continue;
                }

                const done = row.collection === 'look' ? await burnLook(row, chain) : await awardAchievement(row, chain);

                if (done.change !== null)
                {
                    await apply(row.id, done.change);
                    counted(done.change);
                }
                sweep.sent += done.sent ? 1 : 0;
            }

            for (const batch of mints.values())
            {
                if (sweep.sent >= NFT_SENDS_PER_PASS)
                {
                    break;
                }

                const done = await mintLooks(batch, chain);

                for (const [id, change] of done.changes)
                {
                    await apply(id, change);
                    counted(change);
                }
                sweep.sent += done.sent ? 1 : 0;
            }

            return sweep;
        },
    };
}

export type NftService = ReturnType<typeof createNftService>;

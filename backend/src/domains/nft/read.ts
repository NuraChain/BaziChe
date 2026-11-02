import type { DataSource, EntityManager } from 'typeorm';

import { rowsOf } from '../../lib/rows.ts';
import type { NftCollection, NftState } from './rules.ts';

/** What a page says of one thing a person owns on the chain: on its way, or there, with the transaction that put it there. */
export interface NftMark
{
    state: 'minting' | 'minted';
    hash?: string;
}

/**
 * A person's tokens in one collection that are minted or on their way, by key. A token put aside
 * (`failed`) or taken back says nothing on the page: the look or the achievement is drawn as it
 * always was, and only the staff need to know a token is stuck.
 */
export async function nftsOf(runner: DataSource | EntityManager, userId: string, collection: NftCollection): Promise<Map<string, NftMark>>
{
    const rows = rowsOf<{ key: string; state: NftState; hash: string | null }>(await runner.query(
        `select key, state, hash from nft_tokens where user_id = $1 and collection = $2 and state in ('minting', 'minted')`,
        [userId, collection]
    ));

    return new Map(rows.map((row) => [row.key, row.state === 'minted'
        ? { state: 'minted' as const, ...(row.hash === null ? {} : { hash: row.hash }) }
        : { state: 'minting' as const }]));
}

/**
 * The marks as anybody else may see them: on NuraChain or on its way, without the transaction. A
 * transaction's page names the wallet it went to, and a person's wallet is not something their
 * profile shows a stranger, a minor's least of all; so a profile says "On NuraChain" and links
 * nowhere, and only the owner's own collection links to the chain.
 */
export const unlinked = (marks: ReadonlyMap<string, NftMark>) =>
    new Map([...marks].map(([key, mark]): [string, NftMark] => [key, { state: mark.state }]));

/** A mark the wire carries only when there is one. */
export const markOf = (marks: ReadonlyMap<string, NftMark>, key: string) =>
{
    const mark = marks.get(key);

    return mark === undefined ? {} : { nft: mark };
};

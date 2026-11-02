import type { Address, Hex } from 'viem';

import type { NftChain, Sent } from '../../chain/minting.ts';
import { NFT_ATTEMPTS_MOST, type NftCollection, type NftState } from './rules.ts';

/**
 * What the NFT worker does with each token, given what the chain says, and nothing about where the
 * rows live: `service.ts` reads and writes them, this decides. Every step reads the chain before it
 * sends, so a pass that died between a send and its hash being written sends nothing twice.
 */

export interface TokenRow
{
    id: string;
    collection: NftCollection;
    key: string;
    tokenId: Hex;
    address: Address;
    state: NftState;
    hash: Hex | null;
    attempts: number;
}

/** What one step changes on a token's row; nothing for a step that is still waiting. */
export interface Change
{
    state?: NftState;
    hash?: Hex | null;
    attempts?: number;
    failure?: string | null;
}

/**
 * The chain refused because the minter key holds no MINTER_ROLE: a setup step the owner has not
 * taken, not anything wrong with a token. The pass stops and no token is counted against.
 */
export class MinterNotGranted extends Error
{
    override readonly name = 'MinterNotGranted';
}

/** Refusals no retry will change: the token is put aside with its reason. */
const FOR_GOOD: ReadonlySet<string> = new Set(['ERC1155InvalidReceiver', 'ZeroAddress', 'Soulbound']);

/** A refusal counted against the token: tried again until it has been tried enough, then put aside. */
const refused = (row: TokenRow, refusal: string): Change =>
{
    if (refusal === 'AccessControlUnauthorizedAccount')
    {
        throw new MinterNotGranted('The minter key holds no MINTER_ROLE on the NFT contracts.');
    }

    const attempts = row.attempts + 1;

    return {
        attempts,
        failure: refusal,
        ...(FOR_GOOD.has(refusal) || attempts >= NFT_ATTEMPTS_MOST ? { state: 'failed' as const } : {})
    };
};

const sentAs = (sent: Extract<Sent, { ok: true }>): Change => ({ hash: sent.hash, failure: null });

/**
 * A token whose transaction was sent: done once its receipt says so, sent again if it reverted.
 * A burn's receipt makes it `burned`, a mint's `minted`; the hash stays, for the explorer link.
 */
export async function settleSent(row: TokenRow, chain: NftChain): Promise<Change | null>
{
    if (row.hash === null)
    {
        return null;
    }

    const mined = await chain.mined(row.hash);

    if (mined === 'pending')
    {
        return null;
    }

    if (mined === 'success')
    {
        return { state: row.state === 'burning' ? 'burned' : 'minted', failure: null };
    }

    return { ...refused(row, 'reverted'), hash: null };
}

/**
 * Looks owed to one wallet, minted in one transaction: those it already holds are marked minted
 * with nothing sent (a send before a crash that was never written down), the rest go in one
 * `mintBatch`. Answers each row's change by id, and whether a transaction was sent.
 */
export async function mintLooks(rows: readonly TokenRow[], chain: NftChain): Promise<{ changes: Map<string, Change>; sent: boolean }>
{
    const changes = new Map<string, Change>();
    const owed: TokenRow[] = [];

    for (const row of rows)
    {
        if (await chain.holdsLook(row.address, row.tokenId))
        {
            changes.set(row.id, { state: 'minted', failure: null });
        }
        else
        {
            owed.push(row);
        }
    }

    if (owed.length === 0)
    {
        return { changes, sent: false };
    }

    const sent = await chain.mintLooks(owed[0].address, owed.map((row) => row.tokenId));

    for (const row of owed)
    {
        changes.set(row.id, sent.ok ? sentAs(sent) : refused(row, sent.refusal));
    }

    return { changes, sent: sent.ok };
}

/** A look no longer its owner's: burned, unless the wallet holds none of it, which is the burn already done. */
export async function burnLook(row: TokenRow, chain: NftChain): Promise<{ change: Change; sent: boolean }>
{
    if (!await chain.holdsLook(row.address, row.tokenId))
    {
        return { change: { state: 'burned', failure: null }, sent: false };
    }

    const sent = await chain.burnLook(row.address, row.tokenId);

    if (sent.ok)
    {
        return { change: sentAs(sent), sent: true };
    }

    return { change: sent.refusal === 'NotHeld' ? { state: 'burned', failure: null } : refused(row, sent.refusal), sent: false };
}

/**
 * A legendary achievement owed to its earner: minted already if the contract says it was earned;
 * defined first if nobody has earned it before, and awarded on a later pass once the definition is
 * mined (`UnknownAchievement` until then is waiting, not failing).
 */
export async function awardAchievement(row: TokenRow, chain: NftChain): Promise<{ change: Change | null; sent: boolean }>
{
    if (await chain.earned(row.address, row.tokenId))
    {
        return { change: { state: 'minted', failure: null }, sent: false };
    }

    if (!await chain.defined(row.tokenId))
    {
        const defined = await chain.define(row.key);

        if (defined.ok || defined.refusal === 'AchievementLocked')
        {
            return { change: null, sent: defined.ok };
        }

        return { change: refused(row, defined.refusal), sent: false };
    }

    const sent = await chain.award(row.address, row.tokenId);

    if (sent.ok)
    {
        return { change: sentAs(sent), sent: true };
    }

    if (sent.refusal === 'AlreadyEarned')
    {
        return { change: { state: 'minted', failure: null }, sent: false };
    }

    return { change: sent.refusal === 'UnknownAchievement' ? null : refused(row, sent.refusal), sent: false };
}

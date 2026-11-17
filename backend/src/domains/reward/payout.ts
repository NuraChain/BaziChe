import { HttpError } from '@azerothjs/http';
import { In, type DataSource, type EntityManager } from 'typeorm';
import { getAddress, type Address, type Hex } from 'viem';

import { REWARD_TRANSFER_GAS, type RewardWallet } from '../../chain/rewards.ts';
import type { Mined } from '../../chain/vault.ts';
import { RewardPayout } from '../../entities/reward-payout.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { Wallet } from '../../entities/wallet.entity.ts';
import { keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import { audited, AUDIT_PAGE, nothing, type Audit, type AuditAsk } from '../reconcile/audit.ts';
import { rewardsFrozen } from './freeze.ts';
import { REWARD_WITHDRAWAL_MINIMUM } from './payout-rules.ts';
import { REWARD_REFUSALS, type RewardRefusal } from './refusals.ts';

export { REWARD_WITHDRAWAL_MINIMUM };

export const REWARD_PAYOUT_ATTEMPTS = 5;
export const REWARD_PAYOUT_BATCH = 25;

const WEI = 10n ** 18n;

/** Decision 7 in reward.md: the rewards wallet keeps 1,000 NURA for gas that no payout may spend. */
export const REWARD_GAS_RESERVE = 1_000n * WEI;

/**
 * How long a sent payout whose nonce a mined block has used, with no receipt for its own hash,
 * waits before it is taken as replaced. A load-balanced node can answer the nonce from a newer
 * block than the receipt; sending again on that lag alone would pay twice. The wait runs from when
 * this process first saw the nonce used with no receipt, not from signing: a transfer broadcast
 * late or slow to mine would otherwise be one lagging receipt read away from a second payment.
 */
export const REWARD_REPLACED_AFTER_MS = 10 * 60_000;

export interface RewardPayoutSweep
{
    mined: number;
    retried: number;
    failed: number;
    faults: { payout: string; error: string }[];
}

export const transferFee = (gasPrice: bigint) => gasPrice * REWARD_TRANSFER_GAS;

/**
 * Whether one more payout can go out and still leave the gas reserve. What is already sent counts
 * as spent even when its block has already taken it, so this can only err towards waiting.
 */
export function affordable(held: bigint, inFlight: bigint, amount: bigint, fee: bigint)
{
    return held - inFlight - amount - fee >= REWARD_GAS_RESERVE;
}

/** What the wallet must hold to pay every open payout; the reconcile flag and the sweep agree on it. */
export function queueNeeds(owed: bigint, payouts: number, fee: bigint)
{
    return owed + fee * BigInt(payouts) + REWARD_GAS_RESERVE;
}

/** A nonce the chain has not used and no payout row has been signed with. */
export function nextNonce(pending: number, highestSigned: number | null)
{
    return Math.max(pending, highestSigned === null ? 0 : highestSigned + 1);
}

export interface SentSeen
{
    receipt: Mined;
    attempts: number;
    nonce: number | null;
    /** The 'latest' transaction count, read before the receipt; null when it was not read. */
    used: number | null;
    /** When this process first saw the nonce used with no receipt; null when it has not. */
    usedSince: number | null;
}

export type PayoutStep = 'mine' | 'retry' | 'fail' | 'broadcast';

/** Whether a nonce a mined block used is now answered without a receipt for this payout's own hash. */
export const nonceTaken = (seen: Omit<SentSeen, 'attempts' | 'usedSince'>) =>
    seen.receipt === 'pending' && seen.nonce !== null && seen.used !== null && seen.used > seen.nonce;

/** Whether a sent payout's nonce went to some other transaction, so its own bytes can never mine. */
export function replaced(seen: SentSeen, now: number)
{
    return nonceTaken(seen)
        && seen.usedSince !== null
        && now - seen.usedSince >= REWARD_REPLACED_AFTER_MS;
}

/** Whether a sent payout's nonce is old enough that the 'latest' count is worth reading for it. */
export const worthCounting = (sentAt: Date | null, now: number) => sentAt !== null && now - sentAt.getTime() >= REWARD_REPLACED_AFTER_MS;

/** What to do with a sent payout, from what the chain says about it. */
export function payoutStep(seen: SentSeen, now: number): PayoutStep
{
    if (seen.receipt === 'success')
    {
        return 'mine';
    }

    if (seen.receipt === 'reverted' || replaced(seen, now))
    {
        return seen.attempts < REWARD_PAYOUT_ATTEMPTS ? 'retry' : 'fail';
    }

    return 'broadcast';
}

export interface PayoutFacts
{
    minor: boolean;
    suspended: boolean;
    frozen: boolean;
}

/** Why this player's NURA may not leave the wallet now: asked when a withdrawal is queued and again when it is signed. */
export function payoutHold(facts: PayoutFacts): RewardRefusal | undefined
{
    if (facts.minor)
    {
        return 'reward-minor';
    }

    if (facts.suspended)
    {
        return 'reward-suspended';
    }

    return facts.frozen ? 'reward-frozen' : undefined;
}

const HOLD_WORDS: Partial<Record<RewardRefusal, string>> = {
    'reward-minor': 'Only adults can withdraw NURA rewards.',
    'reward-suspended': 'A suspended account cannot withdraw rewards.',
    'reward-frozen': 'These rewards are frozen while the staff look into them.'
};

const BALANCE_SQL = `
    select greatest(
        0,
        coalesce((select sum(g.amount) from reward_grants g where g.user_id = $1), 0)
        - coalesce((select sum(p.amount) from reward_payouts p where p.user_id = $1 and p.state in ('queued', 'sent', 'mined')), 0)
    )::text as balance
`;

const refusal = (word: RewardRefusal, message: string) => new HttpError(REWARD_REFUSALS[word], message, { code: word });

const balanceOf = async (from: DataSource | EntityManager, userId: string) =>
{
    const [row] = await from.query(BALANCE_SQL, [userId]) as [{ balance: string }];
    return BigInt(row?.balance ?? '0');
};

export function createRewardPayoutService(db: DataSource, wallet: RewardWallet, hooks: { mined?(userId: string): void } = {})
{
    const withdrawable = async (userId: string) => (await balanceOf(db, userId)).toString();

    // Payout id to when this process first saw its nonce used with no receipt. A restart forgets
    // it, which only makes a replaced payout wait the full time again, never retry sooner.
    const usedSeen = new Map<string, number>();

    const withdraw = async (userId: string) =>
    {
        if (!wallet.configured)
        {
            throw refusal('reward-wallet', 'Rewards withdrawals are not available because the rewards wallet is not configured.');
        }

        return await db.transaction(async (tx) =>
        {
            // NO KEY UPDATE, not UPDATE: every insert that references the player takes a key-share
            // lock on this row, and the match recorder must not wait on a withdrawal.
            const user = await tx.getRepository(User).createQueryBuilder('user')
                .select(['user.id', 'user.isMinor', 'user.isSuspended'])
                .setLock('for_no_key_update')
                .where('user.id = :userId', { userId })
                .getOne();

            if (user === null)
            {
                throw new HttpError(404, 'No such player.', { code: 'reward-missing' });
            }
            // The freeze is read under the player's lock, which a freeze takes too, so one that lands first is seen.
            const held = payoutHold({ minor: user.isMinor, suspended: user.isSuspended, frozen: await rewardsFrozen(tx, userId) });
            if (held !== undefined)
            {
                throw refusal(held, HOLD_WORDS[held] ?? 'These rewards cannot be withdrawn now.');
            }

            const open = await tx.getRepository(RewardPayout).findOne({
                where: { userId, state: In(['queued', 'sent']) },
                order: { createdAt: 'DESC' }
            });

            if (open !== null)
            {
                const nura = Number(BigInt(open.amount) / WEI);
                return { status: 'queued' as const, amount: nura, queued: nura };
            }

            const address = await tx.getRepository(Wallet).findOne({
                select: { address: true },
                where: { userId },
                order: { lastUsedAt: { direction: 'DESC', nulls: 'LAST' } }
            });

            if (address === null)
            {
                throw refusal('reward-no-wallet', 'Connect a wallet before withdrawing NURA rewards.');
            }

            const balance = await balanceOf(tx, userId);
            if (balance < BigInt(REWARD_WITHDRAWAL_MINIMUM) * WEI)
            {
                return { status: 'none' as const, amount: 0, queued: 0 };
            }

            await tx.getRepository(RewardPayout).insert({
                userId,
                walletAddress: getAddress(address.address),
                amount: balance.toString(),
                state: 'queued',
                txHash: null,
                rawTransaction: null,
                txNonce: null,
                attempts: 0,
                queuedAt: new Date(),
                sentAt: null,
                minedAt: null,
                failedAt: null
            });

            const nura = Number(balance / WEI);
            return { status: 'queued' as const, amount: nura, queued: nura };
        });
    };

    /**
     * Signs a queued payout and saves the hash and bytes before anything is broadcast, so a crash
     * at any later line leaves a row that is only ever sent again as those same bytes. The lock
     * makes every signer in every process take nonces and spend the balance one at a time.
     */
    const sign = async (id: string, from: Address) => db.transaction(async (tx) =>
    {
        await tx.query(`select pg_advisory_xact_lock(hashtext('reward-wallet-nonce'))`);

        const payout = await tx.getRepository(RewardPayout).createQueryBuilder('payout')
            .setLock('pessimistic_write')
            .where('payout.id = :id and payout.state = :state', { id, state: 'queued' })
            .getOne();

        if (payout === null)
        {
            return null;
        }

        // Asked again here, not only when queued: a freeze or suspension that came after the
        // withdrawal keeps the payout queued until it is lifted. SHARE waits for a freeze under way.
        const [facts] = await tx.query(
            `select u.is_minor as minor,
                    u.is_suspended as suspended,
                    exists (select 1 from reward_freezes f where f.user_id = u.id) as frozen
             from users u
             where u.id = $1
             for share of u`,
            [payout.userId]
        ) as PayoutFacts[];

        if (facts === undefined || payoutHold(facts) !== undefined)
        {
            return 'held' as const;
        }

        const [flight] = await tx.query(
            `select coalesce(sum(amount), 0)::text as amount, count(*)::int as count from reward_payouts where state = 'sent'`
        ) as [{ amount: string; count: number }];
        const gasPrice = await wallet.gasPrice();
        const fee = transferFee(gasPrice);
        const held = await wallet.balanceOf(from);
        const amount = BigInt(payout.amount);

        if (!affordable(held, BigInt(flight.amount) + fee * BigInt(flight.count), amount, fee))
        {
            return 'waiting' as const;
        }

        const [last] = await tx.query(`select max(tx_nonce)::text as nonce from reward_payouts`) as [{ nonce: string | null }];
        const highest = last?.nonce ?? null;
        const nonce = nextNonce(await wallet.transactionCount(from, 'pending'), highest === null ? null : Number(highest));
        const prepared = await wallet.prepareTransfer(payout.walletAddress as Address, amount, nonce, gasPrice);

        await tx.getRepository(RewardPayout).update(
            { id, state: 'queued' },
            { state: 'sent', txHash: prepared.hash, rawTransaction: prepared.raw, txNonce: String(nonce), sentAt: new Date(), attempts: () => 'attempts + 1' }
        );

        return prepared;
    });

    const broadcast = async (raw: string, hash: string) =>
    {
        const sent = await wallet.broadcast(raw as Hex);
        if (sent.toLowerCase() !== hash.toLowerCase())
        {
            throw new Error('The chain returned a different hash for the persisted rewards transaction.');
        }
    };

    const settle = async (payout: RewardPayout, from: Address, tally: RewardPayoutSweep) =>
    {
        if (payout.txHash === null)
        {
            return;
        }

        const now = Date.now();
        // Read before the receipt: a nonce used before the receipt was asked for, with no receipt
        // for this hash, was used by another transaction.
        const used = worthCounting(payout.sentAt, now) ? await wallet.transactionCount(from, 'latest') : null;
        const receipt = await wallet.mined(payout.txHash as Hex);
        const seen = { receipt, nonce: payout.txNonce === null ? null : Number(payout.txNonce), used };
        if (nonceTaken(seen))
        {
            if (!usedSeen.has(payout.id))
            {
                usedSeen.set(payout.id, now);
            }
        }
        else
        {
            usedSeen.delete(payout.id);
        }

        const step = payoutStep({ ...seen, attempts: payout.attempts, usedSince: usedSeen.get(payout.id) ?? null }, now);
        const sent = { id: payout.id, state: 'sent' as const, txHash: payout.txHash };
        if (step !== 'broadcast')
        {
            usedSeen.delete(payout.id);
        }

        if (step === 'mine')
        {
            const changed = await db.getRepository(RewardPayout).update(sent, { state: 'mined', minedAt: new Date() });
            if ((changed.affected ?? 0) > 0)
            {
                tally.mined += 1;
                hooks.mined?.(payout.userId);
            }
            return;
        }

        if (step === 'retry')
        {
            await db.getRepository(RewardPayout).update(sent, { state: 'queued', txHash: null, rawTransaction: null, txNonce: null, sentAt: null });
            tally.retried += 1;
            return;
        }

        if (step === 'fail')
        {
            await db.getRepository(RewardPayout).update(sent, { state: 'failed', failedAt: new Date() });
            tally.failed += 1;
            return;
        }

        if (payout.rawTransaction !== null)
        {
            await broadcast(payout.rawTransaction, payout.txHash);
        }
    };

    const sweep = async (budgetMs: number): Promise<RewardPayoutSweep> =>
    {
        const tally: RewardPayoutSweep = { mined: 0, retried: 0, failed: 0, faults: [] };
        const from = wallet.address;
        if (!wallet.configured || from === null)
        {
            return tally;
        }

        const began = performance.now();
        // A held player's queued payout is left out of the read, or a ring of frozen accounts at the
        // head of the queue would fill every batch. `sign` asks again under the lock; this only skips.
        const rows = await db.getRepository(RewardPayout).createQueryBuilder('payout')
            .where(`payout.state = 'sent' or (payout.state = 'queued' and not exists (
                select 1 from users u
                where u.id = payout.user_id
                  and (u.is_suspended or u.is_minor or exists (select 1 from reward_freezes f where f.user_id = u.id))
            ))`)
            .orderBy('payout.createdAt', 'ASC')
            .limit(REWARD_PAYOUT_BATCH)
            .getMany();
        // Once the oldest queued payout cannot be paid, newer ones wait behind it, or a stream of
        // small withdrawals would keep a large one waiting for ever.
        let holding = false;

        for (const payout of rows)
        {
            if (performance.now() - began > budgetMs)
            {
                break;
            }

            if (payout.state === 'queued' && holding)
            {
                continue;
            }

            try
            {
                if (payout.state === 'queued')
                {
                    const prepared = await sign(payout.id, from);
                    if (prepared === 'waiting')
                    {
                        holding = true;
                    }
                    else if (prepared !== null && prepared !== 'held')
                    {
                        await broadcast(prepared.raw, prepared.hash);
                    }
                }
                else
                {
                    await settle(payout, from, tally);
                }
            }
            catch (error)
            {
                tally.faults.push({ payout: payout.id, error: error instanceof Error ? error.message : String(error) });
                if ((error as { status?: number }).status === 503)
                {
                    break;
                }
            }
        }

        return tally;
    };

    const audit = async ({ ids, after, deadline }: AuditAsk): Promise<Audit> =>
    {
        if (!wallet.configured || wallet.address === null)
        {
            return nothing();
        }

        const valid = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        // `user` is reserved in Postgres and a property followed by a cast is not escaped by
        // TypeORM, so the alias is `player` and the handle is read through it uncast on the alias.
        const users = db.getRepository(User).createQueryBuilder('player')
            .select('player.id', 'id')
            .addSelect('player.handle::text', 'handle')
            .addSelect(keyOf('player.created_at'), 'at_key');
        const again = valid.length === 0 ? [] : await users.clone().where('player.id = any(:ids::uuid[])', { ids: valid }).getRawMany<AuditUser>();
        const page = users.clone()
            .where(`(exists (select 1 from reward_grants g where g.user_id = player.id)
                 or exists (select 1 from reward_payouts p where p.user_id = player.id))`);
        const from = keysetAfter(after);
        if (from !== null)
        {
            page.andWhere(olderThan('player.created_at', 'player.id'), from);
        }

        const rows = await page.orderBy('player.created_at', 'DESC').addOrderBy('player.id', 'DESC').limit(AUDIT_PAGE + 1).getRawMany<AuditUser>();
        const result = await audited({ again, page: rows, after }, deadline, async (user) =>
        {
            const [sum] = await db.query(
                `select
                    coalesce((select sum(amount) from reward_grants where user_id = $1), 0)::text as granted,
                    coalesce((select sum(amount) from reward_payouts where user_id = $1 and state = 'mined'), 0)::text as mined,
                    coalesce((select sum(amount) from reward_payouts where user_id = $1 and state in ('queued', 'sent')), 0)::text as queued`,
                [user.id]
            ) as [{ granted: string; mined: string; queued: string }];

            const granted = BigInt(sum?.granted ?? '0');
            const mined = BigInt(sum?.mined ?? '0');
            const queued = BigInt(sum?.queued ?? '0');
            const excess = mined + queued - granted;

            return excess > 0n ? [{
                record: user.id,
                kind: 'reward-ledger',
                db: { granted: granted.toString(), mined: mined.toString(), queued: queued.toString() },
                chain: { unaccounted: excess.toString() },
                about: { player: user.handle }
            }] : [];
        });

        if (performance.now() > deadline)
        {
            return result;
        }

        try
        {
            const [queue] = await db.query(
                `select coalesce(sum(amount), 0)::text as owed, count(*)::int as count
                 from reward_payouts where state in ('queued', 'sent')`
            ) as [{ owed: string; count: number }];

            if (BigInt(queue.owed) > 0n)
            {
                const held = await wallet.balanceOf(wallet.address);
                const fee = transferFee(await wallet.gasPrice());
                const needed = queueNeeds(BigInt(queue.owed), queue.count, fee);
                result.compared.push('reward-wallet');
                if (held < needed)
                {
                    result.found.push({
                        record: 'reward-wallet',
                        kind: 'reward-balance',
                        db: { owed: queue.owed, gasReserve: (needed - BigInt(queue.owed)).toString() },
                        chain: { held: held.toString() },
                        about: { payouts: String(queue.count), address: wallet.address }
                    });
                }
            }
        }
        catch (error)
        {
            if ((error as { status?: number }).status === 503)
            {
                result.unreached = true;
            }
            else
            {
                result.faults.push({ record: 'reward-wallet', error: error instanceof Error ? error.message : String(error) });
            }
        }

        return result;
    };

    return { withdraw, withdrawable, sweep, audit };
}

interface AuditUser extends Keyed
{
    handle: string;
}

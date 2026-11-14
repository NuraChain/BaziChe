import { HttpError } from '@azerothjs/http';
import { In, type DataSource, type EntityManager } from 'typeorm';
import { getAddress } from 'viem';

import type { RewardWallet } from '../../chain/rewards.ts';
import { RewardPayout } from '../../entities/reward-payout.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { Wallet } from '../../entities/wallet.entity.ts';
import { keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import { audited, AUDIT_PAGE, nothing, type Audit, type AuditAsk } from '../reconcile/audit.ts';
import { REWARD_REFUSALS, type RewardRefusal } from './refusals.ts';

export const REWARD_WITHDRAWAL_MINIMUM = 1_000;
export const REWARD_PAYOUT_ATTEMPTS = 5;
export const REWARD_PAYOUT_BATCH = 25;

export interface RewardPayoutSweep
{
    mined: number;
    retried: number;
    failed: number;
    faults: { payout: string; error: string }[];
}

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

    const withdraw = async (userId: string) =>
    {
        if (!wallet.configured)
        {
            throw refusal('reward-wallet', 'Rewards withdrawals are not available because the rewards wallet is not configured.');
        }

        return await db.transaction(async (tx) =>
        {
            const user = await tx.getRepository(User).createQueryBuilder('user')
                .setLock('pessimistic_write')
                .where('user.id = :userId', { userId })
                .getOne();

            if (user === null)
            {
                throw new HttpError(404, 'No such player.', { code: 'reward-missing' });
            }
            if (user.isMinor)
            {
                throw refusal('reward-minor', 'Only adults can withdraw NURA rewards.');
            }
            if (user.isSuspended)
            {
                throw refusal('reward-suspended', 'A suspended account cannot withdraw rewards.');
            }

            const open = await tx.getRepository(RewardPayout).findOne({
                where: { userId, state: In(['queued', 'sent']) },
                order: { createdAt: 'DESC' }
            });

            if (open !== null)
            {
                const nura = Number(BigInt(open.amount) / 10n ** 18n);
                return { status: 'queued' as const, amount: nura, queued: nura };
            }

            const address = await tx.getRepository(Wallet).findOne({
                select: { address: true },
                where: { userId },
                order: { lastUsedAt: { direction: 'DESC', nulls: 'LAST' } }
            });

            if (address === null)
            {
                throw refusal('reward-wallet', 'Connect a wallet before withdrawing NURA rewards.');
            }

            const balance = await balanceOf(tx, userId);
            const minimum = BigInt(REWARD_WITHDRAWAL_MINIMUM) * 10n ** 18n;
            if (balance < minimum)
            {
                return { status: 'none' as const, amount: 0, queued: 0 };
            }

            const amount = balance.toString();
            await tx.getRepository(RewardPayout).insert({
                userId,
                walletAddress: getAddress(address.address),
                amount,
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

            const nura = Number(balance / 10n ** 18n);
            return { status: 'queued' as const, amount: nura, queued: nura };
        });
    };

    const queueTransfer = async (id: string) => db.transaction(async (tx) =>
    {
        const [row] = await tx.query(`select pg_advisory_xact_lock(hashtext('reward-wallet-nonce'))`);
        void row;

        const payout = await tx.getRepository(RewardPayout).createQueryBuilder('payout')
            .setLock('pessimistic_write')
            .where('payout.id = :id and payout.state = :state', { id, state: 'queued' })
            .getOne();

        if (payout === null || wallet.address === null)
        {
            return null;
        }

        const chainNonce = await wallet.transactionCount(wallet.address);
        const [last] = await tx.query(`select coalesce(max(tx_nonce), -1)::bigint as nonce from reward_payouts`);
        const nonce = Math.max(chainNonce, Number(last?.nonce ?? -1) + 1);
        const prepared = await wallet.prepareTransfer(payout.walletAddress as `0x${ string }`, BigInt(payout.amount), nonce);

        await tx.getRepository(RewardPayout).update(
            { id, state: 'queued' },
            { state: 'sent', txHash: prepared.hash, rawTransaction: prepared.raw, txNonce: String(nonce), sentAt: new Date(), attempts: () => 'attempts + 1' }
        );

        return { id, hash: prepared.hash, raw: prepared.raw };
    });

    const settle = async (id: string, tally: RewardPayoutSweep) =>
    {
        let payout = await db.getRepository(RewardPayout).findOne({ where: { id } });
        if (payout === null)
        {
            return;
        }

        if (payout.state === 'queued')
        {
            const prepared = await queueTransfer(id);
            if (prepared === null)
            {
                return;
            }
            payout = await db.getRepository(RewardPayout).findOneByOrFail({ id });
        }

        if (payout.state !== 'sent' || payout.txHash === null)
        {
            return;
        }

        const status = await wallet.mined(payout.txHash as `0x${ string }`);
        if (status === 'success')
        {
            const changed = await db.getRepository(RewardPayout).update(
                { id, state: 'sent', txHash: payout.txHash },
                { state: 'mined', minedAt: new Date() }
            );
            if ((changed.affected ?? 0) > 0)
            {
                tally.mined += 1;
                hooks.mined?.(payout.userId);
            }
            return;
        }

        if (status === 'reverted')
        {
            if (payout.attempts < REWARD_PAYOUT_ATTEMPTS)
            {
                await db.getRepository(RewardPayout).update(
                    { id, state: 'sent', txHash: payout.txHash },
                    { state: 'queued', txHash: null, rawTransaction: null, txNonce: null, sentAt: null }
                );
                tally.retried += 1;
            }
            else
            {
                await db.getRepository(RewardPayout).update(
                    { id, state: 'sent', txHash: payout.txHash },
                    { state: 'failed', failedAt: new Date() }
                );
                tally.failed += 1;
            }
            return;
        }

        if (payout.rawTransaction !== null)
        {
            const sent = await wallet.broadcast(payout.rawTransaction as `0x${ string }`);
            if (sent.toLowerCase() !== payout.txHash.toLowerCase())
            {
                throw new Error('The chain returned a different hash for the persisted rewards transaction.');
            }
        }
    };

    const sweep = async (budgetMs: number): Promise<RewardPayoutSweep> =>
    {
        const tally: RewardPayoutSweep = { mined: 0, retried: 0, failed: 0, faults: [] };
        if (!wallet.configured)
        {
            return tally;
        }

        const began = performance.now();
        const rows = await db.getRepository(RewardPayout).find({
            select: { id: true },
            where: { state: In(['queued', 'sent']) },
            order: { createdAt: 'ASC' },
            take: REWARD_PAYOUT_BATCH
        });

        for (const { id } of rows)
        {
            if (performance.now() - began > budgetMs)
            {
                break;
            }

            try
            {
                await settle(id, tally);
            }
            catch (error)
            {
                tally.faults.push({ payout: id, error: error instanceof Error ? error.message : String(error) });
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
        const users = db.getRepository(User).createQueryBuilder('user')
            .select('user.id', 'id')
            .addSelect('"user".handle::text', 'handle')
            .addSelect(keyOf('user.created_at'), 'at_key');
        const again = valid.length === 0 ? [] : await users.clone().where('user.id = any(:ids::uuid[])', { ids: valid }).getRawMany<AuditUser>();
        const page = users.clone()
            .where(`exists (select 1 from reward_grants g where g.user_id = user.id)
                 or exists (select 1 from reward_payouts p where p.user_id = user.id)`);
        const from = keysetAfter(after);
        if (from !== null)
        {
            page.andWhere(olderThan('user.created_at', 'user.id'), from);
        }

        const rows = await page.orderBy('user.created_at', 'DESC').addOrderBy('user.id', 'DESC').limit(AUDIT_PAGE + 1).getRawMany<AuditUser>();
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
                const reserve = await wallet.gasPrice() * 21_000n * BigInt(queue.count);
                result.compared.push('reward-wallet');
                if (held < BigInt(queue.owed) + reserve)
                {
                    result.found.push({
                        record: 'reward-wallet',
                        kind: 'reward-balance',
                        db: { owed: queue.owed, gasReserve: reserve.toString() },
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
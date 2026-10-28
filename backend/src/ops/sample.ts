import type { DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { stuckOf } from '../domains/stake/admin.ts';
import { Discrepancy } from '../entities/discrepancy.entity.ts';
import { Donation } from '../entities/donation.entity.ts';
import { Escrow } from '../entities/escrow.entity.ts';
import { MarketPosition } from '../entities/market-position.entity.ts';
import { Market } from '../entities/market.entity.ts';
import { ShopOrder } from '../entities/shop-order.entity.ts';
import type { Queue } from './measures.ts';
import type { Sampled } from './monitor.ts';

/** The database pool as the driver holds it: open, idle, and callers waiting for one. */
export const poolOf = (db: DataSource) =>
{
    const pool = (db.driver as unknown as { master?: { totalCount: number; idleCount: number; waitingCount: number } }).master;

    return { total: pool?.totalCount ?? 0, idle: pool?.idleCount ?? 0, waiting: pool?.waitingCount ?? 0 };
};

/** Which of the money's features this server runs: a queue or a count of one it does not is never read. */
export interface Sampling
{
    vault: boolean;
    shop: boolean;
    gifts: boolean;
    markets: boolean;
    checks: boolean;
}

/** How many wait on one queue, and how long the oldest has, in whole seconds by Postgres's clock. */
const queued = async <T extends ObjectLiteral>(queue: Queue, query: SelectQueryBuilder<T>, since: string) =>
{
    const row = await query
        .select('count(*)::int', 'count')
        .addSelect(`floor(extract(epoch from now() - min(${ since })))::int`, 'oldest')
        .getRawOne<{ count: number; oldest: number | null }>();

    return { queue, count: row?.count ?? 0, oldest: row?.oldest ?? null };
};

const openChecks = async (db: DataSource) =>
{
    const row = await db.getRepository(Discrepancy).createQueryBuilder('d')
        .select('count(*)::int', 'open')
        .addSelect('floor(extract(epoch from now() - min(d.first_seen)))::int', 'oldest')
        .where('d.resolved_at is null')
        .getRawOne<{ open: number; oldest: number | null }>();

    return { open: row?.open ?? 0, oldest: row?.oldest ?? null };
};

/**
 * What only the database knows of the work this server is behind on, read once a sample: each
 * worker's queue, the paid games stuck by the vault panel's own rule, and the disagreements with
 * NuraChain still open. Nine indexed reads at most, over the rows still in flight, made one after
 * another so that a sample holds one connection of the pool at a time and never takes a request's.
 */
export function createSampler(db: DataSource, running: Sampling)
{
    return async (): Promise<Sampled> =>
    {
        const asks: (() => Promise<Sampled['queues'][number]>)[] = [];

        if (running.markets)
        {
            asks.push(() => queued('positions', db.getRepository(MarketPosition).createQueryBuilder('p').where(`p.state = 'sent'`), 'p.created_at'));
            asks.push(() => queued('claims', db.getRepository(MarketPosition).createQueryBuilder('p').where('p.claim_hash is not null and p.claimed_at is null'), 'p.claim_sent_at'));
        }

        if (running.shop)
        {
            asks.push(() => queued('orders', db.getRepository(ShopOrder).createQueryBuilder('o').where(`o.state = 'sent'`), 'o.sent_at'));
        }

        if (running.gifts)
        {
            asks.push(() => queued('gifts', db.getRepository(Donation).createQueryBuilder('d').where(`d.state = 'sent'`), 'd.sent_at'));
        }

        if (running.vault)
        {
            asks.push(() => queued('locking', db.getRepository(Escrow).createQueryBuilder('e').where(`e.state = 'locking'`), 'e.updated_at'));
            asks.push(() => queued('paying', db.getRepository(Escrow).createQueryBuilder('e').where(`e.state in ('settling', 'refunding')`), 'e.updated_at'));
        }

        if (running.markets)
        {
            asks.push(() => queued(
                'markets',
                db.getRepository(Market).createQueryBuilder('k')
                    .innerJoin('matches', 'm', 'm.id = k.match_id')
                    .where(`k.state in ('open', 'closing')`)
                    .andWhere('m.finished_at is not null and k.closes_at < now()'),
                'greatest(k.closes_at, m.finished_at)'
            ));
        }

        const queues: Sampled['queues'] = [];

        for (const ask of asks)
        {
            queues.push(await ask());
        }

        const stuck = running.vault ? await stuckOf(db) : null;
        const checks = running.checks ? await openChecks(db) : null;

        return { queues, stuck, checks };
    };
}

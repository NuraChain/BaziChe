import { In, IsNull, type DataSource } from 'typeorm';

import type { Books } from '../../chain/rpc.ts';
import { Discrepancy } from '../../entities/discrepancy.entity.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import type { AdminCheck, AdminChecks } from '../../schemas.ts';
import { record, staffRefusal, type Actor } from '../admin/staff.ts';
import { AUDIT_PAGE, type Audit, type Auditor, type Finding, type Words } from './audit.ts';
import { CHECKS_PAGE, type CheckFamily, type CheckKind, type CheckList, type CheckResolution, type Holder } from './kinds.ts';

export interface ReconcileHooks
{
    /** A disagreement found or resolved: said as a warning in the server's log. */
    said(event: string, fields: Record<string, unknown>): void;
}

export interface ReconcileSweep
{
    compared: number;
    found: number;
    resolved: number;
    faults: { family: CheckFamily; record: string; error: string }[];
}

interface CheckRow extends Keyed
{
    family: CheckFamily;
    record: string;
    kind: CheckKind;
    db: Words;
    chain: Words;
    about: Words;
    first_seen: Date;
    last_seen: Date;
    resolved_at: Date | null;
    resolution: CheckResolution | null;
    staff_handle: string | null;
    reason: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const canonical = (words: Words) => JSON.stringify(Object.keys(words).sort().map((key) => [key, words[key]]));

const sameWords = (one: { db: Words; chain: Words }, other: { db: Words; chain: Words }) =>
    canonical(one.db) === canonical(other.db) && canonical(one.chain) === canonical(other.chain);

const wire = (row: CheckRow): AdminCheck => ({
    id: row.id,
    family: row.family,
    record: row.record,
    kind: row.kind,
    db: row.db,
    chain: row.chain,
    about: row.about,
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString(),
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at.toISOString() }),
    ...(row.resolution === null ? {} : { resolution: row.resolution }),
    ...(row.staff_handle === null ? {} : { staff: row.staff_handle }),
    ...(row.reason === null ? {} : { reason: row.reason })
});

/**
 * The database and NuraChain, checked against each other.
 *
 * Each family's own service compares its records (`audit`, beside its worker); this keeps what they
 * find. One row per disagreement and kind while it lasts, its last sighting moved by every pass that
 * meets it again; resolved when the two sides agree, when a worker's own write put it right in the
 * pass that found it, or when somebody on the staff closes it, which holds for as long as the two
 * sides say what they said then. Every finding and every resolution is said as a warning.
 */
export function createReconciler(
    db: DataSource,
    auditors: ReadonlyMap<Exclude<CheckFamily, 'contract'>, Auditor>,
    holders: ReadonlyMap<Holder, () => Promise<Books>>,
    hooks: ReconcileHooks
)
{
    const cursors = new Map<CheckFamily, string | null>();
    const watching: CheckFamily[] = [...auditors.keys(), ...(holders.size > 0 ? ['contract' as const] : [])];
    let checkedAt: Date | null = null;
    let running: Promise<ReconcileSweep> | null = null;

    const repository = () => db.getRepository(Discrepancy);

    const checkQuery = () => repository().createQueryBuilder('d')
        .select('d.id', 'id')
        .addSelect('d.family', 'family')
        .addSelect('d.record', 'record')
        .addSelect('d.kind', 'kind')
        .addSelect('d.db', 'db')
        .addSelect('d.chain', 'chain')
        .addSelect('d.about', 'about')
        .addSelect('d.first_seen', 'first_seen')
        .addSelect('d.last_seen', 'last_seen')
        .addSelect('d.resolved_at', 'resolved_at')
        .addSelect('d.resolution', 'resolution')
        .addSelect('d.staff_handle', 'staff_handle')
        .addSelect('d.reason', 'reason')
        .addSelect(keyOf('d.first_seen'), 'at_key');

    const resolved = (family: CheckFamily, row: { record: string; kind: CheckKind }, how: Exclude<CheckResolution, 'staff'>) =>
        hooks.said('chain and database agree again', { family, record: row.record, kind: row.kind, how });

    const keep = async (family: CheckFamily, finding: Finding, tally: ReconcileSweep) =>
    {
        const { record: id, kind, db: here, chain: there, about } = finding;
        const same = { family, record: id, kind, resolvedAt: IsNull() };

        if (finding.putRight === true)
        {
            const closed = await repository().update(same, { db: here, chain: there, about, lastSeen: () => 'now()', resolvedAt: () => 'now()', resolution: 'put-right' });

            if ((closed.affected ?? 0) === 0)
            {
                await repository().insert({ family, record: id, kind, db: here, chain: there, about, resolvedAt: () => 'now()', resolution: 'put-right' });
                hooks.said('chain and database disagree', { family, record: id, kind, db: here, chain: there });
                tally.found += 1;
            }

            resolved(family, finding, 'put-right');
            tally.resolved += 1;

            return;
        }

        const moved = await repository().update(same, { db: here, chain: there, about, lastSeen: () => 'now()' });

        if ((moved.affected ?? 0) > 0)
        {
            return;
        }

        const last = await repository().findOne({
            select: { resolution: true, db: true, chain: true },
            where: { family, record: id, kind },
            order: { resolvedAt: { direction: 'DESC', nulls: 'LAST' } }
        });

        if (last?.resolution === 'staff' && sameWords(last, finding))
        {
            return;
        }

        const made = await repository().createQueryBuilder()
            .insert()
            .values({ family, record: id, kind, db: here, chain: there, about })
            .orIgnore()
            .returning(['id'])
            .execute();

        if ((made.raw as unknown[]).length > 0)
        {
            hooks.said('chain and database disagree', { family, record: id, kind, db: here, chain: there });
            tally.found += 1;
        }
    };

    /** What one family's audit came to: every open disagreement about a record it compared and no longer found is over. */
    const apply = async (family: CheckFamily, audit: Pick<Audit, 'compared' | 'found'>, tally: ReconcileSweep) =>
    {
        tally.compared += audit.compared.length;

        const now = new Set(audit.found.map((finding) => `${ finding.record } ${ finding.kind }`));
        const open = audit.compared.length === 0
            ? []
            : await repository().find({ select: { id: true, record: true, kind: true }, where: { family, record: In(audit.compared), resolvedAt: IsNull() } });

        for (const row of open)
        {
            if (now.has(`${ row.record } ${ row.kind }`))
            {
                continue;
            }

            const ended = await repository().update({ id: row.id, resolvedAt: IsNull() }, { resolvedAt: () => 'now()', resolution: 'agreed' });

            if ((ended.affected ?? 0) > 0)
            {
                resolved(family, row, 'agreed');
                tally.resolved += 1;
            }
        }

        for (const finding of audit.found)
        {
            await keep(family, finding, tally);
        }
    };

    const books = async (tally: ReconcileSweep) =>
    {
        const compared: string[] = [];
        const found: Finding[] = [];

        for (const [holder, read] of holders)
        {
            try
            {
                const held = await read();

                compared.push(holder);

                if (!held.solvent)
                {
                    found.push({ record: holder, kind: 'solvency', db: {}, chain: { held: held.held.toString(), owed: held.owed.toString() }, about: {} });
                }
            }
            catch (error)
            {
                if ((error as { status?: number }).status !== 503)
                {
                    tally.faults.push({ family: 'contract', record: holder, error: error instanceof Error ? error.message : String(error) });
                }
            }
        }

        await apply('contract', { compared, found }, tally);
    };

    const sweepOnce = async (budgetMs: number) =>
    {
        const deadline = performance.now() + budgetMs;
        const tally: ReconcileSweep = { compared: 0, found: 0, resolved: 0, faults: [] };

        await books(tally);

        for (const [family, audit] of auditors)
        {
            if (performance.now() > deadline)
            {
                break;
            }

            const open = await repository().find({
                select: { record: true },
                where: { family, resolvedAt: IsNull() },
                order: { lastSeen: 'ASC' },
                take: AUDIT_PAGE
            });
            const done = await audit({ ids: open.map((row) => row.record), after: cursors.get(family) ?? null, deadline });

            cursors.set(family, done.next);
            await apply(family, done, tally);
            tally.faults.push(...done.faults.map((fault) => ({ family, ...fault })));
        }

        checkedAt = new Date();

        return tally;
    };

    const openCount = () => repository().countBy({ resolvedAt: IsNull() });

    return {
        watching,

        openCount,

        /** One pass at a time in a process: a second asked for while one runs is that one. */
        sweep(budgetMs: number)
        {
            running ??= sweepOnce(budgetMs).finally(() =>
            {
                running = null;
            });

            return running;
        },

        async list(list: CheckList, cursor: string | null): Promise<AdminChecks>
        {
            const after = keysetAfter(cursor);
            const query = checkQuery();

            if (list === 'open')
            {
                query.where('d.resolved_at is null');
            }
            else if (list === 'closed')
            {
                query.where('d.resolved_at is not null');
            }

            if (after !== null)
            {
                query.andWhere(olderThan('d.first_seen', 'd.id'), after);
            }

            const [rows, open] = await Promise.all([
                query.orderBy('d.first_seen', 'DESC').addOrderBy('d.id', 'DESC').limit(CHECKS_PAGE + 1).getRawMany<CheckRow>(),
                openCount()
            ]);

            return {
                rows: rows.slice(0, CHECKS_PAGE).map(wire),
                ...cursorOf(rows, CHECKS_PAGE),
                open,
                watching,
                ...(checkedAt === null ? {} : { checkedAt: checkedAt.toISOString() })
            };
        },

        /** Closed by somebody on the staff with a reason, written to their log in the same transaction. */
        async close(actor: Actor, id: string, reason: string)
        {
            if (!UUID.test(id))
            {
                return null;
            }

            const closed = await db.transaction(async (tx) =>
            {
                const held = await tx.getRepository(Discrepancy).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

                if (held === null)
                {
                    return null;
                }

                if (held.resolvedAt !== null)
                {
                    throw staffRefusal('staff-check-closed', 'That disagreement has already been closed.');
                }

                await tx.getRepository(Discrepancy).update(id, { resolvedAt: () => 'now()', resolution: 'staff', staffId: actor.id, staffHandle: actor.handle, reason });
                await record(tx, actor, { kind: 'check', reason, details: { check: id, family: held.family, record: held.record, kind: held.kind } });

                return held;
            });

            if (closed === null)
            {
                return null;
            }

            hooks.said('chain and database disagreement closed', { family: closed.family, record: closed.record, kind: closed.kind, by: actor.handle });

            const [row, open] = await Promise.all([checkQuery().where('d.id = :id', { id }).getRawOne<CheckRow>(), openCount()]);

            return { check: wire(row!), open };
        }
    };
}

export type Reconciler = ReturnType<typeof createReconciler>;

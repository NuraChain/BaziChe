import {
    ALERT_ABILITY,
    CLOSE_CODES,
    LIMITS,
    MOVES,
    REFUSALS,
    WORKERS,
    alertKey,
    closeCodeOf,
    crossings,
    judge,
    type Alert,
    type AlertLevel,
    type CloseCode,
    type Family,
    type Measures,
    type Move,
    type Queue,
    type Refusal,
    type Worker
} from './measures.ts';
import { rendered, type Series } from './prometheus.ts';
import { HOUR_MINUTES, delayWindow, minuteCounts } from './rings.ts';

export interface Sampled
{
    queues: { queue: Queue; count: number; oldest: number | null }[];
    stuck: number | null;
    checks: { open: number; oldest: number | null } | null;
}

/** What one worker's pass came to, as far as the monitor counts it. */
export interface WorkerPass
{
    /** The records whose step failed at this pass. */
    faults: readonly string[];
    failed?: number;
    moves?: Partial<Record<Move, number>>;
}

export interface FamilyCount
{
    family: Family;
    requests: number;
    failed: number;
}

export interface ProcessNow
{
    uptime: number;
    rss: number;
    heap: number;
    loop: { busy: number; stall: number };
    pool: { total: number; idle: number; waiting: number };
}

export interface MonitorDeps
{
    now(): number;
    sample(): Promise<Sampled>;
    sockets(): number;
    outboxes(): { deepest: number; waiting: number };
    families(minutes: number): FamilyCount[];
    familyTotals(): FamilyCount[];
    process(): ProcessNow;
    said(level: AlertLevel, event: string, fields: Record<string, unknown>): void;
}

export interface Standing extends Alert
{
    since: number;
}

type SocketEvent = 'opened' | 'asked' | 'gated';

const counted = <K extends string>(keys: readonly K[], counts: ReadonlyMap<K, number>) =>
    Object.fromEntries(keys.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => [key, counts.get(key) ?? 0]));

const waited = (oldest: number | null) => (oldest === null ? {} : { oldest });

const said = (alert: Alert) => ({ alert: alert.alert, ...(alert.about === undefined ? {} : { about: alert.about }), value: alert.value, limit: alert.limit });

/**
 * What this process measures about itself and the work it is behind on, and the alerts those cross.
 * Memory only, bounded by shape (`ops/rings.ts`); the database is read at each sample for what only
 * it knows. It writes nothing, so a restart costs it its memory and nothing else.
 */
export function createMonitor(deps: MonitorDeps)
{
    const sockets = minuteCounts<SocketEvent>(deps.now);
    const closes = minuteCounts<CloseCode>(deps.now);
    const refusals = minuteCounts<Refusal>(deps.now);
    const moves = minuteCounts<Move>(deps.now);
    const locks = minuteCounts<'failed'>(deps.now);
    const watch = delayWindow(deps.now);
    const failing = new Map<Worker, Map<string, number>>();
    const faults = new Map<Worker, number>();
    let unreached = 0;
    let sampled: (Sampled & { at: number }) | null = null;
    let standing: Standing[] = [];
    let running: Promise<void> | null = null;

    const ceilingIn = (counts: ReadonlyMap<SocketEvent, number>) => Math.max(0, (counts.get('asked') ?? 0) - (counts.get('gated') ?? 0));

    const refusedIn = (minutes: number) =>
    {
        const gate = refusals.within(minutes);
        const ceiling = ceilingIn(sockets.within(minutes));

        return new Map<Refusal, number>([...gate, ...(ceiling > 0 ? [['ceiling', ceiling] as const] : [])]);
    };

    const failingNow = () => WORKERS
        .map((worker) => ({ worker, records: [...(failing.get(worker)?.values() ?? [])] }))
        .filter((one) => one.records.length > 0)
        .map((one) => ({ worker: one.worker, count: one.records.length, oldest: Math.floor((deps.now() - Math.min(...one.records)) / 1000) }));

    const measures = (): Measures =>
    {
        const delays = watch.within();

        return {
            refused: refusedIn(LIMITS.socketsFull.minutes).get('ceiling') ?? 0,
            behind: closes.within(LIMITS.socketsBehind.minutes).get('4413') ?? 0,
            watch: delays === null ? null : { frames: delays.frames, p95: delays.p95 },
            families: deps.families(LIMITS.errors.minutes),
            queues: sampled?.queues ?? [],
            stuck: sampled?.stuck ?? null,
            failedLocks: locks.within(LIMITS.locksFailed.minutes).get('failed') ?? 0,
            failing: failingNow().map((one) => ({ worker: one.worker, oldest: one.oldest })),
            unreached,
            checks: sampled?.checks?.open ?? null
        };
    };

    const judgeNow = () =>
    {
        const judged = judge(measures());
        const { raised, cleared } = crossings(standing, judged);
        const since = new Map(standing.map((one) => [alertKey(one), one.since]));

        raised.forEach((one) => deps.said(one.level, 'alert raised', said(one)));
        cleared.forEach((one) => deps.said(one.level, 'alert cleared', said(one)));
        standing = judged.map((one) => ({ ...one, since: since.get(alertKey(one)) ?? deps.now() }));
    };

    return {
        /** An upgrade on the socket's path, before anything decides on it. */
        asked()
        {
            sockets.add('asked');
        },

        /** An upgrade the gate was asked about: one asked and never gated was refused at the ceiling. */
        gated(refusal: Refusal | null)
        {
            sockets.add('gated');

            if (refusal !== null)
            {
                refusals.add(refusal);
            }
        },

        opened()
        {
            sockets.add('opened');
        },

        closed(code: number)
        {
            closes.add(closeCodeOf(code));
        },

        delivered(ms: number)
        {
            watch.add(ms);
        },

        passed(worker: Worker, pass: WorkerPass)
        {
            const before = failing.get(worker) ?? new Map<string, number>();
            const now = deps.now();

            failing.set(worker, new Map(pass.faults.map((record) => [record, before.get(record) ?? now])));
            faults.set(worker, (faults.get(worker) ?? 0) + pass.faults.length);

            if ((pass.failed ?? 0) > 0)
            {
                locks.add('failed', pass.failed);
            }

            for (const move of MOVES)
            {
                const count = pass.moves?.[move] ?? 0;

                if (count > 0)
                {
                    moves.add(move, count);
                }
            }
        },

        /** Whether the reconciliation pass reached NuraChain: null when it watches nothing. */
        reconciled(reached: boolean | null)
        {
            unreached = reached === false ? unreached + 1 : 0;
        },

        /** Reads what only the database knows, then judges every alert and says each that crossed. One at a time. */
        sample()
        {
            running ??= (async () =>
            {
                try
                {
                    sampled = { ...await deps.sample(), at: deps.now() };
                }
                finally
                {
                    judgeNow();
                    running = null;
                }
            })();

            return running;
        },

        alerts: (): readonly Standing[] => standing,

        alertsFor: (abilities: { health: boolean; money: boolean }) => standing.filter((one) => abilities[ALERT_ABILITY[one.alert]]),

        /** The server's own measures, as "This server" draws them: the last hour's, and the latest sample's. */
        server()
        {
            const hour = sockets.within(HOUR_MINUTES);
            const delays = watch.within();

            return {
                opened: hour.get('opened') ?? 0,
                closed: counted(CLOSE_CODES, closes.within(HOUR_MINUTES)),
                refused: counted(REFUSALS, refusedIn(HOUR_MINUTES)),
                ...deps.outboxes(),
                ...(delays === null ? {} : { delivery: delays }),
                families: deps.families(HOUR_MINUTES).filter((one) => one.requests > 0),
                queues: (sampled?.queues ?? []).map((one) => ({ queue: one.queue, count: one.count, ...waited(one.oldest) })),
                moves: counted(MOVES, moves.within(HOUR_MINUTES)),
                ...(sampled === null ? {} : { sampledAt: new Date(sampled.at).toISOString() })
            };
        },

        /** The money's own measures, as the overview draws them for a role that opens Money; what this server does not run is absent. */
        money()
        {
            const stuck = sampled?.stuck ?? null;
            const markets = sampled?.queues.find((one) => one.queue === 'markets');
            const checks = sampled?.checks ?? null;

            return {
                ...(stuck === null ? {} : { stuck }),
                ...(markets === undefined ? {} : { markets: { count: markets.count, ...waited(markets.oldest) } }),
                failedLocks: locks.within(HOUR_MINUTES).get('failed') ?? 0,
                failing: failingNow(),
                reachable: unreached < LIMITS.chainDownPasses,
                ...(checks === null ? {} : { checks: { open: checks.open, ...waited(checks.oldest) } })
            };
        },

        /** Every measure for a monitor outside, in the Prometheus text format. */
        metrics()
        {
            const process = deps.process();
            const delays = watch.within();
            const delayTotals = watch.totals();
            const socketTotals = sockets.totals();
            const stuck = sampled?.stuck ?? null;
            const checks = sampled?.checks ?? null;
            const series: Series[] = [
                { name: 'baziche_up_seconds', help: 'How long this process has run.', type: 'gauge', samples: [{ value: process.uptime }] },
                { name: 'baziche_memory_bytes', help: 'Resident memory and the heap in use.', type: 'gauge', samples: [{ labels: { kind: 'rss' }, value: process.rss }, { labels: { kind: 'heap' }, value: process.heap }] },
                { name: 'baziche_event_loop_busy_ratio', help: 'How much of the last full minute the event loop was busy.', type: 'gauge', samples: [{ value: process.loop.busy }] },
                { name: 'baziche_event_loop_stall_ms', help: 'The longest the event loop waited past its tick in the last full minute.', type: 'gauge', samples: [{ value: process.loop.stall }] },
                { name: 'baziche_db_pool_connections', help: 'The database pool: open, idle, and callers waiting.', type: 'gauge', samples: [{ labels: { state: 'open' }, value: process.pool.total }, { labels: { state: 'idle' }, value: process.pool.idle }, { labels: { state: 'waiting' }, value: process.pool.waiting }] },
                { name: 'baziche_requests_total', help: 'Requests answered, by route family.', type: 'counter', samples: deps.familyTotals().map((one) => ({ labels: { family: one.family }, value: one.requests })) },
                { name: 'baziche_request_failures_total', help: 'Requests answered with a 5xx, by route family.', type: 'counter', samples: deps.familyTotals().map((one) => ({ labels: { family: one.family }, value: one.failed })) },
                { name: 'baziche_sockets_open', help: 'Sockets open now.', type: 'gauge', samples: [{ value: deps.sockets() }] },
                { name: 'baziche_sockets_opened_total', help: 'Sockets accepted.', type: 'counter', samples: [{ value: socketTotals.get('opened') ?? 0 }] },
                { name: 'baziche_sockets_closed_total', help: 'Sockets closed, by close code.', type: 'counter', samples: CLOSE_CODES.map((code) => ({ labels: { code }, value: closes.totals().get(code) ?? 0 })) },
                { name: 'baziche_sockets_refused_total', help: 'Upgrades refused, by why.', type: 'counter', samples: REFUSALS.map((reason) => ({ labels: { reason }, value: reason === 'ceiling' ? ceilingIn(socketTotals) : refusals.totals().get(reason) ?? 0 })) },
                { name: 'baziche_outbox_deepest_frames', help: 'The most frames any one socket has waiting.', type: 'gauge', samples: [{ value: deps.outboxes().deepest }] },
                { name: 'baziche_watch_delivery_ms', help: 'From a move\'s commit to its frame handed to each watcher, over the last five minutes.', type: 'gauge', samples: delays === null ? [] : [{ labels: { quantile: '0.5' }, value: delays.p50 }, { labels: { quantile: '0.95' }, value: delays.p95 }, { labels: { quantile: '0.99' }, value: delays.p99 }] },
                { name: 'baziche_watch_frames_total', help: 'Watch frames handed to their sockets.', type: 'counter', samples: [{ value: delayTotals.count }] },
                { name: 'baziche_watch_delivery_ms_total', help: 'The sum of every watch frame\'s delivery.', type: 'counter', samples: [{ value: delayTotals.sum }] },
                { name: 'baziche_queue_items', help: 'Each worker\'s queue: what is waiting on it.', type: 'gauge', samples: (sampled?.queues ?? []).map((one) => ({ labels: { queue: one.queue }, value: one.count })) },
                { name: 'baziche_queue_oldest_seconds', help: 'How long the oldest of each queue has waited.', type: 'gauge', samples: (sampled?.queues ?? []).map((one) => ({ labels: { queue: one.queue }, value: one.oldest ?? 0 })) },
                { name: 'baziche_market_moves_total', help: 'What the market worker moved, by kind.', type: 'counter', samples: MOVES.map((move) => ({ labels: { move }, value: moves.totals().get(move) ?? 0 })) },
                { name: 'baziche_stake_locks_failed_total', help: 'Stakes that failed to lock.', type: 'counter', samples: [{ value: locks.totals().get('failed') ?? 0 }] },
                { name: 'baziche_worker_failing', help: 'Records whose step is failing now, by worker.', type: 'gauge', samples: WORKERS.map((worker) => ({ labels: { worker }, value: failing.get(worker)?.size ?? 0 })) },
                { name: 'baziche_worker_faults_total', help: 'Worker steps that failed, by worker.', type: 'counter', samples: WORKERS.map((worker) => ({ labels: { worker }, value: faults.get(worker) ?? 0 })) },
                { name: 'baziche_payments_stuck', help: 'Paid games locking or paying for ten minutes, or with an error.', type: 'gauge', samples: stuck === null ? [] : [{ value: stuck }] },
                { name: 'baziche_chain_unreached_passes', help: 'Reconciliation passes in a row that could not reach NuraChain.', type: 'gauge', samples: [{ value: unreached }] },
                { name: 'baziche_checks_open', help: 'Disagreements with NuraChain still open.', type: 'gauge', samples: checks === null ? [] : [{ value: checks.open }] },
                { name: 'baziche_checks_oldest_seconds', help: 'How long the oldest open disagreement has been open.', type: 'gauge', samples: checks === null || checks.oldest === null ? [] : [{ value: checks.oldest }] },
                { name: 'baziche_alert', help: 'Every alert standing, at 1.', type: 'gauge', samples: standing.map((one) => ({ labels: { alert: one.alert, level: one.level, ...(one.about === undefined ? {} : { about: one.about }) }, value: 1 })) }
            ];

            return rendered(series);
        }
    };
}

export type Monitor = ReturnType<typeof createMonitor>;

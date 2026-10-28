export const SAMPLE_MS = 30_000;

/** The api's own features, as the first segment after `/api/`; any other `/api` path is `other`, and everything else `pages`. */
export const FAMILIES = ['admin', 'auth', 'catalogue', 'chain', 'chat', 'devices', 'donations', 'groups', 'markets', 'matches', 'meta', 'notifications', 'parties', 'public', 'shop', 'social', 'tables', 'vault', 'other', 'pages'] as const;

export type Family = (typeof FAMILIES)[number];

/** Close codes counted by name; any other a peer sends is `other`, so a client cannot grow the set. */
export const CLOSE_CODES = ['1000', '1001', '1005', '1006', '1011', '4400', '4401', '4413', '4429', 'other'] as const;

export type CloseCode = (typeof CLOSE_CODES)[number];

export const REFUSALS = ['ceiling', 'origin', 'budget', 'cookie'] as const;

export type Refusal = (typeof REFUSALS)[number];

export const QUEUES = ['positions', 'claims', 'orders', 'gifts', 'locking', 'paying', 'markets'] as const;

export type Queue = (typeof QUEUES)[number];

export const WORKERS = ['stakes', 'markets', 'shop', 'gifts'] as const;

export type Worker = (typeof WORKERS)[number];

/** What the market worker moved, by the tally it keeps: a market's end, and a position's. */
export const MOVES = ['settled', 'refunded', 'cancelled', 'expired', 'empty', 'placed', 'refused', 'lapsed', 'claimed'] as const;

export type Move = (typeof MOVES)[number];

export const ALERT_KINDS = ['sockets-full', 'sockets-behind', 'watch-slow', 'errors', 'backlog', 'payments-stuck', 'markets-late', 'locks-failed', 'workers-failing', 'chain-down', 'checks-open'] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_LEVELS = ['warn', 'error'] as const;

export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Which section of the admin an alert belongs to: the server's, or the money's. */
export const ALERT_ABILITY: Record<AlertKind, 'health' | 'money'> = {
    'sockets-full': 'health',
    'sockets-behind': 'health',
    'watch-slow': 'health',
    errors: 'health',
    backlog: 'health',
    'payments-stuck': 'money',
    'markets-late': 'money',
    'locks-failed': 'money',
    'workers-failing': 'money',
    'chain-down': 'money',
    'checks-open': 'money'
};

/** The queues a backlog alert watches; the paid games' and the markets' have alerts of their own. */
export const BACKLOG_QUEUES: readonly Queue[] = ['positions', 'claims', 'orders', 'gifts'];

/** Every threshold, and the window it is judged over. Why each number is what it is: the operations design, 3.3. */
export const LIMITS = {
    socketsFull: { refused: 1, minutes: 10 },
    socketsBehind: { closed: 10, minutes: 10 },
    watchSlow: { p95: 1000, frames: 50, minutes: 5 },
    errors: { failed: 10, share: 0.05, requests: 20, minutes: 10 },
    backlogSeconds: 600,
    marketsLateSeconds: 600,
    locksFailed: { failed: 3, minutes: 60 },
    workersFailingSeconds: 120,
    chainDownPasses: 2
} as const;

export interface Measures
{
    /** Upgrades refused at the process's ceiling, and sockets closed for falling behind, in their windows. */
    refused: number;
    behind: number;
    watch: { frames: number; p95: number } | null;
    families: readonly { family: Family; requests: number; failed: number }[];

    /** Seconds the oldest of each queue has waited; null while it is empty. */
    queues: readonly { queue: Queue; count: number; oldest: number | null }[];
    stuck: number | null;
    failedLocks: number;

    /** Seconds the record failing longest has failed, for each worker with one failing. */
    failing: readonly { worker: Worker; oldest: number }[];

    /** Reconciliation passes in a row that could not reach NuraChain. */
    unreached: number;
    checks: number | null;
}

export interface Alert
{
    alert: AlertKind;
    about?: string;
    level: AlertLevel;
    value: number;
    limit: number;
}

export const alertKey = (alert: Pick<Alert, 'alert' | 'about'>) => (alert.about === undefined ? alert.alert : `${ alert.alert }:${ alert.about }`);

const PAYOUT_WORKERS: ReadonlySet<Worker> = new Set(['stakes', 'markets']);

/** Every alert the measures cross, in the order of `ALERT_KINDS`. */
export function judge(measures: Measures): Alert[]
{
    const alerts: Alert[] = [];

    if (measures.refused >= LIMITS.socketsFull.refused)
    {
        alerts.push({ alert: 'sockets-full', level: 'warn', value: measures.refused, limit: LIMITS.socketsFull.refused });
    }

    if (measures.behind >= LIMITS.socketsBehind.closed)
    {
        alerts.push({ alert: 'sockets-behind', level: 'warn', value: measures.behind, limit: LIMITS.socketsBehind.closed });
    }

    if (measures.watch !== null && measures.watch.frames >= LIMITS.watchSlow.frames && measures.watch.p95 >= LIMITS.watchSlow.p95)
    {
        alerts.push({ alert: 'watch-slow', level: 'warn', value: measures.watch.p95, limit: LIMITS.watchSlow.p95 });
    }

    for (const one of measures.families)
    {
        const share = one.requests === 0 ? 0 : one.failed / one.requests;

        if (one.failed >= LIMITS.errors.failed || (one.requests >= LIMITS.errors.requests && share >= LIMITS.errors.share))
        {
            alerts.push({ alert: 'errors', about: one.family, level: 'warn', value: one.failed, limit: LIMITS.errors.failed });
        }
    }

    for (const one of measures.queues)
    {
        if (BACKLOG_QUEUES.includes(one.queue) && one.oldest !== null && one.oldest >= LIMITS.backlogSeconds)
        {
            alerts.push({ alert: 'backlog', about: one.queue, level: 'warn', value: one.oldest, limit: LIMITS.backlogSeconds });
        }
    }

    if (measures.stuck !== null && measures.stuck > 0)
    {
        alerts.push({ alert: 'payments-stuck', level: 'error', value: measures.stuck, limit: 1 });
    }

    const markets = measures.queues.find((one) => one.queue === 'markets');

    if (markets !== undefined && markets.oldest !== null && markets.oldest >= LIMITS.marketsLateSeconds)
    {
        alerts.push({ alert: 'markets-late', level: 'error', value: markets.oldest, limit: LIMITS.marketsLateSeconds });
    }

    if (measures.failedLocks >= LIMITS.locksFailed.failed)
    {
        alerts.push({ alert: 'locks-failed', level: 'warn', value: measures.failedLocks, limit: LIMITS.locksFailed.failed });
    }

    for (const one of measures.failing)
    {
        if (one.oldest >= LIMITS.workersFailingSeconds)
        {
            alerts.push({ alert: 'workers-failing', about: one.worker, level: PAYOUT_WORKERS.has(one.worker) ? 'error' : 'warn', value: one.oldest, limit: LIMITS.workersFailingSeconds });
        }
    }

    if (measures.unreached >= LIMITS.chainDownPasses)
    {
        alerts.push({ alert: 'chain-down', level: 'error', value: measures.unreached, limit: LIMITS.chainDownPasses });
    }

    if (measures.checks !== null && measures.checks > 0)
    {
        alerts.push({ alert: 'checks-open', level: 'error', value: measures.checks, limit: 1 });
    }

    return alerts;
}

/** What changed between the alerts standing and a new judgement: those to raise and those to clear. */
export function crossings(standing: readonly Alert[], judged: readonly Alert[])
{
    const before = new Set(standing.map(alertKey));
    const now = new Set(judged.map(alertKey));

    return {
        raised: judged.filter((one) => !before.has(alertKey(one))),
        cleared: standing.filter((one) => !now.has(alertKey(one)))
    };
}

/** The family a request is counted under. */
export function familyOf(path: string): Family
{
    if (!path.startsWith('/api/'))
    {
        return 'pages';
    }

    const first = path.slice(5).split('/')[0];

    return FAMILIES.find((one) => one === first && one !== 'other' && one !== 'pages') ?? 'other';
}

/** A close code as it is counted. */
export const closeCodeOf = (code: number): CloseCode => CLOSE_CODES.find((one) => one === String(code)) ?? 'other';

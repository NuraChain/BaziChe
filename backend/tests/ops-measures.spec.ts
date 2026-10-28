import { describe, expect, it } from 'vitest';

import { ALERT_ABILITY, ALERT_KINDS, LIMITS, closeCodeOf, crossings, familyOf, judge, type Measures } from '../src/ops/measures.ts';

const calm: Measures = {
    refused: 0,
    behind: 0,
    watch: null,
    families: [],
    queues: [],
    stuck: null,
    failedLocks: 0,
    failing: [],
    unreached: 0,
    checks: null
};

const kinds = (measures: Partial<Measures>) => judge({ ...calm, ...measures }).map((one) => (one.about === undefined ? one.alert : `${ one.alert }:${ one.about }`));

describe('the alerts the measures cross', () =>
{
    it('raises nothing while every measure is under its threshold', () =>
    {
        expect(judge(calm)).toEqual([]);
        expect(kinds({
            refused: 0,
            behind: LIMITS.socketsBehind.closed - 1,
            watch: { frames: 10_000, p95: LIMITS.watchSlow.p95 - 1 },
            families: [{ family: 'tables', requests: 1000, failed: 9 }],
            queues: [{ queue: 'orders', count: 4, oldest: LIMITS.backlogSeconds - 1 }, { queue: 'markets', count: 1, oldest: LIMITS.marketsLateSeconds - 1 }],
            stuck: 0,
            failedLocks: LIMITS.locksFailed.failed - 1,
            failing: [{ worker: 'stakes', oldest: LIMITS.workersFailingSeconds - 1 }],
            unreached: LIMITS.chainDownPasses - 1,
            checks: 0
        })).toEqual([]);
    });

    it('raises each alert at its threshold exactly', () =>
    {
        expect(kinds({ refused: 1 })).toEqual(['sockets-full']);
        expect(kinds({ behind: 10 })).toEqual(['sockets-behind']);
        expect(kinds({ watch: { frames: 50, p95: 1000 } })).toEqual(['watch-slow']);
        expect(kinds({ queues: [{ queue: 'claims', count: 1, oldest: 600 }] })).toEqual(['backlog:claims']);
        expect(kinds({ stuck: 1 })).toEqual(['payments-stuck']);
        expect(kinds({ queues: [{ queue: 'markets', count: 2, oldest: 600 }] })).toEqual(['markets-late']);
        expect(kinds({ failedLocks: 3 })).toEqual(['locks-failed']);
        expect(kinds({ failing: [{ worker: 'gifts', oldest: 120 }] })).toEqual(['workers-failing:gifts']);
        expect(kinds({ unreached: 2 })).toEqual(['chain-down']);
        expect(kinds({ checks: 1 })).toEqual(['checks-open']);
    });

    it('wants enough spectator frames before a p95 means anything', () =>
    {
        expect(kinds({ watch: { frames: 49, p95: 5000 } })).toEqual([]);
    });

    it('raises a family on ten failures, or on one in twenty of at least twenty requests', () =>
    {
        expect(kinds({ families: [{ family: 'shop', requests: 10, failed: 10 }] })).toEqual(['errors:shop']);
        expect(kinds({ families: [{ family: 'vault', requests: 20, failed: 1 }] })).toEqual(['errors:vault']);
        expect(kinds({ families: [{ family: 'vault', requests: 19, failed: 1 }] }), 'too few requests to say').toEqual([]);
        expect(kinds({ families: [{ family: 'vault', requests: 40, failed: 1 }] }), 'one in forty').toEqual([]);
    });

    it('leaves the paid games\' and the markets\' queues to their own alerts', () =>
    {
        expect(kinds({ queues: [{ queue: 'locking', count: 1, oldest: 5000 }, { queue: 'paying', count: 1, oldest: 5000 }] })).toEqual([]);
    });

    it('says money at risk as an error and the rest as a warning', () =>
    {
        const all = judge({
            ...calm,
            refused: 1,
            stuck: 2,
            failing: [{ worker: 'stakes', oldest: 500 }, { worker: 'markets', oldest: 500 }, { worker: 'shop', oldest: 500 }],
            checks: 3
        });

        expect(all.map((one) => [one.alert, one.about ?? null, one.level])).toEqual([
            ['sockets-full', null, 'warn'],
            ['payments-stuck', null, 'error'],
            ['workers-failing', 'stakes', 'error'],
            ['workers-failing', 'markets', 'error'],
            ['workers-failing', 'shop', 'warn'],
            ['checks-open', null, 'error']
        ]);
    });

    it('belongs every alert to the server\'s section or the money\'s', () =>
    {
        expect(ALERT_KINDS.filter((kind) => ALERT_ABILITY[kind] === 'health')).toEqual(['sockets-full', 'sockets-behind', 'watch-slow', 'errors', 'backlog']);
    });

    it('tells the alerts raised and cleared apart from those still standing', () =>
    {
        const standing = judge({ ...calm, refused: 1, stuck: 1 });
        const judged = judge({ ...calm, stuck: 4, checks: 1 });

        expect(crossings(standing, judged)).toEqual({
            raised: [{ alert: 'checks-open', level: 'error', value: 1, limit: 1 }],
            cleared: [{ alert: 'sockets-full', level: 'warn', value: 1, limit: 1 }]
        });
    });
});

describe('what a request and a close are counted under', () =>
{
    it('counts a request under the api\'s feature, any other api path as other, and the rest as pages', () =>
    {
        expect(['/api/tables/abc', '/api/admin/overview', '/api/metrics', '/api/', '/api/other', '/api/pages', '/avatars/x.webp', '/app/me', '/'].map(familyOf))
            .toEqual(['tables', 'admin', 'other', 'other', 'other', 'other', 'pages', 'pages', 'pages']);
    });

    it('names the close codes it knows and folds every other one together', () =>
    {
        expect([1000, 1006, 4413, 4999, 3000, 1002].map(closeCodeOf)).toEqual(['1000', '1006', '4413', 'other', 'other', 'other']);
    });
});

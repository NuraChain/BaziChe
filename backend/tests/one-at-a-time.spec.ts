import { describe, expect, it } from 'vitest';

import { migrationSource } from '../src/db/migrate.ts';
import { oneAtATime, queueRunners } from '../src/lib/one-at-a-time.ts';

const runner = (): { query: (sql: string) => Promise<string>; peak: () => number; order: string[] } =>
{
    let running = 0;
    let peak = 0;
    const order: string[] = [];

    return {
        order,
        peak: () => peak,
        query: async (sql: string) =>
        {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push(sql);
            running -= 1;

            if (sql === 'fail')
            {
                throw new Error('refused');
            }

            return `${ sql } done`;
        }
    };
};

describe('a query runner that asks one thing at a time', () =>
{
    it('never has two queries in flight on one client, and answers each in the order asked', async () =>
    {
        const held = oneAtATime(runner());

        const answers = await Promise.all([held.query('a'), held.query('b'), held.query('c')]);

        expect(answers).toEqual(['a done', 'b done', 'c done']);
        expect(held.order).toEqual(['a', 'b', 'c']);
        expect(held.peak()).toBe(1);
    });

    it('lets the next query run after one that failed', async () =>
    {
        const held = oneAtATime(runner());

        const [failed, after] = await Promise.allSettled([held.query('fail'), held.query('next')]);

        expect(failed.status).toBe('rejected');
        expect(after).toEqual({ status: 'fulfilled', value: 'next done' });
    });

    it('is every runner a data source makes from then on', async () =>
    {
        const made: ReturnType<typeof runner>[] = [];
        const source = {
            driver: {
                createQueryRunner: (mode: string) =>
                {
                    const one = runner();

                    made.push(one);

                    return Object.assign(one, { mode });
                }
            }
        };

        queueRunners(source);

        const first = source.driver.createQueryRunner('master');
        const second = source.driver.createQueryRunner('slave');

        await Promise.all([first.query('a'), first.query('b'), second.query('c'), second.query('d')]);

        expect(made.map((one) => one.peak())).toEqual([1, 1]);
        expect([first.mode, second.mode], 'each made as it was asked').toEqual(['master', 'slave']);
    });

    it('is the migrator\'s too, whose data source is one of its own', () =>
    {
        const made = migrationSource({ type: 'postgres', url: 'postgres://nobody@127.0.0.1:1/nothing' }).driver.createQueryRunner('master');

        expect(made.query, 'the query is queued, not the driver\'s own').not.toBe(Object.getPrototypeOf(made).query);
    });
});

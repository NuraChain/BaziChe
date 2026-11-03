type Querying = { query: (...args: never[]) => Promise<unknown> };

/** Somewhere query runners are made: a DataSource, through its driver. */
interface Runners
{
    driver: { createQueryRunner: (mode: never) => Querying };
}

export function oneAtATime<T extends Querying>(runner: T)
{
    const query = runner.query.bind(runner) as (...args: unknown[]) => Promise<unknown>;
    let tail: Promise<unknown> = Promise.resolve();

    (runner as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (...args: unknown[]) =>
    {
        const next = tail.then(() => query(...args));

        tail = next.catch(() => undefined);

        return next;
    };

    return runner;
}

/**
 * Every query runner a data source makes from now on asks one thing at a time. Each DataSource has
 * a driver of its own, so one built beside another (the migrator's) is not covered by the other's.
 */
export function queueRunners<S extends Runners>(source: S)
{
    const driver = source.driver as unknown as { createQueryRunner: (mode: unknown) => Querying };
    const createRunner = driver.createQueryRunner.bind(driver);

    driver.createQueryRunner = (mode: unknown) => oneAtATime(createRunner(mode));

    return source;
}

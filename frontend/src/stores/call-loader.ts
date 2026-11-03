export function startCalls(stops: (() => void)[])
{
    let stop: (() => void) | null = null;
    let gone = false;

    stops.push(() =>
    {
        gone = true;
        stop?.();
    });

    void import('../components/call/call.ts')
        .then((module) =>
        {
            if (!gone)
            {
                stop = module.begin();
            }
        })
        .catch(() => undefined);
}

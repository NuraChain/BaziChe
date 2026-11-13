/** A read, which asking twice cannot change anything by: the one kind tried again when the network failed it. */
const READS = new Set(['GET', 'HEAD']);

const send = (request: Request, patience: number) => (typeof AbortSignal.any === 'function'
    ? fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(patience)]) })
    : fetch(request));

/**
 * Sends a request to the api, giving up after `patience` milliseconds. A read the network failed
 * outright (a TypeError, not a timeout or an abort) is asked once more: Safari fails the first request
 * over a connection that went stale while the phone slept or the tab sat idle, and the next one goes
 * through, so every page's first read showed an error that its retry button then cleared. A write is
 * never sent twice.
 */
export async function sent(request: Request, patience: number)
{
    try
    {
        return await send(request, patience);
    }
    catch (error)
    {
        if (!(error instanceof TypeError) || request.signal.aborted || !READS.has(request.method))
        {
            throw error;
        }

        return await send(request, patience);
    }
}

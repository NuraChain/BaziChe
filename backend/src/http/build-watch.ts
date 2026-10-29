/**
 * Tells `onNew`, once, when the finished build under this server is not the one it started with.
 * A build writes its marker last (`tools/built.mjs`), so one still being written, its marker gone
 * with everything else it replaces, is not a new build yet.
 *
 * The server needs to know because the page shell is read once, at mount, while every file the
 * shell names is read from disk when asked for (framework register, entry 46): served on, the old
 * shell names files the new build deleted, and every page a browser has not cached yet breaks.
 */
export function watchBuild(read: () => Promise<string | null>, onNew: () => void, every: number)
{
    let started: string | null | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const look = async () =>
    {
        const marker = await read();

        if (stopped)
        {
            return;
        }

        if (started === undefined)
        {
            started = marker;
        }
        else if (marker !== null && marker !== started)
        {
            stopped = true;
            onNew();

            return;
        }

        timer = setTimeout(() => void look(), every);
        timer.unref();
    };

    void look();

    return () =>
    {
        stopped = true;

        if (timer !== null)
        {
            clearTimeout(timer);
        }
    };
}

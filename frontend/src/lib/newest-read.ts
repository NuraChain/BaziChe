/**
 * Reads a resource again, and settles once its newest read has.
 *
 * The framework's `refetch` settles when the read it began does, and a read a later one replaced
 * settles with nothing written while the later one is still out (AzerothJS register #48): a guess
 * let go at that moment shows the answer from before the change it stood for. Every read of the
 * resource has to go through the one function this answers, or a read begun elsewhere replaces
 * the newest unseen.
 */
export function newestRead(resource: { refetch(): Promise<void> })
{
    let newest: Promise<void> = Promise.resolve();

    return async () =>
    {
        newest = resource.refetch();

        let waited: Promise<void>;

        do
        {
            waited = newest;
            await waited;
        }
        while (waited !== newest);
    };
}

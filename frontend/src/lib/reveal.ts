/**
 * Brings an item of a row that scrolls sideways into view, sideways only and clear of the row's
 * fade, and leaves an item already in view where it is. Scrolling the item into view would move the
 * page as well, wherever the row stands on it.
 */
export function revealIn(row: HTMLElement, item: HTMLElement, fade: number, behavior: ScrollBehavior)
{
    const room = row.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    const short = room.left + fade - box.left;
    const by = short > 0 ? -short : Math.max(0, box.right - (room.right - fade));

    if (by !== 0)
    {
        row.scrollTo({ left: row.scrollLeft + by, behavior });
    }
}

/**
 * Calls `then` whenever the row or anything in it changes size, and whenever what it holds changes.
 * The row's own box alone misses an item that grows inside it: a count that comes after the row is
 * drawn widens its item and leaves the row's box as it was, which pushed a chosen tab at the end of
 * a strip out of sight with nothing to say the strip now scrolls.
 */
export function whenResized(row: HTMLElement, then: () => void)
{
    if (typeof ResizeObserver === 'undefined')
    {
        return () => undefined;
    }
    const sized = new ResizeObserver(then);
    const held = typeof MutationObserver === 'undefined' ? null : new MutationObserver((changes) =>
    {
        for (const change of changes)
        {
            for (const node of Array.from(change.addedNodes))
            {
                if (node instanceof Element)
                {
                    sized.observe(node);
                }
            }
            for (const node of Array.from(change.removedNodes))
            {
                if (node instanceof Element)
                {
                    sized.unobserve(node);
                }
            }
        }
        then();
    });

    sized.observe(row);
    for (const item of Array.from(row.children))
    {
        sized.observe(item);
    }
    held?.observe(row, { childList: true });

    return () =>
    {
        sized.disconnect();
        held?.disconnect();
    };
}

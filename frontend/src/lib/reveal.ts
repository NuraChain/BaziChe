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

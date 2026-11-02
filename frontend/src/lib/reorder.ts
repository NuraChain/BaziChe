/** The list with what stands at `from` moved to `to`, everything else in its order; a place past either end is the end. */
export function moved<T>(list: readonly T[], from: number, to: number): T[]
{
    if (from < 0 || from >= list.length)
    {
        return [ ...list ];
    }

    const next = [ ...list ];
    const [ one ] = next.splice(from, 1);

    next.splice(Math.max(0, Math.min(to, next.length)), 0, one);
    return next;
}

/** Which of these boxes holds the point, or -1 for none. */
export const boxAt = (boxes: readonly DOMRect[], x: number, y: number) => boxes.findIndex((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);

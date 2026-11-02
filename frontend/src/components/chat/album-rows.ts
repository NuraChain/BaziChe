import type { Message } from '../../data/chat.ts';

/** How wide an item may stand against its height in a row: past these it is cut to fit, not stretched. */
const NARROWEST = 0.75;

const WIDEST = 1.6;

/**
 * A row's shape, width over height, is held between these: a single tall photo does not fill the
 * screen, and a row of panoramas does not shrink to a strip.
 */
const ROW_LEAST = 1.2;

const ROW_MOST = 3.6;

/**
 * How many of an album's items stand in each row: three to a row, the first row holding whatever is
 * left over, except that four stand two and two, and three stand one over two.
 */
export function rowSizes(count: number)
{
    if (count <= 2)
    {
        return count < 1 ? [] : [count];
    }

    if (count === 3)
    {
        return [1, 2];
    }

    if (count === 4)
    {
        return [2, 2];
    }

    const rest = count % 3;

    return [...(rest === 0 ? [] : [rest]), ...Array.from({ length: Math.floor(count / 3) }, () => 3)];
}

const within = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value));

/** An item's shape, width over height, from what its document says, square when it says nothing. */
const shapeOf = (message: Message) =>
{
    const file = message.file;

    return file?.w === undefined || file.h === undefined ? 1 : within(file.w / file.h, NARROWEST, WIDEST);
};

/**
 * An album laid out in rows, each row as tall as its items' shapes together ask: every item keeps its
 * own proportions inside its row, and a row too tall or too short for a phone is held to the bounds,
 * its items then cut to fit rather than drawn out of shape.
 */
export function albumRows(items: readonly Message[])
{
    let from = 0;

    return rowSizes(items.length).map((size) =>
    {
        const tiles = items.slice(from, from + size).map((message) => ({ message, shape: shapeOf(message) }));

        from += size;

        return {
            key: tiles[0].message.id,
            shape: within(tiles.reduce((sum, tile) => sum + tile.shape, 0), ROW_LEAST, ROW_MOST),
            tiles
        };
    });
}

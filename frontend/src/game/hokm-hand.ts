export function handRows(cards: readonly number[], width: number, height: number, touch: boolean): number[][]
{
    if (!cards.length)
    {
        return [];
    }

    if (touch)
    {
        // Balance the last row as well, so neighbouring cards expose the same amount of face.
        const across = Math.max(1, Math.floor(width / 46));
        const rows = Math.min(height < 380 ? 2 : 3, Math.ceil(cards.length / across));
        const perRow = Math.ceil(cards.length / rows);
        return Array.from({ length: Math.ceil(cards.length / perRow) },
            (_, index) => cards.slice(index * perRow, (index + 1) * perRow));
    }

    const least = Math.max(38.4, Math.min(56, height * 0.12));
    const face = Math.min(84, Math.max(least, Math.min(width * 0.125, height * 0.1)));
    const exposed = (width - face) / Math.max(1, cards.length - 1);
    return cards.length <= 13 || height < 480 || exposed >= 22.5
        ? [[...cards]]
        : [cards.slice(0, Math.ceil(cards.length / 2)), cards.slice(Math.ceil(cards.length / 2))];
}

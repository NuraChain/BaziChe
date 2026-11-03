import { createSignal } from 'azerothjs';

/**
 * The bar a live call draws across the top of every page: made by the calls' chunk once it has
 * arrived, drawn by the strips. The strips import this and nothing of the calls, so their chunk
 * carries none of them.
 */
const [made, make] = createSignal<(() => unknown) | null>(null);

export const callBar = made;

export function offerCallBar(draw: () => unknown)
{
    make(() => draw);

    return () => make((current) => (current === draw ? null : current));
}

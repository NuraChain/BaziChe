import type { MatchPlayer } from '../../data/match.ts';
import { centreOf, type Rect } from '../motion.ts';
import { burstOf, wornOf, type Collection } from './table.ts';

/** The collections a player's cards wear: their faces' and their backs', each null for Classic. */
export function cardsOf(look: MatchPlayer['look'])
{
    return { faces: wornOf('face', look?.face), backs: wornOf('back', look?.back) };
}

/**
 * Marks a node that holds a player's cards with what they wear (`data-faces`, `data-backs`), which
 * the stylesheet draws their deck and back from; a card flown across the table carries its own.
 */
export function dressCards<Node extends HTMLElement>(node: Node, look: MatchPlayer['look'])
{
    const { faces, backs } = cardsOf(look);

    for (const [name, worn] of [['faces', faces], ['backs', backs]] as const)
    {
        if (worn === null)
        {
            delete node.dataset[name];
        }
        else
        {
            node.dataset[name] = worn;
        }
    }

    return node;
}

/** How many of a burst's own unit fit across the card it plays round. */
const BURST_FITS = 40;

/** The burst a card in a look plays where it lands: its collection's, round the card's middle and sized to it. */
export function burstAt(collection: Collection, card: Rect)
{
    const { preset, tune } = burstOf(collection);

    return { preset, at: centreOf(card), tune: { ...tune, scale: card.width / BURST_FITS } };
}

/** Leans a card toward the pointer over it, by `--hx` and `--hy` on the element listening, for its holographic edge to follow; a finger leans nothing. */
export function lean(event: PointerEvent)
{
    const card = event.currentTarget as HTMLElement;
    const box = card.getBoundingClientRect();

    if (event.pointerType === 'touch' || box.width === 0)
    {
        return;
    }

    card.style.setProperty('--hx', ((event.clientX - box.left) / box.width).toFixed(3));
    card.style.setProperty('--hy', ((event.clientY - box.top) / box.height).toFixed(3));
}

export function unlean(event: PointerEvent)
{
    const card = event.currentTarget as HTMLElement;

    card.style.removeProperty('--hx');
    card.style.removeProperty('--hy');
}

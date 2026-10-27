import type { MatchPlayer } from '../../data/match.ts';
import { wornOf } from './table.ts';

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

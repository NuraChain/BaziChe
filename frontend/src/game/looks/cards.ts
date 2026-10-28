import type { MatchPlayer } from '../../data/match.ts';
import { centreOf, type Rect } from '../motion.ts';
import type { Step } from '../vfx/engine.ts';
import { lightOf, wornOf, type Collection } from './table.ts';

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

/** How many of a signature's own unit fit across the card it plays round. */
const PLAY_FITS = 40;

/**
 * What a card in a look plays under itself where it is laid: its collection's signature, its
 * layers at their moments, all of it over within about a second, before the next card lands.
 * Storm cracks twice, as its motion does, and Frost's shatter is cut short so its shards stay
 * round the card rather than cross the felt.
 */
const PLAYS = {
    glow: [{ effect: 'pulse', tune: { intensity: 0.6 } }, { effect: 'stars', after: 40 }],
    shiraz: [{ effect: 'shockwave', tune: { intensity: 0.5 } }, { effect: 'dust', after: 60, tune: { density: 1.6 } }],
    neon: [{ effect: 'sparks' }, { effect: 'pulse', after: 30 }],
    gold: [{ effect: 'burst' }],
    inferno: [{ effect: 'cracks' }, { effect: 'embers', after: 200 }],
    storm: [{ effect: 'discharge' }, { effect: 'pulse', after: 40 }, { effect: 'discharge', after: 150, tune: { intensity: 0.6 } }],
    astral: [{ effect: 'starburst' }, { effect: 'shockwave', after: 60 }],
    void: [{ effect: 'implosion' }, { effect: 'release', after: 240 }],
    jade: [{ effect: 'sigil' }, { effect: 'dust', after: 220, tune: { density: 1.4 } }],
    frost: [{ effect: 'crystals' }, { effect: 'shatter', after: 320, tune: { duration: 460, density: 0.7 } }],
    phoenix: [{ effect: 'flare' }, { effect: 'embers', after: 100 }],
    oni: [{ effect: 'glitch' }, { effect: 'scan', after: 60 }]
} as const satisfies Record<Collection, readonly Step[]>;

/** The signature a card in a look plays where it lands: its collection's, round the card's middle, sized to it and in its light. */
export function playAt(collection: Collection, card: Rect)
{
    return { steps: PLAYS[collection], at: centreOf(card), tune: { colors: lightOf(collection), scale: card.width / PLAY_FITS } };
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

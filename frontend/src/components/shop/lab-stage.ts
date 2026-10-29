import type { Rect } from '../../game/motion.ts';
import type { Collection } from '../../game/looks/table.ts';
import type { Voiced } from '../../game/sound-files.ts';

/** What every stage of the fitting room is handed: the collection it is drawn in, its name, and how to say one of the collection's voices. */
export interface StageProps
{
    collection: Collection;
    title: string;
    say: (voiced: Voiced) => void;
}

/** How long a piece a moment moved stays where it went before it is put back for the next press. */
export const REST_MS = 900;

/** Where `node` is in `scene`, in CSS pixels from the scene's top left; the whole scene for a node that is not there. */
export function placeIn(scene: HTMLElement, node: Element | null | undefined): Rect
{
    const frame = scene.getBoundingClientRect();
    const box = node?.getBoundingClientRect() ?? frame;

    return { x: box.left - frame.left, y: box.top - frame.top, width: box.width, height: box.height };
}

/**
 * Runs keyframes on a node where the browser can and nobody asked for less motion, and answers the
 * animation; otherwise nothing moves, and what the moment plays still plays where it would have landed.
 */
export function move(node: HTMLElement | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions, still: boolean)
{
    if (node === null || node === undefined || still || typeof node.animate !== 'function')
    {
        return null;
    }

    const animation = node.animate(frames, { fill: 'forwards', ...options });

    animation.finished.catch(() => undefined);

    return animation;
}

/** The squash a piece takes as a moment sets it down. */
export function landOn(node: HTMLElement | null | undefined, still: boolean)
{
    move(node, [{ scale: '1.12' }, { scale: '1' }], { duration: 240, easing: 'ease-out', fill: 'none' }, still);
}

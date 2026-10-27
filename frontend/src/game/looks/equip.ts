import { runtime } from '../../lib/runtime.ts';
import type { Vfx } from '../vfx/engine.ts';
import { lazyVfx } from '../vfx/lazy.ts';
import { PALETTES } from './palette.ts';
import { burstOf, type Collection } from './table.ts';

/** How far past the look the burst may reach on every side, in CSS pixels. */
const ROOM = 48;

/** The width of a look a burst is drawn for at a scale of 1, in CSS pixels. */
const UNIT = 48;

/** The largest scale a burst is drawn at: its strokes widen with the scale as its reach does, so past this a burst over a large drawing is drawn in fat smears. */
const LARGEST = 3;

/**
 * How often a burst is asked whether anything of it is still alive, in ms. Asked rather than timed,
 * because a particle ages by the frames drawn, and a slow device draws a burst for longer than its life.
 */
export const SPENT_CHECK_MS = 250;

/**
 * Plays the burst of the collection a look belongs to over `look`, the drawing of the look somebody
 * has just put on, on a host laid over the page above any sheet and under the toasts, let go once
 * nothing of the burst is alive, or once the engine could not be fetched. A look of no collection
 * this build draws plays nothing.
 */
export function burstOver(look: HTMLElement, item: string)
{
    const collection = item.slice(item.indexOf('.') + 1);

    if (!Object.hasOwn(PALETTES, collection))
    {
        return;
    }

    const box = look.getBoundingClientRect();
    const host = document.createElement('span');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.equip = collection;
    host.style.cssText = `position:fixed;left:${ box.left - ROOM }px;top:${ box.top - ROOM }px;width:${ box.width + ROOM * 2 }px;height:${ box.height + ROOM * 2 }px;z-index:calc(var(--z-overlay) + 1);pointer-events:none`;
    document.body.append(host);

    const effects = lazyVfx(host);
    const { effect, tune } = burstOf(collection as Collection);
    let drawn: Vfx | null = null;

    const spent = () =>
    {
        if (drawn !== null && drawn.live() > 0)
        {
            runtime().clock.after(SPENT_CHECK_MS, spent);
            return;
        }

        effects.dispose();
        host.remove();
    };

    void effects.play((vfx) =>
    {
        drawn = vfx;
        vfx.burst(effect, { x: box.width / 2 + ROOM, y: box.height / 2 + ROOM }, { ...tune, scale: Math.min(box.width / UNIT, LARGEST) });
    }).then(spent);
}

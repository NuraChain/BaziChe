import type { Vfx } from '../vfx/engine.ts';
import { lazyVfx } from '../vfx/lazy.ts';
import { AURAS, type Frame } from './frames.ts';

/** How far the aura's host reaches past the picture on every side, as a share of the picture. */
const REACH = 0.4;

/**
 * The picture's circle on a gradient that runs from the host's middle to its nearest side, as a
 * share of that run. The host shows nothing inside it, so a stream that rises or drifts inward is
 * drawn round the face and never over it.
 */
const FACE = 50 / (0.5 + REACH);

/**
 * Where the frame's ring runs from the picture's middle, as a share of its width: halfway through
 * the frame, which reaches an eighth of the picture past its edge (`[data-deco]::after`).
 */
const RING = 0.5625;

/** How far a stream reaches at a scale of 1, in CSS pixels. */
const UNIT = 30;

/**
 * Plays a frame's aura on the ring of the picture whose box is `picture` until the answer is
 * called, on an engine fetched only then, its light leaning toward a pointer anywhere over `area`
 * and never toward a finger, which is scrolling the page.
 *
 * Its host is the box's last child at the frame's own z-index, which is what lays it over the frame
 * and under the presence dot; behind the picture, the frame covered every particle it drew.
 */
export function glowAround(picture: HTMLElement, frame: Frame, area: HTMLElement = picture)
{
    const host = document.createElement('span');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.aura = frame;
    host.style.cssText = `position:absolute;inset:${ -REACH * 100 }%;z-index:1;pointer-events:none;mask:radial-gradient(circle closest-side,transparent ${ FACE.toFixed(2) }%,#000 ${ (FACE + 1).toFixed(2) }%)`;
    picture.append(host);

    const effects = lazyVfx(host);
    const { stream, tune } = AURAS[frame];
    let end = () => undefined as void;
    let drawn: Vfx | null = null;

    effects.play((vfx) =>
    {
        drawn = vfx;
        end = vfx.stream(stream, () => host.clientWidth === 0 ? null : { x: host.clientWidth / 2, y: host.clientHeight / 2 }, {
            ...tune,
            get scale()
            {
                return picture.clientWidth * RING / UNIT;
            }
        });
    });

    const near = (event: PointerEvent) =>
    {
        if (event.pointerType === 'touch')
        {
            return;
        }
        const box = host.getBoundingClientRect();
        drawn?.lean({ x: event.clientX - box.left, y: event.clientY - box.top });
    };
    const away = () => drawn?.lean(null);

    area.addEventListener('pointermove', near);
    area.addEventListener('pointerleave', away);

    return () =>
    {
        area.removeEventListener('pointermove', near);
        area.removeEventListener('pointerleave', away);
        end();
        effects.dispose();
        host.remove();
    };
}

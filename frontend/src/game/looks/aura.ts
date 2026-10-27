import { AURAS, type Frame } from './frames.ts';

/** How far the aura's host reaches past the picture on every side, as a share of the picture. */
const REACH = 0.4;

/**
 * Where the frame's ring runs from the picture's middle, as a share of its width: halfway through
 * the frame, which reaches an eighth of the picture past its edge (`[data-deco]::after`).
 */
const RING = 0.5625;

/** How far a stream reaches at a scale of 1, in CSS pixels. */
const UNIT = 30;

/**
 * Plays a frame's aura on the ring of the picture whose box is `picture` until the answer is
 * called. The engine is fetched here and not before, so a page with no frame on it never loads it;
 * a stop that comes while it is still on its way starts nothing.
 *
 * Its host is the box's last child at the frame's own z-index, which is what lays it over the frame
 * and under the presence dot; behind the picture, the frame covered every particle it drew.
 */
export function glowAround(picture: HTMLElement, frame: Frame)
{
    let stopped = false;
    let stop = () => undefined as void;

    void import('../vfx/engine.ts').then(({ createVfx }) =>
    {
        if (stopped)
        {
            return;
        }
        const host = document.createElement('span');
        host.setAttribute('aria-hidden', 'true');
        host.dataset.aura = frame;
        host.style.cssText = `position:absolute;inset:${ -REACH * 100 }%;z-index:1;pointer-events:none`;
        picture.append(host);

        const vfx = createVfx(host);
        const { stream, tune } = AURAS[frame];
        const end = vfx.stream(stream, () => host.clientWidth === 0 ? null : { x: host.clientWidth / 2, y: host.clientHeight / 2 }, {
            ...tune,
            get scale()
            {
                return picture.clientWidth * RING / UNIT;
            }
        });
        stop = () =>
        {
            end();
            vfx.dispose();
            host.remove();
        };
    }, () => undefined);

    return () =>
    {
        stopped = true;
        stop();
    };
}

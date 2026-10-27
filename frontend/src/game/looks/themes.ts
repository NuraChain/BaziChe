import type { Flow, Tune } from '../vfx/engine.ts';
import { lazyVfx } from '../vfx/lazy.ts';
import { AURAS, FRAMES, type Frame } from './frames.ts';

/**
 * The collection a worn theme names, whose cover (`public/covers/<collection>.svg`, drawn for every
 * collection a frame is) a profile wears, or null for Classic and for anything this build does not draw.
 */
export function coverOf(theme: string | undefined)
{
    const collection = theme?.startsWith('theme.') === true ? theme.slice('theme.'.length) : '';
    return (FRAMES as readonly string[]).includes(collection) ? collection as Frame : null;
}

const ambient = (collection: Frame, stream: Flow) => ({ stream, tune: { colors: AURAS[collection].tune.colors, scale: 0.6, density: 0.5 } });

/** What drifts across a themed cover on its profile page, in the collection's light. */
export const AMBIENTS = {
    glow: ambient('glow', 'aura'),
    shiraz: ambient('shiraz', 'glints'),
    neon: ambient('neon', 'arcs'),
    gold: ambient('gold', 'snow'),
    inferno: ambient('inferno', 'cinders'),
    storm: ambient('storm', 'static'),
    astral: ambient('astral', 'orbit'),
    void: ambient('void', 'wisps'),
    jade: ambient('jade', 'runes'),
    frost: ambient('frost', 'snow'),
    phoenix: ambient('phoenix', 'feathers'),
    oni: ambient('oni', 'pixels')
} satisfies Record<Frame, { stream: Flow; tune: Tune }>;

/**
 * Lets a theme's ambient drift across the whole of `band` until the answer is called, from an
 * engine fetched only then. Its host is the band's last child, so it lies over the cover and under
 * everything the header lays over the band; the area follows the band whatever its size.
 */
export function driftOver(band: HTMLElement, collection: Frame)
{
    const host = document.createElement('span');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.ambient = collection;
    host.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none';
    band.append(host);

    const effects = lazyVfx(host);
    const { stream, tune } = AMBIENTS[collection];
    let end = () => undefined as void;

    effects.play((vfx) =>
    {
        end = vfx.stream(stream, () => host.clientWidth === 0 ? null : { x: host.clientWidth / 2, y: host.clientHeight / 2 }, {
            ...tune,
            get area()
            {
                return { width: host.clientWidth, height: host.clientHeight };
            }
        });
    });

    return () =>
    {
        end();
        effects.dispose();
        host.remove();
    };
}

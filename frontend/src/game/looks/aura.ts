import type { Flow, Step, Tune, Vfx } from '../vfx/engine.ts';
import { lazyVfx } from '../vfx/lazy.ts';
import type { Frame } from './frames.ts';

/** What plays round its owner's picture on their own profile, in the collection's light; a legendary collection's is one of its own streams. */
export const AURAS = {
    glow: { stream: 'aura', tune: { colors: ['#FBE7A6', '#9CC2FF', '#FFFFFF'] } },
    shiraz: { stream: 'aura', tune: { colors: ['#E7BE63', '#B9F0E8', '#FFF4D6'] } },
    neon: { stream: 'arcs', tune: { colors: ['#FF46D2', '#38E8FF'] } },
    gold: { stream: 'aura', tune: { colors: ['#E9C565', '#FFFAE6', '#D9B044'] } },
    inferno: { stream: 'blaze', tune: { colors: ['#FFF1C1', '#FFC14D', '#FF7A1F', '#E2381C'] } },
    storm: { stream: 'static', tune: { colors: ['#EAF6FF', '#7DF0FF', '#3FA9FF', '#8B5CFF'] } },
    astral: { stream: 'orbit', tune: { colors: ['#FFFFFF', '#FFE58A', '#4FE3D8', '#B04BFF'] } },
    void: { stream: 'tendrils', tune: { colors: ['#E9D5FF', '#A855F7', '#5B21B6'] } },
    jade: { stream: 'coil', tune: { colors: ['#F2C14E', '#2BB67F'] } },
    frost: { stream: 'glints', tune: { colors: ['#FFFFFF', '#DFF3FF', '#8FD3FF'] } },
    phoenix: { stream: 'feathers', tune: { colors: ['#FFF6D6', '#FFC94A', '#FF7A1A', '#D7263D'] } },
    oni: { stream: 'pixels', tune: { colors: ['#20E6FF', '#FF2E4D', '#7C5CFF'] } }
} as const satisfies Record<Frame, { stream: Flow; tune: Tune }>;

/**
 * What a worn profile effect plays once round its owner's picture as their profile opens: a
 * legendary collection's signature, its layers at their moments (Inferno's magma cracks before the
 * flame erupts, Storm's charge before the strike), and a classic collection's burst.
 */
export const REVEALS = {
    glow: [{ effect: 'pulse' }, { effect: 'stars', after: 120, tune: { density: 1.8 } }],
    shiraz: [{ effect: 'shockwave' }, { effect: 'orbs', after: 120 }, { effect: 'dust', after: 160, tune: { density: 2.5 } }],
    neon: [{ effect: 'pulse' }, { effect: 'sparks', after: 100, tune: { density: 2.2 } }, { effect: 'shockwave', after: 180 }],
    gold: [{ effect: 'shockwave' }, { effect: 'burst', after: 80, tune: { density: 1.6 } }, { effect: 'stars', after: 260 }],
    inferno: [{ effect: 'cracks' }, { effect: 'eruption', after: 350 }],
    storm: [{ effect: 'charge' }, { effect: 'strike', after: 700 }, { effect: 'discharge', after: 760 }],
    astral: [{ effect: 'rift' }, { effect: 'starburst', after: 500 }, { effect: 'nebula', after: 600 }],
    void: [{ effect: 'absorb' }, { effect: 'fracture', after: 600 }, { effect: 'release', after: 900 }],
    jade: [{ effect: 'sigil' }, { effect: 'orbs', after: 400 }],
    frost: [{ effect: 'crystals' }, { effect: 'shatter', after: 700 }],
    phoenix: [{ effect: 'wings' }, { effect: 'flare', after: 450 }, { effect: 'sunburst', after: 550 }],
    oni: [{ effect: 'scan', dy: 9, tune: { intensity: 1.7 } }, { effect: 'glitch', after: 220, tune: { scale: 3.6, density: 2.4 } }, { effect: 'shockwave', after: 220 }, { effect: 'glitch', after: 620, tune: { scale: 3.2, density: 1.8 } }]
} as const satisfies Record<Frame, readonly Step[]>;

/** How long after its reveal's last layer begins a full set's sigil is struck, in ms. */
const STRIKE_AFTER = 450;

/** How large the strike's echo of a reveal is, as a share of the reveal. */
const ECHO = 0.45;

/** When a full set's sigil is struck, in ms from the start of its reveal: once the reveal's last layer has bloomed. */
export function struckAt(collection: Frame)
{
    const steps: readonly Step[] = REVEALS[collection];

    return Math.max(...steps.map((step) => step.after ?? 0)) + STRIKE_AFTER;
}

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

/**
 * A full set's strike, from its sigil: a ring, and the reveal's last layer that is not its ring
 * again, smaller, at the moment the sigil is struck.
 */
function strike(collection: Frame, sigil: HTMLElement, face: DOMRect, scale: number): Step[]
{
    const steps: readonly Step[] = REVEALS[collection];
    const mark = sigil.getBoundingClientRect();
    const dx = (mark.left + mark.width / 2 - face.left - face.width / 2) / scale;
    const dy = (mark.top + mark.height / 2 - face.top - face.height / 2) / scale;
    const after = struckAt(collection);
    const tune = { scale: scale * ECHO };
    const last = [...steps].reverse().find((step) => step.effect !== 'shockwave') ?? steps[0]!;

    return [{ effect: 'shockwave', after, dx, dy, tune }, { effect: last.effect, after, dx, dy, tune }];
}

/**
 * Plays a collection's reveal once round the picture whose box is `picture`, across the whole of
 * `head`, from an engine fetched only then; the answer lets go of it. Like the aura it is drawn
 * round the face and never over it: its host shows nothing inside the picture's circle. A profile
 * that wears the collection whole hands its set's mark on the frame as `sigil`, struck once the
 * reveal has played, and marked `data-struck` for the stylesheet to strike it at that moment.
 */
export function revealAround(head: HTMLElement, picture: HTMLElement, collection: Frame, sigil: HTMLElement | null = null)
{
    const host = document.createElement('span');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.reveal = collection;
    host.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none';
    head.append(host);

    const effects = lazyVfx(host);

    effects.play((vfx) =>
    {
        const area = head.getBoundingClientRect();
        const face = picture.getBoundingClientRect();

        if (face.width === 0)
        {
            return;
        }

        const at = { x: face.left - area.left + face.width / 2, y: face.top - area.top + face.height / 2 };
        const scale = face.width * RING / UNIT;
        host.style.setProperty('mask', `radial-gradient(circle at ${ at.x }px ${ at.y }px, transparent ${ face.width / 2 }px, #000 ${ face.width / 2 + 1 }px)`);
        vfx.signature(sigil === null ? REVEALS[collection] : [...REVEALS[collection], ...strike(collection, sigil, face, scale)], at, { colors: AURAS[collection].tune.colors, scale });

        if (sigil !== null)
        {
            sigil.style.setProperty('--struck', `${ struckAt(collection) }ms`);
            sigil.style.setProperty('--sigil-glow', AURAS[collection].tune.colors[1]);
            sigil.dataset.struck = '';
        }
    });

    return () =>
    {
        effects.dispose();
        host.remove();
    };
}

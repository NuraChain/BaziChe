import { runtime } from '../../lib/runtime.ts';
import { FAMILIES, FAMILY_STREAMS, type Family, type FamilyStream } from './families.ts';
import { move } from './motion.ts';
import { drawParticle } from './shapes.ts';
import { bolt as boltOf, flash, PRESETS, rolling, seeded, STREAMS, type Emitter, type Particle, type Point, type Preset, type Random, type Stream, type Tune } from './presets.ts';

export type { Point, Preset, Stream, Tune } from './presets.ts';
export type { Family, FamilyStream } from './families.ts';

/** Anything played once: a preset or an effect family. */
export type Effect = Preset | Family;

/** Anything that emits for as long as it runs. */
export type Flow = Stream | FamilyStream;

/** How much a device is asked to draw: fewer particles at a lower pixel ratio on a weaker one. */
export type Quality = 'low' | 'medium' | 'high';

/** One layer of a signature: an effect, how long after the signature began, and where from its point. */
export interface Step
{
    effect: Effect;
    after?: number;
    dx?: number;
    dy?: number;
    tune?: Tune;
}

export interface VfxOptions
{
    /** The most particles one canvas holds; past it the oldest go first. */
    ceiling?: number;

    /** Less motion asked for: a burst becomes one fade and a stream draws nothing. */
    quiet?: () => boolean;

    /** Asks for the next frame and answers how to take the request back. */
    frame?: (run: () => void) => () => void;

    /** The canvas's 2D context; a spec hands in one that counts. */
    context?: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null;

    /** Its z-index among its host's children, for a host that stacks its own layers. */
    layer?: number;

    /** How much this device draws; worked out from the device when not given. */
    quality?: Quality;
}

export interface Vfx
{
    /** Plays an effect once at a point of the host, in CSS pixels from its top left. */
    burst(effect: Effect, at: Point, tune?: Tune): void;

    /** Plays a signature: its layers at their times and places, as one effect. */
    signature(steps: readonly Step[], at: Point, tune?: Tune): void;

    /** A bolt of lightning from one point to another, flickering for its life. */
    bolt(from: Point, to: Point, tune?: Tune): void;

    /** Emits round a point the caller moves until the answer is called; a point of null pauses it. */
    stream(kind: Flow, at: () => Point | null, tune?: Tune): () => void;

    /** Where the pointer is over the host, for the particles that lean toward it; null once it leaves. */
    lean(at: Point | null): void;

    /** How many particles are alive. */
    live(): number;

    clear(): void;
    dispose(): void;
}

export const CEILING = 420;

/** The most particles every canvas of a page holds between them. */
export const PAGE_CEILING = 900;

export const QUALITY: Record<Quality, { density: number; ratio: number; ceiling: number }> = {
    low: { density: 0.45, ratio: 1, ceiling: 0.5 },
    medium: { density: 0.7, ratio: 1.5, ceiling: 0.75 },
    high: { density: 1, ratio: 2, ceiling: 1 }
};

const STEP_MOST = 50;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What this device can draw: low under a finger, Save-Data or four cores and fewer, medium on six, high above. */
export function qualityOf(): Quality
{
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const saving = typeof navigator !== 'undefined' && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 8 : 8;

    if (coarse || saving || cores <= 4)
    {
        return 'low';
    }
    return cores <= 6 ? 'medium' : 'high';
}

const animationFrame = (run: () => void) =>
{
    if (typeof requestAnimationFrame !== 'function')
    {
        const handle = setTimeout(run, 16);
        return () => clearTimeout(handle);
    }
    const handle = requestAnimationFrame(run);
    return () => cancelAnimationFrame(handle);
};

const EMITTERS: Record<Flow, Emitter> = { ...STREAMS, ...FAMILY_STREAMS };

const EFFECTS: Record<Effect, (at: Point, tune: Tune) => Particle[]> = { ...PRESETS, ...FAMILIES };

/** Every canvas of the page drawing now, for the cap they share. */
const drawing = new Set<Particle[]>();

const onPage = () =>
{
    let count = 0;
    for (const particles of drawing)
    {
        count += particles.length;
    }
    return count;
};

interface Running
{
    kind: Flow;
    at: () => Point | null;
    tune: Tune;
    owed: number;

    /** A seeded stream's one roll for its whole run, so each batch goes on from the last. */
    random: Random | null;
}

/** Plays `make` from the tune's seed when it has one. */
const played = (tune: Tune, make: () => Particle[]) => (tune.seed === undefined ? make() : rolling(seeded(tune.seed), make));

/** A canvas laid over `host` that draws particles only while some live. */
export function createVfx(host: HTMLElement, options: VfxOptions = {})
{
    const quality = QUALITY[options.quality ?? qualityOf()];
    const ceiling = Math.round((options.ceiling ?? CEILING) * quality.ceiling);
    const quiet = options.quiet ?? reduced;
    const frame = options.frame ?? animationFrame;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${ options.layer ?? 'var(--layer-burst,70)' }`;
    host.append(canvas);

    const context = (options.context ?? ((one) => one.getContext('2d')))(canvas);
    const particles: Particle[] = [];
    const streams = new Set<Running>();

    let pending: (() => void) | null = null;
    let last = 0;
    let width = 0;
    let height = 0;
    let gone = false;
    let pointer: Point | null = null;
    let onScreen = true;

    const fit = () =>
    {
        const ratio = Math.min(quality.ratio, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
        const nextWidth = host.clientWidth;
        const nextHeight = host.clientHeight;

        if (nextWidth !== width || nextHeight !== height)
        {
            width = nextWidth;
            height = nextHeight;
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
        }
        context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const hidden = () => (typeof document !== 'undefined' && document.visibilityState === 'hidden') || !onScreen;

    const tuned = (tune: Tune): Tune => ({ ...tune, density: (tune.density ?? 1) * quality.density });

    const add = (born: readonly Particle[]) =>
    {
        particles.push(...born);
        const over = Math.max(particles.length - ceiling, onPage() - PAGE_CEILING);
        if (over > 0)
        {
            particles.splice(0, Math.min(over, particles.length));
        }
    };

    const step = (ms: number) =>
    {
        const seconds = ms / 1000;

        for (const running of streams)
        {
            const point = running.at();
            if (point === null)
            {
                continue;
            }
            running.owed += seconds * EMITTERS[running.kind].rate * (running.tune.density ?? 1);
            const count = Math.floor(running.owed);
            running.owed -= count;
            if (count > 0)
            {
                const spawn = () => EMITTERS[running.kind].spawn(point, running.tune, count);
                add(running.random === null ? spawn() : rolling(running.random, spawn));
            }
        }

        let kept = 0;
        for (const particle of particles)
        {
            particle.age += ms;
            if (particle.age >= particle.life)
            {
                continue;
            }
            particles[kept] = particle;
            kept += 1;
            if (particle.age < 0)
            {
                continue;
            }
            move(particle, ms, pointer);
        }
        particles.length = kept;
    };

    const draw = () =>
    {
        if (context === null)
        {
            return;
        }
        context.clearRect(0, 0, width, height);
        for (const particle of particles)
        {
            drawParticle(context, particle);
        }
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
    };

    const alive = () => particles.length > 0 || streams.size > 0;

    const tick = () =>
    {
        pending = null;
        if (gone || hidden())
        {
            return;
        }
        const now = runtime().clock.now();
        step(Math.min(STEP_MOST, Math.max(0, now - last)));
        last = now;
        fit();
        draw();
        if (alive())
        {
            pending = frame(tick);
        }
    };

    const wake = () =>
    {
        if (pending === null && !gone && !hidden() && alive())
        {
            last = runtime().clock.now();
            pending = frame(tick);
        }
    };

    const seen = () => wake();
    document.addEventListener('visibilitychange', seen);

    const watcher = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) =>
        {
            onScreen = entries.some((entry) => entry.isIntersecting);
            wake();
        })
        : null;
    watcher?.observe(host);
    drawing.add(particles);

    const vfx: Vfx = {
        burst(effect, at, tune = {})
        {
            const lit = tuned(tune);
            add(quiet() ? flash(at, lit) : played(lit, () => EFFECTS[effect](at, lit)));
            wake();
        },

        signature(steps, at, tune = {})
        {
            if (quiet())
            {
                add(flash(at, tuned(tune)));
                wake();
                return;
            }
            const lit = tuned(tune);
            add(played(lit, () => steps.flatMap((one) =>
            {
                const born = EFFECTS[one.effect]({ x: at.x + (one.dx ?? 0) * (lit.scale ?? 1), y: at.y + (one.dy ?? 0) * (lit.scale ?? 1) }, { ...lit, ...one.tune });
                for (const particle of born)
                {
                    particle.age -= one.after ?? 0;
                }
                return born;
            })));
            wake();
        },

        bolt(from, to, tune = {})
        {
            const lit = tuned(tune);
            add(quiet() ? flash(to, lit) : played(lit, () => boltOf(from, to, lit)));
            wake();
        },

        stream(kind, at, tune = {})
        {
            if (quiet())
            {
                return () => undefined;
            }
            const running: Running = { kind, at, tune: tuned(tune), owed: 0, random: tune.seed === undefined ? null : seeded(tune.seed) };
            streams.add(running);
            wake();
            return () =>
            {
                streams.delete(running);
            };
        },

        lean(at)
        {
            pointer = at;
        },

        live: () => particles.length,

        clear()
        {
            particles.length = 0;
            streams.clear();
            draw();
        },

        dispose()
        {
            gone = true;
            pending?.();
            pending = null;
            particles.length = 0;
            streams.clear();
            drawing.delete(particles);
            watcher?.disconnect();
            document.removeEventListener('visibilitychange', seen);
            canvas.remove();
        }
    };

    return vfx;
}

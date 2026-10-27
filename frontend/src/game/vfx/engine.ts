import { runtime } from '../../lib/runtime.ts';
import { drawParticle } from './shapes.ts';
import { bolt as boltOf, flash, PRESETS, STREAMS, type Particle, type Point, type Preset, type Stream, type Tune } from './presets.ts';

export type { Point, Preset, Stream, Tune } from './presets.ts';

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
}

export interface Vfx
{
    /** Plays a preset once at a point of the host, in CSS pixels from its top left. */
    burst(preset: Preset, at: Point, tune?: Tune): void;

    /** A bolt of lightning from one point to another, flickering for its life. */
    bolt(from: Point, to: Point, tune?: Tune): void;

    /** Emits round a point the caller moves until the answer is called; a point of null pauses it. */
    stream(kind: Stream, at: () => Point | null, tune?: Tune): () => void;

    /** How many particles are alive. */
    live(): number;

    clear(): void;
    dispose(): void;
}

export const CEILING = 420;

const STEP_MOST = 50;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

interface Running
{
    kind: Stream;
    at: () => Point | null;
    tune: Tune;
    owed: number;
}

/** A canvas laid over `host` that draws particles only while some live. */
export function createVfx(host: HTMLElement, options: VfxOptions = {})
{
    const ceiling = options.ceiling ?? CEILING;
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

    const fit = () =>
    {
        const ratio = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
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

    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const add = (born: readonly Particle[]) =>
    {
        particles.push(...born);
        if (particles.length > ceiling)
        {
            particles.splice(0, particles.length - ceiling);
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
            running.owed += seconds * STREAMS[running.kind].rate * (running.tune.density ?? 1);
            const count = Math.floor(running.owed);
            running.owed -= count;
            if (count > 0)
            {
                add(STREAMS[running.kind].spawn(point, running.tune, count));
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
            particle.vx *= 1 - particle.drag * seconds;
            particle.vy = particle.vy * (1 - particle.drag * seconds) + particle.gravity * seconds;
            particle.x += particle.vx * seconds;
            particle.y += particle.vy * seconds;
            particle.turn += particle.spin * seconds;
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

    const vfx: Vfx = {
        burst(preset, at, tune = {})
        {
            add(quiet() ? flash(at, tune) : PRESETS[preset](at, tune));
            wake();
        },

        bolt(from, to, tune = {})
        {
            add(quiet() ? flash(to, tune) : boltOf(from, to, tune));
            wake();
        },

        stream(kind, at, tune = {})
        {
            if (quiet())
            {
                return () => undefined;
            }
            const running: Running = { kind, at, tune, owed: 0 };
            streams.add(running);
            wake();
            return () =>
            {
                streams.delete(running);
            };
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
            document.removeEventListener('visibilitychange', seen);
            canvas.remove();
        }
    };

    return vfx;
}

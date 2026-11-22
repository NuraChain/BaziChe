import type { GameId } from '../data/games.ts';
import type { Beat, WorldHandle } from './bridge.ts';
import { pickTier, type Choice } from './quality/tiers.ts';

const SLOW_NETWORKS = ['slow-2g', '2g', '3g'];

export interface Conditions
{
    reducedMotion: boolean;

    saveData: boolean;

    effectiveType: string;

    memory: number;
}

export interface Opened
{
    context: WebGL2RenderingContext;

    choice: Choice;
}

export function refused(conditions: Conditions)
{
    return conditions.reducedMotion
        || conditions.saveData
        || SLOW_NETWORKS.includes(conditions.effectiveType)
        || (conditions.memory > 0 && conditions.memory <= 2);
}

export function openWorld(canvas: HTMLCanvasElement): Opened | null
{
    const device = navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
        deviceMemory?: number;
    };
    const memory = device.deviceMemory ?? 0;

    if (refused({
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        saveData: device.connection?.saveData === true,
        effectiveType: device.connection?.effectiveType ?? '',
        memory
    }))
    {
        return null;
    }

    const choice = pickTier({
        cores: navigator.hardwareConcurrency ?? 0,
        memory,
        width: window.innerWidth,
        height: window.innerHeight
    });

    try
    {
        const context = canvas.getContext('webgl2', {
            alpha: true,
            antialias: choice.tier !== 'low',
            depth: true,
            stencil: false,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: true,
            preserveDrawingBuffer: false
        });
        return context === null ? null : { context, choice };
    }
    catch
    {
        return null;
    }
}

export interface TourStage
{
    focus(id: GameId | null): void;
    orbit(degrees: number): void;
    refresh(): void;
    dispose(): void;
}

interface StageEvents
{
    onChapter(id: GameId | null): void;
    onTour(visible: boolean): void;
    onLive(ready: boolean): void;
    preview(): GameId | null;
}

export function attachStage(host: HTMLElement, canvas: HTMLCanvasElement, events: StageEvents): TourStage
{
    const theater = host.parentElement!;
    const sections = [...theater.querySelectorAll<HTMLElement>('[data-beat]')];
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let beats: Beat[] = [];
    let world: WorldHandle | null = null;
    let active = -1;
    let tourStart = Infinity;
    let tourEnd = Infinity;
    let showingPicker = false;
    let visible = true;
    let scrollFrame = 0;
    let layoutFrame = 0;
    let generation = 0;
    let disposed = false;
    let opening = false;
    let failed = false;

    const scroll = () =>
    {
        scrollFrame = 0;
        const y = window.scrollY;
        let index = 0;
        while (index + 1 < beats.length && y >= (beats[index].at + beats[index + 1].at) / 2)
        {
            index += 1;
        }
        if (active !== index)
        {
            active = index;
            events.onChapter((sections[index]?.dataset.chapter as GameId | undefined) ?? null);
            world?.focus(events.preview());
        }
        const reading = y >= tourStart && y < tourEnd;
        if (showingPicker !== reading)
        {
            showingPicker = reading;
            events.onTour(reading);
        }
        world?.setScroll(y);
    };

    const layout = () =>
    {
        layoutFrame = 0;
        const height = host.clientHeight;
        beats = sections.map((element, index) =>
        {
            const box = element.getBoundingClientRect();
            // The camera comes to rest when the chapter's centre meets the viewport's centre.
            return { name: element.dataset.beat!, at: index === 0 ? 0 : box.top + window.scrollY + (box.height - height) / 2 };
        });
        const topbar = document.querySelector('.site-header')?.getBoundingClientRect().height ?? 60;
        const firstTable = sections[1]?.getBoundingClientRect();
        const lastTable = sections[sections.length - 1]?.getBoundingClientRect();
        tourStart = firstTable ? firstTable.top + window.scrollY - topbar - 1 : Infinity;
        tourEnd = lastTable ? lastTable.bottom + window.scrollY - topbar : Infinity;
        world?.measure(beats);
        scroll();
        const style = getComputedStyle(host);
        world?.setFrame(parseFloat(style.getPropertyValue('--subject-x')), parseFloat(style.getPropertyValue('--subject-y')));
    };

    const refresh = () =>
    {
        if (!disposed && layoutFrame === 0) layoutFrame = requestAnimationFrame(layout);
    };
    const onScroll = () =>
    {
        if (scrollFrame === 0) scrollFrame = requestAnimationFrame(scroll);
    };
    const onPointer = (event: PointerEvent) =>
    {
        if (visible && event.pointerType === 'mouse')
        {
            world?.setPointer(2 * event.clientX / innerWidth - 1, 1 - 2 * event.clientY / innerHeight);
        }
    };
    const visibility = () =>
    {
        if (visible && !document.hidden && !motion.matches) world?.resume();
        else world?.pause();
    };

    const retire = () =>
    {
        generation += 1;
        events.onLive(false);
        const previous = world;
        world = null;
        previous?.dispose();
    };

    const start = async () =>
    {
        const ticket = generation;
        if (motion.matches || disposed || opening || failed) return;
        const opened = openWorld(canvas);
        if (opened === null) return;
        opening = true;

        try
        {
            const { createWorld } = await import('./world.ts');
            if (ticket !== generation)
            {
                opened.context.getExtension('WEBGL_lose_context')?.loseContext();
                return;
            }
            const handle = await createWorld({
                canvas, context: opened.context, choice: opened.choice, assetBase: '/world',
                callbacks: { onFailed: () => { if (ticket === generation) { failed = true; retire(); } } }
            });
            if (ticket !== generation)
            {
                handle.dispose();
                return;
            }
            world = handle;
            handle.focus(events.preview());
            layout();
            visibility();
            events.onLive(!motion.matches);
        }
        catch
        {
            if (ticket === generation)
            {
                opened.context.getExtension('WEBGL_lose_context')?.loseContext();
                failed = true;
                retire();
            }
        }
        finally
        {
            opening = false;
        }
    };

    const onMotion = () =>
    {
        if (world !== null)
        {
            visibility();
            events.onLive(!motion.matches);
        }
        else if (!motion.matches)
        {
            void start();
        }
    };

    const resize = new ResizeObserver(refresh);
    resize.observe(theater);
    resize.observe(host);
    const intersection = new IntersectionObserver(([entry]) =>
    {
        visible = entry.isIntersecting;
        visibility();
    });
    intersection.observe(host);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', onMotion);
    void document.fonts.ready.then(refresh);
    layout();
    void start();
    return {
        focus(id) { world?.focus(id); },
        orbit(degrees) { world?.setOrbit(degrees); },
        refresh,
        dispose()
        {
            disposed = true;
            retire();
            resize.disconnect();
            intersection.disconnect();
            cancelAnimationFrame(scrollFrame);
            cancelAnimationFrame(layoutFrame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('pointermove', onPointer);
            document.removeEventListener('visibilitychange', visibility);
            motion.removeEventListener('change', onMotion);
        }
    };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, createSignal } from 'azerothjs';

import MediaViewer, { DISMISS, DOUBLE_MS, SWIPE } from '../src/components/chat/media-viewer.component.azeroth';
import '../src/icons/all.ts';
import type { Message } from '../src/data/chat.ts';
import { sealFile } from '../src/lib/chat-file.ts';
import { forgetFile, heldFile } from '../src/lib/file-held.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { ChatFileError, setChatFiles, type ChatFileFailure } from '../src/services/chat-files.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useFileLoads } from '../src/stores/file-loads.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/**
 * The viewer (MS-D24): a photo or a video over the conversation, the whole window, fetched as it is
 * shown with how much has come; the room's photos and videos walked by the buttons, the arrows and a
 * swipe in the order the page reads; a photo zoomed and moved; closed by a press beside it or a drag
 * down; a video played large from where its bubble left it; and what it fetched and never showed let
 * go as it closes.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 300 }, (_, at) => at % 200)]);

const FILM = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, ...Array.from({ length: 300 }, (_, at) => at % 100)]);

let clock: ManualClock;

let kept = new Map<string, Uint8Array>();

const downloads: string[] = [];

const fetching = { door: null as Promise<void> | null, refuse: new Map<string, ChatFileFailure>() };

/** One photo or video of the thread, sealed as a sender's browser seals it. */
const media = async (place: number, as: 'photo' | 'video' = 'photo', text = ''): Promise<Message> =>
{
    const id = crypto.randomUUID();
    const sealed = await sealFile(as === 'photo' ? JPEG : FILM, id);

    kept.set(id, sealed.body);

    return {
        id: `m-${ place }`,
        conversationId: 'c-1',
        from: 'sara.k',
        kind: 'file',
        text,
        at: 1_700_000_000_000 + place * 60_000,
        ref: null,
        file: {
            id,
            key: sealed.key,
            iv: sealed.iv,
            as,
            mime: as === 'photo' ? 'image/jpeg' : 'video/mp4',
            name: as === 'photo' ? `p${ place }.jpg` : `v${ place }.mp4`,
            bytes: 1_048_576,
            w: 1600,
            h: 1200,
            thumb: 'AAAA',
            ...(as === 'video' ? { ms: 12_000 } : {})
        }
    };
};

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const open = async (all: Message[], start: Message, extra: Partial<{ from: number; playing: boolean; older: () => Promise<boolean> }> = {}) =>
{
    const [list, setList] = createSignal<readonly Message[]>(all);
    const closed: unknown[] = [];
    const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
    const container = renderTest(() => RouterProvider({
        router,
        children: () => MediaViewer({ overlayId: 'media-viewer', close: (result) => closed.push(result ?? 'closed'), start, list, ...extra })
    }) as HTMLElement).container;
    const stage = container.querySelector<HTMLElement>('[data-stage]')!;

    Object.defineProperty(stage, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 56, right: 800, bottom: 656, width: 800, height: 600, x: 0, y: 56 }) });
    await settle();

    return { container, stage, closed, setList };
};

const counted = (container: HTMLElement) => container.querySelector('[data-count]')?.textContent?.trim();

const shownId = (container: HTMLElement) => container.querySelector('[data-shown]')?.getAttribute('data-shown');

const scaleOf = (container: HTMLElement) => Number(/scale\(([\d.]+)\)/.exec(container.querySelector<HTMLElement>('[data-media]')?.style.transform ?? '')?.[1] ?? 'NaN');

const shiftOf = (container: HTMLElement) => /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(container.querySelector<HTMLElement>('[data-media]')?.style.transform ?? '')?.slice(1, 3).map(Number);

const pointer = (target: Element, type: string, x: number, y: number, pointerId = 1, pointerType = 'touch') =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, pointerType, button: 0 }));

/** A finger put down at one place and lifted at another. */
const drag = (target: Element, from: [number, number], to: [number, number]) =>
{
    pointer(target, 'pointerdown', ...from);
    pointer(target, 'pointermove', ...to);
    pointer(target, 'pointerup', ...to);
};

const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_700_000_100_000);
    setRuntime({ clock, seed: 2 });
    useLocale().setLocale('en');
    useDevice().overrideCoarse(false);
    kept = new Map();
    downloads.length = 0;
    fetching.door = null;
    fetching.refuse.clear();
    forgetFile();
    useFileLoads().reset();
    setChatFiles({
        upload: () => Promise.resolve(),
        async download(id, progress)
        {
            downloads.push(id);
            progress(0.4);

            if (fetching.door !== null)
            {
                await fetching.door;
            }

            const refused = fetching.refuse.get(id);

            if (refused !== undefined)
            {
                throw new ChatFileError(refused);
            }

            const body = kept.get(id);

            if (body === undefined)
            {
                throw new ChatFileError('file-missing');
            }

            return body;
        }
    });
});

afterEach(() =>
{
    cleanup();
    setChatFiles(null);
    forgetFile();
    useDevice().overrideCoarse(null);
});

describe('the viewer', () =>
{
    it('opens on the one pressed, says which of how many, who sent it and when, and fetches it and the photos beside it', async () =>
    {
        const all = [await media(0), await media(1, 'photo', 'At the **coast**'), await media(2)];
        const { container } = await open(all, all[1]);

        expect(counted(container)).toBe('2 of 3');
        expect(container.querySelector('[data-sender]')?.textContent).toBe('sara.k');
        expect(container.querySelector('[data-when]')?.textContent).toBe(useLocale().date(all[1].at, { dateStyle: 'medium', timeStyle: 'short' }));
        expect(container.querySelector('[data-caption]')?.textContent?.trim()).toBe('At the coast');
        expect(downloads, 'the one shown first, then either side').toEqual([all[1].file!.id, all[0].file!.id, all[2].file!.id]);

        await vi.waitFor(() => expect(container.querySelector('[data-original]')?.getAttribute('src')).toMatch(/^blob:/));
        expect(container.querySelector('[data-original]')?.getAttribute('alt')).toBe('At the coast');
        expect(container.querySelector('[data-original]')?.getAttribute('draggable'), 'never the browser’s own drag, which would cancel a pan').toBe('false');
    });

    it('walks the room’s photos and videos by its buttons and the arrows, the way the page reads', async () =>
    {
        const all = [await media(0), await media(1, 'video'), await media(2)];
        const { container } = await open(all, all[0]);
        const viewer = container.querySelector('[data-viewer]')!;

        expect(container.querySelector('[data-previous]'), 'nothing before the first').toBeNull();

        fire(container.querySelector('[data-next]')!, 'click');
        expect([counted(container), shownId(container)]).toEqual(['2 of 3', 'm-1']);

        key(viewer, 'ArrowRight');
        expect(counted(container)).toBe('3 of 3');
        expect(container.querySelector('[data-next]'), 'nothing after the last').toBeNull();

        key(viewer, 'ArrowRight');
        expect(counted(container), 'still the last').toBe('3 of 3');

        fire(container.querySelector('[data-previous]')!, 'click');
        key(viewer, 'ArrowLeft');
        expect(counted(container)).toBe('1 of 3');
    });

    it('keeps the keyboard in itself when the photo or the space beside it is pressed, so its keys go on working', async () =>
    {
        const all = [await media(0), await media(1)];
        const { container } = await open(all, all[0]);
        const viewer = container.querySelector<HTMLElement>('[data-viewer]')!;

        // A press moves the keyboard to the nearest thing that can hold it. With nothing in the viewer
        // able to, that was the dialog round it, where its keys were never heard.
        expect(viewer.getAttribute('tabindex')).toBe('-1');

        viewer.focus();
        key(document.activeElement!, 'ArrowRight');
        expect(counted(container)).toBe('2 of 2');
    });

    it('goes on to the next by the left arrow for a reader of Persian, its buttons on their sides', async () =>
    {
        useLocale().setLocale('fa');

        const all = [await media(0), await media(1), await media(2)];
        const { container } = await open(all, all[1]);

        expect(counted(container)).toBe('۲ از ۳');
        expect(container.querySelector('[data-next]')?.className).toContain('left-2');
        expect(container.querySelector('[data-previous]')?.className).toContain('right-2');

        key(container.querySelector('[data-viewer]')!, 'ArrowLeft');
        expect(counted(container)).toBe('۳ از ۳');
    });

    it('steps back past its first into older ones it reads, and stops where there are none', async () =>
    {
        const [ a, b, c ] = [ await media(0), await media(1), await media(2) ];
        let reads = 0;
        const { container, setList } = await open([ b, c ], b, {
            older: async () =>
            {
                reads += 1;

                if (reads === 1)
                {
                    setList([ a, b, c ]);
                    return true;
                }

                return false;
            }
        });

        expect(counted(container)).toBe('1 of 2');
        expect(container.querySelector('[data-previous]'), 'offered while there may be older ones').not.toBeNull();

        fire(container.querySelector('[data-previous]')!, 'click');
        await vi.waitFor(() => expect(shownId(container)).toBe(a.id));
        expect(counted(container)).toBe('1 of 3');

        key(container.querySelector('[data-viewer]')!, 'ArrowLeft');
        await vi.waitFor(() => expect(reads).toBe(2));
        await settle();
        expect(shownId(container), 'nothing older came').toBe(a.id);
        expect(container.querySelector('[data-previous]'), 'none once there are no more').toBeNull();

        key(container.querySelector('[data-viewer]')!, 'ArrowLeft');
        await settle();
        expect(reads, 'not asked again').toBe(2);
    });

    it('reads a caption in its own direction, whatever way the page reads', async () =>
    {
        useLocale().setLocale('fa');

        const all = [await media(0, 'photo', 'From the coast!')];
        const { container } = await open(all, all[0]);

        expect(container.querySelector('[data-caption]')?.getAttribute('dir')).toBe('auto');
    });

    it('takes a swipe across to the next or the previous, the way the page reads, and a drag down closes it', async () =>
    {
        const all = [await media(0), await media(1), await media(2)];
        const { container, stage, closed } = await open(all, all[1]);

        drag(stage, [400, 300], [400 - SWIPE - 10, 310]);
        expect(counted(container)).toBe('3 of 3');

        drag(stage, [300, 300], [300 + SWIPE + 10, 290]);
        expect(counted(container)).toBe('2 of 3');

        drag(stage, [300, 300], [300 + SWIPE - 20, 300]);
        expect([counted(container), shiftOf(container)], 'too short a swipe goes back where it was').toEqual(['2 of 3', [0, 0]]);

        drag(stage, [300, 200], [310, 200 + DISMISS + 20]);
        expect(closed).toEqual(['closed']);
    });

    it('follows a finger across before it lets go', async () =>
    {
        const all = [await media(0), await media(1)];
        const { container, stage } = await open(all, all[0]);

        pointer(stage, 'pointerdown', 400, 300);
        pointer(stage, 'pointermove', 360, 305);

        expect(shiftOf(container)).toEqual([-40, 0]);

        stage.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
        expect([shiftOf(container), counted(container)], 'a swipe the browser took away goes back').toEqual([[0, 0], '1 of 2']);
    });

    it('has no buttons beside the picture under a finger, which swipes', async () =>
    {
        useDevice().overrideCoarse(true);

        const all = [await media(0), await media(1), await media(2)];
        const { container } = await open(all, all[1]);

        expect([container.querySelector('[data-previous]'), container.querySelector('[data-next]')]).toEqual([null, null]);
    });

    it('zooms a photo by the wheel, a double press and the keys, moves it while zoomed, and starts each one whole', async () =>
    {
        const all = [await media(0), await media(1)];
        const { container } = await open(all, all[0]);
        const viewer = container.querySelector('[data-viewer]')!;

        await vi.waitFor(() => expect(container.querySelector('[data-original]')).not.toBeNull());

        const photo = container.querySelector('[data-original]')!;

        // happy-dom's WheelEvent keeps no place on the screen, which every browser's does.
        const wheel = new WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true });

        Object.defineProperties(wheel, { clientX: { value: 400 }, clientY: { value: 356 } });
        photo.dispatchEvent(wheel);
        expect(scaleOf(container)).toBeCloseTo(Math.E, 3);
        expect([wheel.defaultPrevented, shiftOf(container)], 'the page does not scroll, and the place under the pointer stays').toEqual([true, [0, 0]]);

        drag(photo, [400, 356], [460, 386]);
        expect(shiftOf(container), 'moved while zoomed, not taken to the next').toEqual([60, 30]);
        expect(counted(container)).toBe('1 of 2');

        key(viewer, '0');
        expect([scaleOf(container), shiftOf(container)]).toEqual([1, [0, 0]]);

        key(viewer, '+');
        expect(scaleOf(container)).toBe(1.5);

        key(viewer, '-');
        expect(scaleOf(container)).toBe(1);

        container.querySelector('[data-shown]')!.dispatchEvent(new MouseEvent('dblclick', { clientX: 10, clientY: 70, bubbles: true }));
        expect(scaleOf(container), 'a double press beside it zooms nothing').toBe(1);

        photo.dispatchEvent(new MouseEvent('dblclick', { clientX: 400, clientY: 356, bubbles: true }));
        expect(scaleOf(container)).toBe(2.5);

        fire(container.querySelector('[data-next]')!, 'click');
        expect([counted(container), scaleOf(container)]).toEqual(['2 of 2', 1]);
    });

    it('zooms at a finger’s double press, and at a pinch about the fingers', async () =>
    {
        const all = [await media(0)];
        const { container } = await open(all, all[0]);

        await vi.waitFor(() => expect(container.querySelector('[data-original]')).not.toBeNull());

        const photo = container.querySelector('[data-original]')!;

        pointer(photo, 'pointerdown', 400, 356);
        pointer(photo, 'pointerup', 400, 356);
        clock.advance(DOUBLE_MS - 50);
        pointer(photo, 'pointerdown', 402, 357);
        pointer(photo, 'pointerup', 402, 357);
        expect(scaleOf(container)).toBe(2.5);

        pointer(photo, 'pointerdown', 400, 356);
        pointer(photo, 'pointerup', 400, 356);
        clock.advance(DOUBLE_MS + 50);
        pointer(photo, 'pointerdown', 400, 356);
        pointer(photo, 'pointerup', 400, 356);
        expect(scaleOf(container), 'two presses too far apart in time are not one').toBe(2.5);

        clock.advance(DOUBLE_MS);
        pointer(photo, 'pointerdown', 400, 356);
        pointer(photo, 'pointerup', 400, 356);
        clock.advance(10);
        pointer(photo, 'pointerdown', 400, 356);
        pointer(photo, 'pointerup', 400, 356);
        expect(scaleOf(container), 'and back to whole').toBe(1);

        pointer(photo, 'pointerdown', 350, 356, 1);
        pointer(photo, 'pointerdown', 450, 356, 2);
        pointer(photo, 'pointermove', 300, 356, 1);
        pointer(photo, 'pointermove', 500, 356, 2);
        expect(scaleOf(container), 'twice as far apart').toBe(2);

        pointer(photo, 'pointerup', 300, 356, 1);
        pointer(photo, 'pointermove', 540, 376, 2);
        expect([scaleOf(container), shiftOf(container)], 'the finger left moves it').toEqual([2, [40, 20]]);

        pointer(photo, 'pointerup', 540, 376, 2);
        expect(scaleOf(container), 'kept once the fingers are lifted').toBe(2);
    });

    it('closes at a press beside the picture, and not at one on it nor on its own buttons', async () =>
    {
        const all = [await media(0), await media(1)];
        const { container, stage, closed } = await open(all, all[0]);

        await vi.waitFor(() => expect(container.querySelector('[data-original]')).not.toBeNull());

        pointer(container.querySelector('[data-original]')!, 'pointerdown', 400, 356, 1, 'mouse');
        pointer(container.querySelector('[data-original]')!, 'pointerup', 400, 356, 1, 'mouse');
        expect(closed).toEqual([]);

        pointer(container.querySelector('[data-next]')!, 'pointerdown', 780, 356, 1, 'mouse');
        pointer(container.querySelector('[data-next]')!, 'pointerup', 780, 356, 1, 'mouse');
        expect(closed, 'its own buttons are not beside it').toEqual([]);

        pointer(container.querySelector('[data-shown]')!, 'pointerdown', 10, 70, 1, 'mouse');
        pointer(container.querySelector('[data-shown]')!, 'pointerup', 10, 70, 1, 'mouse');
        expect(closed).toEqual(['closed']);

        fire(container.querySelector('[data-close]')!, 'click');
        expect(closed).toHaveLength(2);
        expect(stage.isConnected).toBe(true);
    });

    it('says how much has come, and why one cannot come, with Try again', async () =>
    {
        const all = [await media(0)];
        let release: () => void = () => undefined;

        fetching.door = new Promise<void>((resolve) =>
        {
            release = resolve;
        });

        const { container } = await open(all, all[0]);

        await vi.waitFor(() => expect(container.querySelector('[data-coming]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Downloading, 40%'));
        expect(container.querySelector('[data-save]')?.getAttribute('aria-disabled'), 'nothing to save yet').toBe('true');

        fetching.refuse.set(all[0].file!.id, 'network');
        release();

        await vi.waitFor(() => expect(container.querySelector('[data-fault]')?.getAttribute('data-fault')).toBe('failed'));
        expect(container.querySelector('[data-fault]')?.textContent).toContain('This file could not be downloaded.');

        fetching.door = null;
        fetching.refuse.clear();
        fire(container.querySelector('[data-retry]')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[data-original]')).not.toBeNull());
        expect(downloads).toEqual([all[0].file!.id, all[0].file!.id]);
    });

    it('saves the original under its name once it has come', async () =>
    {
        const all = [await media(0)];
        const { container } = await open(all, all[0]);

        await vi.waitFor(() => expect(container.querySelector('[data-save]')?.getAttribute('href')).toMatch(/^blob:/));

        const save = container.querySelector('[data-save]')!;

        expect([save.getAttribute('download'), save.getAttribute('aria-label'), save.getAttribute('aria-disabled')]).toEqual(['p0.jpg', 'Save p0.jpg', null]);
    });

    it('plays a video large with its player, from where its bubble left it', async () =>
    {
        const all = [await media(0), await media(1, 'video', 'The harbour'), await media(2)];
        const { container } = await open(all, all[1], { from: 4, playing: true });

        await vi.waitFor(() => expect(container.querySelector('[data-player] video')).not.toBeNull(), { timeout: 4000 });
        await settle();

        const video = container.querySelector('video')!;

        expect([video.currentTime, video.paused]).toEqual([4, false]);
        expect(container.querySelector('[data-player]')?.getAttribute('aria-label')).toBe('The harbour');
        expect(container.querySelector('[data-original]'), 'and no picture of it').toBeNull();
        expect(container.querySelector('[data-speed]')?.className, 'large: the speed always there').not.toContain('hidden');
        expect(container.querySelectorAll('[data-range]'), 'and its loudness on a range').toHaveLength(2);

        const player = container.querySelector('[data-player]')!;

        player.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect([video.currentTime, counted(container)], 'the arrows in its player are the player’s').toEqual([9, '2 of 3']);

        fire(container.querySelector('[data-previous]')!, 'click');
        fire(container.querySelector('[data-next]')!, 'click');
        await vi.waitFor(() => expect(container.querySelector('[data-player] video')).not.toBeNull(), { timeout: 4000 });
        await settle();

        const again = container.querySelector('video')!;

        expect([again === video, again.currentTime, again.paused], 'seen again, it begins at its start, waiting to be played').toEqual([false, 0, true]);
    });

    it('fetches only photos beside the one shown, never a video', async () =>
    {
        const all = [await media(0, 'video'), await media(1), await media(2, 'video')];

        await open(all, all[1]);

        expect(downloads).toEqual([all[1].file!.id]);
    });

    it('lets go, as it closes, of what it fetched and never showed, and keeps what it showed', async () =>
    {
        const all = [await media(0), await media(1), await media(2)];
        const { container } = await open(all, all[0]);

        await vi.waitFor(() => expect(heldFile(all[1].file!.id)).not.toBeNull());
        fire(container.querySelector('[data-next]')!, 'click');
        await vi.waitFor(() => expect(heldFile(all[2].file!.id)).not.toBeNull());

        cleanup();

        expect([heldFile(all[0].file!.id) !== null, heldFile(all[1].file!.id) !== null, heldFile(all[2].file!.id)]).toEqual([true, true, null]);
    });

    it('closes when what it shows is taken away', async () =>
    {
        const all = [await media(0), await media(1)];
        const { closed, setList } = await open(all, all[0]);

        setList([all[1]]);
        await settle();

        expect(closed).toEqual(['closed']);
    });

    it('shows the one pressed alone when the thread it walks does not hold it', async () =>
    {
        const lone = await media(0);
        const { container } = await open([], lone);

        expect([counted(container), container.querySelector('[data-next]'), container.querySelector('[data-previous]')]).toEqual(['1 of 1', null, null]);
    });

    it('walks only what can be shown: no file, no line of words and nothing this browser could not open', async () =>
    {
        const photo = await media(1);
        const file: Message = { ...(await media(2)), file: { ...(await media(3)).file!, as: 'file', mime: 'application/pdf', name: 'notes.pdf' } };
        const words: Message = { id: 'm-4', conversationId: 'c-1', from: 'sara.k', kind: 'text', text: 'hi', at: 1_700_000_500_000, ref: null };
        const locked: Message = { ...(await media(5)), locked: 'no-epoch-key' };
        const { container } = await open([photo, file, words, locked], photo);

        expect(counted(container)).toBe('1 of 1');
    });
});

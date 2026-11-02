import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import MediaPlayer, { CONTROLS_MS } from '../src/components/chat/media-player.component.azeroth';
import '../src/icons/all.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';

/**
 * A video with controls of its own (MS-D47): it never plays by itself, says where it is and how long it
 * is, moves by a press, a drag or a key along a range that runs left to right in every language, is as
 * loud and as fast as it is told, fills the screen or opens in the viewer, steps its controls aside
 * while it plays untouched, says it is loading and why it cannot play, and plays one at a time.
 */

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 8; turn += 1)
    {
        await Promise.resolve();
    }
};

type Extra = Partial<{ ms: number; large: boolean; from: number; playing: boolean; onOpen: (at: number, playing: boolean) => void; label: string }>;

const show = async (extra: Extra = {}) =>
{
    const container = renderTest(() => MediaPlayer({ url: 'blob:video', label: 'Our trip', ms: 12_000, ...extra }) as HTMLElement).container;

    await settle();
    return container;
};

const videoOf = (container: HTMLElement) => container.querySelector('video')!;

const rootOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-player]')!;

const the = (container: HTMLElement, selector: string) => container.querySelector<HTMLElement>(selector);

const clockOf = (container: HTMLElement) => the(container, '[data-clock]')?.textContent?.replace(/\s+/g, ' ').trim();

const shown = (container: HTMLElement) => the(container, '[data-bar]')?.getAttribute('data-shown');

/** A range laid out 200px wide from the left edge, as happy-dom lays out nothing. */
const laid = (range: HTMLElement) =>
{
    Object.defineProperty(range, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24, x: 0, y: 0 }) });
    return range;
};

const pointer = (target: HTMLElement, type: string, clientX: number) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, pointerId: 1, pointerType: 'mouse', button: 0 }));

const key = (target: HTMLElement, name: string) =>
{
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });

    target.dispatchEvent(event);
    return event;
};

/** The video says how long it is, as a browser does once its header is read. */
const lasting = (video: HTMLVideoElement, seconds: number) =>
{
    Object.defineProperty(video, 'duration', { configurable: true, value: seconds });
    video.dispatchEvent(new Event('loadedmetadata'));
};

const at = (video: HTMLVideoElement, seconds: number) =>
{
    video.currentTime = seconds;
    video.dispatchEvent(new Event('timeupdate'));
};

let full: Element | null = null;

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_700_000_000_000);
    setRuntime({ clock, seed: 1 });
    useLocale().setLocale('en');
    useDevice().overrideCoarse(false);
    full = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
});

afterEach(() =>
{
    cleanup();
    useDevice().overrideCoarse(null);
    Reflect.deleteProperty(document, 'fullscreenElement');
    vi.restoreAllMocks();
});

describe('a video’s own player', () =>
{
    it('never plays by itself, and offers to play, saying how long it is before the video does', async () =>
    {
        const container = await show();

        expect(videoOf(container).paused).toBe(true);
        expect(videoOf(container).hasAttribute('controls'), 'none of the browser’s controls').toBe(false);
        expect(the(container, '[data-big]')?.getAttribute('aria-label')).toBe('Play');
        expect(clockOf(container)).toBe('0:00 / 0:12');
        expect(rootOf(container).getAttribute('data-state')).toBe('paused');
        expect(rootOf(container).getAttribute('aria-label')).toBe('Our trip');
        expect(shown(container)).toBe('true');
    });

    it('plays at a press and pauses at the next, its controls saying which', async () =>
    {
        const container = await show();
        const video = videoOf(container);

        fire(the(container, '[data-big]')!, 'click');

        expect(video.paused).toBe(false);
        expect(rootOf(container).getAttribute('data-state')).toBe('playing');
        expect(the(container, '[data-big]'), 'the large button steps aside').toBeNull();
        expect(the(container, '[data-toggle]')?.getAttribute('aria-label')).toBe('Pause');

        fire(the(container, '[data-toggle]')!, 'click');

        expect(video.paused).toBe(true);
        expect(the(container, '[data-toggle]')?.getAttribute('aria-label')).toBe('Play');
        expect(the(container, '[data-big]')).not.toBeNull();
    });

    it('takes its length from the video once it says it, and says where it is', async () =>
    {
        const container = await show();
        const video = videoOf(container);
        const range = the(container, '[data-range]')!;

        lasting(video, 30);
        at(video, 7);

        expect(clockOf(container)).toBe('0:07 / 0:30');
        expect([range.getAttribute('aria-valuenow'), range.getAttribute('aria-valuemax'), range.getAttribute('aria-valuetext')]).toEqual(['7', '30', '0:07 of 0:30']);
        expect(range.querySelector('[data-filled]')?.getAttribute('data-filled')).toBe('23.33%');
    });

    it('moves to where a press or a drag lets go of its range, left to right in every language', async () =>
    {
        useLocale().setLocale('fa');

        const container = await show();
        const video = videoOf(container);
        const range = laid(the(container, '[data-range]')!);

        expect(range.getAttribute('dir')).toBe('ltr');

        pointer(range, 'pointermove', 180);
        expect(clockOf(container), 'a pointer passing over moves nothing').toBe('۰:۰۰ / ۰:۱۲');

        pointer(range, 'pointerdown', 50);
        pointer(range, 'pointermove', 100);

        expect(clockOf(container), 'held where the drag is').toBe('۰:۰۶ / ۰:۱۲');
        expect(video.currentTime, 'nothing moved until it lets go').toBe(0);

        pointer(range, 'pointerup', 150);

        expect(video.currentTime).toBe(9);
        expect(clockOf(container)).toBe('۰:۰۹ / ۰:۱۲');
    });

    it('keeps its place when the browser takes a drag away', async () =>
    {
        const container = await show();
        const video = videoOf(container);
        const range = laid(the(container, '[data-range]')!);

        at(video, 2);
        pointer(range, 'pointerdown', 150);
        range.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));

        expect(video.currentTime).toBe(2);
        expect(clockOf(container)).toBe('0:02 / 0:12');
    });

    it('moves by its keys: five seconds an arrow, a tenth a page, its start and its end', async () =>
    {
        const container = await show();
        const video = videoOf(container);
        const range = the(container, '[data-range]')!;

        lasting(video, 60);
        key(range, 'ArrowRight');
        expect(video.currentTime).toBe(5);

        key(range, 'PageUp');
        expect(video.currentTime).toBe(11);

        key(range, 'ArrowLeft');
        expect(video.currentTime).toBe(6);

        key(range, 'End');
        expect(video.currentTime).toBe(60);

        key(range, 'Home');
        expect(video.currentTime).toBe(0);

        key(range, 'ArrowLeft');
        expect(video.currentTime, 'never before its start').toBe(0);
    });

    it('is as loud and as fast as it is told, and says so', async () =>
    {
        const container = await show();
        const video = videoOf(container);
        const mute = the(container, '[data-mute]')!;
        const speed = the(container, '[data-speed]')!;

        fire(mute, 'click');
        expect(video.muted).toBe(true);
        expect([mute.getAttribute('aria-label'), mute.getAttribute('aria-pressed')]).toEqual(['Unmute', 'true']);

        fire(mute, 'click');
        expect(video.muted).toBe(false);
        expect(mute.getAttribute('aria-label')).toBe('Mute');

        const rates: [number, string | null][] = [];

        for (let press = 0; press < 3; press += 1)
        {
            fire(speed, 'click');
            rates.push([video.playbackRate, speed.textContent?.trim() ?? null]);
        }

        expect(rates).toEqual([[1.5, '1.5×'], [2, '2×'], [1, '1×']]);
        expect(speed.getAttribute('aria-label')).toBe('Playing at 1×. Press for another speed.');
    });

    it('follows the video when something else changes how loud or how fast it is', async () =>
    {
        const container = await show();
        const video = videoOf(container);

        video.muted = true;
        video.dispatchEvent(new Event('volumechange'));
        expect(the(container, '[data-mute]')?.getAttribute('aria-label')).toBe('Unmute');

        video.playbackRate = 2;
        video.dispatchEvent(new Event('ratechange'));
        expect(the(container, '[data-speed]')?.textContent?.trim()).toBe('2×');
    });

    it('turns its loudness on a range of its own when it is large and a pointer can hold one', async () =>
    {
        const container = await show({ large: true });
        const video = videoOf(container);
        const loud = laid(container.querySelectorAll<HTMLElement>('[data-range]')[1]);

        expect(loud.getAttribute('aria-label')).toBe('Volume');

        pointer(loud, 'pointerdown', 100);
        pointer(loud, 'pointerup', 100);
        expect(video.volume).toBe(0.5);

        key(loud, 'ArrowDown');
        expect(video.volume).toBe(0.4);

        key(loud, 'Home');
        expect([video.volume, video.muted, the(container, '[data-mute]')?.getAttribute('aria-label')]).toEqual([0, true, 'Unmute']);

        fire(the(container, '[data-mute]')!, 'click');
        expect([video.volume, video.muted], 'heard again, and not at nothing').toEqual([1, false]);
    });

    it('has no loudness range in a bubble, nor under a finger', async () =>
    {
        const small = await show();

        expect(small.querySelectorAll('[data-range]')).toHaveLength(1);
        cleanup();

        useDevice().overrideCoarse(true);

        const touched = await show({ large: true });

        expect(touched.querySelectorAll('[data-range]')).toHaveLength(1);
    });

    it('steps its controls aside while it plays untouched, and brings them back at a touch', async () =>
    {
        const container = await show();

        fire(the(container, '[data-big]')!, 'click');
        expect(shown(container)).toBe('true');

        clock.advance(CONTROLS_MS - 1);
        expect(shown(container), 'not yet').toBe('true');

        clock.advance(1);
        expect(shown(container)).toBe('false');

        fire(rootOf(container), 'pointermove');
        expect(shown(container)).toBe('true');

        fire(the(container, '[data-toggle]')!, 'click');
        clock.advance(CONTROLS_MS * 3);
        expect(shown(container), 'always while paused').toBe('true');
    });

    it('keeps its controls while the keyboard is on them', async () =>
    {
        const container = await show();
        const toggle = the(container, '[data-toggle]')!;

        fire(the(container, '[data-big]')!, 'click');
        toggle.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        clock.advance(CONTROLS_MS * 2);
        expect(shown(container)).toBe('true');

        toggle.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: the(container, '[data-mute]') }));
        clock.advance(CONTROLS_MS * 2);
        expect(shown(container), 'still inside it').toBe('true');

        toggle.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
        fire(rootOf(container), 'pointermove');
        clock.advance(CONTROLS_MS);
        expect(shown(container)).toBe('false');
    });

    it('steps its controls aside as a mouse leaves a playing video', async () =>
    {
        const container = await show();

        fire(the(container, '[data-big]')!, 'click');
        rootOf(container).dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));

        expect(shown(container)).toBe('false');
    });

    it('under a finger, shows its controls at the first press on a playing video and hides them at the next', async () =>
    {
        useDevice().overrideCoarse(true);

        const container = await show();
        const video = videoOf(container);
        const picture = the(container, '[data-picture]')!;

        fire(picture, 'click');
        expect(video.paused, 'a paused video plays').toBe(false);

        clock.advance(CONTROLS_MS);
        expect(shown(container)).toBe('false');

        fire(picture, 'click');
        expect([shown(container), video.paused]).toEqual(['true', false]);

        fire(picture, 'click');
        expect([shown(container), video.paused]).toEqual(['false', false]);
    });

    it('plays or pauses at a press on the picture under a mouse', async () =>
    {
        const container = await show();
        const video = videoOf(container);

        fire(the(container, '[data-picture]')!, 'click');
        expect(video.paused).toBe(false);

        fire(the(container, '[data-picture]')!, 'click');
        expect(video.paused).toBe(true);
    });

    it('says it is loading while the video waits, and why it cannot play, with Try again', async () =>
    {
        const container = await show();
        const video = videoOf(container);
        const reload = vi.spyOn(video, 'load');

        fire(the(container, '[data-big]')!, 'click');
        video.dispatchEvent(new Event('waiting'));

        expect(rootOf(container).getAttribute('data-state')).toBe('waiting');
        expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading…');

        video.dispatchEvent(new Event('playing'));
        expect(container.querySelector('[role="status"]')).toBeNull();

        video.dispatchEvent(new Event('error'));

        expect(rootOf(container).getAttribute('data-state')).toBe('failed');
        expect(the(container, '[data-failed]')?.textContent).toContain('This video could not be played.');
        expect(the(container, '[data-big]'), 'nothing to play').toBeNull();
        expect(the(container, '[data-toggle]')?.getAttribute('aria-label'), 'not playing').toBe('Play');

        fire(the(container, '[data-retry]')!, 'click');

        expect(reload).toHaveBeenCalledTimes(1);
        expect(the(container, '[data-failed]')).toBeNull();
    });

    it('offers to play again once it has ended, from its start', async () =>
    {
        const container = await show();
        const video = videoOf(container);

        fire(the(container, '[data-big]')!, 'click');
        at(video, 12);
        video.pause();
        video.dispatchEvent(new Event('ended'));

        expect(rootOf(container).getAttribute('data-state')).toBe('ended');
        expect(the(container, '[data-big]')?.getAttribute('aria-label')).toBe('Play again');

        fire(the(container, '[data-big]')!, 'click');

        expect([video.currentTime, video.paused]).toEqual([0, false]);
    });

    it('answers its keys wherever the keyboard is in it, and leaves a button its own', async () =>
    {
        const container = await show();
        const video = videoOf(container);
        const root = rootOf(container);

        key(root, 'k');
        expect(video.paused).toBe(false);

        key(root, ' ');
        expect(video.paused).toBe(true);

        const spaced = key(the(container, '[data-mute]')!, ' ');

        expect([spaced.defaultPrevented, video.paused], 'Space on a button presses that button').toEqual([false, true]);

        key(root, 'm');
        expect(video.muted).toBe(true);

        key(root, 'ArrowRight');
        expect(video.currentTime).toBe(5);

        key(root, 'ArrowLeft');
        expect(video.currentTime).toBe(0);

        const asked = vi.fn(() => Promise.resolve());

        Object.defineProperty(root, 'requestFullscreen', { configurable: true, value: asked });
        key(root, 'f');
        expect(asked).toHaveBeenCalledTimes(1);

        const held = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });

        root.dispatchEvent(held);
        expect([held.defaultPrevented, video.paused], 'a shortcut of the browser’s is left to it').toEqual([false, true]);
    });

    it('fills the screen, and leaves it', async () =>
    {
        const container = await show({ large: true });
        const root = rootOf(container);
        const corner = the(container, '[data-corner]')!;
        const asked = vi.fn(() => Promise.resolve());
        const left = vi.fn(() => Promise.resolve());

        Object.defineProperty(root, 'requestFullscreen', { configurable: true, value: asked });
        Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: left });

        expect(corner.getAttribute('aria-label')).toBe('Full screen');
        fire(corner, 'click');
        expect(asked).toHaveBeenCalledTimes(1);

        full = root;
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(corner.getAttribute('aria-label')).toBe('Leave full screen');

        fire(corner, 'click');
        expect(left).toHaveBeenCalledTimes(1);

        Reflect.deleteProperty(document, 'exitFullscreen');
    });

    it('opens in the viewer from where it is when its bubble gives it the way', async () =>
    {
        const opened: [number, boolean][] = [];
        const container = await show({ onOpen: (seconds, playing) => opened.push([seconds, playing]) });
        const video = videoOf(container);
        const corner = the(container, '[data-corner]')!;

        fire(the(container, '[data-big]')!, 'click');
        at(video, 4);

        expect(corner.getAttribute('aria-label')).toBe('Open the video');
        fire(corner, 'click');

        expect(opened).toEqual([[4, true]]);
        expect(video.paused, 'the bubble’s stops as the viewer’s begins').toBe(true);
    });

    it('begins where it was handed, playing if it was', async () =>
    {
        const container = await show({ from: 4, playing: true, large: true });
        const video = videoOf(container);

        expect([video.currentTime, video.paused]).toEqual([4, false]);
        expect(clockOf(container)).toBe('0:04 / 0:12');
    });

    it('plays one video at a time', async () =>
    {
        const container = renderTest(() =>
        {
            const both = document.createElement('div');

            both.append(MediaPlayer({ url: 'blob:one', label: 'One', ms: 5_000 }) as HTMLElement, MediaPlayer({ url: 'blob:two', label: 'Two', ms: 5_000 }) as HTMLElement);
            return both;
        }).container;

        await settle();

        const [first, second] = [...container.querySelectorAll('video')];
        const [startFirst, startSecond] = [...container.querySelectorAll<HTMLElement>('[data-big]')];

        fire(startFirst, 'click');
        fire(startSecond, 'click');

        expect([first.paused, second.paused]).toEqual([true, false]);
    });

    it('stops when it is taken away', async () =>
    {
        const container = await show();
        const video = videoOf(container);

        fire(the(container, '[data-big]')!, 'click');
        cleanup();

        expect(video.paused).toBe(true);
        expect(container.childElementCount).toBe(0);
    });

    it('keeps a press on its controls its own, and lets one on the picture through to the line', async () =>
    {
        const container = await show();
        const heard: string[] = [];

        container.addEventListener('pointerdown', (event) => heard.push((event.target as HTMLElement).getAttribute('data-picture') !== null ? 'picture' : 'control'));

        pointer(the(container, '[data-toggle]')!, 'pointerdown', 10);
        pointer(the(container, '[data-big]')!, 'pointerdown', 10);
        pointer(the(container, '[data-range]')!, 'pointerdown', 10);
        pointer(the(container, '[data-picture]')!, 'pointerdown', 10);

        expect(heard).toEqual(['picture']);
    });

    it('is said in the reader’s language and digits', async () =>
    {
        useLocale().setLocale('fa');

        const container = await show({ ms: 75_000 });

        expect(the(container, '[data-big]')?.getAttribute('aria-label')).toBe('پخش');
        expect(clockOf(container)).toBe('۰:۰۰ / ۱:۱۵');
        expect(the(container, '[data-range]')?.getAttribute('aria-valuetext')).toBe('۰:۰۰ از ۱:۱۵');
        expect(the(container, '[data-bar]')?.getAttribute('dir')).toBe('ltr');
    });
});

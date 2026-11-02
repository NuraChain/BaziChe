import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Gallery from '../src/components/chat/gallery.component.azeroth';
import '../src/icons/all.ts';
import type { Attachment, Message } from '../src/data/chat.ts';
import { forgetFile, holdFile } from '../src/lib/file-held.ts';
import { openGallery } from '../src/lib/gallery.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useFileLoads } from '../src/stores/file-loads.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const viewed = vi.hoisted(() => ({ calls: [] as { start: string; list: string[] }[] }));

vi.mock('../src/lib/media-viewer.ts', () => ({
    openViewer: (start: Message, _carried: unknown, list?: () => readonly Message[]) =>
    {
        viewed.calls.push({ start: start.id, list: (list?.() ?? []).map((one) => one.id) });
        return Promise.resolve();
    }
}));

/**
 * A conversation's photos and videos, files and voice messages (MS-D25): each list newest first,
 * a page at a time, opened as the thread's lines are; a photo or a video opens the viewer walking the
 * gallery, a file is saved where it stands and found by its name, a voice message plays in place.
 */

const AT = 1_700_000_000_000;

const sent = (id: string, file: Partial<Attachment> | null, extra: Partial<Message> = {}): Message => ({
    id,
    conversationId: 'c-1',
    from: 'sara.k',
    kind: file === null ? 'voice' : 'file',
    text: '',
    at: AT,
    ref: null,
    ...(file === null ? {} : { file: { id: `f-${ id }`, key: 'k', iv: 'i', as: 'photo', mime: 'image/jpeg', name: `${ id }.jpg`, bytes: 1024, w: 1600, h: 1200, thumb: 'AAAA', ...file } }),
    ...extra
});

const pages = new Map<string, { messages: Message[]; cursor?: string }>();

const asked: string[] = [];

const show = () => renderTest(() => Gallery({ overlayId: 'chat-gallery', close: () => undefined, conversationId: 'c-1' }) as HTMLElement).container;

const tab = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((one) => one.textContent?.trim() === name)!;

const items = (container: HTMLElement) => [...container.querySelectorAll('[data-shelf-item]')].map((one) => one.getAttribute('data-shelf-item'));

beforeEach(() =>
{
    useLocale().setLocale('en');
    useOverlay().reset();
    useFileLoads().reset();
    forgetFile();
    pages.clear();
    asked.length = 0;
    viewed.calls.length = 0;
    vi.spyOn(useChat(), 'media').mockImplementation((conversationId, kind, cursor) =>
    {
        asked.push(`${ conversationId } ${ kind } ${ cursor ?? '' }`);

        const page = pages.get(`${ kind } ${ cursor ?? '' }`);

        return page === undefined ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(page);
    });
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    vi.restoreAllMocks();
});

describe('the gallery', () =>
{
    it('opens on the photos and videos, newest first, and opens the viewer walking them', async () =>
    {
        pages.set('media ', { messages: [ sent('p2', {}), sent('v1', { as: 'video', mime: 'video/mp4', ms: 65_000, name: 'clip.mp4' }), sent('p1', {}) ] });
        holdFile('f-p2', new Uint8Array([ 0xff, 0xd8, 0xff, 0xe0 ]), 'image/jpeg');

        const container = show();

        await vi.waitFor(() => expect(items(container)).toEqual([ 'p2', 'v1', 'p1' ]));
        await vi.waitFor(() => expect(container.querySelector('[data-shelf-item="p2"] img')?.getAttribute('src'), 'a photo fetched already is shown sharp').toMatch(/^blob:/));
        expect(container.querySelector('[data-shelf-item="p2"] img')?.getAttribute('class')).not.toContain('blur');
        expect(container.querySelector('[data-shelf-item="p1"] img')?.getAttribute('src'), 'one not fetched, by its thumb').toMatch(/^data:image\/jpeg/);
        expect(container.querySelector('[data-shelf-item="p1"] img')?.getAttribute('class')).toContain('blur');
        expect(asked).toEqual([ 'c-1 media ' ]);
        expect(container.querySelector('[data-shelf-item="v1"]')?.getAttribute('aria-label')).toBe(`Video from sara.k, ${ useLocale().date(AT, { dateStyle: 'medium' }) }`);
        expect(container.querySelector('[data-shelf-item="v1"]')?.textContent).toContain('1:05');

        fire(container.querySelector('[data-shelf-item="v1"]')!, 'click');

        expect(viewed.calls).toEqual([ { start: 'v1', list: [ 'p2', 'v1', 'p1' ] } ]);
    });

    it('reads older ones at Show older, a page at a time, and offers no more after the last', async () =>
    {
        pages.set('media ', { messages: [ sent('p3', {}) ], cursor: 'p3' });
        pages.set('media p3', { messages: [ sent('p2', {}), sent('p1', {}) ] });

        const container = show();

        await vi.waitFor(() => expect(items(container)).toEqual([ 'p3' ]));

        const older = [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'Show older')!;

        fire(older, 'click');

        await vi.waitFor(() => expect(items(container)).toEqual([ 'p3', 'p2', 'p1' ]));
        expect(asked).toEqual([ 'c-1 media ', 'c-1 media p3' ]);
        expect([...container.querySelectorAll('button')].some((one) => one.textContent?.trim() === 'Show older')).toBe(false);
    });

    it('lists files with the way to fetch each, and finds them by name among those read, saying so', async () =>
    {
        pages.set('media ', { messages: [] });
        pages.set('files ', { messages: [ sent('a', { as: 'file', mime: 'application/pdf', name: 'report.pdf', w: undefined, h: undefined, thumb: undefined }), sent('b', { as: 'file', mime: 'text/plain', name: 'notes.txt', w: undefined, h: undefined, thumb: undefined }) ] });

        const container = show();

        fire(tab(container, 'Files'), 'click');

        await vi.waitFor(() => expect(items(container)).toEqual([ 'a', 'b' ]));
        expect(container.querySelectorAll('[data-download]')).toHaveLength(2);
        expect(container.textContent).toContain('Looks through the files shown so far.');

        const field = container.querySelector<HTMLInputElement>('input[type="search"], input')!;

        field.focus();
        field.value = 'REPO';
        fire(field, 'input');
        await vi.waitFor(() => expect(items(container)).toEqual([ 'a' ]));

        field.value = 'zzz';
        fire(field, 'input');
        await vi.waitFor(() => expect(container.querySelector('[data-shelf-missed]')?.textContent).toBe('No file by that name so far.'));
        expect(document.activeElement, 'the field keeps the keyboard').toBe(field);
    });

    it('plays voice messages where they stand', async () =>
    {
        pages.set('media ', { messages: [] });
        pages.set('voice ', { messages: [ sent('w', null, { voice: { id: 'vf', key: 'k', iv: 'i', mime: 'audio/webm', ms: 4000, wave: [ 1, 2, 3 ], bytes: 900 } }) ] });

        const container = show();

        fire(tab(container, 'Voice'), 'click');

        await vi.waitFor(() => expect(items(container)).toEqual([ 'w' ]));
        await vi.waitFor(() => expect(container.querySelector('[data-voice="w"], [data-voice-coming]')).not.toBeNull(), { timeout: 4000 });
    });

    it('says when a list holds nothing, and when it could not be read, with Try again', async () =>
    {
        pages.set('media ', { messages: [] });

        const container = show();

        await vi.waitFor(() => expect(container.querySelector('[data-shelf-empty]')?.textContent).toBe('No photos or videos here yet.'));

        fire(tab(container, 'Files'), 'click');

        await vi.waitFor(() => expect(container.textContent).toContain('Try again'));
        expect(container.querySelector('[data-shelf-empty]'), 'a list that could not be read is never empty').toBeNull();

        pages.set('files ', { messages: [] });
        fire([...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'Try again')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[data-shelf-empty]')?.textContent).toBe('No files here yet.'));
        expect(asked.filter((one) => one === 'c-1 files ')).toHaveLength(2);
    });

    it('leaves out what this browser could not open', async () =>
    {
        pages.set('media ', { messages: [ sent('p', {}), sent('q', null, { kind: 'file', locked: 'no-key' }) ] });

        const container = show();

        await vi.waitFor(() => expect(items(container)).toEqual([ 'p' ]));
    });

    it('is said in the reader’s language, and opens from its door with the conversation it is about', async () =>
    {
        useLocale().setLocale('fa');
        pages.set('media ', { messages: [] });

        const container = show();

        expect([...container.querySelectorAll('[role="tab"]')].map((one) => one.textContent?.trim())).toEqual([ 'عکس و ویدیو', 'فایل‌ها', 'صدا' ]);
        await vi.waitFor(() => expect(container.querySelector('[data-shelf-empty]')?.textContent).toBe('هنوز عکس یا ویدیویی اینجا نیست.'));

        cleanup();
        openGallery('c-9');

        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.id)).toEqual([ 'chat-gallery' ]));
        expect(useOverlay().items()[0].props).toMatchObject({ conversationId: 'c-9' });
    });
});

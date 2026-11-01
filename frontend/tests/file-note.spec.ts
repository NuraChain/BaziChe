import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import { gistOf, sizeSaid } from '../src/components/chat/gist.ts';
import '../src/icons/all.ts';
import type { Attachment, Message } from '../src/data/chat.ts';
import { sealFile } from '../src/lib/chat-file.ts';
import { forgetFile } from '../src/lib/file-held.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { ChatFileError, setChatFiles } from '../src/services/chat-files.ts';
import { useFileLoads } from '../src/stores/file-loads.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/**
 * A photo, a video or a file in its bubble: its size said before anything is fetched, nothing fetched
 * until it is pressed, and what came shown only as what its bytes are.
 */

const ID = '0f8b5d2c-7a41-4c3e-9b6d-2e1f0a9c8b7d';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 600 }, (_, at) => at % 200)]);

const downloads: string[] = [];

let kept = new Map<string, Uint8Array>();

const sent = async (attachment: Partial<Attachment> = {}, extra: Partial<Message> = {}, plain = JPEG): Promise<Message> =>
{
    const sealed = await sealFile(plain, ID);

    kept.set(ID, sealed.body);

    return {
        id: 'm-1',
        conversationId: 'c-1',
        from: 'sara.k',
        kind: 'file',
        text: '',
        at: 1_700_000_000_000,
        ref: null,
        file: { id: ID, key: sealed.key, iv: sealed.iv, as: 'photo', mime: 'image/jpeg', name: 'beach.jpg', bytes: 2_516_582, w: 1600, h: 1200, thumb: 'AAAA', ...attachment },
        ...extra
    };
};

const show = (message: Message) =>
{
    const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });

    return renderTest(() => RouterProvider({
        router,
        children: () => MessageBubble({ message, me: 'alex', onActions: () => undefined })
    }) as HTMLElement).container;
};

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(1_700_000_100_000), seed: 3 });
    useLocale().setLocale('en');
    downloads.length = 0;
    kept = new Map();
    forgetFile();
    useFileLoads().reset();
    setChatFiles({
        upload: () => Promise.resolve(),
        async download(id, progress)
        {
            downloads.push(id);
            progress(0.4);

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
});

describe('a file’s size, said', () =>
{
    it('in bytes, then KB, then MB to one place', () =>
    {
        const locale = useLocale();

        expect(sizeSaid(900, locale)).toBe('900 B');
        expect(sizeSaid(5 * 1024 + 300, locale)).toBe('5.3 KB');
        expect(sizeSaid(300 * 1024, locale)).toBe('300 KB');
        expect(sizeSaid(2_516_582, locale)).toBe('2.4 MB');
        expect(sizeSaid(50 * 1024 * 1024, locale)).toBe('50 MB');
    });

    it('in the reader’s own digits', () =>
    {
        useLocale().setLocale('fa');

        expect(sizeSaid(2_516_582, useLocale())).toBe('۲٫۴ مگابایت');
    });
});

describe('a file in its bubble', () =>
{
    it('says a photo’s size before it is fetched, and fetches nothing until it is pressed', async () =>
    {
        const container = show(await sent());

        expect(container.querySelector('[data-size]')?.textContent).toContain('2.4 MB');
        expect(container.querySelector('[data-download]')?.getAttribute('aria-label')).toBe('Download beach.jpg, 2.4 MB');
        expect(container.querySelector('[data-file] img[aria-hidden="true"]')?.getAttribute('src'), 'its thumb, blurred').toBe('data:image/jpeg;base64,AAAA');
        expect(downloads, 'nothing fetched').toEqual([]);
    });

    it('fetches, opens and shows the photo once it is pressed', async () =>
    {
        const container = show(await sent());

        fire(container.querySelector('[data-download]')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('button[aria-label="Open the photo"] img')).not.toBeNull());
        expect(downloads).toEqual([ID]);
        expect(container.querySelector('[data-download]'), 'nothing left to download').toBeNull();
    });

    it('says a video’s length beside its size', async () =>
    {
        const container = show(await sent({ as: 'video', mime: 'video/mp4', ms: 42_000, w: 1920, h: 1080 }));

        expect(container.querySelector('[data-size]')?.textContent).toContain('0:42 · 2.4 MB');
    });

    it('shows a file by its name, size and type, and offers it to be saved once it has come, never shown', async () =>
    {
        const container = show(await sent({ as: 'file', mime: 'application/pdf', name: 'report.pdf', w: undefined, h: undefined, thumb: undefined }, {}, new TextEncoder().encode('%PDF-1.7 ...')));

        expect(container.textContent).toContain('report.pdf');
        expect(container.textContent).toContain('2.4 MB');
        expect(container.textContent).toContain('PDF');

        fire(container.querySelector('[data-download]')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('a[data-save]')).not.toBeNull());
        expect(container.querySelector('a[data-save]')?.getAttribute('download')).toBe('report.pdf');
        expect(container.querySelector('[data-file] img, [data-file] video'), 'never shown inline').toBeNull();
    });

    it('raises the alarm for a file that does not open under its key, and shows nothing of it', async () =>
    {
        const message = await sent();

        kept.set(ID, (await sealFile(JPEG, ID)).body);

        const container = show(message);

        fire(container.querySelector('[data-download]')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[data-fault]')?.getAttribute('data-fault')).toBe('tampered'));
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('changed after it was sent');
        expect(container.querySelector('button[aria-label="Open the photo"]')).toBeNull();
    });

    it('refuses a photo whose bytes are no picture, rather than show it as one', async () =>
    {
        const container = show(await sent({}, {}, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')));

        fire(container.querySelector('[data-download]')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[data-fault]')?.getAttribute('data-fault')).toBe('unshowable'));
        expect(container.querySelector('button[aria-label="Open the photo"]')).toBeNull();
    });

    it('says a file is gone when the server no longer has it', async () =>
    {
        const message = await sent();

        kept.clear();

        const container = show(message);

        fire(container.querySelector('[data-download]')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[data-fault]')?.getAttribute('data-fault')).toBe('gone'));
    });

    it('draws its caption under it', async () =>
    {
        const container = show(await sent({}, { text: 'At the **beach**' }));

        expect(container.textContent).toContain('At the beach');
        expect(container.querySelector('strong')?.textContent).toBe('beach');
    });
});

describe('a file as a sentence quotes it', () =>
{
    it('is its caption, or what it is', async () =>
    {
        const locale = useLocale();

        expect(gistOf(await sent({}, { text: 'Look' }), locale)).toBe('Look');
        expect(gistOf(await sent(), locale)).toBe('Photo');
        expect(gistOf(await sent({ as: 'video', ms: 1000 }), locale)).toBe('Video');
        expect(gistOf(await sent({ as: 'file', name: 'report.pdf', w: undefined, h: undefined, thumb: undefined }), locale)).toBe('File: report.pdf');
        expect(gistOf({ ...await sent(), file: undefined }, locale), 'not opened').toBe('File');
    });
});

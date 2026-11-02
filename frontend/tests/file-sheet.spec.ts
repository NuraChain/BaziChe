import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Composer from '../src/components/chat/composer.component.azeroth';
import FileSheet from '../src/components/chat/file-sheet.component.azeroth';
import '../src/icons/all.ts';
import type { FileDraft } from '../src/data/chat.ts';
import { FILE_PHOTO_MOST } from '../../backend/src/domains/chat/files.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/** What was prepared, in order, and a door a file whose name starts with "slow" waits at. */
const preparing = vi.hoisted(() => ({ names: [] as string[], door: null as Promise<void> | null }));

// happy-dom draws nothing on a canvas, so a photo or a video is made here as a browser makes one.
vi.mock('../src/lib/file-prepare.ts', async (original) =>
{
    const real = await original<typeof import('../src/lib/file-prepare.ts')>();

    return {
        ...real,
        prepare: async (file: File, asFile: boolean): Promise<FileDraft> =>
        {
            preparing.names.push(file.name);

            if (file.name.startsWith('slow') && preparing.door !== null)
            {
                await preparing.door;
            }

            const plain = new Uint8Array(await file.arrayBuffer());

            if (file.name.startsWith('broken'))
            {
                throw new Error('unreadable');
            }

            if (asFile || !real.showable(file))
            {
                return { plain, as: 'file', mime: file.type === '' ? 'application/octet-stream' : file.type, name: file.name };
            }

            return file.type.startsWith('video/')
                ? { plain, as: 'video', mime: file.type, name: file.name, w: 1920, h: 1080, ms: 4000, thumb: 'AAAA' }
                : { plain, as: 'photo', mime: file.type, name: file.name, w: 1600, h: 1200, thumb: 'AAAA' };
        }
    };
});

/**
 * Several photos, videos and files chosen at once (MS-D48): each a tile that can be taken out, what
 * cannot go said at once, and what goes sent as an album and files after it, the caption on the last.
 */

const photo = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], name, { type: 'image/jpeg' });

const video = (name: string) => new File([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], name, { type: 'video/mp4' });

const doc = (name: string, type = 'application/pdf') => new File([new TextEncoder().encode('%PDF-1.7')], name, { type });

/** A file that says it is as large as asked without holding that much. */
const sized = (name: string, type: string, size: number) =>
{
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });

    Object.defineProperty(file, 'size', { value: size });
    return file;
};

const made: string[] = [];

const freed: string[] = [];

const sheet = (files: readonly File[], caption = '', onSend?: (draft: FileDraft, caption: string) => Promise<void>) =>
{
    const closed: unknown[] = [];
    const sent: number[] = [];
    const container = renderTest(() => FileSheet({
        overlayId: 'file-sheet',
        close: (result) => closed.push(result),
        room: 'c-reza',
        files,
        caption,
        onSent: () => sent.push(1),
        ...(onSend === undefined ? {} : { onSend })
    }) as HTMLElement).container;

    return { container, closed, sent };
};

const button = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === name || one.getAttribute('aria-label') === name) ?? null;

const ready = async (container: HTMLElement) => vi.waitFor(() => expect(button(container, 'Send')?.disabled).toBe(false));

const heading = (container: HTMLElement) => container.querySelector('h2')?.textContent?.trim();

beforeEach(() =>
{
    useLocale().setLocale('en');
    useOverlay().reset();
    made.length = 0;
    freed.length = 0;
    preparing.names.length = 0;
    preparing.door = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() =>
    {
        made.push(`blob:${ made.length }`);
        return made.at(-1)!;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) =>
    {
        freed.push(url);
    });
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    vi.restoreAllMocks();
});

describe('the sheet several things go from', () =>
{
    it('lists them as tiles, each one it can take out, under what they are', async () =>
    {
        const { container } = sheet([photo('a.jpg'), photo('b.jpg'), video('c.mp4')]);

        await ready(container);

        expect(container.querySelectorAll('[data-chosen] li')).toHaveLength(3);
        expect(heading(container)).toBe('3 photos and videos');
        expect(button(container, 'Remove b.jpg'), 'each can be taken out').not.toBeNull();
        expect(container.querySelector('[role="switch"]')?.textContent).toContain('Send as files');
    });

    it('sends photos and videos together as one album, in the order chosen, with the caption', async () =>
    {
        const sendAlbum = vi.spyOn(useChat(), 'sendAlbum').mockResolvedValue(undefined);
        const sendFile = vi.spyOn(useChat(), 'sendFile').mockResolvedValue(undefined);
        const { container, closed, sent } = sheet([photo('a.jpg'), video('b.mp4'), photo('c.jpg')], 'Our trip');

        await ready(container);
        fire(button(container, 'Send')!, 'click');

        expect(sendAlbum).toHaveBeenCalledTimes(1);
        expect(sendAlbum.mock.calls[0][0]).toBe('c-reza');
        expect(sendAlbum.mock.calls[0][1].map((one) => [one.as, one.name])).toEqual([['photo', 'a.jpg'], ['video', 'b.mp4'], ['photo', 'c.jpg']]);
        expect(sendAlbum.mock.calls[0][2]).toBe('Our trip');
        expect(sendFile, 'nothing alone').not.toHaveBeenCalled();
        expect([sent, closed], 'the composer empties and the sheet goes').toEqual([[1], [true]]);
    });

    it('sends files one message each after the album, the caption on the last of them', async () =>
    {
        const calls: string[] = [];
        const sendAlbum = vi.spyOn(useChat(), 'sendAlbum').mockImplementation(async (_, drafts, caption) =>
        {
            calls.push(`album ${ drafts.map((one) => one.name).join(',') } "${ caption }"`);
        });
        const sendFile = vi.spyOn(useChat(), 'sendFile').mockImplementation(async (_, draft, caption) =>
        {
            calls.push(`${ draft.name } "${ caption }"`);
        });
        const { container } = sheet([photo('a.jpg'), doc('b.pdf'), photo('c.jpg'), doc('d.txt', 'text/plain')], 'Here');

        await ready(container);
        expect(heading(container)).toBe('4 items');

        fire(button(container, 'Send')!, 'click');

        expect(calls).toEqual(['album a.jpg,c.jpg ""', 'b.pdf ""', 'd.txt "Here"']);
        expect([sendAlbum, sendFile].map((spy) => spy.mock.calls.length)).toEqual([1, 2]);
    });

    it('sends one photo among files as itself', async () =>
    {
        const sendAlbum = vi.spyOn(useChat(), 'sendAlbum').mockResolvedValue(undefined);
        const sendFile = vi.spyOn(useChat(), 'sendFile').mockResolvedValue(undefined);
        const { container } = sheet([photo('a.jpg'), doc('b.pdf')], 'Look');

        await ready(container);
        fire(button(container, 'Send')!, 'click');

        expect(sendAlbum).not.toHaveBeenCalled();
        expect(sendFile.mock.calls.map(([, draft, caption]) => [draft.as, draft.name, caption])).toEqual([['photo', 'a.jpg', ''], ['file', 'b.pdf', 'Look']]);
    });

    it('sends everything as files when asked, one message each', async () =>
    {
        const sendAlbum = vi.spyOn(useChat(), 'sendAlbum').mockResolvedValue(undefined);
        const sendFile = vi.spyOn(useChat(), 'sendFile').mockResolvedValue(undefined);
        const { container } = sheet([photo('a.jpg'), video('b.mp4'), photo('c.jpg')], 'Originals');

        await ready(container);
        fire(container.querySelector('[role="switch"]')!, 'click');
        await vi.waitFor(() => expect(heading(container)).toBe('3 files'));
        await ready(container);

        fire(button(container, 'Send')!, 'click');

        expect(sendAlbum).not.toHaveBeenCalled();
        expect(sendFile.mock.calls.map(([, draft, caption]) => [draft.as, draft.name, caption])).toEqual([['file', 'a.jpg', ''], ['file', 'b.mp4', ''], ['file', 'c.jpg', 'Originals']]);
    });

    it('says at once what cannot go, marks it, and sends the rest once it is taken out', async () =>
    {
        const sendAlbum = vi.spyOn(useChat(), 'sendAlbum').mockResolvedValue(undefined);
        const read = vi.fn();
        const huge = sized('film.mov', 'application/octet-stream', 72 * 1024 * 1024);

        huge.arrayBuffer = read;

        const { container } = sheet([photo('a.jpg'), photo('broken.jpg'), huge, photo('c.jpg')]);

        await vi.waitFor(() => expect(container.querySelector('[data-over]')?.textContent).toBe('Some of these cannot be sent. Remove them to send the rest.'));

        const faults = [...container.querySelectorAll('[data-chosen] li')].map((one) => one.getAttribute('data-fault'));

        expect(faults).toEqual([null, 'unreadable', 'large', null]);
        expect(button(container, 'Send')?.disabled, 'nothing goes while it is there').toBe(true);
        expect(read, 'the one too large was never read').not.toHaveBeenCalled();

        fire(button(container, 'Remove broken.jpg')!, 'click');
        fire(button(container, 'Remove film.mov')!, 'click');

        await ready(container);
        expect(container.querySelector('[data-over]')).toBeNull();

        fire(button(container, 'Send')!, 'click');

        expect(sendAlbum.mock.calls[0][1].map((one) => one.name)).toEqual(['a.jpg', 'c.jpg']);
    });

    it('says a photo too large once it is drawn cannot go, and Enter sends nothing while it is there', async () =>
    {
        const sendAlbum = vi.spyOn(useChat(), 'sendAlbum').mockResolvedValue(undefined);
        const giant = new File([new Uint8Array(FILE_PHOTO_MOST + 1)], 'giant.jpg', { type: 'image/jpeg' });
        const { container } = sheet([photo('a.jpg'), giant]);

        await vi.waitFor(() => expect(container.querySelector('[data-chosen] li[data-fault="large"]')).not.toBeNull());
        expect(button(container, 'Send')?.disabled).toBe(true);

        container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

        expect(sendAlbum, 'not by Enter either').not.toHaveBeenCalled();
    });

    it('prepares nothing it was told to leave before its turn came, and lets go of what it drew for one taken out meanwhile', async () =>
    {
        const door = () =>
        {
            let open: () => void = () => undefined;

            preparing.door = new Promise<void>((resolve) =>
            {
                open = resolve;
            });
            return open;
        };

        const first = door();
        const { container } = sheet([photo('slow-a.jpg'), photo('b.jpg'), photo('slow-c.jpg'), photo('d.jpg')]);

        await vi.waitFor(() => expect(preparing.names).toEqual(['slow-a.jpg']));

        fire(button(container, 'Remove b.jpg')!, 'click');

        const second = door();

        first();
        await vi.waitFor(() => expect(preparing.names).toContain('slow-c.jpg'));

        fire(button(container, 'Remove slow-c.jpg')!, 'click');
        second();
        await ready(container);

        expect(preparing.names, 'the one taken out before its turn was never read').toEqual(['slow-a.jpg', 'slow-c.jpg', 'd.jpg']);

        cleanup();
        expect([...freed].sort(), 'every picture let go').toEqual([...made].sort());
    });

    it('takes the first ten, and says the rest are left for after', async () =>
    {
        const { container } = sheet(Array.from({ length: 12 }, (_, at) => photo(`p${ at }.jpg`)));

        await ready(container);

        expect(container.querySelectorAll('[data-chosen] li')).toHaveLength(10);
        expect(container.querySelector('[data-left]')?.textContent).toBe('Only the first 10 are here. Send the rest after these.');
    });

    it('is one thing again once the others are taken out', async () =>
    {
        const { container } = sheet([photo('a.jpg'), doc('b.pdf')]);

        await ready(container);
        fire(button(container, 'Remove a.jpg')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[data-chosen]')).toBeNull());
        expect(heading(container)).toBe('Send a file');
        expect(container.textContent).toContain('b.pdf');
    });

    it('lets go of every picture it drew, as one is taken out and when it goes', async () =>
    {
        const { container } = sheet([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);

        await ready(container);
        expect(made, 'a picture each').toHaveLength(3);

        fire(button(container, 'Remove b.jpg')!, 'click');
        expect(freed).toEqual([made[1]]);

        cleanup();
        expect([...freed].sort()).toEqual([...made].sort());
    });

    it('hands a channel each one in turn, the caption on the last', async () =>
    {
        const posted: string[] = [];
        const { container } = sheet([photo('a.jpg'), doc('b.pdf')], 'Notes', async (draft, caption) =>
        {
            posted.push(`${ draft.name } "${ caption }"`);
        });

        await ready(container);
        fire(button(container, 'Send')!, 'click');

        await vi.waitFor(() => expect(posted).toEqual(['a.jpg ""', 'b.pdf "Notes"']));
    });

    it('says under its switch what happens to what was chosen, one or several, photos, videos or both', async () =>
    {
        const said = async (files: readonly File[]) =>
        {
            const { container } = sheet(files);

            await ready(container);

            const words = container.querySelector('[role="switch"]')?.textContent ?? '';

            cleanup();
            return words;
        };

        expect(await said([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]), 'three photos').toContain('Sent as photos, they are redrawn without their location or camera details. As files, they go as they are.');
        expect(await said([video('a.mp4'), video('b.mp4')]), 'two videos').toContain('Videos are sent as they are, with their own details.');
        expect(await said([photo('a.jpg'), video('b.mp4')]), 'a photo and a video').toContain('Photos are redrawn without their location or camera details, and videos go as they are.');
        expect(await said([photo('a.jpg'), doc('b.pdf')]), 'one photo among files').toContain('Sent as a photo, it is redrawn without its location or camera details.');
        expect(await said([video('a.mp4'), doc('b.pdf')]), 'one video among files').toContain('A video is sent as it is, with its own details.');
    });

    it('goes on saying a video is a video once it is switched to go as a file', async () =>
    {
        const { container } = sheet([video('a.mp4')]);

        await ready(container);
        fire(container.querySelector<HTMLElement>('[role="switch"]')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true'));
        await ready(container);
        expect(container.querySelector('[role="switch"]')?.textContent).toContain('A video is sent as it is, with its own details.');
    });

    it('says in Persian what is chosen', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = sheet([photo('a.jpg'), video('b.mp4')]);

        await vi.waitFor(() => expect(heading(container)).toBe('۲ عکس و ویدیو'));
    });
});

describe('the composer, given several at once', () =>
{
    const composer = () => renderTest(() => Composer({
        value: 'With these',
        disabled: false,
        editing: null,
        record: 'c-reza',
        onInput: () => undefined,
        onSend: () => undefined
    }) as HTMLElement).container;

    it('opens the sheet with every file picked', async () =>
    {
        const container = composer();
        const input = container.querySelector<HTMLInputElement>('input[data-attach]')!;
        const files = [photo('a.jpg'), photo('b.jpg')];

        expect(input.multiple, 'the picker takes several').toBe(true);

        Object.defineProperty(input, 'files', { value: files, configurable: true });
        fire(input, 'change');

        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.id)).toEqual(['file-sheet']), { timeout: 4000 });
        expect(useOverlay().items()[0].props).toMatchObject({ room: 'c-reza', files, caption: 'With these' });
        expect(useOverlay().items()[0].kind, 'a sheet on a phone and a dialog on a wide screen').toBe('auto');
    });

    it('takes every file dropped together', async () =>
    {
        const container = composer();
        const files = [photo('a.jpg'), video('b.mp4')];
        const event = new Event('drop', { bubbles: true, cancelable: true });

        Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
        container.querySelector('textarea')!.dispatchEvent(event);

        await vi.waitFor(() => expect(useOverlay().items()[0]?.props).toMatchObject({ files }), { timeout: 4000 });
    });

    it('takes every file pasted together', async () =>
    {
        const container = composer();
        const files = [photo('a.jpg'), doc('b.pdf')];
        const field = container.querySelector('textarea')!;
        const event = new Event('paste', { bubbles: true, cancelable: true });

        Object.defineProperty(event, 'clipboardData', { value: { files } });
        field.dispatchEvent(event);

        await vi.waitFor(() => expect(useOverlay().items()[0]?.props).toMatchObject({ files }), { timeout: 4000 });
    });
});

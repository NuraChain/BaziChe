import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Composer from '../src/components/chat/composer.component.azeroth';
import FileSheet from '../src/components/chat/file-sheet.component.azeroth';
import { FILE_MOST, FILE_NAME_MOST, FILE_PHOTO_MOST } from '../../backend/src/domains/chat/files.ts';
import '../src/icons/all.ts';
import { nameOf, overUnread, tooLarge, typeOf } from '../src/lib/file-prepare.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/**
 * A photo, a video or a file on its way into the composer: what its name and type are kept as, the
 * limits said before anything is read that need not be, the paperclip where a file can be sent, and
 * the sheet that sends it with its caption.
 */

/** A file that says it is as large as asked without holding that much. */
const sized = (name: string, type: string, size: number, bytes = new Uint8Array([1, 2, 3])) =>
{
    const file = new File([bytes as BlobPart], name, { type });

    Object.defineProperty(file, 'size', { value: size });
    return file;
};

beforeEach(() =>
{
    useLocale().setLocale('en');
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    vi.restoreAllMocks();
});

describe('a file as it is kept', () =>
{
    it('keeps a name’s last part, without what a save dialog or a screen should never be handed', () =>
    {
        expect(nameOf('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
        expect(nameOf('../../etc/passwd')).toBe('passwd');
        expect(nameOf('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
        expect(nameOf('  holiday.jpg  ')).toBe('holiday.jpg');
        expect(nameOf('..')).toBe('file');
        expect(nameOf('')).toBe('file');
        expect(nameOf('گزارش.pdf')).toBe('گزارش.pdf');
    });

    it('cuts a long name to what a document takes, keeping its extension', () =>
    {
        const cut = nameOf(`${ 'a'.repeat(400) }.tar.gz`);

        expect(cut).toHaveLength(FILE_NAME_MOST);
        expect(cut.endsWith('.gz')).toBe(true);
    });

    it('keeps a type it can name, and says nothing for one it cannot', () =>
    {
        expect(typeOf('application/PDF')).toBe('application/pdf');
        expect(typeOf('')).toBe('application/octet-stream');
        expect(typeOf('text/html; charset=utf-8')).toBe('application/octet-stream');
    });

    it('holds a photo to 10 MB and a video or a file to 50 MB', () =>
    {
        expect(tooLarge({ as: 'photo', plain: new Uint8Array(FILE_PHOTO_MOST) })).toBe(false);
        expect(tooLarge({ as: 'photo', plain: new Uint8Array(FILE_PHOTO_MOST + 1) })).toBe(true);
        expect(tooLarge({ as: 'video', plain: new Uint8Array(FILE_PHOTO_MOST + 1) })).toBe(false);
        expect(tooLarge({ as: 'file', plain: new Uint8Array(FILE_MOST + 1) })).toBe(true);
    });

    it('knows a video or a file is too large without reading it, and leaves a photo to be re-drawn first', () =>
    {
        expect(overUnread(sized('film.mp4', 'video/mp4', FILE_MOST + 1), false)).toBe(true);
        expect(overUnread(sized('big.zip', 'application/zip', FILE_MOST + 1), false)).toBe(true);
        expect(overUnread(sized('huge.jpg', 'image/jpeg', FILE_MOST + 1), false), 'a photo is measured once re-drawn').toBe(false);
        expect(overUnread(sized('huge.jpg', 'image/jpeg', FILE_MOST + 1), true), 'unless it goes as a file').toBe(true);
        expect(overUnread(sized('small.zip', 'application/zip', 1000), false)).toBe(false);
    });
});

const composer = (props: { record?: string; disabled?: boolean; editing?: string | null; value?: string } = {}) => renderTest(() => Composer({
    value: props.value ?? '',
    disabled: props.disabled ?? false,
    editing: props.editing ?? null,
    ...(props.record === undefined ? {} : { record: props.record }),
    onInput: () => undefined,
    onSend: () => undefined
}) as HTMLElement).container;

const attachButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[aria-label="Attach a photo, a video or a file"]');

describe('the composer’s paperclip', () =>
{
    it('is offered only where a file can be sent, and not while a line is edited', () =>
    {
        expect(attachButton(composer({ record: 'c-reza' }))).not.toBeNull();

        cleanup();
        expect(attachButton(composer())).toBeNull();

        cleanup();
        expect(attachButton(composer({ record: 'c-reza', disabled: true }))).toBeNull();

        cleanup();
        expect(attachButton(composer({ record: 'c-reza', editing: 'old words' }))).toBeNull();
    });

    it('opens the sheet for a file picked, with the words in the field as its caption', async () =>
    {
        const container = composer({ record: 'c-reza', value: 'Here it is' });
        const input = container.querySelector<HTMLInputElement>('input[data-attach]')!;
        const file = new File([new Uint8Array([37, 80, 68, 70])], 'report.pdf', { type: 'application/pdf' });

        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        fire(input, 'change');

        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.id)).toEqual(['file-sheet']), { timeout: 4000 });
        expect(useOverlay().items()[0].props).toMatchObject({ room: 'c-reza', files: [file], caption: 'Here it is' });
    });
});

const sheet = (file: File, caption = '') =>
{
    const closed: unknown[] = [];
    const sent: number[] = [];
    const container = renderTest(() => FileSheet({
        overlayId: 'file-sheet',
        close: (result) => closed.push(result),
        room: 'c-reza',
        files: [file],
        caption,
        onSent: () => sent.push(1)
    }) as HTMLElement).container;

    return { container, closed, sent };
};

const sendButton = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'Send') ?? null;

describe('the sheet a file goes from', () =>
{
    it('shows a file’s name and size, and sends it with its caption', async () =>
    {
        const sendFile = vi.spyOn(useChat(), 'sendFile').mockResolvedValue(undefined);
        const file = new File([new TextEncoder().encode('%PDF-1.7 hello')], 'report.pdf', { type: 'application/pdf' });
        const { container, closed, sent } = sheet(file, 'The numbers');

        await vi.waitFor(() => expect(sendButton(container)?.disabled).toBe(false));
        expect(container.textContent).toContain('report.pdf');
        expect(container.querySelector('[data-size]')?.textContent).toBe('14 B');
        expect(container.querySelector('[role="switch"]'), 'a file is only a file').toBeNull();

        fire(sendButton(container)!, 'click');

        expect(sendFile).toHaveBeenCalledTimes(1);

        const [room, draft, caption] = sendFile.mock.calls[0];

        expect(room).toBe('c-reza');
        expect(draft).toMatchObject({ as: 'file', name: 'report.pdf', mime: 'application/pdf' });
        expect(caption).toBe('The numbers');
        expect(sent, 'the composer empties').toHaveLength(1);
        expect(closed).toEqual([true]);
    });

    it('says a file over its limit at once, reads none of it, and will not send it', async () =>
    {
        const sendFile = vi.spyOn(useChat(), 'sendFile').mockResolvedValue(undefined);
        const file = sized('film.mov', 'application/octet-stream', 72 * 1024 * 1024);
        const read = vi.spyOn(file, 'arrayBuffer');
        const { container } = sheet(file);

        await vi.waitFor(() => expect(container.querySelector('[data-over]')?.textContent).toBe('This is 72 MB. The most is 50 MB.'));
        expect(sendButton(container)?.disabled).toBe(true);
        expect(read, 'nothing read').not.toHaveBeenCalled();
        expect(sendFile).not.toHaveBeenCalled();
    });

    it('offers a photo or a video to go as a file', async () =>
    {
        const { container } = sheet(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'beach.jpg', { type: 'image/jpeg' }));

        await vi.waitFor(() => expect(container.querySelector('[role="switch"]')?.textContent).toContain('Send as a file'));
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileDraft } from '../src/data/chat.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { openFile } from '../src/lib/chat-file.ts';
import { heldFile } from '../src/lib/file-held.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
import { ChatFileError, setChatFiles, type ChatFileFailure } from '../src/services/chat-files.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { useSearch } from '../src/stores/search.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import '../src/locales/app-catalogue.ts';

/**
 * A photo, a video or a file on its way, through the real sealing and the specs' server: in the
 * thread at the press with its caption, its file up first, the message naming it, and the same file
 * again once the server has it.
 */

const memory = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

/** The specs' file store: what went up, what it was told to refuse, and an upload held at its door. */
const files = {
    held: new Map<string, Uint8Array>(),
    uploads: [] as string[],
    refuse: null as ChatFileFailure | null,
    door: null as Promise<void> | null
};

const photo = (): FileDraft => ({
    plain: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 3000 }, (_, at) => at % 251)]),
    as: 'photo',
    mime: 'image/jpeg',
    name: 'beach.jpg',
    w: 1600,
    h: 1200,
    thumb: 'AAAA'
});

const holding = () =>
{
    let release: () => void = () => undefined;

    files.door = new Promise<void>((resolve) =>
    {
        release = resolve;
    });

    return () =>
    {
        files.door = null;
        release();
    };
};

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(900_000), seed: 9 });
    memory.clear();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) =>
            {
                memory.set(key, value);
            },
            removeItem: (key: string) =>
            {
                memory.delete(key);
            }
        }
    });
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    server.reset();
    useSocial().reset();
    useGroups().reset();
    useChat().reset();
    useNotifications().reset();
    useSearch().reset();
    useSettings().reset();

    files.held.clear();
    files.uploads.length = 0;
    files.refuse = null;
    files.door = null;
    setChatFiles({
        async upload(id, body, progress)
        {
            progress(0.5);

            if (files.door !== null)
            {
                await files.door;
            }

            if (files.refuse !== null)
            {
                throw new ChatFileError(files.refuse);
            }

            files.uploads.push(id);
            files.held.set(id, body);
            progress(1);
        },
        async download(id, progress)
        {
            const body = files.held.get(id);

            if (body === undefined)
            {
                throw new ChatFileError('file-missing');
            }

            progress(1);
            return body;
        }
    });
});

afterEach(() =>
{
    setChatSource(null);
    setChatFiles(null);
    vi.restoreAllMocks();
    useSocial().reset();
    useChat().reset();
    if (original !== undefined)
    {
        Object.defineProperty(window, 'localStorage', original);
    }
});

describe('a photo, a video or a file on its way', () =>
{
    it('is in the thread at the press with its caption, its size and its proportions, and is that file once the server has it', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const release = holding();

        const sending = chat.sendFile('c-reza', photo(), '  At the beach  ');

        await vi.waitFor(() => expect(chat.messages().at(-1)?.kind).toBe('file'));

        const shown = chat.messages().at(-1)!;

        expect(shown).toMatchObject({ kind: 'file', from: 'alex', outgoing: 'sending', text: 'At the beach', file: { as: 'photo', name: 'beach.jpg', bytes: 3004, w: 1600, h: 1200, thumb: 'AAAA' } });
        expect(chat.lastOf('c-reza')?.id, 'the list shows it as the last line').toBe(shown.id);

        release();
        await sending;
        await chat.refresh();

        const landed = chat.messages().filter((one) => one.kind === 'file');

        expect(landed, 'once, as the server stored it').toHaveLength(1);
        expect(landed[0].id, 'under the id it was shown with').toBe(shown.id);
        expect(landed[0].outgoing).toBeUndefined();
        expect(landed[0].file, 'what its sender sealed, read back').toEqual(shown.file);
        expect(landed[0].text, 'its caption, read back').toBe('At the beach');
        expect(server.messages.find((one) => one.id === shown.id)?.file, 'the message names its file').toBe(shown.file?.id);
    });

    it('goes up as ciphertext the server cannot see, which opens under the key sealed in the message', async () =>
    {
        const chat = useChat();
        const said = photo();

        chat.openThread('c-reza');
        await chat.sendFile('c-reza', said, 'secret caption');
        await chat.refresh();

        const sent = server.messages.at(-1)!;
        const kept = files.held.get(sent.file!)!;
        const file = chat.messages().find((one) => one.id === sent.id)!.file!;

        expect(kept).toHaveLength(said.plain.length + 16);
        expect([...kept.slice(0, 4)], 'nothing of the photo shows').not.toEqual([...said.plain.slice(0, 4)]);
        expect(sent.body, 'the document is sealed too').not.toContain('beach');
        expect(sent.body, 'and its caption').not.toContain('secret');
        expect(await openFile(kept, file.key, file.iv, file.id)).toEqual(said.plain);
        expect(heldFile(file.id)?.type, 'the sender sees it without fetching it, as the picture its bytes say it is').toBe('image/jpeg');
    });

    it('says what it was sent as in the clear, for the gallery, and opens as tampered when the server says otherwise', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.sendFile('c-reza', photo(), '');
        await chat.refresh();

        const sent = server.messages.at(-1)!;

        expect(sent.fileAs, 'stated beside the file it names').toBe('photo');
        expect(chat.messages().find((one) => one.id === sent.id)?.locked, 'and opened as the document says').toBeUndefined();

        sent.fileAs = 'file';
        await chat.refresh();

        expect(chat.messages().find((one) => one.id === sent.id)?.locked).toBe('tampered');
    });

    it('is read back from the gallery, opened as the thread opens it, photos and files each in a list of their own', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.sendFile('c-reza', photo(), 'At the beach');
        await chat.sendFile('c-reza', { plain: new TextEncoder().encode('%PDF-1.7 numbers'), as: 'file', mime: 'application/pdf', name: 'report.pdf' }, '');
        await chat.refresh();

        const media = await chat.media('c-reza', 'media');
        const filed = await chat.media('c-reza', 'files');
        const voices = await chat.media('c-reza', 'voice');

        expect(media.messages.map((one) => [ one.file?.name, one.text, one.locked ])).toEqual([ [ 'beach.jpg', 'At the beach', undefined ] ]);
        expect(filed.messages.map((one) => one.file?.name)).toEqual([ 'report.pdf' ]);
        expect(voices.messages).toEqual([]);
        expect(media.cursor, 'one page holds them').toBeUndefined();
    });

    it('opens as tampered when the server moves the message onto another file', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.sendFile('c-reza', photo(), '');
        await chat.refresh();

        const sent = server.messages.at(-1)!;

        sent.file = crypto.randomUUID();
        await chat.refresh();

        expect(chat.messages().find((one) => one.id === sent.id)?.locked).toBe('tampered');
    });

    it('holds a file the sender chose to send as a file as one that is never shown', async () =>
    {
        const chat = useChat();

        await chat.sendFile('c-reza', { ...photo(), as: 'file', name: 'beach.jpg', w: undefined, h: undefined, thumb: undefined }, '');

        expect(heldFile(chat.lastOf('c-reza')!.file!.id)?.type).toBe('application/octet-stream');
    });

    it('says how much of its file has gone up while it goes, and nothing once it has', async () =>
    {
        const chat = useChat();
        const release = holding();

        const sending = chat.sendFile('c-reza', photo(), '');

        await vi.waitFor(() => expect(chat.lastOf('c-reza')?.kind).toBe('file'));

        const id = chat.lastOf('c-reza')!.id;

        await vi.waitFor(() => expect(chat.uploadOf(id)).toBe(0.5));

        release();
        await sending;

        expect(chat.uploadOf(id)).toBeNull();
    });

    it('is Not sent when its file did not go up, and goes up when the reader tries again', async () =>
    {
        const chat = useChat();

        files.refuse = 'network';
        await chat.sendFile('c-reza', photo(), '').catch(() => undefined);

        const failed = chat.lastOf('c-reza')!;

        expect(failed.outgoing).toBe('failed');
        expect(server.calls.filter((one) => one === 'chat.send'), 'no message without its file').toEqual([]);

        files.refuse = null;
        await chat.retry(failed);
        await chat.refresh();

        expect(files.uploads).toEqual([failed.file?.id]);
        expect(server.messages.some((one) => one.id === failed.id), 'stored under the id it was shown with').toBe(true);
    });

    it('does not put its file up again when only the message was refused, and does when the server no longer holds it', async () =>
    {
        const chat = useChat();

        server.refuseSend = 'no';
        await chat.sendFile('c-reza', photo(), '').catch(() => undefined);

        const failed = chat.lastOf('c-reza')!;

        expect(failed.outgoing).toBe('failed');
        expect(files.uploads, 'the file went up').toHaveLength(1);

        server.refuseSend = null;
        const send = client.chat.send.bind(client.chat);
        const refused = vi.spyOn(client.chat, 'send').mockImplementationOnce(() => Promise.reject(new ApiError(404, 'file-missing', 'No such file.', undefined)));

        await chat.retry(failed).catch(() => undefined);

        expect(files.uploads, 'not again for a refused message').toHaveLength(1);

        refused.mockImplementation(send);
        await chat.retry(chat.lastOf('c-reza')!);

        expect(files.uploads, 'up again once the server said it had no such file').toEqual([failed.file?.id, failed.file?.id]);
    });

    it('is taken out of the thread when the reader deletes it, its file let go', async () =>
    {
        const chat = useChat();

        files.refuse = 'file-budget';
        await chat.sendFile('c-reza', photo(), '').catch(() => undefined);

        const dropped = chat.lastOf('c-reza')!;

        expect(heldFile(dropped.file!.id)).not.toBeNull();

        chat.discard(dropped);

        expect(chat.lastOf('c-reza')?.id).not.toBe(dropped.id);
        expect(heldFile(dropped.file!.id)).toBeNull();
    });

    it('forwards its file as it is with its caption, putting nothing up', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.sendFile('c-reza', photo(), 'Look');
        await chat.refresh();

        const sent = chat.messages().find((one) => one.kind === 'file' && one.outgoing === undefined)!;
        const to = server.conversations.find((one) => one.id !== 'c-reza' && one.kind === 'direct')!.id;

        await chat.forward(sent, to);

        const forwarded = server.messages.at(-1)!;

        expect(forwarded.conversationId).toBe(to);
        expect(forwarded.file, 'the same file').toBe(sent.file?.id);
        expect(files.uploads, 'up once').toHaveLength(1);
    });
});

describe('a file in search', () =>
{
    it('is found by its caption, and one without a caption is not a row of nothing', async () =>
    {
        const chat = useChat();
        const search = useSearch();

        chat.openThread('c-reza');
        await chat.sendFile('c-reza', photo(), 'sunset over the harbour');
        await chat.sendFile('c-reza', photo(), '');
        await chat.refresh();

        search.setQuery('harbour');

        expect(search.results().messages.map((one) => one.text)).toEqual(['sunset over the harbour']);

        search.setQuery('alex');

        expect(search.results().messages.some((one) => one.kind === 'file' && one.text === ''), 'no caption, no row').toBe(false);
    });
});

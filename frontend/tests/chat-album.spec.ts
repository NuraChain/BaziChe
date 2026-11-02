import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gistOf } from '../src/components/chat/gist.ts';
import type { FileDraft, Message } from '../src/data/chat.ts';
import { manualClock } from '../src/lib/clock.ts';
import { heldFile } from '../src/lib/file-held.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { createApiSource } from '../src/services/chat.source.ts';
import { ChatFileError, setChatFiles, type ChatFileFailure } from '../src/services/chat-files.ts';
import { setVoiceFiles } from '../src/services/voice-files.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
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
 * Two to ten photos and videos sent together as one album (MS-D46), through the real sealing and the
 * specs' server: in the thread at the press, every file up, the album in one request, each item sealed
 * in its place, and the album Not sent, tried again and taken away whole.
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

const photo = (name = 'beach.jpg'): FileDraft => ({
    plain: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 2000 }, (_, at) => at % 251)]),
    as: 'photo',
    mime: 'image/jpeg',
    name,
    w: 1600,
    h: 1200,
    thumb: 'AAAA'
});

const video = (): FileDraft => ({
    plain: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...Array.from({ length: 2000 }, (_, at) => at % 241)]),
    as: 'video',
    mime: 'video/mp4',
    name: 'waves.mp4',
    w: 1920,
    h: 1080,
    ms: 4200,
    thumb: 'BBBB'
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

/** The album's items as the thread shows them, in their places. */
const itemsOf = (messages: readonly Message[]) => messages.filter((one) => one.album !== undefined).sort((a, b) => (a.album?.at ?? 0) - (b.album?.at ?? 0));

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

describe('an album on its way', () =>
{
    it('is in the thread at the press, every item in its place, the caption on the first, and is that album once the server has it', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const release = holding();

        const sending = chat.sendAlbum('c-reza', [photo(), video(), photo('rocks.jpg')], '  Our trip  ');

        await vi.waitFor(() => expect(itemsOf(chat.messages())).toHaveLength(3));

        const shown = itemsOf(chat.messages());
        const album = shown[0].album?.id;

        expect(shown.map((one) => [one.album?.at, one.album?.of, one.album?.holds, one.file?.as, one.text, one.outgoing])).toEqual([
            [0, 3, 'both', 'photo', 'Our trip', 'sending'],
            [1, 3, 'both', 'video', '', 'sending'],
            [2, 3, 'both', 'photo', '', 'sending']
        ]);
        expect(new Set(shown.map((one) => one.album?.id)).size, 'one album').toBe(1);
        expect(shown.map((one) => one.at), 'each a millisecond after the one before').toEqual([shown[0].at, shown[0].at + 1, shown[0].at + 2]);
        expect(chat.lastOf('c-reza')?.id, 'the list shows its last item').toBe(shown[2].id);
        expect(gistOf(chat.lastOf('c-reza')!, useLocale()), 'and says what it holds').toBe('3 photos and videos');

        release();
        await sending;
        await chat.refresh();

        const landed = itemsOf(chat.messages());

        expect(landed.map((one) => one.id), 'stored under the ids it was shown with').toEqual(shown.map((one) => one.id));
        expect(landed.every((one) => one.outgoing === undefined && one.album?.id === album && one.locked === undefined)).toBe(true);
        expect(landed.map((one) => one.file), 'what its sender sealed, read back').toEqual(shown.map((one) => one.file));
        expect(landed[0].text, 'the caption, read back').toBe('Our trip');
        expect(server.calls.filter((one) => one === 'chat.album'), 'sent in one request').toHaveLength(1);
        expect(server.calls.filter((one) => one === 'chat.send'), 'and not a line at a time').toHaveLength(0);
        expect(server.messages.filter((one) => one.album === album).map((one) => one.file), 'each names its own file').toEqual(shown.map((one) => one.file?.id));
    });

    it('marks every item as the server has it, before the read hands them back', async () =>
    {
        const live = createApiSource();
        let open: () => void = () => undefined;
        let gate: Promise<void> | null = null;

        setChatSource({
            ...live,
            thread: async (...args: Parameters<typeof live.thread>) =>
            {
                const page = await live.thread(...args);

                await gate;
                return page;
            }
        });

        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();

        gate = new Promise<void>((resolve) =>
        {
            open = resolve;
        });
        await chat.sendAlbum('c-reza', [photo(), photo(), video()], '');

        expect(itemsOf(chat.messages()).map((one) => one.outgoing)).toEqual(['sent', 'sent', 'sent']);

        open();
        await chat.refresh();

        expect(itemsOf(chat.messages()).map((one) => one.outgoing), 'and are the album the server read back').toEqual([undefined, undefined, undefined]);
    });

    it('sends nothing when the store is reset while it waits its turn', async () =>
    {
        const chat = useChat();
        let open: () => void = () => undefined;

        server.holdChat = new Promise<void>((resolve) =>
        {
            open = resolve;
        });

        const line = chat.send('c-reza', 'first in the queue');
        const album = chat.sendAlbum('c-reza', [photo(), photo()], '');

        await vi.waitFor(() => expect(chat.lastOf('c-reza')?.album).toBeDefined());

        chat.reset();
        server.holdChat = null;
        open();
        await line.catch(() => undefined);

        await expect(album).resolves.toBeUndefined();
        expect(server.calls, 'no album asked for after it').not.toContain('chat.album');
        expect(files.uploads, 'and no file put up').toEqual([]);
    });

    it('seals each item in its place under one read of the epoch, with the next number after the one before it', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.sendAlbum('c-reza', [photo(), photo(), photo(), video()], 'secret caption');

        const rows = server.messages.filter((one) => one.album !== undefined);

        expect(rows.map((one) => one.seq! - rows[0].seq!), 'numbers that follow one another').toEqual([0, 1, 2, 3]);
        expect(new Set(rows.map((one) => one.epoch)).size, 'one epoch').toBe(1);
        expect(rows.map((one) => one.fileAs)).toEqual(['photo', 'photo', 'photo', 'video']);
        expect(rows.some((one) => (one.body ?? '').includes('secret')), 'the caption is sealed').toBe(false);

        await chat.send('c-reza', 'and a line after it');

        const line = server.messages.at(-1)!;

        expect(line.seq, 'a line after it takes the number after its last').toBe(rows[3].seq! + 1);
    });

    it('puts the reply on its first item alone', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();

        const quoted = chat.messages().find((one) => one.kind === 'text')!;

        chat.setReplyTo('c-reza', quoted);
        await chat.sendAlbum('c-reza', [photo(), photo()], '');
        await chat.refresh();

        const landed = itemsOf(chat.messages());

        expect(landed.map((one) => one.reply)).toEqual([quoted.id, undefined]);
        expect(chat.replyTo('c-reza'), 'and the composer lets go of it').toBeNull();
    });

    it('is drawn item by item when its row and its document name different albums', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.sendAlbum('c-reza', [photo(), photo(), photo()], '');
        await chat.refresh();

        const rows = server.messages.filter((one) => one.album !== undefined);

        rows[0].album = crypto.randomUUID();
        delete rows[1].album;
        await chat.refresh();

        const read = (id: string) => chat.messages().find((one) => one.id === id)!;

        expect(read(rows[0].id).album, 'moved into another album').toBeUndefined();
        expect(read(rows[1].id).album, 'moved out of its own').toBeUndefined();
        expect([read(rows[0].id).locked, read(rows[1].id).locked], 'and still each a photo').toEqual([undefined, undefined]);
        expect(read(rows[2].id).album?.at, 'the one left where it was').toBe(2);
    });

    it('says how much of each file has gone up while they go, one after another, and nothing once they have', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const release = holding();

        const sending = chat.sendAlbum('c-reza', [photo(), photo()], '');

        await vi.waitFor(() => expect(itemsOf(chat.messages())).toHaveLength(2));

        const [first, second] = itemsOf(chat.messages());

        await vi.waitFor(() => expect(chat.uploadOf(first.id), 'the first on its way').toBe(0.5));
        expect(chat.uploadOf(second.id), 'the second after it').toBeNull();

        release();
        await sending;

        expect([chat.uploadOf(first.id), chat.uploadOf(second.id)]).toEqual([null, null]);
    });

    it('refuses an album that is not one before anything is shown or sent', async () =>
    {
        const chat = useChat();
        const file: FileDraft = { ...photo(), as: 'file', name: 'report.pdf', mime: 'application/pdf', w: undefined, h: undefined, thumb: undefined };

        await expect(chat.sendAlbum('c-reza', [photo()], ''), 'one').rejects.toThrow(RangeError);
        await expect(chat.sendAlbum('c-reza', Array.from({ length: 11 }, () => photo()), ''), 'eleven').rejects.toThrow(RangeError);
        await expect(chat.sendAlbum('c-reza', [photo(), file], ''), 'a file').rejects.toThrow(RangeError);

        expect(chat.lastOf('c-reza')?.album, 'nothing shown').toBeUndefined();
        expect(files.uploads, 'nothing up').toEqual([]);
    });
});

describe('an album that did not go', () =>
{
    it('is Not sent together when a file did not go up, and goes up whole when tried again', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');

        files.refuse = 'network';
        await chat.sendAlbum('c-reza', [photo(), photo(), video()], '').catch(() => undefined);

        const failed = itemsOf(chat.messages());

        expect(failed.map((one) => one.outgoing)).toEqual(['failed', 'failed', 'failed']);
        expect(server.calls.filter((one) => one === 'chat.album'), 'no album without its files').toEqual([]);

        files.refuse = null;
        await chat.retry(failed[1]);
        await chat.refresh();

        expect(files.uploads, 'every file up once').toEqual(failed.map((one) => one.file?.id));
        expect(itemsOf(chat.messages()).map((one) => [one.id, one.outgoing]), 'stored under the ids it was shown with').toEqual(failed.map((one) => [one.id, undefined]));
    });

    it('does not put its files up again when only the album was refused, and does when the server no longer holds one', async () =>
    {
        const chat = useChat();

        server.refuseSend = 'no';
        await chat.sendAlbum('c-reza', [photo(), photo()], '').catch(() => undefined);

        const failed = chat.lastOf('c-reza')!;

        expect(failed.outgoing).toBe('failed');
        expect(files.uploads, 'both went up').toHaveLength(2);

        server.refuseSend = null;
        const send = client.chat.album.bind(client.chat);
        const refused = vi.spyOn(client.chat, 'album').mockImplementationOnce(() => Promise.reject(new ApiError(404, 'file-missing', 'No such file.', undefined)));

        await chat.retry(failed).catch(() => undefined);

        expect(files.uploads, 'not again for a refused album').toHaveLength(2);

        refused.mockImplementation(send);
        await chat.retry(chat.lastOf('c-reza')!);

        expect(files.uploads, 'up again once the server said it had no such file').toHaveLength(4);
        expect(server.messages.filter((one) => one.album !== undefined), 'and the album stored').toHaveLength(2);
    });

    it('is taken out of the thread whole when the reader deletes it, every file let go', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');

        files.refuse = 'file-budget';
        await chat.sendAlbum('c-reza', [photo(), photo(), photo()], '').catch(() => undefined);

        const dropped = itemsOf(chat.messages());

        expect(dropped.every((one) => heldFile(one.file!.id) !== null)).toBe(true);

        chat.discard(dropped[2]);

        expect(itemsOf(chat.messages()), 'every item gone').toEqual([]);
        expect(dropped.every((one) => heldFile(one.file!.id) === null), 'every file let go').toBe(true);
    });
});

describe('an album taken away', () =>
{
    it('goes whole at the press, and stays gone once the server has it', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.sendAlbum('c-reza', [photo(), photo(), photo()], 'gone soon');
        await chat.refresh();

        const sent = itemsOf(chat.messages());
        const release = (() =>
        {
            let open: () => void = () => undefined;

            server.holdChat = new Promise<void>((resolve) =>
            {
                open = resolve;
            });
            return () =>
            {
                server.holdChat = null;
                open();
            };
        })();

        const removing = chat.remove(sent[1]);

        expect(itemsOf(chat.messages()), 'every item gone at the press').toEqual([]);

        release();
        await removing;

        expect(server.calls.filter((one) => one === 'chat.removeAlbum'), 'in one request').toHaveLength(1);
        expect(server.messages.filter((one) => sent.some((item) => item.id === one.id)).map((one) => one.kind), 'every item a tombstone').toEqual(['deleted', 'deleted', 'deleted']);
        expect(itemsOf(chat.messages())).toEqual([]);
    });

    it('comes back whole when the server refuses', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.sendAlbum('c-reza', [photo(), photo()], '');
        await chat.refresh();

        const sent = itemsOf(chat.messages());

        server.refuseRemove = 'no';
        await chat.remove(sent[0]).catch(() => undefined);

        expect(itemsOf(chat.messages()).map((one) => one.id)).toEqual(sent.map((one) => one.id));
    });
});

describe('an album forwarded', () =>
{
    it('goes whole, as an album of its own, each file named as it is, its caption kept and nothing put up', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.sendAlbum('c-reza', [photo(), video(), photo('rocks.jpg')], 'Our trip');
        await chat.refresh();

        const sent = itemsOf(chat.messages());
        const to = server.conversations.find((one) => one.id !== 'c-reza' && one.kind === 'direct')!.id;
        const uploaded = files.uploads.length;

        await chat.forward(sent[1], to);

        const again = server.messages.filter((one) => one.conversationId === to && one.album !== undefined);

        expect(again.map((one) => one.file), 'the same files, in their places').toEqual(sent.map((one) => one.file?.id));
        expect(new Set(again.map((one) => one.album)).size, 'one album').toBe(1);
        expect(again[0].album, 'of its own').not.toBe(sent[0].album?.id);
        expect(files.uploads, 'nothing put up').toHaveLength(uploaded);

        chat.openThread(to);
        await chat.refresh();

        const read = itemsOf(chat.messages());

        expect(read.map((one) => [one.forwarded, one.album?.at, one.album?.of, one.album?.holds])).toEqual([[true, 0, 3, 'both'], [true, 1, 3, 'both'], [true, 2, 3, 'both']]);
        expect(read[0].text, 'its caption with it').toBe('Our trip');
    });

    it('forwards an item alone when no other item of its album is here', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.sendAlbum('c-reza', [photo(), photo()], '');
        await chat.refresh();

        const one = itemsOf(chat.messages())[0];
        const to = server.conversations.find((row) => row.id !== 'c-reza' && row.kind === 'direct')!.id;

        await chat.forward({ ...one, album: { ...one.album!, id: crypto.randomUUID() } }, to);

        const sent = server.messages.at(-1)!;

        expect([sent.conversationId, sent.album, sent.file]).toEqual([to, undefined, one.file?.id]);
    });
});

describe('several sent together', () =>
{
    it('are in the thread in the order they were sent, however long each takes to seal', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const release = holding();
        const large = (): FileDraft => ({ ...photo(), plain: new Uint8Array(4 * 1024 * 1024).fill(7) });

        const album = chat.sendAlbum('c-reza', [large(), large(), large()], '');
        const alone = chat.sendFile('c-reza', photo('after.jpg'), '');
        const waiting = () => chat.messages().filter((one) => one.outgoing !== undefined);

        await vi.waitFor(() => expect(waiting()).toHaveLength(4));

        expect(waiting().map((one) => (one.album === undefined ? one.file?.name : 'album'))).toEqual(['album', 'album', 'album', 'after.jpg']);

        release();
        await Promise.all([album, alone]);
        await chat.refresh();

        expect(server.messages.slice(-4).map((one) => (one.album === undefined ? 'alone' : 'album')), 'and go in that order').toEqual(['album', 'album', 'album', 'alone']);
    });

    it('keep a voice message sent after an album behind it', async () =>
    {
        setVoiceFiles({ upload: () => Promise.resolve(), download: () => Promise.resolve(new Uint8Array()), reported: () => Promise.resolve(new Uint8Array()) });

        try
        {
            const chat = useChat();
            chat.openThread('c-reza');
            await chat.refresh();
            const release = holding();
            const large = (): FileDraft => ({ ...photo(), plain: new Uint8Array(4 * 1024 * 1024).fill(7) });
            const waiting = () => chat.messages().filter((one) => one.outgoing !== undefined);

            const album = chat.sendAlbum('c-reza', [large(), large()], '');
            const spoken = chat.sendVoice('c-reza', { plain: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]), mime: 'audio/webm;codecs=opus', ms: 1200, wave: [3, 9] });

            await vi.waitFor(() => expect(waiting()).toHaveLength(3));

            expect(waiting().map((one) => (one.kind === 'voice' ? 'voice' : 'album'))).toEqual(['album', 'album', 'voice']);

            release();
            await Promise.all([album, spoken]);
        }
        finally
        {
            setVoiceFiles(null);
        }
    });
});

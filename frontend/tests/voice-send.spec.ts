import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import ChatListItem from '../src/components/chat/chat-list-item.component.azeroth';
import type { Message, VoiceRecording } from '../src/data/chat.ts';
import '../src/icons/all.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import { heldAudio } from '../src/lib/voice-held.ts';
import { openAudio } from '../src/lib/voice-note.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
import { createApiSource, type ChatSource } from '../src/services/chat.source.ts';
import { setVoiceFiles, VoiceFileError, type VoiceFileFailure } from '../src/services/voice-files.ts';
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
 * A voice message on its way, through the real sealing and the specs' server: in the thread at the
 * press, its file up first, the message naming it, and a voice message again once the server has it.
 */

const memory = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

/** The specs' file store: what went up, what it was told to refuse, and an upload held at its door. */
const files = {
    held: new Map<string, Uint8Array>(),
    uploads: [] as string[],
    refuse: null as VoiceFileFailure | null,
    door: null as Promise<void> | null
};

const recording = (): VoiceRecording => ({
    plain: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array.from({ length: 2000 }, (_, at) => at % 199)]),
    mime: 'audio/webm;codecs=opus',
    ms: 4200,
    wave: [0, 20, 63, 40]
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
    setVoiceFiles({
        async upload(id, body, progress)
        {
            progress(0.5);

            if (files.door !== null)
            {
                await files.door;
            }

            if (files.refuse !== null)
            {
                throw new VoiceFileError(files.refuse);
            }

            files.uploads.push(id);
            files.held.set(id, body);
            progress(1);
        },
        async download(id)
        {
            const body = files.held.get(id);

            if (body === undefined)
            {
                throw new VoiceFileError('voice-missing');
            }

            return body;
        },
        reported: () => Promise.reject(new VoiceFileError('voice-missing'))
    });
});

afterEach(() =>
{
    setChatSource(null);
    setVoiceFiles(null);
    vi.restoreAllMocks();
    useSocial().reset();
    useChat().reset();
    if (original !== undefined)
    {
        Object.defineProperty(window, 'localStorage', original);
    }
});

describe('a voice message on its way', () =>
{
    it('is in the thread and on the list at the press, with its length and its waveform, and is that voice message once the server has it', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const release = holding();

        const sending = chat.sendVoice('c-reza', recording());

        await vi.waitFor(() => expect(chat.messages().at(-1)?.kind).toBe('voice'));

        const shown = chat.messages().at(-1)!;

        expect(shown).toMatchObject({ kind: 'voice', from: 'alex', outgoing: 'sending', voice: { ms: 4200, wave: [0, 20, 63, 40], mime: 'audio/webm;codecs=opus' } });
        expect(chat.lastOf('c-reza')?.id, 'the list shows it as the last line').toBe(shown.id);

        release();
        await sending;
        await chat.refresh();

        const landed = chat.messages().filter((one) => one.kind === 'voice');

        expect(landed, 'once, as the server stored it').toHaveLength(1);
        expect(landed[0].id, 'under the id it was shown with').toBe(shown.id);
        expect(landed[0].outgoing).toBeUndefined();
        expect(landed[0].voice, 'what its sender sealed, read back').toEqual(shown.voice);
        expect(server.messages.find((one) => one.id === shown.id)?.voice, 'the message names its file').toBe(shown.voice?.id);
    });

    it('goes up as ciphertext the server cannot hear, which opens under the key sealed in the message', async () =>
    {
        const chat = useChat();
        const said = recording();

        chat.openThread('c-reza');
        await chat.sendVoice('c-reza', said);
        await chat.refresh();

        const sent = server.messages.at(-1)!;
        const kept = files.held.get(sent.voice!)!;
        const voice = chat.messages().find((one) => one.id === sent.id)!.voice!;

        expect(kept).toHaveLength(said.plain.length + 16);
        expect([...kept.slice(0, 4)], 'nothing of the recording shows').not.toEqual([...said.plain.slice(0, 4)]);
        expect(sent.body, 'the document is sealed too').not.toContain('voice');
        expect(await openAudio(kept, voice.key, voice.iv, voice.id)).toEqual(said.plain);
        expect(heldAudio(voice.id), 'the sender hears it without fetching it').toEqual(said.plain);
    });

    it('says how much of its file has gone up while it goes, and nothing once it has', async () =>
    {
        const chat = useChat();
        const release = holding();

        const sending = chat.sendVoice('c-reza', recording());

        await vi.waitFor(() => expect(chat.lastOf('c-reza')?.kind).toBe('voice'));

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
        await chat.sendVoice('c-reza', recording()).catch(() => undefined);

        const failed = chat.lastOf('c-reza')!;

        expect(failed.outgoing).toBe('failed');
        expect(files.uploads).toEqual([]);
        expect(server.calls.filter((one) => one === 'chat.send'), 'no message without its file').toEqual([]);

        files.refuse = null;
        await chat.retry(failed);
        await chat.refresh();

        expect(files.uploads).toEqual([failed.voice?.id]);
        expect(server.messages.some((one) => one.id === failed.id), 'stored under the id it was shown with').toBe(true);
    });

    it('does not put its file up again when only the message was refused', async () =>
    {
        const chat = useChat();

        server.refuseSend = 'no';
        await chat.sendVoice('c-reza', recording()).catch(() => undefined);

        const failed = chat.lastOf('c-reza')!;

        expect(failed.outgoing).toBe('failed');
        expect(files.uploads, 'the file went up').toHaveLength(1);

        server.refuseSend = null;
        await chat.retry(failed);
        await chat.refresh();

        expect(files.uploads, 'and not again').toHaveLength(1);
        expect(server.messages.some((one) => one.id === failed.id)).toBe(true);
    });

    it('puts its file up again when the server no longer holds it', async () =>
    {
        const chat = useChat();
        const send = client.chat.send.bind(client.chat);
        const refused = vi.spyOn(client.chat, 'send').mockImplementationOnce(() => Promise.reject(new ApiError(404, 'voice-missing', 'No such voice file.', undefined)));

        await chat.sendVoice('c-reza', recording()).catch(() => undefined);

        const failed = chat.lastOf('c-reza')!;

        expect(failed.outgoing).toBe('failed');

        refused.mockImplementation(send);
        await chat.retry(failed);

        expect(files.uploads, 'up, then up again').toEqual([failed.voice?.id, failed.voice?.id]);
    });

    it('is taken out of the thread when the reader deletes it, its recording let go', async () =>
    {
        const chat = useChat();

        files.refuse = 'voice-budget';
        await chat.sendVoice('c-reza', recording()).catch(() => undefined);

        const dropped = chat.lastOf('c-reza')!;

        expect(heldAudio(dropped.voice!.id)).not.toBeNull();

        chat.discard(dropped);

        expect(chat.lastOf('c-reza')?.id).not.toBe(dropped.id);
        expect(heldAudio(dropped.voice!.id)).toBeNull();
    });

    it('forwards its file as it is, putting nothing up', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.sendVoice('c-reza', recording());
        await chat.refresh();

        const spoken = chat.messages().find((one) => one.kind === 'voice' && one.outgoing === undefined)!;
        const to = server.conversations.find((one) => one.id !== 'c-reza' && one.kind === 'direct')!.id;

        await chat.forward(spoken, to);
        await chat.refresh();

        const forwarded = server.messages.at(-1)!;

        expect(files.uploads, 'one upload in all').toHaveLength(1);
        expect([forwarded.conversationId, forwarded.kind, forwarded.voice]).toEqual([to, 'voice', spoken.voice?.id]);

        chat.openThread(to);
        await chat.refresh();

        expect(chat.messages().find((one) => one.id === forwarded.id), 'read as a forwarded voice message').toMatchObject({ kind: 'voice', forwarded: true, voice: spoken.voice });
    });

    it('opens as tampered when its row names another file than the one its sender sealed', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');

        await chat.sendVoice('c-reza', recording());

        const stored = server.messages.at(-1)!;

        stored.voice = crypto.randomUUID();
        await chat.refresh();

        expect(chat.messages().find((one) => one.id === stored.id)?.locked).toBe('tampered');
    });
});

describe('a voice message last in the list', () =>
{
    it('says it is a voice message and how long, with the mark of what became of it', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.sendVoice('c-reza', recording());
        await chat.refresh();

        const router = createRouter({ routes: [], history: createMemoryHistory('/app/chats'), scroll: false });
        const container = renderTest(() => RouterProvider({
            router,
            children: () => ChatListItem({ conversation: chat.conversation('c-reza')!, me: 'alex', now: runtime().clock.now() })
        }) as HTMLElement).container;

        expect(container.textContent).toContain('Voice message (0:04)');
        expect(container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('sent');

        cleanup();
    });
});

describe('a voice message in search', () =>
{
    it('is not looked through for words it does not have, nor counted as one that could not be read', async () =>
    {
        const chat = useChat();
        const search = useSearch();

        chat.openThread('c-reza');
        await chat.refresh();
        search.setQuery('alex');

        const before = search.results().locked;

        await chat.sendVoice('c-reza', recording());
        await chat.refresh();

        expect(chat.archive().some((one) => one.kind === 'voice'), 'opened, and held with the rest').toBe(true);

        expect(search.results().messages.some((one) => one.kind === 'voice'), 'never a row of nothing under its sender').toBe(false);
        expect(search.results().locked, 'and not locked').toBe(before);
    });
});

describe('a voice message played', () =>
{
    const theirs: Message = {
        id: 'v-1',
        conversationId: 'c-reza',
        from: 'reza',
        kind: 'voice',
        text: '',
        at: 1000,
        ref: null,
        voice: { id: '0b5b0d47-5a3c-4f8e-9a51-6f0b3c2d1e7a', key: 'A'.repeat(43), iv: 'B'.repeat(16), mime: 'audio/webm;codecs=opus', ms: 3000, wave: [1, 2, 3], bytes: 900 }
    };

    const sourced = (told: string[], refuse = false): ChatSource =>
    {
        const real = createApiSource();

        return {
            ...real,
            thread: async () => ({ messages: [theirs, { ...theirs, id: 'v-2', from: 'alex' }], earlier: false }),
            played: async (conversationId, messageId) =>
            {
                told.push(`${ conversationId }:${ messageId }`);

                if (refuse)
                {
                    throw new ApiError(404, 'not-found', 'No such voice message here.', undefined);
                }
            }
        };
    };

    it('loses its dot at the press, and the server is told', async () =>
    {
        const told: string[] = [];

        setChatSource(sourced(told));

        const chat = useChat();
        chat.openThread('c-reza');
        await vi.waitFor(() => expect(chat.messages()).toHaveLength(2));

        const playing = chat.played(chat.messages()[0]);

        expect(chat.messages()[0].played, 'at the press').toBe(true);

        await playing;

        expect(told).toEqual(['c-reza:v-1']);
    });

    it('is never marked for its own sender, nor again once played', async () =>
    {
        const told: string[] = [];

        setChatSource(sourced(told));

        const chat = useChat();
        chat.openThread('c-reza');
        await vi.waitFor(() => expect(chat.messages()).toHaveLength(2));

        await chat.played(chat.messages()[1]);
        await chat.played({ ...chat.messages()[0], played: true });

        expect(told).toEqual([]);
    });

    it('takes its dot back without a word when the server refuses', async () =>
    {
        const told: string[] = [];

        setChatSource(sourced(told, true));

        const chat = useChat();
        chat.openThread('c-reza');
        await vi.waitFor(() => expect(chat.messages()).toHaveLength(2));

        await chat.played(chat.messages()[0]);

        expect(chat.messages()[0].played).toBeUndefined();
    });
});

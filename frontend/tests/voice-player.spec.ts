import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import { messageActions } from '../src/components/chat/actions.ts';
import { gistOf, voiceClock } from '../src/components/chat/gist.ts';
import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import '../src/icons/all.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { forgetAudio, holdAudio } from '../src/lib/voice-held.ts';
import { sealAudio, wavePath } from '../src/lib/voice-note.ts';
import { createApiSource, type ChatSource } from '../src/services/chat.source.ts';
import { setVoiceFiles, VoiceFileError, type VoiceFileFailure } from '../src/services/voice-files.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { setVoiceAudio, type VoiceAudio } from '../src/lib/voice-audio.ts';
import { useVoicePlayer, VOICE_TICK_MS } from '../src/stores/voice-player.store.ts';
import { server } from './fake-api.ts';
import { blockFlags, durationAt, webm } from './webm.ts';
import '../src/locales/app-catalogue.ts';

/**
 * Voice messages played: one at a time through one element, from the recording the tab holds or the
 * file fetched and opened under its key, the next one after, at the speed the device keeps; and the
 * player in its bubble, drawn whole before anything is fetched.
 */

/** How the next element the player makes behaves: the length its header names, the one found past its end, and what it refuses. */
const shape = {
    header: 4 as number,
    found: 4,
    playable: 'maybe',
    refuse: false,
    breaks: null as number | null
};

/** An audio element the spec drives: it loads what it is handed, plays, pauses and ends as told, and keeps what was set on it. */
class FakeAudio implements VoiceAudio
{
    static made: FakeAudio[] = [];

    duration = Number.NaN;
    playbackRate = 1;
    preservesPitch = false;
    paused = true;
    error: { code: number } | null = null;
    sink = '';
    private place = 0;
    private address = '';
    private readonly heard = new Map<string, Set<() => void>>();

    constructor()
    {
        FakeAudio.made.push(this);
    }

    get src()
    {
        return this.address;
    }

    set src(value: string)
    {
        this.address = value;
        this.place = 0;
        this.duration = Number.NaN;
        this.error = null;

        if (value !== '')
        {
            queueMicrotask(() => this.arrive(value));
        }
    }

    get currentTime()
    {
        return this.place;
    }

    set currentTime(value: number)
    {
        if (this.duration === Infinity && value > shape.found)
        {
            this.duration = shape.found;
            this.place = shape.found;
            queueMicrotask(() =>
            {
                this.emit('durationchange');
                this.emit('timeupdate');
            });
            return;
        }

        this.place = Number.isFinite(this.duration) ? Math.min(value, this.duration) : value;
    }

    private arrive(value: string)
    {
        if (this.address !== value)
        {
            return;
        }

        if (shape.breaks !== null)
        {
            this.error = { code: shape.breaks };
            this.emit('error');
            return;
        }

        this.duration = shape.header;
        this.emit('loadedmetadata');
    }

    emit(type: string)
    {
        for (const listener of [...this.heard.get(type) ?? []])
        {
            listener();
        }
    }

    addEventListener(type: string, listener: () => void)
    {
        const all = this.heard.get(type) ?? new Set<() => void>();

        all.add(listener);
        this.heard.set(type, all);
    }

    removeEventListener(type: string, listener: () => void)
    {
        this.heard.get(type)?.delete(listener);
    }

    canPlayType()
    {
        return shape.playable;
    }

    removeAttribute(name: string)
    {
        if (name === 'src')
        {
            this.address = '';
            this.duration = Number.NaN;
        }
    }

    load()
    {
        return undefined;
    }

    async play()
    {
        if (shape.refuse)
        {
            throw new DOMException('Not without a press.', 'NotAllowedError');
        }

        if (this.paused)
        {
            this.paused = false;
            queueMicrotask(() => this.emit('playing'));
        }
    }

    pause()
    {
        if (!this.paused)
        {
            this.paused = true;
            queueMicrotask(() => this.emit('pause'));
        }
    }

    async setSinkId(id: string)
    {
        this.sink = id;
    }

    /** It ran to its end, as an element says it: the last place, paused, then ended. */
    end()
    {
        this.place = this.duration;
        this.paused = true;
        this.emit('timeupdate');
        this.emit('pause');
        this.emit('ended');
    }
}

const audio = () => FakeAudio.made.at(-1)!;

const addresses = { made: [] as { url: string; blob: Blob }[], revoked: [] as string[] };

const files = {
    held: new Map<string, Uint8Array>(),
    downloads: [] as string[],
    refuse: null as VoiceFileFailure | null,
    door: null as Promise<void> | null
};

const plains = new Map<string, Uint8Array>();

const WEBM = [0x1a, 0x45, 0xdf, 0xa3];

const recordingOf = (magic: number[]) => new Uint8Array([...magic, ...Array.from({ length: 600 }, (_, at) => (at * 7) % 251)]);

/** A voice message whose file is really sealed under the key it carries, kept by the specs' file store. */
const spoken = async (id: string, from: string, extra: Partial<Message> = {}, plain = recordingOf(WEBM)): Promise<Message> =>
{
    const fileId = crypto.randomUUID();
    const sealed = await sealAudio(plain, fileId);

    files.held.set(fileId, sealed.body);
    plains.set(fileId, plain);

    return {
        id,
        conversationId: 'c-reza',
        from,
        kind: 'voice',
        text: '',
        at: 1_700_000_000_000 + Number(id.replace(/\D/g, '')) * 1000,
        ref: null,
        voice: { id: fileId, key: sealed.key, iv: sealed.iv, mime: 'audio/webm;codecs=opus', ms: 4000, wave: [0, 30, 63, 12], bytes: plain.length },
        ...extra
    };
};

const words = (id: string, from: string): Message => ({ id, conversationId: 'c-reza', from, kind: 'text', text: 'hello', at: 1_700_000_000_000 + Number(id.replace(/\D/g, '')) * 1000, ref: null });

let lines: Message[] = [];

const told: string[] = [];

const source = (): ChatSource =>
{
    const real = createApiSource();

    return {
        ...real,
        thread: async () => ({ messages: lines, earlier: false }),
        played: async (conversationId, messageId) =>
        {
            told.push(`${ conversationId }:${ messageId }`);
        }
    };
};

/** The thread on screen, as the store reads it. */
const opened = async (next: Message[]) =>
{
    lines = next;
    setChatSource(source());

    const chat = useChat();

    chat.closeThread();
    chat.openThread('c-reza');
    await vi.waitFor(() => expect(chat.messages().map((one) => one.id)).toEqual(next.map((one) => one.id)));

    return chat;
};

const line = (id: string) => useChat().messages().find((one) => one.id === id)!;

let clock: ManualClock;

const memory = new Map<string, string>();
const storage = Object.getOwnPropertyDescriptor(window, 'localStorage');

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_700_000_100_000);
    setRuntime({ clock, seed: 5 });
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
    useChat().reset();
    useSettings().reset();
    useVoicePlayer().reset();
    forgetAudio();

    Object.assign(shape, { header: 4, found: 4, playable: 'maybe', refuse: false, breaks: null });
    FakeAudio.made = [];
    setVoiceAudio(() => new FakeAudio());

    addresses.made = [];
    addresses.revoked = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) =>
    {
        const url = `blob:voice/${ addresses.made.length + 1 }`;

        addresses.made.push({ url, blob: blob as Blob });
        return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) =>
    {
        addresses.revoked.push(url);
    });

    lines = [];
    told.length = 0;
    plains.clear();
    files.held.clear();
    files.downloads = [];
    files.refuse = null;
    files.door = null;
    setVoiceFiles({
        async upload(id, body)
        {
            files.held.set(id, body);
        },
        async download(id)
        {
            files.downloads.push(id);

            if (files.door !== null)
            {
                await files.door;
            }

            if (files.refuse !== null)
            {
                throw new VoiceFileError(files.refuse);
            }

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
    cleanup();
    useVoicePlayer().reset();
    setVoiceAudio(null);
    setVoiceFiles(null);
    setChatSource(null);
    useChat().reset();
    useSocial().reset();
    vi.restoreAllMocks();

    if (storage !== undefined)
    {
        Object.defineProperty(window, 'localStorage', storage);
    }
});

const playingNow = async (id: string) =>
{
    const player = useVoicePlayer();

    await vi.waitFor(() => expect([player.isCurrent(id), player.playing()]).toEqual([true, true]));
};

describe('a voice message played', () =>
{
    it('plays its file, fetched and opened under the key its message carries, at the speed this device keeps', async () =>
    {
        const first = await spoken('v-1', 'reza');
        await opened([first]);
        const player = useVoicePlayer();

        useSettings().update({ voiceRate: 1.5 });
        player.toggle(line('v-1'));

        expect(player.isCurrent('v-1'), 'in the player at the press').toBe(true);
        expect(player.stateOf('v-1')).toBe('loading');

        await playingNow('v-1');

        const made = addresses.made[0];

        expect(files.downloads).toEqual([first.voice!.id]);
        expect(audio().src).toBe(made.url);
        expect(made.blob.type, 'the type its own bytes say').toBe('audio/webm');
        expect(new Uint8Array(await made.blob.arrayBuffer())).toEqual(plains.get(first.voice!.id));
        expect([audio().playbackRate, audio().preservesPitch]).toEqual([1.5, true]);
        expect(player.stateOf('v-1')).toBeNull();
        await vi.waitFor(() => expect(told, 'marked played, once').toEqual(['c-reza:v-1']));
    });

    it('hands its element a recording Firefox made as one every browser can move through', async () =>
    {
        const first = await spoken('v-1', 'reza', {}, webm());

        await opened([first]);
        useVoicePlayer().toggle(line('v-1'));
        await playingNow('v-1');

        const handed = new Uint8Array(await addresses.made[0].blob.arrayBuffer());

        expect(blockFlags(handed), 'every block a keyframe, which Chromium seeks by').toEqual([0x80, 0x80, 0x80, 0x80, 0x80]);
        expect(durationAt(handed), 'and no Duration of 0, which Firefox took for the length').toBe(-1);
        expect(handed.length, 'nothing moved').toBe(first.voice!.bytes);
    });

    it('plays the reader’s own recording from what this tab holds, fetching nothing and marking nothing', async () =>
    {
        const own = await spoken('v-2', 'alex');

        holdAudio(own.voice!.id, plains.get(own.voice!.id)!);
        await opened([own]);

        useVoicePlayer().toggle(line('v-2'));
        await playingNow('v-2');

        expect(files.downloads).toEqual([]);
        expect(told).toEqual([]);
    });

    it('plays on the speaker chosen in Settings', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        useSettings().update({ voiceSpeaker: 'speaker-2' });

        useVoicePlayer().toggle(line('v-1'));
        await playingNow('v-1');

        expect(audio().sink).toBe('speaker-2');
    });

    it('says where it is while it plays, on the product clock, and reads nothing while it is paused', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');

        audio().currentTime = 1.25;
        clock.advance(VOICE_TICK_MS);

        expect(player.at()).toBe(1.25);
        await vi.waitFor(() => expect(told).toEqual(['c-reza:v-1']));

        player.toggle(line('v-1'));
        await vi.waitFor(() => expect(player.playing()).toBe(false));

        audio().currentTime = 3;
        clock.advance(VOICE_TICK_MS * 4);

        expect(player.at(), 'nothing read while paused').toBe(1.25);
        expect(player.isCurrent('v-1'), 'still the one in the player').toBe(true);

        player.toggle(line('v-1'));
        await playingNow('v-1');
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(files.downloads, 'not fetched again').toHaveLength(1);
        expect(told, 'marked played once, though it started twice').toEqual(['c-reza:v-1']);
    });

    it('pauses the first when another plays, the first keeping its place to go on from', async () =>
    {
        await opened([await spoken('v-1', 'reza'), await spoken('v-4', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');

        const first = audio().src;

        audio().currentTime = 2;
        player.toggle(line('v-4'));
        await playingNow('v-4');

        expect(player.keptOf('v-1')).toBe(2);
        expect(player.isCurrent('v-1')).toBe(false);
        expect(addresses.revoked, 'its address let go').toContain(first);
        expect(FakeAudio.made, 'one element for the tab').toHaveLength(1);

        player.toggle(line('v-1'));
        await playingNow('v-1');

        expect(audio().currentTime).toBe(2);
        expect(files.downloads, 'what was opened is held, not fetched again').toHaveLength(2);
    });

    it('hands over to the next voice message the reader has not played, passing their own and those played', async () =>
    {
        await opened([
            await spoken('v-1', 'reza'),
            words('t-2', 'reza'),
            await spoken('v-3', 'alex'),
            await spoken('v-4', 'reza', { played: true }),
            await spoken('v-5', 'reza')
        ]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');
        audio().end();

        await playingNow('v-5');
        expect(player.keptOf('v-1'), 'back at its start').toBe(0);

        audio().end();

        expect([player.isCurrent('v-5'), player.playing()], 'the last one ends where it is').toEqual([false, false]);
    });

    it('steps its speed through 1, 1.5 and 2, on the element at once and for every one after', async () =>
    {
        await opened([await spoken('v-1', 'reza'), await spoken('v-2', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');

        const speeds: number[] = [];

        for (let press = 0; press < 3; press += 1)
        {
            player.nextRate();
            speeds.push(audio().playbackRate);
        }

        expect(speeds).toEqual([1.5, 2, 1]);

        player.nextRate();
        player.nextRate();
        expect(useSettings().settings().voiceRate, 'kept on the device').toBe(2);

        player.toggle(line('v-2'));
        await playingNow('v-2');

        expect(audio().playbackRate).toBe(2);
    });

    it('moves the one playing, keeps another where it is put, and plays one from a place when asked', async () =>
    {
        await opened([await spoken('v-1', 'reza'), await spoken('v-2', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');

        player.seek(line('v-1'), 3);
        expect([audio().currentTime, player.at()]).toEqual([3, 3]);

        player.seek(line('v-1'), 99);
        expect(player.at(), 'no further than its end').toBe(4);

        player.seek(line('v-2'), 1.5);
        expect([player.keptOf('v-2'), player.isCurrent('v-2')]).toEqual([1.5, false]);

        player.seek(line('v-2'), 2.5, true);
        await playingNow('v-2');

        expect(audio().currentTime).toBe(2.5);
    });

    it('finds the length of a recording whose header names none, by asking for a place past its end', async () =>
    {
        shape.header = Infinity;
        shape.found = 6.5;
        await opened([await spoken('v-1', 'reza')]);
        const player = useVoicePlayer();

        expect(player.lengthOf(line('v-1')), 'its sender’s measure until then').toBe(4);

        player.toggle(line('v-1'));
        await playingNow('v-1');

        expect(player.lengthOf(line('v-1'))).toBe(6.5);
        expect(audio().currentTime, 'and back at its start').toBe(0);
    });

    it('is left paused and ready to press when the browser will not play without one', async () =>
    {
        shape.refuse = true;
        await opened([await spoken('v-1', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await vi.waitFor(() => expect(player.stateOf('v-1')).toBeNull());

        expect([player.isCurrent('v-1'), player.playing()]).toEqual([true, false]);

        shape.refuse = false;
        player.toggle(line('v-1'));
        await playingNow('v-1');
    });

    it('gives up one on its way when it is pressed again', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        const player = useVoicePlayer();
        let release: () => void = () => undefined;

        files.door = new Promise<void>((resolve) =>
        {
            release = resolve;
        });

        player.toggle(line('v-1'));
        await vi.waitFor(() => expect(files.downloads).toHaveLength(1));

        player.toggle(line('v-1'));
        expect([player.isCurrent('v-1'), player.stateOf('v-1')]).toEqual([false, null]);

        files.door = null;
        release();
        await vi.waitFor(() => expect(files.downloads).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(FakeAudio.made, 'nothing was played').toHaveLength(0);
        expect(player.isCurrent('v-1')).toBe(false);
    });
});

describe('a voice message that does not play', () =>
{
    const faultOf = async (message: Message) =>
    {
        await opened([message]);
        const player = useVoicePlayer();

        player.toggle(line(message.id));
        await vi.waitFor(() => expect(player.stateOf(message.id)).not.toBe('loading'));

        return { player, state: player.stateOf(message.id) };
    };

    it('is gone when the server no longer has its file', async () =>
    {
        files.refuse = 'voice-missing';

        const { player, state } = await faultOf(await spoken('v-1', 'reza'));

        expect(state).toBe('gone');
        expect(player.isCurrent('v-1')).toBe(false);
        expect(addresses.made).toHaveLength(0);
    });

    it('could not be loaded when its file did not come, and plays once it does', async () =>
    {
        files.refuse = 'network';

        const { player, state } = await faultOf(await spoken('v-1', 'reza'));

        expect(state).toBe('failed');

        files.refuse = null;
        player.toggle(line('v-1'));
        await playingNow('v-1');

        expect(player.stateOf('v-1')).toBeNull();
    });

    it('was changed after it was sent when its file does not open under its key', async () =>
    {
        const message = await spoken('v-1', 'reza');
        const body = files.held.get(message.voice!.id)!;

        body[20] ^= 1;

        expect((await faultOf(message)).state).toBe('tampered');
        expect(addresses.made, 'nothing of it handed to the element').toHaveLength(0);
    });

    it('is no recording when its own bytes say it is not one, whatever its sender named', async () =>
    {
        const message = await spoken('v-1', 'reza', {}, recordingOf([0x4d, 0x5a, 0x90, 0x00]));

        expect((await faultOf(message)).state).toBe('unplayable');
        expect(addresses.made).toHaveLength(0);
    });

    it('is one this browser cannot play when it says so of its type, or of the source', async () =>
    {
        shape.playable = '';
        expect((await faultOf(await spoken('v-1', 'reza'))).state).toBe('unsupported');

        shape.playable = 'maybe';
        shape.breaks = 4;
        useVoicePlayer().reset();
        expect((await faultOf(await spoken('v-2', 'reza'))).state).toBe('unsupported');
        expect(addresses.revoked, 'its address let go').toEqual(addresses.made.map((one) => one.url));

        shape.breaks = 3;
        useVoicePlayer().reset();
        expect((await faultOf(await spoken('v-3', 'reza'))).state, 'a source that breaks as it is read').toBe('unplayable');
    });

    it('is one that cannot be played when it breaks mid-way', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');

        audio().error = { code: 3 };
        audio().emit('error');

        expect([player.stateOf('v-1'), player.isCurrent('v-1'), player.playing()]).toEqual(['unplayable', false, false]);
    });
});

describe('a voice message let go', () =>
{
    it('stops, its address revoked, when the reader leaves the conversation', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');

        const url = audio().src;

        useChat().closeThread();

        await vi.waitFor(() => expect(player.isCurrent('v-1')).toBe(false));
        expect(addresses.revoked).toContain(url);
        expect([audio().src, audio().paused]).toEqual(['', true]);
    });

    it('stops when its message leaves the thread: deleted, or run out', async () =>
    {
        const chat = await opened([await spoken('v-1', 'reza'), words('t-2', 'reza')]);
        const player = useVoicePlayer();

        player.toggle(line('v-1'));
        await playingNow('v-1');

        lines = lines.filter((one) => one.id !== 'v-1');
        await chat.refresh();

        await vi.waitFor(() => expect(player.isCurrent('v-1')).toBe(false));
    });

    it('stops, and forgets every place, when the tab lets go of everything it held', async () =>
    {
        await opened([await spoken('v-1', 'reza'), await spoken('v-2', 'reza')]);
        const player = useVoicePlayer();

        player.seek(line('v-2'), 2);
        player.toggle(line('v-1'));
        await playingNow('v-1');

        forgetAudio();

        expect([player.isCurrent('v-1'), player.keptOf('v-2')]).toEqual([false, 0]);
    });
});

/** A voice message drawn in its bubble, as a thread draws it. */
const show = (message: Message, onActions = vi.fn()) =>
{
    const router = createRouter({ routes: [], history: createMemoryHistory('/app/chats/c-reza'), scroll: false });

    return renderTest(() => RouterProvider({
        router,
        children: () => MessageBubble({ message, me: 'alex', onActions, onReply: () => undefined })
    }) as HTMLElement).container;
};

const drawn = async (container: HTMLElement) =>
{
    await vi.waitFor(() => expect(container.querySelector('[data-voice]')).not.toBeNull());

    return {
        play: container.querySelector<HTMLButtonElement>('[data-play]')!,
        track: container.querySelector<HTMLElement>('[role="slider"]')!,
        clock: () => container.querySelector('[data-clock]')?.textContent?.trim() ?? '',
        played: () => Number(container.querySelector('[data-played]')?.getAttribute('data-played'))
    };
};

describe('a voice message in its bubble', () =>
{
    it('is drawn whole before anything is fetched: play, its waveform, how long it is, and a dot until it is played', async () =>
    {
        const container = show(await spoken('v-1', 'reza'));
        const { play, track, clock: said } = await drawn(container);

        expect(play.getAttribute('aria-label')).toBe('Play the voice message, 0:04');
        expect(said()).toBe('0:04');
        expect(track.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(64);
        expect(track.getAttribute('aria-valuetext')).toBe('0:04 of 0:04');
        expect(container.querySelector('[data-fresh]')?.textContent).toBe('Not played yet');
        expect(container.querySelector('.bubble')?.getAttribute('dir'), 'a media control runs left to right').toBe('ltr');
        expect(files.downloads).toEqual([]);
    });

    it('says why when this browser could not open it, as any line does, and is never drawn as a line the server wrote', () =>
    {
        const locked: Message = { id: 'v-9', conversationId: 'c-reza', from: 'alex', kind: 'voice', text: '', at: 1_700_000_009_000, ref: null, locked: 'no-epoch-key' };
        const container = show(locked);

        expect(container.textContent).toContain('This browser was not given the key for this part of the conversation.');
        expect(container.textContent, 'not a table opened').not.toContain('opened a table');
        expect(container.querySelector('[data-voice]'), 'and no player for a file it cannot open').toBeNull();
    });

    it('has no dot once played, and on the reader’s own from the press until somebody has played it', async () =>
    {
        expect(show(await spoken('v-1', 'reza', { played: true })).querySelector('[data-fresh]')).toBeNull();

        cleanup();
        const own = show(await spoken('v-2', 'alex'));

        await drawn(own);
        expect(own.querySelector('[data-fresh]')?.textContent).toBe('Nobody has played it yet');

        cleanup();
        const heard = show(await spoken('v-3', 'alex', { heard: true }));

        await drawn(heard);
        expect(heard.querySelector('[data-fresh]')).toBeNull();

        cleanup();
        const going = show(await spoken('v-4', 'alex', { outgoing: 'sending' }));

        await drawn(going);
        expect(going.querySelector('[data-fresh]'), 'from the press, not once the server has it').not.toBeNull();

        cleanup();
        const unsent = show(await spoken('v-5', 'alex', { outgoing: 'failed' }));

        await drawn(unsent);
        expect(unsent.querySelector('[data-fresh]'), 'never on one that reached nobody').toBeNull();
    });

    it('plays at a press, says where it is and its speed while it plays, and pauses at the next', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        const container = show(line('v-1'));
        const { play, clock: said, played } = await drawn(container);

        fire(play, 'click');
        await vi.waitFor(() => expect(play.getAttribute('data-play')).toBe('playing'));

        expect(play.getAttribute('aria-label')).toBe('Pause the voice message');
        expect(container.querySelector('[data-speed]')?.textContent?.trim()).toBe('1×');

        audio().currentTime = 2;
        clock.advance(VOICE_TICK_MS);

        await vi.waitFor(() => expect(said()).toBe('0:02'));
        expect(played()).toBe(0.5);

        fire(container.querySelector('[data-speed]')!, 'click');
        expect(container.querySelector('[data-speed]')?.textContent?.trim()).toBe('1.5×');

        fire(play, 'click');
        await vi.waitFor(() => expect(play.getAttribute('data-play')).toBe('paused'));
    });

    it('moves along its waveform under the arrows, Home and End, as a slider does', async () =>
    {
        await opened([await spoken('v-2', 'reza')]);

        const long = { ...line('v-2'), voice: { ...line('v-2').voice!, ms: 20_000 } };
        const container = show(long);
        const { track, clock: said } = await drawn(container);
        const key = (name: string) => track.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

        key('ArrowRight');
        expect([said(), track.getAttribute('aria-valuenow')]).toEqual(['0:05', '5']);

        key('PageUp');
        expect(said()).toBe('0:09');

        key('ArrowLeft');
        expect(said()).toBe('0:04');

        key('End');
        expect(said()).toBe('0:20');

        key('Home');
        expect(said(), 'back at its start, it says how long it is').toBe('0:20');
        expect(useVoicePlayer().isCurrent('v-2'), 'nothing played by a key').toBe(false);
    });

    it('plays from where its waveform is pressed, and keeps that press from the line’s own held press', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        const onActions = vi.fn();
        const container = show(line('v-1'), onActions);
        const { track } = await drawn(container);
        const at = (type: string, x: number, kind = 'mouse') =>
        {
            const event = new Event(type, { bubbles: true, cancelable: true });

            Object.defineProperty(event, 'clientX', { value: x });
            Object.defineProperty(event, 'clientY', { value: 5 });
            Object.defineProperty(event, 'pointerType', { value: kind });
            Object.defineProperty(event, 'isPrimary', { value: true });
            Object.defineProperty(event, 'button', { value: 0 });
            Object.defineProperty(event, 'pointerId', { value: 1 });
            track.dispatchEvent(event);
        };

        track.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 24, right: 300, bottom: 24, x: 100, y: 0, toJSON: () => ({}) });

        at('pointerdown', 120, 'touch');
        clock.advance(800);
        at('pointercancel', 120, 'touch');

        expect(onActions, 'a finger on the waveform is not a held line').not.toHaveBeenCalled();

        at('pointerdown', 150);
        at('pointermove', 200);
        at('pointerup', 200);

        await playingNow('v-1');
        expect(audio().currentTime).toBe(2);
    });

    it('says why it does not play, and offers to try again only where that could help', async () =>
    {
        await opened([await spoken('v-1', 'reza')]);
        files.refuse = 'network';

        const container = show(line('v-1'));
        const { play } = await drawn(container);

        fire(play, 'click');
        await vi.waitFor(() => expect(container.querySelector('[data-fault]')?.getAttribute('data-fault')).toBe('failed'));

        expect(container.querySelector('[data-fault]')?.textContent).toContain('This voice message could not be loaded.');

        files.refuse = null;
        fire([...container.querySelectorAll<HTMLButtonElement>('[data-fault] button')].find((one) => one.textContent?.includes('Try again'))!, 'click');
        await playingNow('v-1');

        cleanup();
        useVoicePlayer().reset();

        const changed = await spoken('v-2', 'reza');

        files.held.get(changed.voice!.id)![30] ^= 1;
        lines = [changed];
        await useChat().refresh();

        const broken = show(line('v-2'));
        const parts = await drawn(broken);

        fire(parts.play, 'click');
        await vi.waitFor(() => expect(broken.querySelector('[data-fault]')?.getAttribute('role')).toBe('alert'));

        expect(broken.querySelector('[data-fault]')?.textContent).toContain('changed after it was sent');
        expect(broken.querySelector('[data-fault] button'), 'nothing to try again').toBeNull();
        expect(parts.play.disabled).toBe(true);
    });

    it('says its clock in the reader’s own digits, still left to right', async () =>
    {
        useLocale().setLocale('fa');

        const container = show(await spoken('v-1', 'reza'));
        const { clock: said } = await drawn(container);

        expect(said()).toBe('۰:۰۴');
        expect(container.querySelector('[data-voice]')?.getAttribute('dir')).toBe('ltr');
    });
});

describe('a voice message quoted', () =>
{
    it('is said as a voice message and how long, in both languages', async () =>
    {
        const spokenFor = { ...words('v-1', 'reza'), kind: 'voice' as const, text: '', voice: { id: 'f', key: 'k', iv: 'i', mime: 'audio/webm', ms: 65_400, wave: [1], bytes: 1 } };

        expect(gistOf(spokenFor, useLocale())).toBe('Voice message (1:05)');

        useLocale().setLocale('fa');
        expect(gistOf(spokenFor, useLocale())).toBe('پیام صوتی (۱:۰۵)');
    });

    it('is a voice message, with no length, while this browser cannot open it', () =>
    {
        const locked = { ...words('v-1', 'reza'), kind: 'voice' as const, text: '', locked: 'no-epoch-key' as const };

        expect(gistOf(locked, useLocale())).toBe('Voice message');
    });

    it('offers no words to copy', async () =>
    {
        const ids = messageActions(useLocale().t, await spoken('v-1', 'reza'), 'alex', { onReply: () => undefined, onForward: () => undefined })
            .map((action) => action.id);

        expect(ids).toEqual(['reply', 'forward']);
    });

    it('is quoted as a voice message by a reply to it', async () =>
    {
        const quoted = await spoken('v-1', 'reza');
        const router = createRouter({ routes: [], history: createMemoryHistory('/app/chats/c-reza'), scroll: false });
        const container = renderTest(() => RouterProvider({
            router,
            children: () => MessageBubble({ message: { ...words('t-2', 'alex'), reply: 'v-1' }, me: 'alex', quoteOf: () => quoted, onActions: () => undefined })
        }) as HTMLElement).container;

        expect(container.textContent).toContain('Voice message (0:04)');
    });
});

describe('a clock and a waveform', () =>
{
    it('says a length as minutes and two digits of seconds', () =>
    {
        const n = useLocale().n;

        expect([voiceClock(0, n), voiceClock(4.9, n), voiceClock(65.9, n), voiceClock(600, n)]).toEqual(['0:00', '0:04', '1:05', '10:00']);
    });

    it('draws a bar a level, silence as dots and the loudest nearly the whole height', () =>
    {
        const bars = [...wavePath([0, 63]).matchAll(/M([\d.]+) ([\d.]+)v([\d.]+)/g)].map((one) => one.slice(1).map(Number));

        expect(bars).toHaveLength(64);
        expect(bars[0], 'silence: a dot in the middle').toEqual([1.5, 12, 0]);
        expect(bars[63], 'the loudest, from 2 to 22').toEqual([190.5, 2, 20]);
    });
});

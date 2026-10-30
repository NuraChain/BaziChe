import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import { VOICE_MOST_MS, VOICE_WAVE_BARS } from '../../backend/src/domains/chat/voice.ts';
import Composer from '../src/components/chat/composer.component.azeroth';
import '../src/icons/all.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { forgetAudio } from '../src/lib/voice-held.ts';
import { liveWave, typeSaid, waveOfLevels } from '../src/lib/voice-note.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVoicePlayer } from '../src/stores/voice-player.store.ts';
import { RECORD_TICK_MS, setRecorderEnv, useVoiceRecorder, type Decoded, type RecorderLike } from '../src/stores/voice-recorder.store.ts';
import { useVoiceRooms } from '../src/stores/voice-rooms.store.ts';
import { server } from './fake-api.ts';
import { blockFlags, durationAt, webm } from './webm.ts';
import '../src/locales/app-catalogue.ts';

/**
 * A voice message recorded in a composer: the microphone asked for with the reader's choices, recorded
 * by a MediaRecorder, paused to be heard, resumed, sent with the length and waveform its own recording
 * gives, deleted, kept when the reader leaves, and every way the browser can say no.
 */

const WEBM = [0x1a, 0x45, 0xdf, 0xa3];

/** A MediaRecorder the spec drives: it holds what it is told it heard, and hands it over as a browser does. */
class FakeRecorder implements RecorderLike
{
    public static made: FakeRecorder[] = [];

    public state = 'inactive';
    public slice: number | undefined = undefined;
    public ondataavailable: ((event: { data: Blob }) => void) | null = null;
    public onstop: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public readonly stream: MediaStream;
    public readonly options: MediaRecorderOptions;
    public readonly mimeType: string;
    #heard: Uint8Array[] = [];

    constructor(stream: MediaStream, options: MediaRecorderOptions, mimeType: string)
    {
        this.stream = stream;
        this.options = options;
        this.mimeType = mimeType;
        FakeRecorder.made.push(this);
    }

    public start(slice?: number)
    {
        this.state = 'recording';
        this.slice = slice;
    }

    public pause()
    {
        this.state = 'paused';
    }

    public resume()
    {
        this.state = 'recording';
    }

    public requestData()
    {
        queueMicrotask(() => this.hand());
    }

    public stop()
    {
        this.state = 'inactive';
        queueMicrotask(() =>
        {
            this.hand();
            this.onstop?.();
        });
    }

    /** What the microphone said since it last handed anything over. */
    public say(bytes: Uint8Array)
    {
        this.#heard.push(bytes);
    }

    public hand()
    {
        const data = new Blob(this.#heard as BlobPart[]);

        this.#heard = [];
        this.ondataavailable?.({ data });
    }
}

/** What the spec makes the browser answer. */
const browser = {
    able: true,
    types: ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
    says: 'audio/webm;codecs=opus',
    refuse: null as string | null,
    door: null as Promise<void> | null,
    level: 0.25,
    decoded: { samples: new Float32Array(8000).map((_, at) => Math.sin(at / 3) * 0.4), seconds: 3 } as Decoded | null,
    asked: [] as MediaStreamConstraints[],
    stopped: 0,
    closed: 0,
    tracks: [] as { stopped: boolean }[]
};

const recorder = () => FakeRecorder.made.at(-1)!;

const take = () => useVoiceRecorder().take('c-reza');

let clock: ManualClock;

const addresses = { made: [] as string[], revoked: [] as string[] };

const memory = new Map<string, string>();
const storage = Object.getOwnPropertyDescriptor(window, 'localStorage');

const toasts = () => useToasts().items().map((toast) => toast.text);

beforeEach(async () =>
{
    resetRuntime();
    clock = manualClock(1_700_000_000_000);
    setRuntime({ clock, seed: 7 });
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
    useToasts().dismissAll();
    useVoiceRecorder().reset();
    useVoiceRooms().reset();

    Object.assign(browser, {
        able: true,
        types: ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
        says: 'audio/webm;codecs=opus',
        refuse: null,
        door: null,
        level: 0.25,
        decoded: { samples: new Float32Array(8000).map((_, at) => Math.sin(at / 3) * 0.4), seconds: 3 },
        asked: [],
        stopped: 0,
        closed: 0,
        tracks: []
    });
    FakeRecorder.made = [];

    setRecorderEnv({
        able: () => browser.able,
        supported: (type) => browser.types.includes(type),
        listener: () => ({
            hear: () => undefined,
            level: () => browser.level,
            close: () =>
            {
                browser.closed += 1;
            }
        }),
        async microphone(constraints)
        {
            browser.asked.push(constraints);

            if (browser.door !== null)
            {
                await browser.door;
            }

            if (browser.refuse !== null)
            {
                throw new DOMException('No.', browser.refuse);
            }

            const track = { stopped: false, stop: () => undefined as void };

            track.stop = () =>
            {
                track.stopped = true;
                browser.stopped += 1;
            };
            browser.tracks.push(track);

            return { getTracks: () => [track] } as unknown as MediaStream;
        },
        recorder: (stream, options) => new FakeRecorder(stream, options, browser.says),
        decode: async () => browser.decoded
    });

    addresses.made = [];
    addresses.revoked = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() =>
    {
        const url = `blob:take/${ addresses.made.length + 1 }`;

        addresses.made.push(url);
        return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) =>
    {
        addresses.revoked.push(url);
    });

    useChat().openThread('c-reza');
    await vi.waitFor(() => expect(useChat().openId()).toBe('c-reza'));
});

afterEach(() =>
{
    cleanup();
    useVoiceRecorder().reset();
    setRecorderEnv(null);
    setChatSource(null);
    useChat().reset();
    useSocial().reset();
    vi.restoreAllMocks();

    if (storage !== undefined)
    {
        Object.defineProperty(window, 'localStorage', storage);
    }
});

const recording = async () =>
{
    void useVoiceRecorder().start('c-reza');
    await vi.waitFor(() => expect(take()?.phase).toBe('recording'));
};

const spoken = (size = 900) => new Uint8Array([...WEBM, ...Array.from({ length: size }, (_, at) => at % 251)]);

describe('a voice message recorded', () =>
{
    it('asks for the microphone with the choices of Settings › Voice, and records the first type the browser can make at 32 kbps', async () =>
    {
        useSettings().update({ voiceMic: 'mic-2', voiceEcho: false, voiceNoise: 'off', voiceAgc: true });
        browser.types = ['audio/ogg;codecs=opus', 'audio/mp4'];

        void useVoiceRecorder().start('c-reza');

        expect(take()?.phase, 'asking at the press').toBe('asking');
        expect(useVoiceRooms().has('c-reza'), 'its composer is the recorder’s').toBe(true);

        await vi.waitFor(() => expect(take()?.phase).toBe('recording'));

        expect(browser.asked).toEqual([{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1, deviceId: { ideal: 'mic-2' } } }]);
        expect(recorder().options).toEqual({ mimeType: 'audio/ogg;codecs=opus', audioBitsPerSecond: 32_000 });
        expect(recorder().slice, 'handing over a second at a time').toBe(1000);
    });

    it('stops whatever voice message is playing as it starts', async () =>
    {
        const stop = vi.spyOn(useVoicePlayer(), 'stop');

        await recording();

        expect(stop).toHaveBeenCalled();
    });

    it('says how long it has recorded and what the microphone hears, on the product clock', async () =>
    {
        await recording();

        clock.advance(RECORD_TICK_MS * 3);

        expect(take()?.elapsed).toBe(300);
        expect(take()?.levels).toEqual([0.25, 0.25, 0.25]);
    });

    it('pauses, and opens what was said so far: its length and waveform read from the recording itself', async () =>
    {
        await recording();

        recorder().say(spoken());
        clock.advance(2_000);
        void useVoiceRecorder().pause('c-reza');

        expect(take()?.phase).toBe('paused');
        expect(recorder().state).toBe('paused');

        await vi.waitFor(() => expect(take()?.preview).not.toBeNull());

        const preview = take()!.preview!;

        expect(preview.ms, 'the decoded length').toBe(3000);
        expect(preview.wave).toHaveLength(VOICE_WAVE_BARS);
        expect(Math.max(...preview.wave)).toBe(63);
        expect(preview.url).toBe(addresses.made.at(-1));
        expect(take()?.elapsed).toBe(2000);
    });

    it('draws its waveform from the microphone’s levels where the recording will not decode', async () =>
    {
        browser.decoded = null;
        await recording();

        browser.level = 0.5;
        clock.advance(RECORD_TICK_MS * 4);
        browser.level = 0.1;
        clock.advance(RECORD_TICK_MS * 4);
        recorder().say(spoken());
        void useVoiceRecorder().pause('c-reza');

        await vi.waitFor(() => expect(take()?.preview).not.toBeNull());

        expect(take()?.preview?.ms, 'as long as it recorded').toBe(800);
        expect(take()?.preview?.wave).toEqual(waveOfLevels([0.5, 0.5, 0.5, 0.5, 0.1, 0.1, 0.1, 0.1]));
    });

    it('records more into the same recording, letting go of the preview', async () =>
    {
        await recording();
        recorder().say(spoken());
        void useVoiceRecorder().pause('c-reza');
        await vi.waitFor(() => expect(take()?.preview).not.toBeNull());

        const url = take()!.preview!.url;

        useVoiceRecorder().resume('c-reza');

        expect([take()?.phase, take()?.preview, recorder().state]).toEqual(['recording', null, 'recording']);
        expect(addresses.revoked).toContain(url);
        expect(FakeRecorder.made, 'one recorder throughout').toHaveLength(1);
    });

    it('is sent as a voice message with all it recorded, its type as a document takes it, and lets go of the microphone', async () =>
    {
        const sendVoice = vi.spyOn(useChat(), 'sendVoice').mockResolvedValue(undefined);

        browser.says = 'audio/ogg; codecs=opus';
        await recording();
        recorder().say(spoken(400));
        recorder().hand();
        recorder().say(spoken(300));
        clock.advance(3_000);

        await useVoiceRecorder().send('c-reza');

        expect(sendVoice).toHaveBeenCalledTimes(1);

        const [room, sent] = sendVoice.mock.calls[0];

        expect(room).toBe('c-reza');
        expect(sent.plain).toEqual(new Uint8Array([...spoken(400), ...spoken(300)]));
        expect([sent.mime, sent.ms, sent.wave.length], 'the type the recorder made, in the document’s spelling').toEqual(['audio/ogg;codecs=opus', 3000, VOICE_WAVE_BARS]);
        expect([browser.tracks.every((track) => track.stopped), browser.closed]).toEqual([true, 1]);
        expect([take(), useVoiceRooms().has('c-reza')]).toEqual([null, false]);
    });

    it('is heard here, and sent, as a recording every browser can move through, though Firefox made it', async () =>
    {
        const sendVoice = vi.spyOn(useChat(), 'sendVoice').mockResolvedValue(undefined);
        const blobs: Blob[] = [];

        vi.mocked(URL.createObjectURL).mockImplementation((blob) =>
        {
            blobs.push(blob as Blob);
            return `blob:take/${ blobs.length }`;
        });

        const made = webm();

        await recording();
        recorder().say(made.slice(0, 60));
        recorder().hand();
        recorder().say(made.slice(60));
        clock.advance(3_000);
        void useVoiceRecorder().pause('c-reza');
        await vi.waitFor(() => expect(take()?.preview).not.toBeNull());

        const heard = new Uint8Array(await blobs.at(-1)!.arrayBuffer());

        expect(blockFlags(heard), 'heard here as it will be everywhere').toEqual([0x80, 0x80, 0x80, 0x80, 0x80]);
        expect(durationAt(heard)).toBe(-1);

        await useVoiceRecorder().send('c-reza');

        const [, sent] = sendVoice.mock.calls[0];

        expect(blockFlags(sent.plain), 'and sent so').toEqual([0x80, 0x80, 0x80, 0x80, 0x80]);
        expect([durationAt(sent.plain), sent.plain.length]).toEqual([-1, made.length]);
    });

    it('is dropped, and says so, when it is too short to send', async () =>
    {
        const sendVoice = vi.spyOn(useChat(), 'sendVoice').mockResolvedValue(undefined);

        browser.decoded = { samples: new Float32Array(4000), seconds: 0.6 };
        await recording();
        recorder().say(spoken());

        await useVoiceRecorder().send('c-reza');

        expect(sendVoice).not.toHaveBeenCalled();
        expect(toasts()).toContain('That was too short to send.');
        expect(take()).toBeNull();
    });

    it('is deleted with nothing sent, the microphone let go', async () =>
    {
        const sendVoice = vi.spyOn(useChat(), 'sendVoice').mockResolvedValue(undefined);

        await recording();
        recorder().say(spoken());
        useVoiceRecorder().discard('c-reza');

        expect([take(), useVoiceRooms().has('c-reza'), recorder().state]).toEqual([null, false, 'inactive']);
        expect(browser.tracks.every((track) => track.stopped)).toBe(true);
        await Promise.resolve();
        expect(sendVoice).not.toHaveBeenCalled();
    });

    it('keeps nothing, and lets go of the microphone it is given, when deleted while the browser asks', async () =>
    {
        let release: () => void = () => undefined;

        browser.door = new Promise<void>((resolve) =>
        {
            release = resolve;
        });

        void useVoiceRecorder().start('c-reza');
        await vi.waitFor(() => expect(browser.asked).toHaveLength(1));

        useVoiceRecorder().discard('c-reza');
        browser.door = null;
        release();

        await vi.waitFor(() => expect(browser.tracks).toHaveLength(1));
        await vi.waitFor(() => expect(browser.tracks[0].stopped).toBe(true));
        expect([FakeRecorder.made.length, take()]).toEqual([0, null]);
    });

    it('stops itself at the longest a voice message may be, says so, and records no more into it', async () =>
    {
        await recording();
        recorder().say(spoken());

        clock.advance(VOICE_MOST_MS);

        await vi.waitFor(() => expect(take()?.phase).toBe('paused'));
        expect(take()?.closed).toBe(true);
        expect(toasts()).toContain('That is as long as a voice message can be.');

        useVoiceRecorder().resume('c-reza');

        expect(take()?.phase, 'no more').toBe('paused');
    });

    it('stops itself short of the largest file a voice message may be', async () =>
    {
        await recording();
        recorder().say(new Uint8Array(6 * 1024 * 1024 - 32 * 1024));
        recorder().hand();

        clock.advance(RECORD_TICK_MS);

        await vi.waitFor(() => expect(take()?.phase).toBe('paused'));
        expect(take()?.closed).toBe(true);
    });

    it('waits, as it was and its microphone let go, when the reader leaves the room, to be sent when they come back', async () =>
    {
        const sendVoice = vi.spyOn(useChat(), 'sendVoice').mockResolvedValue(undefined);

        await recording();
        recorder().say(spoken());
        clock.advance(1_500);

        useChat().closeThread();

        await vi.waitFor(() => expect(take()?.preview).not.toBeNull());
        expect([take()?.phase, take()?.closed, recorder().state]).toEqual(['paused', true, 'inactive']);
        expect([browser.tracks.every((track) => track.stopped), browser.closed]).toEqual([true, 1]);
        expect(useVoiceRooms().has('c-reza'), 'its room still holds it').toBe(true);

        useChat().openThread('c-reza');
        await useVoiceRecorder().send('c-reza');

        expect(sendVoice).toHaveBeenCalledTimes(1);
    });

    it('lets go of every recording when the tab lets go of everything it held', async () =>
    {
        await recording();

        forgetAudio();

        expect([take(), browser.tracks[0].stopped]).toEqual([null, true]);
    });
});

describe('a recording the browser will not make', () =>
{
    const refused = async () =>
    {
        await useVoiceRecorder().start('c-reza');
        await vi.waitFor(() => expect(take()).toBeNull());

        return toasts();
    };

    it('says the microphone is off for the site when it was refused', async () =>
    {
        browser.refuse = 'NotAllowedError';

        expect(await refused()).toContain('Microphone access is off for this site. Allow it in your browser’s settings to record.');
        expect(useVoiceRooms().has('c-reza')).toBe(false);
    });

    it('says there is no microphone, or that another app has it', async () =>
    {
        browser.refuse = 'NotFoundError';
        expect(await refused()).toContain('No microphone was found.');

        useToasts().dismissAll();
        browser.refuse = 'NotReadableError';
        expect(await refused()).toContain('Another app is using the microphone.');
    });

    it('says this browser cannot record, where it has no recorder or makes none of the types', async () =>
    {
        browser.able = false;
        expect(await refused()).toContain('This browser cannot record audio here.');

        useToasts().dismissAll();
        browser.able = true;
        browser.types = [];
        expect(await refused()).toContain('This browser cannot record audio here.');
        expect(browser.asked, 'the microphone never asked for').toEqual([]);
    });
});

describe('the bars while it records', () =>
{
    it('are the microphone’s newest levels, the newest at their end and dots before anything was heard', () =>
    {
        const bars = liveWave([0.25, 0]);

        expect(bars).toHaveLength(VOICE_WAVE_BARS);
        expect(bars.slice(-2)).toEqual([63, 0]);
        expect(bars.slice(0, -2).every((level) => level === 0)).toBe(true);
        expect(liveWave([0.01]).at(-1), 'a quiet voice still moves them').toBe(13);

        const long = liveWave(Array.from({ length: 70 }, (_, at) => (at === 0 ? 0.25 : 0.04)));

        expect([long.length, Math.max(...long)], 'only the newest are drawn').toEqual([VOICE_WAVE_BARS, 25]);
    });
});

describe('a recorder’s type, as a voice message’s document takes it', () =>
{
    it('is what the recorder says in the one spelling, or what it was asked for', () =>
    {
        expect(typeSaid('audio/ogg; codecs=opus', 'audio/ogg;codecs=opus')).toBe('audio/ogg;codecs=opus');
        expect(typeSaid('audio/ogg; codecs=opus', 'audio/webm;codecs=opus'), 'what it made, not what it was asked for').toBe('audio/ogg;codecs=opus');
        expect(typeSaid('audio/mp4', 'audio/mp4;codecs=mp4a.40.2')).toBe('audio/mp4');
        expect(typeSaid('', 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
        expect(typeSaid('audio/webm;codecs="opus"', 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
    });
});

const composer = (props: { value?: string; disabled?: boolean; editing?: string | null } = {}) => renderTest(() => Composer({
    value: props.value ?? '',
    disabled: props.disabled ?? false,
    editing: props.editing ?? null,
    record: 'c-reza',
    onInput: () => undefined,
    onSend: () => undefined
}) as HTMLElement).container;

const named = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.getAttribute('aria-label') === label) ?? null;

describe('the composer’s microphone', () =>
{
    it('stands where Send is while the field is empty, and Send is back once something is typed', () =>
    {
        expect(named(composer(), 'Record a voice message')).not.toBeNull();

        cleanup();
        const typed = composer({ value: 'hello' });

        expect(named(typed, 'Record a voice message')).toBeNull();
        expect(named(typed, 'Send')?.disabled).toBe(false);
    });

    it('is not offered where nothing can be sent, nor while a line is edited', () =>
    {
        expect(named(composer({ disabled: true }), 'Record a voice message')).toBeNull();

        cleanup();
        expect(named(composer({ editing: 'old words' }), 'Record a voice message')).toBeNull();
    });

    it('turns the composer into the recorder at the press: recording, paused with what was said, and the field again once sent', async () =>
    {
        const sendVoice = vi.spyOn(useChat(), 'sendVoice').mockResolvedValue(undefined);
        const container = composer();

        fire(named(container, 'Record a voice message')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[data-recorder]')?.getAttribute('data-recorder')).toBe('recording'));
        expect(container.querySelector('textarea'), 'the field gives way').toBeNull();
        expect(container.querySelector('[data-live]')).not.toBeNull();

        recorder().say(spoken());
        clock.advance(2_000);
        await vi.waitFor(() => expect(container.querySelector('[data-clock]')?.textContent).toBe('0:02'));

        fire(named(container, 'Pause recording')!, 'click');
        await vi.waitFor(() => expect(named(container, 'Hear what you recorded')?.disabled).toBe(false));

        expect(container.querySelector('[role="slider"]')).not.toBeNull();
        expect(container.querySelector('[data-clock]')?.textContent, 'its decoded length').toBe('0:03');
        expect(named(container, 'Record more')).not.toBeNull();

        fire(named(container, 'Send the voice message')!, 'click');

        await vi.waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
        expect(sendVoice).toHaveBeenCalledTimes(1);
    });

    it('says its time in the reader’s own digits', async () =>
    {
        useLocale().setLocale('fa');

        const container = composer();

        fire(named(container, 'ضبط پیام صوتی')!, 'click');
        await vi.waitFor(() => expect(container.querySelector('[data-recorder]')?.getAttribute('data-recorder')).toBe('recording'));

        clock.advance(65_000);

        await vi.waitFor(() => expect(container.querySelector('[data-clock]')?.textContent).toBe('۱:۰۵'));
    });
});

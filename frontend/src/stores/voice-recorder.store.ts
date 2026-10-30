import { batch, createEffect, createRoot, createSignal, createStore, untrack } from 'azerothjs';

import { VOICE_FILE_MOST, VOICE_MOST_MS } from '../../../backend/src/domains/chat/voice.ts';
import { runtime } from '../lib/runtime.ts';
import { onForgotten } from '../lib/voice-held.ts';
import { recordingType, seekable, typeSaid, VOICE_BITRATE, VOICE_LEAST_MS, waveOf, waveOfLevels } from '../lib/voice-note.ts';
import type { MessageKey } from '../locales/en.ts';
import { useChat } from './chat.store.ts';
import { useLocale } from './locale.store.ts';
import { useSettings, type Settings } from './settings.store.ts';
import { useToasts } from './toasts.store.ts';
import { useVoicePlayer } from './voice-player.store.ts';
import { useVoiceRooms } from './voice-rooms.store.ts';

/** A MediaRecorder as the recorder uses one. A spec hands it one it drives. */
export interface RecorderLike
{
    readonly mimeType: string;
    readonly state: string;
    ondataavailable: ((event: { data: Blob }) => void) | null;
    onstop: (() => void) | null;
    onerror: (() => void) | null;
    start(timeslice?: number): void;
    pause(): void;
    resume(): void;
    stop(): void;
    requestData(): void;
}

/** What hears the microphone while it records, for the bars that move with it. */
export interface Listener
{
    hear(stream: MediaStream): void;

    /** How loud it is now, 0 to 1. */
    level(): number;
    close(): void;
}

export interface Decoded
{
    samples: Float32Array;
    seconds: number;
}

/** The browser's half of recording, behind one seam so a spec can stand in for every part of it. */
export interface RecorderEnv
{
    able(): boolean;
    supported(type: string): boolean;

    /** Made at the press, inside the gesture a browser wants before it lets a page hear anything. */
    listener(): Listener | null;
    microphone(constraints: MediaStreamConstraints): Promise<MediaStream>;
    recorder(stream: MediaStream, options: MediaRecorderOptions): RecorderLike;

    /** The recording decoded at a low rate, for its real length and its waveform, or nothing where it cannot be. */
    decode(bytes: Uint8Array): Promise<Decoded | null>;
}

/** Enough samples a second to measure a voice's loudness slice by slice, and little enough to decode ten minutes. */
const DECODE_RATE = 8_000;

const browser: RecorderEnv = {
    able: () => typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',

    supported: (type) => typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type),

    listener()
    {
        if (typeof AudioContext === 'undefined')
        {
            return null;
        }

        const context = new AudioContext();
        const analyser = context.createAnalyser();
        const samples = new Float32Array(analyser.fftSize);
        let source: MediaStreamAudioSourceNode | null = null;

        void context.resume().catch(() => undefined);

        return {
            hear(stream)
            {
                source = context.createMediaStreamSource(stream);
                source.connect(analyser);
                void context.resume().catch(() => undefined);
            },

            level()
            {
                if (source === null)
                {
                    return 0;
                }

                analyser.getFloatTimeDomainData(samples);

                let sum = 0;

                for (const sample of samples)
                {
                    sum += sample * sample;
                }

                return Math.sqrt(sum / samples.length);
            },

            close()
            {
                source?.disconnect();
                void context.close().catch(() => undefined);
            }
        };
    },

    microphone: (constraints) => navigator.mediaDevices.getUserMedia(constraints),

    recorder: (stream, options) => new MediaRecorder(stream, options) as unknown as RecorderLike,

    async decode(bytes)
    {
        if (typeof OfflineAudioContext === 'undefined')
        {
            return null;
        }

        try
        {
            const decoded = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(bytes.slice().buffer);

            return { samples: decoded.getChannelData(0), seconds: decoded.duration };
        }
        catch
        {
            return null;
        }
    }
};

let env: RecorderEnv = browser;

export function setRecorderEnv(next: RecorderEnv | null)
{
    env = next ?? browser;
}

/** How often the recorder hands over what it has, so a pause or a send waits a second at most. */
const SLICE_MS = 1_000;

/** How often the time and the bars move while it records. */
export const RECORD_TICK_MS = 100;

/** How long a recorder may take to hand over its last piece. */
const SETTLE_MS = 2_000;

/**
 * Where a recording stops itself short of the largest file a voice message may be: a recorder hands
 * its data over a second at a time, and a browser that ignores the rate it is asked for (AAC at 128
 * kbps) would cross the line between two seconds.
 */
const FULL_BYTES = VOICE_FILE_MOST - 64 * 1024;

/** How many of the microphone's newest levels the bars draw. */
const LIVE_LEVELS = 64;

export type TakePhase = 'asking' | 'recording' | 'paused' | 'sending';

/** A recording as its row draws it. */
export interface Take
{
    phase: TakePhase;

    /** How long it has recorded, in milliseconds. */
    elapsed: number;

    /** The microphone's newest levels, 0 to 1, the newest last. */
    levels: readonly number[];

    /** What has been said so far, there to be heard and seen once it is paused. */
    preview: { url: string; ms: number; wave: readonly number[] } | null;

    /** Nothing more can be recorded into it: it is as long as a voice message may be, or the reader left while it recorded. */
    closed: boolean;
}

export interface RecorderApi
{
    take(room: string): Take | null;
    start(room: string): Promise<void>;
    pause(room: string): Promise<void>;
    resume(room: string): void;
    send(room: string): Promise<void>;
    discard(room: string): void;
    reset(): void;
}

interface Session
{
    room: string;
    type: string;
    stream: MediaStream | null;
    recorder: RecorderLike | null;
    listener: Listener | null;
    chunks: Blob[];
    bytes: number;

    /** Milliseconds recorded in the stretches before the one under way. */
    spent: number;

    /** When the stretch under way began. */
    since: number;
    levels: number[];
    ticking: (() => void) | null;
    preview: string | null;
    handed: (() => void)[];
}

const FAULTS: Record<string, MessageKey> = {
    NotAllowedError: 'chat.voice.denied',
    SecurityError: 'chat.voice.denied',
    NotFoundError: 'chat.voice.noMic',
    OverconstrainedError: 'chat.voice.noMic',
    NotReadableError: 'chat.voice.busyMic',
    AbortError: 'chat.voice.busyMic'
};

const microphoneOf = (settings: Settings): MediaStreamConstraints => ({
    audio: {
        echoCancellation: settings.voiceEcho,
        noiseSuppression: settings.voiceNoise !== 'off',
        autoGainControl: settings.voiceAgc,
        channelCount: 1,
        ...(settings.voiceMic === '' ? {} : { deviceId: { ideal: settings.voiceMic } })
    }
});

const stopTracks = (stream: MediaStream | null) =>
{
    for (const track of stream?.getTracks() ?? [])
    {
        track.stop();
    }
};

/**
 * A voice message recorded in a room's composer: asked for the microphone with the choices of
 * Settings › Voice, recorded by the browser's MediaRecorder in the first type it can make, paused to be
 * heard and seen as it stands, resumed, and sent once its real length and waveform are read from the
 * recording itself. The microphone is let go the moment it is no longer recording into something: a
 * send, a delete, the reader leaving the room (the recording waits there as it was, for this tab's
 * life) and signing out. One recording a room.
 */
export const useVoiceRecorder = createStore((): RecorderApi =>
{
    const chat = useChat();
    const settings = useSettings();
    const toasts = useToasts();
    const locale = useLocale();
    const rooms = useVoiceRooms();
    const player = useVoicePlayer();

    const [takes, setTakes] = createSignal<Readonly<Record<string, Take>>>({});

    const sessions = new Map<string, Session>();

    let disarm: (() => void) | null = null;

    const viewOf = (room: string, change: Partial<Take>) => setTakes((all) =>
    {
        const now = all[room] ?? { phase: 'asking', elapsed: 0, levels: [], preview: null, closed: false };

        return { ...all, [room]: { ...now, ...change } };
    });

    const say = (key: MessageKey) => toasts.show({ kind: 'error', text: locale.t(key), dedupe: 'voice-record' });

    const still = (session: Session) =>
    {
        session.ticking?.();
        session.ticking = null;
    };

    const revoke = (session: Session) =>
    {
        if (session.preview !== null)
        {
            URL.revokeObjectURL(session.preview);
            session.preview = null;
        }
    };

    /** Lets go of everything a recording holds, and its row. */
    const drop = (room: string) =>
    {
        const session = sessions.get(room);

        if (session !== undefined)
        {
            sessions.delete(room);
            still(session);

            const recorder = session.recorder;

            if (recorder !== null && recorder.state !== 'inactive')
            {
                recorder.ondataavailable = null;
                recorder.onstop = null;
                recorder.stop();
            }

            stopTracks(session.stream);
            session.stream = null;
            session.listener?.close();
            session.listener = null;
            revoke(session);
        }

        batch(() =>
        {
            setTakes((all) => (room in all ? Object.fromEntries(Object.entries(all).filter(([name]) => name !== room)) : all));
            rooms.set(room, false);
        });
    };

    /** Resolves at the recorder's next piece, or after a second when none comes. */
    const nextPiece = (session: Session) => new Promise<void>((done) =>
    {
        const stop = runtime().clock.after(SETTLE_MS, done);

        session.handed.push(() =>
        {
            stop();
            done();
        });
    });

    /** Stops the recorder for good, once it has handed over everything it holds. */
    const finish = (session: Session) => new Promise<void>((done) =>
    {
        const recorder = session.recorder;

        if (recorder === null || recorder.state === 'inactive')
        {
            done();
            return;
        }

        const stop = runtime().clock.after(SETTLE_MS, done);

        recorder.onstop = () =>
        {
            stop();
            done();
        };
        recorder.stop();
    });

    /** What has been said so far, opened for its length and its waveform: the decoded recording's, or the microphone's levels where it will not decode. */
    const measure = async (session: Session) =>
    {
        const plain = seekable(new Uint8Array(await new Blob(session.chunks).arrayBuffer()));
        const blob = new Blob([plain as BlobPart], { type: session.type });
        const decoded = await env.decode(plain);

        return {
            blob,
            plain,
            ms: decoded === null ? session.spent : Math.round(decoded.seconds * 1000),
            wave: decoded === null ? waveOfLevels(session.levels) : waveOf(decoded.samples)
        };
    };

    const present = async (session: Session) =>
    {
        const heard = await measure(session);

        if (sessions.get(session.room) !== session)
        {
            return;
        }

        revoke(session);
        session.preview = URL.createObjectURL(heard.blob);
        viewOf(session.room, { preview: { url: session.preview, ms: heard.ms, wave: heard.wave } });
    };

    const tick = (session: Session) =>
    {
        still(session);
        session.ticking = runtime().clock.every(RECORD_TICK_MS, () =>
        {
            const elapsed = session.spent + runtime().clock.now() - session.since;

            session.levels.push(session.listener?.level() ?? 0);
            viewOf(session.room, { elapsed, levels: session.levels.slice(-LIVE_LEVELS) });

            if (elapsed >= VOICE_MOST_MS || session.bytes >= FULL_BYTES)
            {
                void pause(session.room, true);
            }
        });
    };

    const pause = async (room: string, full = false) =>
    {
        const session = sessions.get(room);
        const recorder = session?.recorder ?? null;

        if (session === undefined || recorder === null || recorder.state !== 'recording')
        {
            return;
        }

        still(session);
        session.spent += runtime().clock.now() - session.since;

        const handed = nextPiece(session);

        recorder.pause();
        recorder.requestData();
        viewOf(room, { phase: 'paused', elapsed: session.spent, preview: null, closed: full || untrack(takes)[room]?.closed === true });

        if (full)
        {
            say('chat.voice.full');
        }

        await handed;

        if (sessions.get(room) === session)
        {
            await present(session);
        }
    };

    /** The reader left the room: the recording stops where it is and waits there, its microphone let go. */
    const settle = async (session: Session) =>
    {
        still(session);

        if (session.recorder?.state === 'recording')
        {
            session.spent += runtime().clock.now() - session.since;
        }

        await finish(session);
        stopTracks(session.stream);
        session.stream = null;
        session.listener?.close();
        session.listener = null;

        if (sessions.get(session.room) !== session)
        {
            return;
        }

        if (session.chunks.length === 0)
        {
            drop(session.room);
            return;
        }

        viewOf(session.room, { phase: 'paused', elapsed: session.spent, closed: true });
        await present(session);
    };

    const arm = () =>
    {
        if (disarm !== null)
        {
            return;
        }

        const unforget = onForgotten((file) =>
        {
            if (file === null)
            {
                for (const room of [...sessions.keys()])
                {
                    drop(room);
                }
            }
        });

        const unwatch = createRoot((dispose) =>
        {
            createEffect(() =>
            {
                const open = chat.openId();

                for (const session of [...sessions.values()])
                {
                    if (session.room !== open && session.stream !== null)
                    {
                        void settle(session);
                    }
                }
            }, { name: 'voice.recorder.room' });

            return dispose;
        });

        disarm = () =>
        {
            unforget();
            unwatch();
        };
    };

    return {
        take: (room) => takes()[room] ?? null,

        async start(room)
        {
            if (sessions.has(room))
            {
                return;
            }

            const type = env.able() ? recordingType((asked) => env.supported(asked)) : null;

            if (type === null)
            {
                rooms.set(room, false);
                say('chat.voice.cannot');
                return;
            }

            arm();
            player.stop();

            const session: Session = {
                room,
                type,
                stream: null,
                recorder: null,
                listener: env.listener(),
                chunks: [],
                bytes: 0,
                spent: 0,
                since: 0,
                levels: [],
                ticking: null,
                preview: null,
                handed: []
            };

            sessions.set(room, session);

            batch(() =>
            {
                rooms.set(room, true);
                viewOf(room, { phase: 'asking', elapsed: 0, levels: [], preview: null, closed: false });
            });

            let stream: MediaStream;

            try
            {
                stream = await env.microphone(microphoneOf(untrack(settings.settings)));
            }
            catch (error)
            {
                if (sessions.get(room) === session)
                {
                    drop(room);
                    say(FAULTS[(error as { name?: string }).name ?? ''] ?? 'chat.voice.micFailed');
                }
                return;
            }

            // Deleted while the browser asked, or the reader went elsewhere meanwhile: nothing was said, so nothing is kept.
            if (sessions.get(room) !== session || untrack(chat.openId) !== room)
            {
                stopTracks(stream);

                if (sessions.get(room) === session)
                {
                    drop(room);
                }
                return;
            }

            session.stream = stream;
            session.listener?.hear(stream);

            let recorder: RecorderLike;

            try
            {
                recorder = env.recorder(stream, { mimeType: type, audioBitsPerSecond: VOICE_BITRATE });
            }
            catch
            {
                drop(room);
                say('chat.voice.micFailed');
                return;
            }

            session.recorder = recorder;
            recorder.ondataavailable = (event) =>
            {
                if (event.data.size > 0)
                {
                    session.chunks.push(event.data);
                    session.bytes += event.data.size;
                }

                for (const handed of session.handed.splice(0))
                {
                    handed();
                }
            };
            recorder.onerror = () =>
            {
                if (sessions.get(room) === session)
                {
                    drop(room);
                    say('chat.voice.micFailed');
                }
            };
            recorder.start(SLICE_MS);
            session.since = runtime().clock.now();
            tick(session);
            viewOf(room, { phase: 'recording' });
        },

        pause: (room) => pause(room),

        resume(room)
        {
            const session = sessions.get(room);
            const recorder = session?.recorder ?? null;

            if (session === undefined || recorder === null || recorder.state !== 'paused' || untrack(takes)[room]?.closed === true)
            {
                return;
            }

            player.stop();
            revoke(session);
            recorder.resume();
            session.since = runtime().clock.now();
            tick(session);
            viewOf(room, { phase: 'recording', preview: null });
        },

        async send(room)
        {
            const session = sessions.get(room);

            if (session === undefined || session.recorder === null || untrack(takes)[room]?.phase === 'sending')
            {
                return;
            }

            still(session);

            if (session.recorder.state === 'recording')
            {
                session.spent += runtime().clock.now() - session.since;
            }

            viewOf(room, { phase: 'sending', elapsed: session.spent });
            await finish(session);

            if (sessions.get(room) !== session)
            {
                return;
            }

            const heard = await measure(session);
            const mime = typeSaid(session.recorder.mimeType, session.type);

            if (sessions.get(room) !== session)
            {
                return;
            }

            drop(room);

            if (heard.ms < VOICE_LEAST_MS)
            {
                say('chat.voice.tooShort');
                return;
            }

            // What became of it is the line's to say: on its way at once, Not sent with Try again if it does not go.
            void chat.sendVoice(room, { plain: heard.plain, mime, ms: heard.ms, wave: heard.wave }).catch(() => undefined);
        },

        discard: (room) => drop(room),

        reset()
        {
            for (const room of [...sessions.keys()])
            {
                drop(room);
            }

            setTakes({});
            disarm?.();
            disarm = null;
        }
    };
});

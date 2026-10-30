import { batch, createEffect, createRoot, createSelector, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import type { Message } from '../data/chat.ts';
import { runtime } from '../lib/runtime.ts';
import { NOT_SUPPORTED, readyAudio, voiceAudio, type VoiceAudio } from '../lib/voice-audio.ts';
import { heldAudio, holdAudio, onForgotten } from '../lib/voice-held.ts';
import { openAudio, seekable, sniffAudio } from '../lib/voice-note.ts';
import { VoiceFileError, voiceFiles } from '../services/voice-files.ts';
import { useChat } from './chat.store.ts';
import { useSettings } from './settings.store.ts';

/**
 * Why a voice message does not play: its file is gone from the server, could not be fetched, does
 * not open under the key its sender signed, is not a recording at all, or is one this browser cannot
 * play.
 */
export type VoiceFault = 'gone' | 'failed' | 'tampered' | 'unplayable' | 'unsupported';

export type VoiceState = 'loading' | VoiceFault;

/** The speeds the chip steps through; the one it is left at plays every voice message after. */
export const VOICE_RATES = [1, 1.5, 2];

/** How often the place of the voice message playing is read, while one plays and never otherwise. */
export const VOICE_TICK_MS = 50;

/** A place this close to the start is the start: nothing worth coming back to. */
const NOWHERE = 0.25;

export interface VoicePlayerApi
{
    /** Whether a message is the one in the player, playing, paused or on its way; each bubble hears only its own change. */
    isCurrent(id: string): boolean;
    playing: Getter<boolean>;

    /** Where the voice message in the player is, in seconds. */
    at: Getter<number>;

    /** Where a voice message not in the player was left, in seconds. */
    keptOf(id: string): number;

    /** How long a voice message is, in seconds: what the element measured once it has, what its sender measured until then. */
    lengthOf(message: Message): number;
    stateOf(id: string): VoiceState | null;
    rate: Getter<number>;

    /** Plays a voice message from where it was left, pauses the one playing, or gives up one on its way. */
    toggle(message: Message): void;

    /** Moves a voice message to a place, and with `play` starts it from there. */
    seek(message: Message, seconds: number, play?: boolean): void;

    /** The next speed, for this voice message and every one after. */
    nextRate(): void;
    stop(): void;
    reset(): void;
}

const without = <T>(record: Readonly<Record<string, T>>, key: string) =>
    (key in record ? Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)) : record);

/**
 * One voice message at a time, through one audio element the whole tab shares: playing another
 * pauses the first, which keeps its place; one that ends hands over to the next the reader has not
 * played. The audio is the recording this tab holds (`voice-held.ts`) or the file fetched and opened
 * under its key, sniffed from its own bytes, and played from an address revoked as soon as it is let
 * go. Nothing is made, fetched or listened to before the first press.
 */
export const useVoicePlayer = createStore((): VoicePlayerApi =>
{
    const chat = useChat();
    const settings = useSettings();

    const [current, setCurrent] = createSignal<string | null>(null);
    const [playing, setPlaying] = createSignal(false);
    const [at, setAt] = createSignal(0);
    const [kept, setKept] = createSignal<Readonly<Record<string, number>>>({});
    const [states, setStates] = createSignal<Readonly<Record<string, VoiceState>>>({});
    const [measured, setMeasured] = createSignal<Readonly<Record<string, number>>>({});

    const isCurrent = createSelector(current);

    let element: VoiceAudio | null = null;
    let unlisten: (() => void) | null = null;

    /** The message in the player, from the press until it is let go, and the address its audio plays from once it has one. */
    let held: Message | null = null;
    let url: string | null = null;
    let ticket = 0;
    let ticking: (() => void) | null = null;
    let disarm: (() => void) | null = null;
    const marked = new Set<string>();

    const rate = () =>
    {
        const chosen = settings.settings().voiceRate;

        return VOICE_RATES.includes(chosen) ? chosen : 1;
    };

    const stateTo = (id: string, state: VoiceState | null) =>
        setStates((all) => (state === null ? without(all, id) : (all[id] === state ? all : { ...all, [id]: state })));

    const keep = (id: string, place: number) =>
        setKept((all) => (place > NOWHERE ? { ...all, [id]: place } : without(all, id)));

    const lengthOf = (message: Message) => measured()[message.id] ?? (message.voice?.ms ?? 0) / 1000;

    /** Whether the element holds the audio of the message in the player, and not an address let go a moment ago. */
    const ours = () => element !== null && url !== null && element.src === url;

    const read = () =>
    {
        if (ours())
        {
            setAt(element!.currentTime);
        }
    };

    const still = () =>
    {
        ticking?.();
        ticking = null;
    };

    const tick = () =>
    {
        still();
        ticking = runtime().clock.every(VOICE_TICK_MS, read);
    };

    const measure = () =>
    {
        const length = element?.duration ?? Number.NaN;

        if (ours() && held !== null && Number.isFinite(length) && length > 0)
        {
            const id = held.id;

            setMeasured((all) => (all[id] === length ? all : { ...all, [id]: length }));
        }
    };

    /** Empties the element and revokes the address it played from. */
    const unload = () =>
    {
        still();

        if (element !== null && url !== null)
        {
            element.pause();
            element.removeAttribute('src');
            element.load();
            URL.revokeObjectURL(url);
        }

        url = null;
    };

    /** Puts down the message in the player, its place kept to come back to. */
    const release = () =>
    {
        const message = held;

        if (message !== null)
        {
            keep(message.id, ours() ? element!.currentTime : untrack(at));
        }

        unload();
        held = null;

        batch(() =>
        {
            setCurrent(null);
            setPlaying(false);
            setAt(0);

            if (message !== null && untrack(states)[message.id] === 'loading')
            {
                stateTo(message.id, null);
            }
        });
    };

    const fault = (id: string, why: VoiceFault) =>
    {
        unload();
        held = null;

        batch(() =>
        {
            setCurrent(null);
            setPlaying(false);
            setAt(0);
            stateTo(id, why);
        });
    };

    const markPlayed = () =>
    {
        const message = held;

        if (message !== null && !marked.has(message.id))
        {
            marked.add(message.id);
            void chat.played(message);
        }
    };

    /** The next voice message below one in the thread that the reader has not played, and that is somebody else's. */
    const nextAfter = (message: Message) =>
    {
        const lines = untrack(chat.messages);
        const me = untrack(chat.me);
        const from = lines.findIndex((line) => line.id === message.id);

        if (from === -1)
        {
            return null;
        }

        return lines.slice(from + 1).find((line) =>
            line.kind === 'voice'
            && line.voice !== undefined
            && line.from !== me
            && line.played !== true
            && line.locked === undefined
            && line.outgoing === undefined
            && !marked.has(line.id)) ?? null;
    };

    const ended = () =>
    {
        const message = held;

        unload();
        held = null;

        batch(() =>
        {
            setCurrent(null);
            setPlaying(false);
            setAt(0);
        });

        const next = message === null ? null : nextAfter(message);

        if (next !== null)
        {
            void load(next);
        }
    };

    const audioOf = () =>
    {
        if (element !== null)
        {
            return element;
        }

        const audio = voiceAudio();
        const on = (type: string, listener: () => void) =>
        {
            audio.addEventListener(type, listener);
            return () => audio.removeEventListener(type, listener);
        };
        const offs = [
            on('playing', () =>
            {
                if (ours())
                {
                    setPlaying(true);
                    tick();
                    markPlayed();
                }
            }),
            on('pause', () =>
            {
                if (ours())
                {
                    read();
                    still();
                    setPlaying(false);
                }
            }),
            on('ended', () =>
            {
                if (ours())
                {
                    ended();
                }
            }),
            on('timeupdate', read),
            on('durationchange', measure),
            on('error', () =>
            {
                // While it is on its way `ready` answers for the element; after that, a recording that breaks mid-way is one that cannot be played.
                if (ours() && held !== null && untrack(states)[held.id] !== 'loading')
                {
                    fault(held.id, audio.error?.code === NOT_SUPPORTED ? 'unsupported' : 'unplayable');
                }
            })
        ];

        unlisten = () => offs.forEach((off) => off());
        element = audio;
        return audio;
    };

    /** The recording in the clear: held by this tab, or fetched and opened under the key its message carries. */
    const recordingOf = async (message: Message): Promise<Uint8Array | VoiceFault> =>
    {
        const voice = message.voice!;
        const near = heldAudio(voice.id);

        if (near !== null)
        {
            return near;
        }

        let body: Uint8Array;

        try
        {
            body = await voiceFiles().download(voice.id);
        }
        catch (error)
        {
            return error instanceof VoiceFileError && error.failure === 'voice-missing' ? 'gone' : 'failed';
        }

        return await openAudio(body, voice.key, voice.iv, voice.id) ?? 'tampered';
    };

    /** Lets the player go when its message leaves the thread on screen: the reader left, or it was deleted or ran out. */
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
                forgetAll();
            }
            else if (held?.voice?.id === file)
            {
                ticket += 1;
                release();
            }
        });

        const unwatch = createRoot((dispose) =>
        {
            createEffect(() =>
            {
                const open = chat.openId();
                const lines = chat.messages();
                const message = held;

                if (message !== null && (message.conversationId !== open || !lines.some((line) => line.id === message.id && line.kind === 'voice')))
                {
                    ticket += 1;
                    release();
                }
            }, { name: 'voice.thread' });

            return dispose;
        });

        disarm = () =>
        {
            unforget();
            unwatch();
        };
    };

    const load = async (message: Message) =>
    {
        const voice = message.voice;

        if (voice === undefined)
        {
            return;
        }

        arm();
        release();

        const mine = ++ticket;
        const from = untrack(kept)[message.id] ?? 0;

        held = message;

        batch(() =>
        {
            setCurrent(message.id);
            setAt(from);
            stateTo(message.id, 'loading');
        });

        const recording = await recordingOf(message);

        if (mine !== ticket)
        {
            return;
        }

        if (typeof recording === 'string')
        {
            fault(message.id, recording);
            return;
        }

        const type = sniffAudio(recording);
        const audio = audioOf();

        if (type === null)
        {
            fault(message.id, 'unplayable');
            return;
        }

        if (audio.canPlayType(type) === '')
        {
            fault(message.id, 'unsupported');
            return;
        }

        holdAudio(voice.id, seekable(recording));
        url = URL.createObjectURL(new Blob([recording as BlobPart], { type }));
        audio.src = url;
        audio.playbackRate = rate();
        audio.preservesPitch = true;

        const speaker = untrack(settings.settings).voiceSpeaker;

        if (speaker !== '' && typeof audio.setSinkId === 'function')
        {
            void audio.setSinkId(speaker).catch(() => undefined);
        }

        const fine = await readyAudio(audio);

        if (mine !== ticket)
        {
            return;
        }

        if (!fine)
        {
            fault(message.id, audio.error?.code === NOT_SUPPORTED ? 'unsupported' : 'unplayable');
            return;
        }

        measure();

        const length = lengthOf(message);
        const start = untrack(at);

        audio.currentTime = start >= length - NOWHERE ? 0 : start;

        batch(() =>
        {
            setAt(audio.currentTime);
            stateTo(message.id, null);
            keep(message.id, 0);
        });

        try
        {
            await audio.play();
        }
        catch
        {
            // Refused without a press the browser counts (a next one, in a tab never touched): left paused, there to press.
            if (mine === ticket)
            {
                setPlaying(false);
            }
        }
    };

    const forgetAll = () =>
    {
        ticket += 1;
        release();
        marked.clear();

        batch(() =>
        {
            setKept({});
            setStates({});
            setMeasured({});
        });
    };

    return {
        isCurrent,
        playing,
        at,
        keptOf: (id) => kept()[id] ?? 0,
        lengthOf,
        stateOf: (id) => states()[id] ?? null,
        rate,

        toggle(message)
        {
            if (untrack(current) === message.id && held !== null)
            {
                if (untrack(states)[message.id] === 'loading')
                {
                    ticket += 1;
                    release();
                    return;
                }

                if (ours())
                {
                    if (element!.paused)
                    {
                        void element!.play().catch(() => setPlaying(false));
                    }
                    else
                    {
                        element!.pause();
                    }
                    return;
                }
            }

            void load(message);
        },

        seek(message, seconds, play = false)
        {
            const to = Math.max(0, Math.min(seconds, lengthOf(message)));

            if (untrack(current) === message.id && held !== null)
            {
                setAt(to);

                if (ours() && untrack(states)[message.id] !== 'loading')
                {
                    element!.currentTime = to;

                    if (play && element!.paused)
                    {
                        void element!.play().catch(() => setPlaying(false));
                    }
                }
                return;
            }

            keep(message.id, to);

            if (play)
            {
                void load(message);
            }
        },

        nextRate()
        {
            const next = VOICE_RATES[(VOICE_RATES.indexOf(rate()) + 1) % VOICE_RATES.length];

            settings.update({ voiceRate: next });

            if (element !== null)
            {
                element.playbackRate = next;
            }
        },

        stop()
        {
            ticket += 1;
            release();
        },

        reset()
        {
            forgetAll();
            disarm?.();
            disarm = null;
            unlisten?.();
            unlisten = null;
            element = null;
        }
    };
});

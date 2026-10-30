import { runtime } from './runtime.ts';

/** What a voice message's player and a recording's preview need of an audio element. A spec hands one it drives itself. */
export interface VoiceAudio
{
    src: string;
    currentTime: number;
    readonly duration: number;
    playbackRate: number;
    preservesPitch?: boolean;
    readonly paused: boolean;
    readonly error: { readonly code: number } | null;
    play(): Promise<void>;
    pause(): void;
    load(): void;
    removeAttribute(name: string): void;
    canPlayType(type: string): string;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    setSinkId?: (id: string) => Promise<void>;
}

let make = (): VoiceAudio => new Audio();

export const voiceAudio = () => make();

export function setVoiceAudio(next: (() => VoiceAudio) | null)
{
    make = next ?? (() => new Audio());
}

/** The media error a browser raises for a source it has no way to play. */
export const NOT_SUPPORTED = 4;

/** How long an element may take to say what it was handed can be played. */
export const VOICE_READY_MS = 10_000;

/** How long a recording whose header names no length may take to find its end. */
const LENGTH_MS = 2_000;

/**
 * Resolves once the element knows what it was handed: true, or false for something it cannot play.
 * A recording from Chrome's MediaRecorder names no length in its header, and the element reports one
 * only once asked for a place past its end; until it finds it, whoever asked keeps their own measure.
 * The caller puts the element back where it wants it.
 */
export const readyAudio = (audio: VoiceAudio) => new Promise<boolean>((done) =>
{
    const offs: (() => void)[] = [];
    let over = false;

    const end = (answer: boolean) =>
    {
        if (!over)
        {
            over = true;
            offs.forEach((off) => off());
            done(answer);
        }
    };

    const on = (type: string, listener: () => void) =>
    {
        audio.addEventListener(type, listener);
        offs.push(() => audio.removeEventListener(type, listener));
    };

    on('error', () => end(false));
    offs.push(runtime().clock.after(VOICE_READY_MS, () => end(false)));
    on('loadedmetadata', () =>
    {
        if (Number.isFinite(audio.duration))
        {
            end(true);
            return;
        }

        const found = () =>
        {
            if (Number.isFinite(audio.duration))
            {
                end(true);
            }
        };

        on('durationchange', found);
        on('timeupdate', found);
        offs.push(runtime().clock.after(LENGTH_MS, () => end(true)));
        audio.currentTime = 1e101;
    });
});

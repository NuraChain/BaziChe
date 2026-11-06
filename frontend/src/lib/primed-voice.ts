import { useSettings } from '../stores/settings.store.ts';
import { isWebKit } from './webkit.ts';

/**
 * The microphone and the audio a call will use, asked for inside the press that starts the call.
 *
 * A call joins its voice once the server says it is live - a ring answered, a voice chat entered -
 * which is a round trip after the press, from an effect. Chrome grants the microphone and starts an
 * AudioContext there all the same; Safari grants them only inside the press, so an iPhone's call
 * connected with no microphone: it heard and was not heard. The press that places, answers or joins
 * a call now asks for both at once, and the voice store takes them when it joins (`voice.store.ts`).
 *
 * Only on WebKit: anywhere else nothing changes, and the microphone is asked for when the call is
 * live, as it always was. What is asked for and not taken in 90 seconds - the call refused, never
 * answered - is let go of, so nothing holds the microphone for a call that is not.
 */
/** Longer than a ring may last (`RING_SECONDS`, 45) with room for the answer to arrive. */
const KEPT_MS = 90_000;

interface Primed
{
    microphone: Promise<MediaStream>;
    context: AudioContext | null;
    release: ReturnType<typeof setTimeout>;
}

let primed: Primed | null = null;

let active: () => boolean = isWebKit;

/** For a spec: whether a press primes the voice, or `null` for what this browser is. */
export function setPrimedVoice(next: boolean | null)
{
    active = next === null ? isWebKit : () => next;
}

const stopAll = (held: Primed) =>
{
    clearTimeout(held.release);
    void held.microphone.then((stream) =>
    {
        for (const track of stream.getTracks())
        {
            track.stop();
        }
    }, () => undefined);
    void held.context?.close().catch(() => undefined);
};

/** Lets go of whatever a press asked for and nothing took. */
export function forgetPrimedVoice()
{
    if (primed !== null)
    {
        stopAll(primed);
        primed = null;
    }
}

/**
 * Asks for the microphone and wakes an AudioContext, here and now, inside the press. Synchronous up
 * to the asking - called before anything is awaited - or WebKit takes it for a page asking by itself.
 */
export function primeVoice()
{
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;

    // One a press is enough: the call a press placed joins its voice later, and must find that one.
    if (!active() || primed !== null || typeof devices?.getUserMedia !== 'function')
    {
        return;
    }

    const current = useSettings().settings();
    const microphone = devices.getUserMedia({
        audio: {
            echoCancellation: current.voiceEcho,
            noiseSuppression: current.voiceNoise !== 'off',
            autoGainControl: current.voiceAgc,
            channelCount: 1,
            ...(current.voiceMic === '' ? {} : { deviceId: { ideal: current.voiceMic } })
        }
    }).catch(() => devices.getUserMedia({ audio: true }));

    // Asked for once more inside the same press when the choices are turned down, and never left unhandled.
    void microphone.catch(() => undefined);

    let context: AudioContext | null = null;

    if (typeof AudioContext !== 'undefined')
    {
        try
        {
            context = new AudioContext({ latencyHint: 'interactive' });
            void context.resume().catch(() => undefined);
        }
        catch
        {
            context = null;
        }
    }

    const held: Primed = { microphone, context, release: setTimeout(() =>
    {
        if (primed === held)
        {
            forgetPrimedVoice();
        }
    }, KEPT_MS) };

    primed = held;
}

/** What a press asked for, handed over once: the microphone (or why not) and the woken context. */
export function takePrimedVoice(): { microphone: Promise<MediaStream>; context: AudioContext | null } | null
{
    const held = primed;

    if (held === null)
    {
        return null;
    }

    clearTimeout(held.release);
    primed = null;

    return { microphone: held.microphone, context: held.context };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetPrimedVoice, primeVoice, setPrimedVoice, takePrimedVoice } from '../src/lib/primed-voice.ts';
import { isWebKit } from '../src/lib/webkit.ts';
import { useSettings } from '../src/stores/settings.store.ts';

/**
 * The microphone a call will use, asked for inside the press that places, answers or joins it: WebKit
 * grants it nowhere else, and the call joins its voice a round trip later.
 */

const asked: MediaStreamConstraints[] = [];
const stopped: number[] = [];

const streamOf = (id: number) => ({ id, getTracks: () => [{ stop: () => stopped.push(id) }] }) as unknown as MediaStream;

let answer: (constraints: MediaStreamConstraints) => Promise<MediaStream>;

const media = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

beforeEach(() =>
{
    asked.length = 0;
    stopped.length = 0;
    answer = async () => streamOf(asked.length);
    useSettings().reset();
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: (constraints: MediaStreamConstraints) =>
            {
                asked.push(constraints);
                return answer(constraints);
            }
        }
    });
    setPrimedVoice(true);
});

afterEach(() =>
{
    forgetPrimedVoice();
    setPrimedVoice(null);
    vi.useRealTimers();

    if (media === undefined)
    {
        Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    else
    {
        Object.defineProperty(navigator, 'mediaDevices', media);
    }
});

describe('the voice a press primes', () =>
{
    it('asks for the microphone inside the press itself, before anything is awaited, with the choices of Settings › Voice', () =>
    {
        useSettings().update({ voiceMic: 'mic-2', voiceEcho: false, voiceNoise: 'off', voiceAgc: true });

        primeVoice();

        expect(asked).toEqual([{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1, deviceId: { ideal: 'mic-2' } } }]);
    });

    it('is handed over once, and a second press keeps the microphone the first asked for', async () =>
    {
        primeVoice();
        primeVoice();

        expect(asked).toHaveLength(1);

        const taken = takePrimedVoice();

        expect(await taken?.microphone).toMatchObject({ id: 1 });
        expect(takePrimedVoice()).toBeNull();
    });

    it('asks once more for any microphone when the choices are turned down', async () =>
    {
        answer = async (constraints) =>
        {
            if (constraints.audio !== true)
            {
                throw Object.assign(new Error('no'), { name: 'OverconstrainedError' });
            }
            return streamOf(9);
        };

        primeVoice();

        expect(await takePrimedVoice()?.microphone).toMatchObject({ id: 9 });
        expect(asked.at(-1)).toEqual({ audio: true });
    });

    it('lets the microphone go when nothing takes it: forgotten, or after the longest a ring may wait', async () =>
    {
        primeVoice();
        forgetPrimedVoice();
        await Promise.resolve();
        await Promise.resolve();

        expect(stopped).toEqual([1]);

        vi.useFakeTimers();
        primeVoice();
        await vi.advanceTimersByTimeAsync(90_000);

        expect(stopped).toEqual([1, 2]);
        expect(takePrimedVoice()).toBeNull();
    });

    it('asks nothing where the browser is not WebKit, which grants the microphone after the press', () =>
    {
        setPrimedVoice(false);

        primeVoice();

        expect(asked).toEqual([]);
        expect(takePrimedVoice()).toBeNull();
    });
});

describe('WebKit', () =>
{
    const agent = (said: string, touches = 0) =>
    {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(said);
        vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(touches);
    };

    afterEach(() => vi.restoreAllMocks());

    it('is Safari, every browser on an iPhone or an iPad, and nothing else', () =>
    {
        agent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1');
        expect(isWebKit(), 'Safari on an iPhone').toBe(true);

        agent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1');
        expect(isWebKit(), 'Chrome on an iPhone, which is WebKit').toBe(true);

        agent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 5);
        expect(isWebKit(), 'an iPad that says it is a Mac').toBe(true);

        agent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15');
        expect(isWebKit(), 'Safari on a Mac').toBe(true);

        agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        expect(isWebKit(), 'Chrome').toBe(false);

        agent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36');
        expect(isWebKit(), 'Chrome on Android').toBe(false);

        agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0');
        expect(isWebKit(), 'Firefox').toBe(false);
    });
});

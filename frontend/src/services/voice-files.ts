import type { VoiceRefusal } from '../../../backend/src/domains/chat/voice.ts';

/**
 * Why a voice file did not go up or come down: one of the server's words, `network` when no answer
 * came, `server` for an answer that is none of its words.
 */
export type VoiceFileFailure = VoiceRefusal | 'network' | 'server';

export class VoiceFileError extends Error
{
    public readonly failure: VoiceFileFailure;

    constructor(failure: VoiceFileFailure)
    {
        super(`voice file: ${ failure }`);
        this.failure = failure;
    }
}

/**
 * How a voice file's ciphertext goes up and comes down. Raw bytes, so neither is the typed client,
 * which speaks JSON. A spec gives its own (`setVoiceFiles`) to drive what a server would answer.
 */
export interface VoiceFiles
{
    upload(id: string, body: Uint8Array, progress: (fraction: number) => void): Promise<void>;
    download(id: string): Promise<Uint8Array>;
}

const WORDS: readonly VoiceFileFailure[] = ['voice-size', 'voice-type', 'voice-taken', 'voice-budget', 'voice-pending', 'voice-missing'];

const failureOf = (said: string): VoiceFileFailure =>
{
    try
    {
        const code = (JSON.parse(said) as { error?: { code?: string } }).error?.code ?? '';

        return WORDS.includes(code as VoiceFileFailure) ? code as VoiceFileFailure : 'server';
    }
    catch
    {
        return 'server';
    }
};

const pathOf = (id: string) => `/api/chat/voice/${ encodeURIComponent(id) }`;

/** XMLHttpRequest for the upload, because it is the one way a page is told how much of a body has gone. */
const browserFiles: VoiceFiles = {
    upload: (id, body, progress) => new Promise((done, failed) =>
    {
        const request = new XMLHttpRequest();

        request.open('PUT', pathOf(id));
        request.setRequestHeader('content-type', 'application/octet-stream');
        request.upload.onprogress = (event) =>
        {
            if (event.lengthComputable && event.total > 0)
            {
                progress(event.loaded / event.total);
            }
        };
        request.onload = () =>
        {
            if (request.status >= 200 && request.status < 300)
            {
                progress(1);
                done();
                return;
            }

            failed(new VoiceFileError(failureOf(request.responseText)));
        };
        request.onerror = () => failed(new VoiceFileError('network'));
        request.onabort = () => failed(new VoiceFileError('network'));
        request.send(body as XMLHttpRequestBodyInit);
    }),

    async download(id)
    {
        let answer: Response;

        try
        {
            answer = await fetch(pathOf(id), { credentials: 'same-origin' });
        }
        catch
        {
            throw new VoiceFileError('network');
        }

        if (!answer.ok)
        {
            throw new VoiceFileError(failureOf(await answer.text()));
        }

        return new Uint8Array(await answer.arrayBuffer());
    }
};

let active: VoiceFiles = browserFiles;

export const voiceFiles = () => active;

export function setVoiceFiles(next: VoiceFiles | null)
{
    active = next ?? browserFiles;
}

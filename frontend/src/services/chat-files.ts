import type { FileRefusal } from '../../../backend/src/domains/chat/files.ts';

/**
 * Why a photo, a video or a file did not go up or come down: one of the server's words, `network`
 * when no answer came, `server` for an answer that is none of its words, `cancelled` when the reader
 * stopped it.
 */
export type ChatFileFailure = FileRefusal | 'network' | 'server' | 'cancelled';

export class ChatFileError extends Error
{
    public readonly failure: ChatFileFailure;

    constructor(failure: ChatFileFailure)
    {
        super(`chat file: ${ failure }`);
        this.failure = failure;
    }
}

/**
 * How a file's ciphertext goes up and comes down, each telling how far it has got. Raw bytes, so
 * neither is the typed client, which speaks JSON. A spec gives its own (`setChatFiles`).
 */
export interface ChatFiles
{
    upload(id: string, body: Uint8Array, progress: (fraction: number) => void): Promise<void>;
    download(id: string, progress: (fraction: number) => void, signal?: AbortSignal): Promise<Uint8Array>;
}

const WORDS: readonly ChatFileFailure[] = ['file-size', 'file-type', 'file-taken', 'file-budget', 'file-pending', 'file-missing'];

const failureOf = (said: string): ChatFileFailure =>
{
    try
    {
        const code = (JSON.parse(said) as { error?: { code?: string } }).error?.code ?? '';

        return WORDS.includes(code as ChatFileFailure) ? code as ChatFileFailure : 'server';
    }
    catch
    {
        return 'server';
    }
};

const pathOf = (id: string) => `/api/chat/files/${ encodeURIComponent(id) }`;

/** XMLHttpRequest both ways, because it is the one way a page is told how much of a body has gone or come. */
const browserFiles: ChatFiles = {
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

            failed(new ChatFileError(request.status === 413 ? 'file-size' : failureOf(request.responseText)));
        };
        request.onerror = () => failed(new ChatFileError('network'));
        request.onabort = () => failed(new ChatFileError('network'));
        request.send(body as XMLHttpRequestBodyInit);
    }),

    download: (id, progress, signal) => new Promise((done, failed) =>
    {
        if (signal?.aborted === true)
        {
            failed(new ChatFileError('cancelled'));
            return;
        }

        const request = new XMLHttpRequest();
        const stop = () => request.abort();

        request.open('GET', pathOf(id));
        request.responseType = 'arraybuffer';
        request.withCredentials = true;
        request.onprogress = (event) =>
        {
            if (event.lengthComputable && event.total > 0)
            {
                progress(event.loaded / event.total);
            }
        };
        request.onload = () =>
        {
            signal?.removeEventListener('abort', stop);

            if (request.status >= 200 && request.status < 300)
            {
                progress(1);
                done(new Uint8Array(request.response as ArrayBuffer));
                return;
            }

            failed(new ChatFileError(request.status === 404 ? 'file-missing' : 'server'));
        };
        request.onerror = () =>
        {
            signal?.removeEventListener('abort', stop);
            failed(new ChatFileError('network'));
        };
        request.onabort = () =>
        {
            signal?.removeEventListener('abort', stop);
            failed(new ChatFileError(signal?.aborted === true ? 'cancelled' : 'network'));
        };
        signal?.addEventListener('abort', stop, { once: true });
        request.send();
    })
};

let active: ChatFiles = browserFiles;

export const chatFiles = () => active;

export function setChatFiles(next: ChatFiles | null)
{
    active = next ?? browserFiles;
}

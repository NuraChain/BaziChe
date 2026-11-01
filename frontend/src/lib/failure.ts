import { ApiError } from '../api.ts';
import type { MessageKey } from '../locales/en.ts';

/**
 * What a fetch that never got an answer throws. Chromium, Firefox and Safari each word it their own
 * way and a module that would not load says it again; a TypeError that says none of these is a fault
 * in the page, and the connection is not blamed for it.
 */
const UNANSWERED = /Failed to fetch|NetworkError|Load failed|dynamically imported module|Importing a module script failed/i;

/**
 * The limiter's own word, and the one a proxy's page is read as for having no envelope. A domain's
 * 429 (a cooldown, a day's budget) is a refusal its own reader has words for.
 */
const LIMITED = new Set(['too-many-requests', 'unknown']);

const REFUSED: Readonly<Partial<Record<number, MessageKey>>> = {
    400: 'failure.invalid',
    401: 'failure.session',
    403: 'failure.forbidden',
    404: 'failure.missing',
    409: 'failure.conflict',
    413: 'failure.invalid',
    422: 'failure.invalid'
};

/**
 * What went wrong on the way rather than at the server's word: no connection, no answer in time (so
 * nobody knows whether it went through), a server that failed or is not answering, the limiter. A
 * 401 is not one: the server answers a wrong signature or recovery phrase with it too.
 */
function passageOf(error: unknown): MessageKey | null
{
    if (error instanceof ApiError)
    {
        if (error.status === 429)
        {
            return LIMITED.has(error.code) ? 'failure.busy' : null;
        }

        if (error.status < 500 || error.code === 'chain-unreachable')
        {
            return null;
        }

        return error.status === 502 || error.status === 503 || error.status === 504 ? 'failure.down' : 'failure.server';
    }

    if (error instanceof DOMException && error.name === 'TimeoutError')
    {
        return 'failure.timeout';
    }

    if (error instanceof TypeError && UNANSWERED.test(error.message))
    {
        return typeof navigator !== 'undefined' && !navigator.onLine ? 'failure.offline' : 'failure.unreached';
    }

    return null;
}

function refusalOf(error: unknown): MessageKey
{
    if (!(error instanceof ApiError))
    {
        return 'common.actionFailed';
    }

    return error.code === 'chain-unreachable' ? 'failure.chain' : REFUSED[error.status] ?? 'common.actionFailed';
}

/**
 * The sentence for a request that failed. What went wrong on the way says more than any reader of
 * refusals can, so it is said in place of the reader's words (`said`); the kind of refusal is said
 * only where the reader knew nothing more than the plain sentence.
 */
export function whyFailed(error: unknown, said?: MessageKey)
{
    return passageOf(error) ?? (said === undefined || said === 'common.actionFailed' ? refusalOf(error) : said);
}

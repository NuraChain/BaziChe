import { VISITOR_SHAPE, codeFrom } from '../../../backend/src/domains/invite/policy.ts';
import { runtime } from './runtime.ts';
import { forget, recallJson, rememberJson } from './storage.ts';

const KEPT = 'nura.invite';

const VISITOR = 'nura.visitor';

/** How long the code a link brought is kept: whoever brought somebody here first, within this, brought them. */
export const KEPT_MS = 30 * 24 * 60 * 60 * 1000;

interface Kept
{
    code: string;
    at: number;
}

const isKept = (value: unknown): value is Kept =>
    typeof value === 'object' && value !== null
    && typeof (value as Kept).code === 'string' && codeFrom((value as Kept).code) === (value as Kept).code
    && typeof (value as Kept).at === 'number' && Number.isFinite((value as Kept).at);

const young = () =>
{
    const kept = recallJson(KEPT, isKept);

    return kept !== null && runtime().clock.now() - kept.at < KEPT_MS ? kept.code : null;
};

/** The code this device keeps for the account a wallet will make here, while it is young enough to count. */
export function keptInvite()
{
    return young();
}

/**
 * Keeps the code a link brought, and answers the code kept. One kept within the window stays, so
 * whoever brought somebody here first is the one who brought them, unless the page has found that
 * the kept one no longer works (`replacing`). The same link opened again starts its window again.
 */
export function keepInvite(code: string, replacing = false)
{
    const kept = young();

    if (!replacing && kept !== null && kept !== code)
    {
        return kept;
    }

    rememberJson(KEPT, { code, at: runtime().clock.now() });

    return code;
}

/** Lets the kept code go once a wallet has signed in here: it can credit nobody after that. */
export function letInviteGo()
{
    forget(KEPT);
}

const isVisitor = (value: unknown): value is string => typeof value === 'string' && VISITOR_SHAPE.test(value);

/** The token this device names itself by when it opens an invite link: made once and kept, and nothing else about the device. */
export function visitorToken()
{
    const kept = recallJson(VISITOR, isVisitor);

    if (kept !== null)
    {
        return kept;
    }

    const made = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    rememberJson(VISITOR, made);

    return made;
}

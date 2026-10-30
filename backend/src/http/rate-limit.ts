import { rateLimit, type HandlerWrapper } from '@azerothjs/http';

/**
 * Applies an edge middleware only to the paths it is meant for.
 *
 * `pipeline()` wraps the whole handler, and a rate limiter wrapped that way meters everything -
 * including the forty static assets a single cold page load pulls. That is the wrong unit: a
 * file served from disk with an ETag costs almost nothing, while an API call costs a database
 * round trip, and one budget cannot be right for both. Metering the cheap thing at the rate the
 * expensive thing needs is how a normal visitor gets 429s on their own JavaScript.
 */
export function forPaths(matches: (pathname: string) => boolean, wrapper: HandlerWrapper): HandlerWrapper
{
    return (next) =>
    {
        const wrapped = wrapper(next);
        return {
            handle: (request) => (matches(routedPath(new URL(request.url).pathname))
                ? wrapped.handle(request)
                : next.handle(request))
        };
    };
}

export function routedPath(pathname: string)
{
    const segments = pathname.split('/').filter((segment) => segment !== '').map((segment) =>
    {
        try
        {
            return decodeURIComponent(segment);
        }
        catch
        {
            return segment;
        }
    });

    return `/${ segments.join('/') }`;
}

/**
 * Whether a path is metered.
 *
 * `/ws` is still here and a test pins it, but once the realtime gateway registers its upgrade
 * listener this entry only ever catches a plain non-upgrade GET - which `mountPages` would 404
 * anyway. The real handshake meter is `realtime/handshake-limit.ts`, because an upgraded socket
 * never reaches a middleware.
 */
export function isMetered(pathname: string)
{
    return pathname.startsWith('/api/') || pathname === '/api' || pathname === '/ws';
}

/**
 * The coarse per-IP ceiling for the API.
 *
 * It is a flood stop, not a business rule: the tight limits belong on the expensive individual
 * endpoints - sign-in, the SIWE nonce, message send, search - where they can be counted per
 * account rather than per address, and where a shared NAT does not make one user's burst
 * everybody's refusal.
 *
 * `trustProxy` must be turned on by any deployment that runs behind one, or every client shares
 * the proxy's address and this becomes a single global budget an attacker can exhaust for
 * everyone.
 */
export function apiRateLimit(options: { limit?: number; windowMs?: number; trustProxy?: boolean } = {})
{
    return forPaths(isMetered, rateLimit({
        limit: options.limit ?? 600,
        windowMs: options.windowMs ?? 60_000,
        trustProxy: options.trustProxy ?? false
    }));
}

export const SIGN_IN_SHARE = 20;

export const SIGN_IN_LEAST = 10;

export function isSignIn(pathname: string)
{
    return pathname === '/api/auth/challenge' || pathname === '/api/auth/wallet';
}

export function signInLimit(apiLimit: number)
{
    return Math.max(SIGN_IN_LEAST, Math.floor(apiLimit / SIGN_IN_SHARE));
}

export function signInRateLimit(options: { apiLimit: number; trustProxy: boolean })
{
    return forPaths(isSignIn, rateLimit({
        limit: signInLimit(options.apiLimit),
        windowMs: 60_000,
        trustProxy: options.trustProxy
    }));
}

export const INVITE_SHARE = 10;

export const INVITE_LEAST = 20;

/** The two routes an invite link's page asks with nobody signed in: who invited, and that the link was opened. */
export function isPublicInvite(pathname: string)
{
    return pathname.startsWith('/api/public/invites/');
}

/**
 * A tenth of the api's ceiling, never under twenty: a page asks twice, so at 600 an address opens
 * thirty links a minute, which a household or an office behind one address does not reach, and
 * guessing at codes or writing visits under made-up tokens goes no faster than that.
 */
export function publicInviteLimit(apiLimit: number)
{
    return Math.max(INVITE_LEAST, Math.floor(apiLimit / INVITE_SHARE));
}

export function publicInviteRateLimit(options: { apiLimit: number; trustProxy: boolean })
{
    return forPaths(isPublicInvite, rateLimit({
        limit: publicInviteLimit(options.apiLimit),
        windowMs: 60_000,
        trustProxy: options.trustProxy
    }));
}

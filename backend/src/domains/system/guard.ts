import { ForbiddenError } from '@azerothjs/http';

/**
 * What a system player may never hold. Nothing makes one sign in, and no wallet is ever linked to
 * one; the paths that insert either ask here as well, so a bug elsewhere cannot hand the server's
 * own seat a session or money.
 */
export type Held = 'session' | 'wallet';

/** The refusal for a user being given a session or a wallet, or null when they may have it. */
export const systemRefusal = (system: boolean, held: Held) =>
    system ? new ForbiddenError(held === 'session' ? 'This account cannot sign in.' : 'This account cannot hold a wallet.') : null;

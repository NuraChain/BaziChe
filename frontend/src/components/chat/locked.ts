import type { MessageLock } from '../../data/chat.ts';
import type { MessageKey } from '../../locales/en.ts';

/** Why a line could not be opened here, as the thread says it in its place. */
export const LOCKED: Record<MessageLock, MessageKey> = {
    'unknown-sender': 'locked.unknownSender',
    'bad-signature': 'locked.badSignature',
    'no-key': 'locked.noKey',
    'no-epoch-key': 'locked.noEpochKey',
    tampered: 'locked.tampered',
    expired: 'expiry.locked'
};

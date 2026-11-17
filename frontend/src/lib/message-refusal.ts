import { isMessageRefusal } from '../../../backend/src/domains/chat/refusals.ts';
import { ApiError } from '../api.ts';
import type { MessageKey } from '../locales/en.ts';

/** The words for a person who cannot be written to, for `attempt`; anything else is said as every refusal is. */
export const whyMessage = (error: unknown): MessageKey =>
    (error instanceof ApiError && isMessageRefusal(error.code) ? `chat.refused.${ error.code }` : 'common.actionFailed');

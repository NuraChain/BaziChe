/** Why a person cannot be written to, one word each, so the page can say it in the reader's words. */
export const MESSAGE_REFUSALS = {
    'message-blocked': 403,
    'message-closed': 403
} as const satisfies Record<string, 403>;

export type MessageRefused = keyof typeof MESSAGE_REFUSALS;

export const isMessageRefusal = (value: string): value is MessageRefused => Object.hasOwn(MESSAGE_REFUSALS, value);

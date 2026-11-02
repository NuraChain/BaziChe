/** Every word a call is refused with, and its status. Imports nothing, so the browser reads the same list. */
export const CALL_REFUSALS = {
    'call-missing': 404,
    'call-room': 404,
    'call-friends': 403,
    'in-call': 409,
    'call-over': 409
} as const;

export type CallRefusal = keyof typeof CALL_REFUSALS;

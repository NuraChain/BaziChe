/** A call between the two people of a direct conversation, or a group's voice chat. */
export const CALL_KINDS = ['direct', 'group'] as const;

export type CallKind = typeof CALL_KINDS[number];

/** Ringing until it is answered or ends; live once answered; ended, with how. */
export const CALL_STATES = ['ringing', 'live', 'ended'] as const;

export type CallState = typeof CALL_STATES[number];

/**
 * How a call ended (MS-D30): `answered` after it was live, `missed` when nobody answered in time,
 * `declined` by whoever was rung, `busy` when they were in or being rung for another call,
 * `cancelled` by whoever rang before it was answered, `failed` when it could not go on.
 */
export const CALL_ENDINGS = ['answered', 'missed', 'declined', 'busy', 'cancelled', 'failed'] as const;

export type CallEnding = typeof CALL_ENDINGS[number];

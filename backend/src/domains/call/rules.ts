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

/** How long a call rings before it is missed (MS-D31). */
export const RING_SECONDS = 45;

/** How long a live direct call waits for somebody out of its room to come back, or to come at all (MS-D32). */
export const ALONE_SECONDS = 30;

/** What a call's room is called on the voice frames, beside a table's id. */
export const CALL_ROOM = 'call:';

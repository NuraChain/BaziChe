/** What inviting answers when it will not do something: one word each, with its status. The browser reads the same list. */
export const INVITE_REFUSALS = {
    'invite-missing': 404,
    'invite-code-soon': 409
} as const satisfies Record<string, 404 | 409 | 422>;

export type InviteRefusal = keyof typeof INVITE_REFUSALS;

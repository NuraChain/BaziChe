/** Each refusal of a group's own, one word with its status, so the page can say it in the reader's words. */
export const GROUP_REFUSALS = {
    'group-right': 403,
    'group-rank': 409,
    'group-self': 409,
    'group-member': 404,
    'group-banned': 403,
    'group-suspended': 409,
    'group-muted': 403,
    'group-quiet': 403,
    'group-no-media': 403,
    'group-picture': 422,
    'group-rights': 422,
    'group-link': 404
} as const satisfies Record<string, 403 | 404 | 409 | 422>;

export type GroupRefusal = keyof typeof GROUP_REFUSALS;

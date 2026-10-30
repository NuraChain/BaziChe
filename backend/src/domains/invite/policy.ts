/** The letters an invite code is made of: no 0, O, 1, I or L, which a person reading a code aloud mistakes for each other. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Thirty-one letters eight times is about 8.5 × 10^11 codes: a guess is hopeless, and could only credit a stranger with a new account. */
export const CODE_LENGTH = 8;

/** A campaign being written (`draft`), giving (`active`), stopped for now (`paused`) or over (`ended`). At most one is active. */
export const CAMPAIGN_STATES = ['draft', 'active', 'paused', 'ended'] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

/** A number of friends counted, and the look it gives whoever reaches it. */
export interface Milestone
{
    count: number;
    item: string;
}

/** Who a reward is for: whoever invited, the friend invited, or whoever reached a milestone of friends counted. */
export const REWARD_KINDS = ['inviter', 'invitee', 'milestone'] as const;

export type RewardKind = (typeof REWARD_KINDS)[number];

/** Waiting for the staff (`review`), given, refused, or given and then taken back (`taken`). */
export const REWARD_STATES = ['review', 'given', 'refused', 'taken'] as const;

export type RewardState = (typeof REWARD_STATES)[number];

/**
 * What makes a counted invite wait for a person, never act on its own: its first counted game came
 * soon after the account was made (`quick`), the others in that game were brought in by the same
 * inviter (`ring`), or the inviter had many friends counted in one day (`many`).
 */
export const INVITE_FLAGS = ['quick', 'ring', 'many'] as const;

export type InviteFlag = (typeof INVITE_FLAGS)[number];

/** The letters an invite code is made of: no 0, O, 1, I or L, which a person reading a code aloud mistakes for each other. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Thirty-one letters eight times is about 8.5 × 10^11 codes: a guess is hopeless, and could only credit a stranger with a new account. */
export const CODE_LENGTH = 8;

const CODE_SHAPE = new RegExp(`^[${ CODE_ALPHABET }]{${ CODE_LENGTH }}$`);

/** The code a link or a sign-in carried, read in capitals, or nothing when it cannot be one. */
export const codeFrom = (text: string | undefined) =>
{
    const code = (text ?? '').trim().toUpperCase();

    return CODE_SHAPE.test(code) ? code : null;
};

/** A device that opened a link names itself by a token it made up and keeps: 22 letters of base64url, as a device id is. */
export const VISITOR_SHAPE = /^[A-Za-z0-9_-]{22}$/;

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

/** How old an account must be before it can become established: a week. */
export const ESTABLISHED_DAYS = 7;

/** How many games, played out with somebody established or on the staff, make a player established. */
export const ESTABLISHED_GAMES = 5;

/** A first counted game finished this many minutes after joining is `quick`: a real first game almost never is. */
export const QUICK_MINUTES = 10;

/** An inviter with this many invites counted in the last day has the next one flagged `many`. */
export const MANY_A_DAY = 5;

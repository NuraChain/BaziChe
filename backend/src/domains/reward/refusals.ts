/** What the reward system answers when it will not do something. */
export const REWARD_REFUSALS = {
    'not-established': 409,
    'reward-off': 404,
    'reward-wallet': 409,
    'reward-minor': 409,
    'reward-suspended': 409,
    'reward-claimed': 409,
    'reward-budget': 409,
    'reward-cap': 409
} as const satisfies Record<string, 404 | 409>;

export type RewardRefusal = keyof typeof REWARD_REFUSALS;

export const isRewardRefusal = (value: string): value is RewardRefusal => Object.hasOwn(REWARD_REFUSALS, value);

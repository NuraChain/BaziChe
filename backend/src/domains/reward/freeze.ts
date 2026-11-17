import type { DataSource, EntityManager } from 'typeorm';

import { RewardFreeze } from '../../entities/reward-freeze.entity.ts';

/** Whether the staff froze this player's rewards: then they earn no NURA, claim no quest and withdraw nothing. */
export const rewardsFrozen = async (from: DataSource | EntityManager, userId: string) =>
    await from.getRepository(RewardFreeze).existsBy({ userId });

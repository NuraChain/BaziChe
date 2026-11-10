import type { DataSource, EntityManager } from 'typeorm';

import { Setting } from '../../entities/setting.entity.ts';
import { STAKE_STEP_WEI, weiOf } from './policy.ts';

const RATE_KEY = 'usd-rate';

/**
 * How many NURA the staff say a dollar is, in wei. Only ever a suggestion on the screen that opens
 * a table: the shortcuts there fill in an amount, and the server checks that amount, never dollars.
 * A rate on the step a stake must keep to, so every shortcut is itself a stake a table may take.
 */
export const rateOf = (text: string) =>
{
    const wei = weiOf(text);

    return wei !== null && wei % STAKE_STEP_WEI === 0n ? wei : null;
};

export async function usdRate(db: DataSource | EntityManager)
{
    const held = await db.getRepository(Setting).findOneBy({ key: RATE_KEY });

    return held === null ? null : rateOf(held.value);
}

/** Answers the rate it replaced, so the log can say what it was. */
export async function setUsdRate(tx: EntityManager, wei: bigint | null, staffId: string)
{
    const before = await usdRate(tx);

    if (wei === null)
    {
        await tx.getRepository(Setting).delete({ key: RATE_KEY });
    }
    else
    {
        await tx.getRepository(Setting).upsert({ key: RATE_KEY, value: wei.toString(), staffId }, ['key']);
    }

    return before;
}

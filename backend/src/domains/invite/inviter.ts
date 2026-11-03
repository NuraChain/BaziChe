import type { DataSource, EntityManager } from 'typeorm';

import { Referral } from '../../entities/referral.entity.ts';

/**
 * The wallet of whoever brought `me` in, once that invite counted and while they are not suspended,
 * unless it is `own`, the wallet paying: the inviter the shop and the vault give a share to.
 */
export async function inviterWalletOf(runner: DataSource | EntityManager, me: string, own: string)
{
    const found = await runner.getRepository(Referral)
        .createQueryBuilder('f')
        .innerJoin('users', 'i', 'i.id = f.inviter_id and i.is_suspended = false')
        .select('(select w.address from wallets w where w.user_id = i.id order by w.last_used_at desc nulls last limit 1)', 'address')
        .where('f.invitee_id = :me', { me })
        .andWhere('f.counted_at is not null')
        .getRawOne<{ address: string | null }>();
    const address = found?.address ?? null;

    return address === null || address.toLowerCase() === own.toLowerCase() ? null : address.toLowerCase();
}

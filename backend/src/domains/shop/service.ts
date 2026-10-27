import { HttpError } from '@azerothjs/http';
import { In, type DataSource, type EntityManager } from 'typeorm';

import { EquippedItem } from '../../entities/equipped-item.entity.ts';
import { OwnedItem } from '../../entities/owned-item.entity.ts';
import type { ShopCollectionView } from '../../schemas.ts';
import { SHOP_SLOTS, fitsSlot, isSlot, tableSlotsOf } from './catalogue.ts';
import type { OwnedVia } from './policy.ts';
import { SHOP_REFUSALS, type ShopRefusal } from './refusals.ts';

export const shopRefusal = (word: ShopRefusal, message: string, details?: Record<string, string>) =>
    new HttpError(SHOP_REFUSALS[word], message, { code: word, ...(details === undefined ? {} : { details }) });

/** What a player had chosen for a table, by kind: `{ dice: 'dice.shiraz' }`. Classic is a kind left out. */
export type TableLook = Record<string, string>;

/** Reads, inside a game's opening transaction, what each of its players chose for that game's table. */
export type LooksReader = (runner: EntityManager, game: string, userIds: readonly string[]) => Promise<Map<string, TableLook>>;

export function createShopService(db: DataSource)
{
    const collection = async (me: string): Promise<ShopCollectionView> =>
    {
        const [owned, chosen] = await Promise.all([
            db.getRepository(OwnedItem)
                .createQueryBuilder('o')
                .leftJoin('users', 'g', 'g.id = o.giver_id')
                .select('o.item_id', 'item')
                .addSelect('o.via', 'via')
                .addSelect('o.acquired_at', 'at')
                .addSelect('g.handle::text', 'giver')
                .where('o.user_id = :me', { me })
                .orderBy('o.acquired_at', 'DESC')
                .addOrderBy('o.item_id', 'ASC')
                .getRawMany<{ item: string; via: OwnedVia; at: Date; giver: string | null }>(),
            db.getRepository(EquippedItem).find({ where: { userId: me }, order: { slot: 'ASC' } })
        ]);

        return {
            owned: owned.map((row) => ({
                item: row.item,
                via: row.via,
                at: new Date(row.at).toISOString(),
                ...(row.giver === null ? {} : { from: row.giver })
            })),
            chosen: chosen.flatMap((row) => isSlot(row.slot) ? [{ slot: row.slot, item: row.itemId }] : [])
        };
    };

    return {
        collection,

        /**
         * Chooses a look for a slot, or Classic with no look. The look has to be the reader's and of
         * the slot's kind; the database holds both as well, and a look taken back in the moment
         * between the two is the same refusal.
         */
        async choose(me: string, slot: string, item: string | null)
        {
            if (!isSlot(slot) || (item !== null && !fitsSlot(slot, item)))
            {
                throw shopRefusal('shop-slot', 'That look does not go there.');
            }

            if (item === null)
            {
                await db.getRepository(EquippedItem).delete({ userId: me, slot });
                return await collection(me);
            }

            try
            {
                await db.getRepository(EquippedItem).upsert({ userId: me, slot, itemId: item }, ['userId', 'slot']);
            }
            catch (error)
            {
                if ((error as { driverError?: { code?: string } }).driverError?.code === '23503')
                {
                    throw shopRefusal('shop-not-owned', 'That look is not yours yet.');
                }

                throw error;
            }

            return await collection(me);
        },

        looksAt: (async (runner, game, userIds) =>
        {
            const slots = tableSlotsOf(game);
            const looks = new Map<string, TableLook>(userIds.map((id) => [id, {}]));

            if (slots.length === 0 || userIds.length === 0)
            {
                return looks;
            }

            const rows = await runner.getRepository(EquippedItem).find({ where: { userId: In([...userIds]), slot: In([...slots]) } });

            for (const row of rows)
            {
                const look = looks.get(row.userId);

                if (look !== undefined && isSlot(row.slot))
                {
                    look[SHOP_SLOTS[row.slot]] = row.itemId;
                }
            }

            return looks;
        }) satisfies LooksReader
    };
}

export type ShopService = ReturnType<typeof createShopService>;

import type { DataSource } from 'typeorm';

import { Conversation } from '../../entities/conversation.entity.ts';
import { Donation } from '../../entities/donation.entity.ts';

/**
 * The table chat a confirmed gift is said in and who gave whom how much, or null when there is
 * nowhere to say it: a gift not confirmed, a row that is gone, or a table with no thread.
 */
export async function donationLineOf(db: DataSource, donationId: string)
{
    const row = await db.getRepository(Donation)
        .createQueryBuilder('d')
        .innerJoin('matches', 'm', 'm.id = d.match_id')
        .innerJoin(Conversation, 'c', `c.table_id = m.table_id and c.kind = 'game'`)
        .innerJoin('users', 'g', 'g.id = d.giver_id')
        .innerJoin('users', 'r', 'r.id = d.receiver_id')
        .select('c.id', 'conversation_id')
        .addSelect('g.handle::text', 'who')
        .addSelect('r.handle::text', 'to')
        .addSelect('d.amount::text', 'amount')
        .where(`d.id = :donationId and d.state = 'confirmed'`, { donationId })
        .getRawOne<{ conversation_id: string; who: string; to: string; amount: string }>();

    return row === undefined
        ? null
        : { conversationId: row.conversation_id, params: { who: row.who, to: row.to, amount: row.amount } };
}

import type { DataSource } from 'typeorm';

import { Call } from '../../entities/call.entity.ts';
import { CallParticipant } from '../../entities/call-participant.entity.ts';
import { CALL_ROOM } from './rules.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A call's room on the voice frames, beside a table's id. */
export const roomOf = (callId: string) => `${ CALL_ROOM }${ callId }`;

/** The call a room names, in lower case, or null for a room that names none. */
export const callOfRoom = (room: string) =>
{
    const id = room.startsWith(CALL_ROOM) ? room.slice(CALL_ROOM.length) : '';

    return UUID.test(id) ? id.toLowerCase() : null;
};

/**
 * The room somebody may be in for a call, or nothing: a live call they are a participant of and were
 * not taken out of. What the hub asks of a call's room, as it asks a table's of the table.
 */
export async function callRoom(db: DataSource, userId: string, room: string)
{
    const id = callOfRoom(room);

    if (id === null)
    {
        return null;
    }

    const found = await db.getRepository(CallParticipant).createQueryBuilder('p')
        .innerJoin(Call, 'c', `c.id = p.call_id and c.state = 'live'`)
        .where('p.call_id = :id and p.user_id = :userId and p.removed_at is null', { id, userId })
        .getCount();

    return found > 0 ? roomOf(id) : null;
}

/**
 * Somebody came into a live call's room, or went out of it. `left_at` is when they were last not in
 * it, which is what a direct call's ending waits on (MS-D32): the ring and the answer set it, coming
 * in clears it, going out sets it again.
 */
export async function callMoved(db: DataSource, userId: string, room: string, here: boolean)
{
    const id = callOfRoom(room);

    if (id === null)
    {
        return;
    }

    await db.getRepository(CallParticipant).createQueryBuilder()
        .update()
        .set({ leftAt: here ? null : () => 'now()' })
        .where(`call_id = :id and user_id = :userId and removed_at is null and left_at is ${ here ? 'not null' : 'null' }`, { id, userId })
        .andWhere(`exists (select 1 from calls c where c.id = call_id and c.state = 'live')`)
        .execute();
}

import { HttpError } from '@azerothjs/http';
import { LessThan, type DataSource } from 'typeorm';

import { SupportMessage, SupportTicket } from '../../entities/index.ts';
import type { SupportCreate, SupportListQuery, SupportReply } from '../../schemas.ts';
import { record, type Actor } from '../admin/staff.ts';
import { MESSAGES_PER_PAGE, SUPPORT_ID, TICKETS_PER_PAGE } from './rules.ts';

const summary = (row: SupportTicket) => ({
    id: row.id,
    owner: row.owner.handle,
    subject: row.subject,
    status: row.status,
    updatedAt: row.updatedAt.toISOString()
});

export function createSupportService(db: DataSource)
{
    return {
        async list(ownerId: string | null, query: SupportListQuery)
        {
            const found = await db.getRepository(SupportTicket).find({
                where: { ...(ownerId === null ? {} : { ownerId }), ...(query.status === undefined ? {} : { status: query.status }) },
                relations: { owner: true },
                select: { id: true, subject: true, status: true, updatedAt: true, owner: { handle: true } },
                order: { updatedAt: 'DESC', id: 'DESC' },
                skip: (Number(query.page ?? 1) - 1) * TICKETS_PER_PAGE,
                take: TICKETS_PER_PAGE + 1
            });
            return { tickets: found.slice(0, TICKETS_PER_PAGE).map(summary), more: found.length > TICKETS_PER_PAGE };
        },

        async thread(ownerId: string | null, id: string, before?: string)
        {
            if (!SUPPORT_ID.test(id))
            {
                return null;
            }
            const ticket = await db.getRepository(SupportTicket).findOne({
                where: { id, ...(ownerId === null ? {} : { ownerId }) },
                relations: { owner: true },
                select: { id: true, subject: true, status: true, updatedAt: true, owner: { handle: true } }
            });
            if (ticket === null)
            {
                return null;
            }
            const messages = await db.getRepository(SupportMessage).find({
                where: { ticketId: id, ...(before === undefined ? {} : { sequence: LessThan(Number(before)) }) },
                order: { sequence: 'DESC' },
                take: MESSAGES_PER_PAGE + 1
            });
            return {
                ticket: summary(ticket),
                messages: messages.slice(0, MESSAGES_PER_PAGE).reverse().map((one) => ({
                    sequence: one.sequence, staff: one.staff, body: one.body, at: one.createdAt.toISOString()
                })),
                older: messages.length > MESSAGES_PER_PAGE
            };
        },

        async open(ownerId: string, input: SupportCreate)
        {
            const id = input.requestId;
            return db.transaction(async (tx) =>
            {
                const inserted = await tx.createQueryBuilder().insert().into(SupportTicket)
                    .values({ id, ownerId, subject: input.subject }).orIgnore().returning('id').execute();
                if (inserted.raw.length === 0)
                {
                    return await tx.getRepository(SupportTicket).existsBy({ id, ownerId }) ? { id } : null;
                }
                await tx.getRepository(SupportMessage).insert({ ticketId: id, sequence: 1, requestId: id, staff: false, body: input.body });
                return { id };
            });
        },

        async change(id: string, caller: string | Actor, reply: SupportReply | null)
        {
            if (!SUPPORT_ID.test(id))
            {
                return null;
            }
            const staff = typeof caller !== 'string';
            return db.transaction(async (tx) =>
            {
                const repo = tx.getRepository(SupportTicket);
                const ticket = await repo.findOne({
                    where: { id, ...(typeof caller === 'string' ? { ownerId: caller } : {}) },
                    lock: { mode: 'pessimistic_write' }
                });
                if (ticket === null)
                {
                    return null;
                }
                const messages = tx.getRepository(SupportMessage);
                if (reply !== null && await messages.existsBy({ ticketId: id, requestId: reply.requestId }))
                {
                    return { id };
                }
                if (ticket.status === 'closed')
                {
                    if (reply === null)
                    {
                        return { id };
                    }
                    throw new HttpError(409, 'This ticket is closed.', { code: 'support-closed' });
                }
                if (reply === null)
                {
                    await repo.update(id, { status: 'closed' });
                }
                else
                {
                    const sequence = ticket.count + 1;
                    await messages.insert({ ticketId: id, sequence, requestId: reply.requestId, staff, body: reply.body });
                    await repo.update(id, { status: staff ? 'answered' : 'open', count: sequence });
                }
                if (typeof caller !== 'string')
                {
                    await record(tx, caller, {
                        kind: 'support', reason: reply === null ? 'Ticket closed' : 'Ticket answered',
                        details: { ticket: id, action: reply === null ? 'close' : 'reply' }
                    });
                }
                return { id };
            });
        }
    };
}

import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Call, CallParticipant, Conversation, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import type { CallEnding, CallKind, CallState } from '../src/domains/call/rules.ts';

/**
 * The rows a call is made of: the call in its room, and who is in it. Each rule here is the
 * database's, so it holds whoever writes the row.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    return (await db.getRepository(User).save({ handle: `caller${ seq }`, displayName: `Caller ${ seq }`, hue: 200, kind: 'wallet' })).id;
};

const makeRoom = async () => (await db.getRepository(Conversation).save({ kind: 'group' })).id;

/** The SQLSTATE a write is refused with, or nothing when it is taken. */
const refusal = async (write: Promise<unknown>) =>
{
    try
    {
        await write;
        return null;
    }
    catch (error)
    {
        return (error as { driverError?: { code?: string }; code?: string }).driverError?.code ?? (error as { code?: string }).code ?? 'thrown';
    }
};

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

interface Shape
{
    state?: CallState;
    kind?: CallKind;
    ending?: CallEnding | null;
    answeredAt?: Date | null;
    endedAt?: Date | null;
    startedBy?: string | null;
}

let room = '';
let caller = '';

const call = (shape: Shape = {}, conversationId = room) =>
{
    const id = crypto.randomUUID();

    return {
        id,
        write: db.getRepository(Call).insert({
            id,
            conversationId,
            kind: shape.kind ?? 'direct',
            startedBy: shape.startedBy === undefined ? caller : shape.startedBy,
            state: shape.state ?? 'ringing',
            ending: shape.ending ?? null,
            answeredAt: shape.answeredAt ?? null,
            endedAt: shape.endedAt ?? null
        })
    };
};

const ended = (ending: CallEnding, answeredAt: Date | null): Shape => ({ state: 'ended', ending, answeredAt, endedAt: new Date(Date.now() + 1000) });

const join = (callId: string, userId: string, more: Partial<Pick<CallParticipant, 'leftAt' | 'removedAt' | 'handAt' | 'held' | 'joinedAt'>> = {}) =>
    db.getRepository(CallParticipant).insert({ callId, userId, joinedAt: more.joinedAt ?? new Date(), held: more.held ?? false, leftAt: more.leftAt ?? null, handAt: more.handAt ?? null, removedAt: more.removedAt ?? null });

describe.skipIf(!active)('a call\'s rows', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: [] });
        await db.initialize();
        await syncSchema(db);
    }, 180_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query('truncate table users cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('delete from call_participants');
        await db.query('delete from calls');
        await db.query('delete from conversations');
        await db.getRepository(User).createQueryBuilder().delete().execute();

        caller = await makeUser();
        room = await makeRoom();
    });

    it('keep one call open in a room at a time, and an ended one leaves room for the next', async () =>
    {
        const first = call();

        expect(await refusal(first.write)).toBeNull();
        expect(await refusal(call().write), 'a second while the first rings').toBe('23505');
        expect(await refusal(call({}, await makeRoom()).write), 'another room').toBeNull();

        await db.getRepository(Call).update({ id: first.id }, { state: 'ended', ending: 'cancelled', endedAt: new Date(Date.now() + 1000) });

        expect(await refusal(call().write), 'once the first has ended').toBeNull();
    });

    it('ring unanswered, are live answered, and end with how and when together', async () =>
    {
        expect(await refusal(call({ answeredAt: new Date(Date.now() + 1000) }).write), 'ringing, answered').toBe('23514');
        expect(await refusal(call({ state: 'live' }).write), 'live, never answered').toBe('23514');
        expect(await refusal(call({ state: 'live', answeredAt: new Date(Date.now() + 1000) }).write), 'live, answered').toBeNull();
    });

    it('end with how and when together, and only once ended', async () =>
    {
        const room2 = await makeRoom();

        expect(await refusal(call({ state: 'ended', ending: 'cancelled' }, room2).write), 'no end').toBe('23514');
        expect(await refusal(call({ state: 'ended', endedAt: new Date(Date.now() + 1000) }, room2).write), 'no way it ended').toBe('23514');
        expect(await refusal(call({ ending: 'cancelled' }, room2).write), 'ringing, with a way it ended').toBe('23514');
        expect(await refusal(call({ endedAt: new Date(Date.now() + 1000) }, room2).write), 'ringing, with an end').toBe('23514');
        expect(await refusal(call({ state: 'live', answeredAt: new Date(Date.now() + 1000), ending: 'answered' }, room2).write), 'live, with a way it ended').toBe('23514');
        expect(await refusal(call(ended('cancelled', null), room2).write)).toBeNull();
    });

    it('answer for how they ended: answered once answered, never for one nobody took, a failure either way', async () =>
    {
        const later = new Date(Date.now() + 500);
        const rooms = await Promise.all(Array.from({ length: 8 }, () => makeRoom()));

        expect(await refusal(call(ended('answered', null), rooms[0]).write), 'answered, never answered').toBe('23514');
        expect(await refusal(call(ended('answered', later), rooms[1]).write)).toBeNull();

        for (const [at, ending] of (['missed', 'declined', 'busy', 'cancelled'] as const).entries())
        {
            expect(await refusal(call(ended(ending, later), rooms[2 + at]).write), `${ ending }, answered`).toBe('23514');
        }

        expect(await refusal(call(ended('failed', null), rooms[6]).write), 'failed while it rang').toBeNull();
        expect(await refusal(call(ended('failed', later), rooms[7]).write), 'failed once live').toBeNull();
    });

    it('go forward in time', async () =>
    {
        const rooms = await Promise.all(Array.from({ length: 2 }, () => makeRoom()));

        expect(await refusal(call({ state: 'live', answeredAt: ago(3600) }, rooms[0]).write), 'answered before it rang').toBe('23514');
        expect(await refusal(call({ state: 'ended', ending: 'answered', answeredAt: new Date(Date.now() + 5000), endedAt: new Date(Date.now() + 1000) }, rooms[1]).write), 'ended before it was answered').toBe('23514');
    });

    it('refuse a word nobody wrote', async () =>
    {
        expect(await refusal(call({ kind: 'video' as CallKind }).write)).toBe('23514');
        expect(await refusal(call({ state: 'paused' as CallState }).write)).toBe('23514');
        expect(await refusal(call({ state: 'ended', ending: 'hung-up' as CallEnding, endedAt: new Date(Date.now() + 1000) }).write)).toBe('23514');
        expect(await refusal(call({ kind: 'group' }).write), 'a group\'s voice chat').toBeNull();
    });

    it('go with their room, and keep whoever rang as nobody once their account is gone', async () =>
    {
        const kept = call();

        await kept.write;
        await db.getRepository(User).delete({ id: caller });

        expect((await db.getRepository(Call).findOneByOrFail({ id: kept.id })).startedBy, 'whoever rang').toBeNull();

        await db.getRepository(Conversation).delete({ id: room });

        expect(await db.getRepository(Call).countBy({ id: kept.id }), 'the room gone').toBe(0);
    });

    it('hold a person in one call at a time, and back in the same one on the row they had', async () =>
    {
        const person = await makeUser();
        const first = call();
        const second = call({}, await makeRoom());

        await first.write;
        await second.write;

        expect(await refusal(join(first.id, person))).toBeNull();
        expect(await refusal(join(second.id, person)), 'a second call while in the first').toBe('23505');
        expect(await refusal(join(first.id, person, { leftAt: new Date(Date.now() + 1000) })), 'the same call twice').toBe('23505');

        await db.getRepository(CallParticipant).update({ callId: first.id, userId: person }, { leftAt: new Date(Date.now() + 1000) });

        expect(await refusal(join(second.id, person)), 'once they left the first').toBeNull();
    });

    it('take somebody out only once they are gone, and never back before they came', async () =>
    {
        const person = await makeUser();
        const held = call();

        await held.write;

        expect(await refusal(join(held.id, person, { removedAt: new Date() })), 'removed, still there').toBe('23514');
        expect(await refusal(join(held.id, person, { joinedAt: new Date(), leftAt: ago(60) })), 'gone before they came').toBe('23514');
        expect(await refusal(join(held.id, person, { held: true, handAt: new Date(), leftAt: new Date(Date.now() + 1000), removedAt: new Date(Date.now() + 1000) })), 'held, a hand up, removed').toBeNull();
    });

    it('go with their call and with their person', async () =>
    {
        const person = await makeUser();
        const other = await makeUser();
        const held = call();

        await held.write;
        await join(held.id, person);
        await join(held.id, other);

        await db.getRepository(User).delete({ id: person });
        expect(await db.getRepository(CallParticipant).countBy({ callId: held.id }), 'their person gone').toBe(1);

        await db.getRepository(Call).delete({ id: held.id });
        expect(await db.getRepository(CallParticipant).countBy({ userId: other }), 'their call gone').toBe(0);
    });
});

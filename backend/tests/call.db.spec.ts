import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Call, CallParticipant, Conversation, Notification, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { callMoved, callRoom, roomOf } from '../src/domains/call/rooms.ts';
import { ALONE_SECONDS, RING_SECONDS } from '../src/domains/call/rules.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * Calls between the two people of a direct conversation, through the ports, against Postgres:
 * every change, each asked twice and raced, and what each rings.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NOWHERE = '3f0e3c2a-1111-4222-8333-444455556666';

const OWNER_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

let db: DataSource;
let ports: Services;
let seq = 0;

let rung: { callId: string; people: string[] }[] = [];
let told: { userId: string; what: string }[] = [];
let chats: string[] = [];

const listener: WriteListener = {
    chatChanged: (conversationId) =>
    {
        chats.push(conversationId);
    },
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        told.push({ userId, what });
    },
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    callChanged: (callId, people) =>
    {
        rung.push({ callId, people: [...people].sort() });
    },
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const door = () => buildPorts(db, {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    vaultAddress: '',
    adminWallet: OWNER_WALLET
} as Parameters<typeof buildPorts>[1], listener);

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (overrides: Partial<Pick<User, 'isSuspended'>> = {}): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({ handle: `call${ seq }`, displayName: `Caller ${ seq }`, hue: seq % 360, kind: 'wallet', ...overrides });

    return { id: made.id, handle: made.handle };
};

const befriend = (a: Person, b: Person) =>
    db.query(`insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1) on conflict do nothing`, [a.id, b.id]);

/** Two friends and the direct conversation between them. */
const pair = async () =>
{
    const a = await makeUser();
    const b = await makeUser();

    await befriend(a, b);

    return { a, b, room: await ports.chat.openDirect(a.id, b.handle) };
};

const refusal = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return null;
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string } };

    return `${ response.status } ${ body.error.code }`;
};

const callOf = (id: string) => db.getRepository(Call).findOneByOrFail({ id });

const participants = (callId: string) => db.getRepository(CallParticipant).find({ where: { callId }, order: { userId: 'ASC' } });

/** Moves a call's clocks back, as if it had rung or been answered that long ago. */
const ago = async (callId: string, seconds: number) =>
{
    await db.query(
        `update calls set created_at = created_at - make_interval(secs => $2),
                          answered_at = answered_at - make_interval(secs => $2)
          where id = $1`,
        [callId, seconds]
    );
    await db.query(
        `update call_participants set joined_at = joined_at - make_interval(secs => $2),
                                      left_at = left_at - make_interval(secs => $2)
          where call_id = $1`,
        [callId, seconds]
    );
};

const heardBy = (callId: string) => rung.filter((one) => one.callId === callId).map((one) => one.people);

/** What a person's bell holds about calls: each row's kind, whoever it is about, where it leads and whether it was read. */
const bell = async (person: Person) => (await db.getRepository(Notification).find({ where: { userId: person.id }, order: { createdAt: 'ASC' } }))
    .filter((row) => row.kind === 'call' || row.kind === 'call-missed')
    .map((row) => ({ kind: row.kind, actor: row.actorId, ref: row.ref, key: row.dedupeKey, read: row.readAt !== null }));

/** The lines a room was told about its calls, oldest first. */
const lines = async (room: string) => rowsOf<{ payload: { key: string; params: Record<string, string> } }>(
    await db.query(`select payload from messages where conversation_id = $1 and kind = 'system' order by created_at, id`, [room])
).map((row) => row.payload).filter((payload) => payload.key === 'chat.line.call');

describe.skipIf(!active)('calls between two people, against Postgres', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: false });
        await db.initialize();
        await syncSchema(db);
    }, 180_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.getRepository(Conversation).createQueryBuilder().delete().execute();
            await db.getRepository(User).createQueryBuilder().delete().execute();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();

        ports = door();
        rung = [];
        told = [];
        chats = [];
    });

    describe('a ring', () =>
    {
        it('rings the other one, tells both and reads the same to each from their own side', async () =>
        {
            const { a, b, room } = await pair();

            const mine = await ports.calls.ring(a.id, room);

            expect(mine).toMatchObject({ room, kind: 'direct', state: 'ringing', out: true, person: b.handle, rung: false });
            expect(mine.ending).toBeUndefined();
            expect(mine.remainingMs).toBeGreaterThan((RING_SECONDS - 5) * 1000);
            expect(mine.remainingMs).toBeLessThanOrEqual(RING_SECONDS * 1000);
            expect(heardBy(mine.id)).toEqual([[a.id, b.id].sort()]);

            const theirs = (await ports.calls.state(b.id)).calls;

            expect(theirs).toHaveLength(1);
            expect(theirs[0]).toMatchObject({ id: mine.id, state: 'ringing', out: false, person: a.handle });

            const rows = await participants(mine.id);

            expect(rows.map((row) => row.userId)).toEqual([a.id, b.id].sort());
            expect(rows.every((row) => row.leftAt !== null), 'nobody is in its room while it rings').toBe(true);
        });

        it('says it rings once a page of the callee has read it, and tells the caller then, once', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            told = [];
            await ports.calls.state(a.id);
            expect(told, 'the caller reading it').toEqual([]);

            await ports.calls.state(b.id);
            expect(told).toEqual([{ userId: a.id, what: 'calls' }]);

            await ports.calls.view(b.id, call.id);
            expect(told, 'read again').toHaveLength(1);
            expect((await ports.calls.view(a.id, call.id)).rung).toBe(true);

            await ports.calls.accept(b.id, call.id);
            expect((await ports.calls.view(a.id, call.id)).rung, 'once it is answered').toBe(false);
        });

        it('is the one call when the caller asks again, and answers the other one when they call back', async () =>
        {
            const { a, b, room } = await pair();
            const first = await ports.calls.ring(a.id, room);

            rung = [];
            const again = await ports.calls.ring(a.id, room);

            expect(again.id).toBe(first.id);
            expect(rung, 'nothing changed, nobody rung').toEqual([]);

            const back = await ports.calls.ring(b.id, room);

            expect(back).toMatchObject({ id: first.id, state: 'live', out: false });
            expect(heardBy(first.id)).toEqual([[a.id, b.id].sort()]);
            expect(await db.getRepository(Call).countBy({ conversationId: room })).toBe(1);
        });

        it('ends at once as busy when the callee is in a call or being rung, and holds a caller already in one', async () =>
        {
            const { a, b, room } = await pair();
            const c = await makeUser();

            await befriend(c, b);
            await befriend(c, a);

            const toB = await ports.chat.openDirect(c.id, b.handle);
            const toA = await ports.chat.openDirect(c.id, a.handle);

            await ports.calls.ring(a.id, room);

            const busy = await ports.calls.ring(c.id, toB);

            expect(busy).toMatchObject({ state: 'ended', ending: 'busy', out: true, person: b.handle });
            expect(busy.remainingMs).toBeUndefined();

            const stored = await callOf(busy.id);

            expect(stored.endedAt).not.toBeNull();
            expect((await participants(busy.id)).every((row) => row.leftAt !== null)).toBe(true);
            expect((await ports.calls.ring(c.id, toA)).ending, 'somebody who is ringing is busy too').toBe('busy');

            expect(await refusal(ports.calls.ring(b.id, toB)), 'somebody being rung starts nothing').toBe('409 in-call');
        });

        it('rings only a friend, and a room hidden by a block or that is not theirs is nobody to call', async () =>
        {
            const a = await makeUser();
            const b = await makeUser();
            const stranger = await makeUser();
            const room = await ports.chat.openDirect(a.id, b.handle).catch(() => null);

            await befriend(a, b);

            const friends = room ?? await ports.chat.openDirect(a.id, b.handle);

            await db.query(`delete from friendships where user_id in ($1, $2)`, [a.id, b.id]);
            expect(await refusal(ports.calls.ring(a.id, friends))).toBe('403 call-friends');

            await befriend(a, b);
            await db.query(`update users set is_suspended = true where id = $1`, [b.id]);
            expect(await refusal(ports.calls.ring(a.id, friends)), 'a suspended friend').toBe('403 call-friends');

            await db.query(`update users set is_suspended = false where id = $1`, [b.id]);
            await db.query(`insert into blocks (user_id, blocked_id) values ($1, $2)`, [b.id, a.id]);
            expect(await refusal(ports.calls.ring(a.id, friends)), 'blocked by them').toBe('404 call-room');
            await db.query(`delete from blocks`);

            expect(await refusal(ports.calls.ring(stranger.id, friends)), 'not in the room').toBe('404 call-room');
            expect(await refusal(ports.calls.ring(a.id, NOWHERE))).toBe('404 call-room');
            expect(await refusal(ports.calls.ring(a.id, 'not-a-uuid'))).toBe('404 call-room');

            const [group] = rowsOf<{ id: string }>(await db.query(`insert into conversations (kind) values ('group') returning id`));

            await db.query(`insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)`, [group.id, a.id, b.id]);
            expect(await refusal(ports.calls.ring(a.id, group.id)), 'a group room').toBe('404 call-room');
            expect(await db.getRepository(Call).count()).toBe(0);
        });

        it('rings two callers at one callee once: the second finds them busy', async () =>
        {
            const callee = await makeUser();
            const callers = await Promise.all([makeUser(), makeUser(), makeUser()]);
            const rooms: string[] = [];

            for (const caller of callers)
            {
                await befriend(caller, callee);
                rooms.push(await ports.chat.openDirect(caller.id, callee.handle));
            }

            const answers = await Promise.all(callers.map((caller, index) => ports.calls.ring(caller.id, rooms[index])));

            expect(answers.filter((one) => one.state === 'ringing')).toHaveLength(1);
            expect(answers.filter((one) => one.ending === 'busy')).toHaveLength(2);
        });

        it('rings once when both call each other at the same moment, and that call is live', async () =>
        {
            for (let round = 0; round < 5; round += 1)
            {
                const { a, b, room } = await pair();
                const [one, two] = await Promise.all([ports.calls.ring(a.id, room), ports.calls.ring(b.id, room)]);

                expect(one.id).toBe(two.id);
                expect((await callOf(one.id)).state).toBe('live');
            }
        });
    });

    describe('an answer', () =>
    {
        it('makes it live, lets both into its room, and is the same answer asked twice', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            expect(await callRoom(db, a.id, roomOf(call.id)), 'no room while it rings').toBeNull();

            rung = [];
            const live = await ports.calls.accept(b.id, call.id);

            expect(live).toMatchObject({ id: call.id, state: 'live', out: false });
            expect(live.answeredAt).toBeDefined();
            expect(live.remainingMs).toBeUndefined();
            expect(heardBy(call.id)).toEqual([[a.id, b.id].sort()]);
            expect(await callRoom(db, a.id, roomOf(call.id))).toBe(roomOf(call.id));
            expect(await callRoom(db, b.id, `call:${ call.id.toUpperCase() }`), 'its id in capitals').toBe(roomOf(call.id));

            rung = [];
            expect(await ports.calls.accept(b.id, call.id)).toMatchObject({ state: 'live' });
            expect(rung, 'answered twice').toEqual([]);
        });

        it('belongs to the callee alone, and comes too late once the ring is over', async () =>
        {
            const { a, b, room } = await pair();
            const outsider = await makeUser();
            const call = await ports.calls.ring(a.id, room);

            expect(await refusal(ports.calls.accept(a.id, call.id)), 'the caller').toBe('404 call-missing');
            expect(await refusal(ports.calls.accept(outsider.id, call.id))).toBe('404 call-missing');
            expect(await refusal(ports.calls.accept(b.id, 'not-a-uuid'))).toBe('404 call-missing');
            expect(await refusal(ports.calls.view(outsider.id, call.id))).toBe('404 call-missing');

            await ports.calls.hangUp(a.id, call.id);

            expect(await refusal(ports.calls.accept(b.id, call.id))).toBe('409 call-over');
            expect((await callOf(call.id)).ending).toBe('cancelled');
        });

        it('against a cancel at the same moment: one of them, never both', async () =>
        {
            for (let round = 0; round < 6; round += 1)
            {
                const { a, b, room } = await pair();
                const call = await ports.calls.ring(a.id, room);

                await Promise.allSettled([ports.calls.accept(b.id, call.id), ports.calls.hangUp(a.id, call.id)]);

                const ended = await callOf(call.id);

                expect(['ended', 'live']).toContain(ended.state);

                if (ended.state === 'ended')
                {
                    expect(['cancelled', 'answered']).toContain(ended.ending);
                }
            }
        });
    });

    describe('a decline and a hang up', () =>
    {
        it('declines a ring once, and is refused for a call that was answered', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            rung = [];
            expect(await ports.calls.decline(b.id, call.id)).toMatchObject({ state: 'ended', ending: 'declined' });
            expect(heardBy(call.id)).toEqual([[a.id, b.id].sort()]);

            rung = [];
            expect(await ports.calls.decline(b.id, call.id)).toMatchObject({ ending: 'declined' });
            expect(rung).toEqual([]);
            expect(await refusal(ports.calls.decline(a.id, call.id)), 'the caller').toBe('404 call-missing');

            const next = await ports.calls.ring(a.id, room);

            await ports.calls.accept(b.id, next.id);
            expect(await refusal(ports.calls.decline(b.id, next.id))).toBe('409 call-over');
        });

        it('cancels a ring from the caller, declines it from the callee, ends a live one as answered', async () =>
        {
            const { a, b, room } = await pair();

            const cancelled = await ports.calls.ring(a.id, room);

            expect(await ports.calls.hangUp(a.id, cancelled.id)).toMatchObject({ state: 'ended', ending: 'cancelled' });

            const declined = await ports.calls.ring(a.id, room);

            expect(await ports.calls.hangUp(b.id, declined.id)).toMatchObject({ ending: 'declined' });

            const answered = await ports.calls.ring(b.id, room);

            await ports.calls.accept(a.id, answered.id);

            const ended = await ports.calls.hangUp(a.id, answered.id);

            expect(ended).toMatchObject({ state: 'ended', ending: 'answered', out: false });
            expect(Date.parse(ended.endedAt!)).toBeGreaterThanOrEqual(Date.parse(ended.answeredAt!));
            expect((await participants(answered.id)).every((row) => row.leftAt !== null)).toBe(true);
            expect(await callRoom(db, a.id, roomOf(answered.id)), 'its room is gone').toBeNull();

            rung = [];
            expect(await ports.calls.hangUp(b.id, answered.id)).toMatchObject({ ending: 'answered' });
            expect(rung, 'hung up twice').toEqual([]);
        });

        it('lets both call again once it ended, the ended one kept for a moment in what they read', async () =>
        {
            const { a, b, room } = await pair();
            const first = await ports.calls.ring(a.id, room);

            await ports.calls.hangUp(a.id, first.id);

            const read = (await ports.calls.state(b.id)).calls;

            expect(read.map((one) => [one.id, one.ending])).toEqual([[first.id, 'cancelled']]);

            const second = await ports.calls.ring(b.id, room);

            expect(second.id).not.toBe(first.id);
            expect((await ports.calls.state(a.id)).calls.map((one) => one.id)).toEqual([second.id, first.id]);

            await db.query(`update calls set ended_at = ended_at - interval '1 minute', created_at = created_at - interval '1 minute' where id = $1`, [first.id]);
            expect((await ports.calls.state(a.id)).calls.map((one) => one.id), 'a minute after it ended').toEqual([second.id]);
            expect((await ports.calls.view(a.id, first.id)).ending, 'still read by its id').toBe('cancelled');
        });
    });

    describe('time', () =>
    {
        it('ends a ring nobody answered as missed, and not a moment before', async () =>
        {
            const { a, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            await ago(call.id, RING_SECONDS - 3);
            expect(await ports.jobs.sweepCalls()).toEqual({ missed: 0, ended: 0 });

            rung = [];
            await ago(call.id, 4);
            expect(await ports.jobs.sweepCalls()).toEqual({ missed: 1, ended: 0 });
            expect((await callOf(call.id)).ending).toBe('missed');
            expect(heardBy(call.id)).toHaveLength(1);
            expect(await ports.jobs.sweepCalls(), 'swept twice').toEqual({ missed: 0, ended: 0 });
        });

        it('ends a live call one side left, or never came to, after its wait, and keeps it for somebody back', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            await ports.calls.accept(b.id, call.id);

            const key = roomOf(call.id);

            await callMoved(db, a.id, key, true);
            await callMoved(db, b.id, key, true);
            await ago(call.id, ALONE_SECONDS + 10);
            expect(await ports.jobs.sweepCalls(), 'both in').toEqual({ missed: 0, ended: 0 });

            await callMoved(db, b.id, key, false);
            await ago(call.id, ALONE_SECONDS - 5);
            expect(await ports.jobs.sweepCalls(), 'not long enough').toEqual({ missed: 0, ended: 0 });

            await callMoved(db, b.id, key, true);
            await ago(call.id, 30);
            expect(await ports.jobs.sweepCalls(), 'back in time').toEqual({ missed: 0, ended: 0 });

            await callMoved(db, b.id, key, false);
            await ago(call.id, ALONE_SECONDS + 1);
            expect(await ports.jobs.sweepCalls()).toEqual({ missed: 0, ended: 1 });
            expect((await callOf(call.id)).ending).toBe('answered');

            const never = await ports.calls.ring(a.id, room);

            await ports.calls.accept(b.id, never.id);
            await callMoved(db, a.id, roomOf(never.id), true);
            await ago(never.id, ALONE_SECONDS + 1);
            expect(await ports.jobs.sweepCalls(), 'the callee never came').toEqual({ missed: 0, ended: 1 });
        });

        it('waits for a side that has not come yet from the answer, however long the call rang first', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            await ago(call.id, RING_SECONDS - 5);
            await ports.calls.accept(b.id, call.id);

            expect(await ports.jobs.sweepCalls(), 'answered after forty seconds').toEqual({ missed: 0, ended: 0 });
            expect((await callOf(call.id)).state).toBe('live');
        });

        it('lets nobody into an ended call room, and comes and goes only from a live one', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);
            const key = roomOf(call.id);

            await callMoved(db, a.id, key, true);
            expect((await participants(call.id)).find((row) => row.userId === a.id)?.leftAt, 'not while it rings').not.toBeNull();

            await ports.calls.accept(b.id, call.id);
            await callMoved(db, a.id, key, true);
            expect((await participants(call.id)).find((row) => row.userId === a.id)?.leftAt).toBeNull();

            await ports.calls.hangUp(b.id, call.id);
            await callMoved(db, a.id, key, true);
            expect((await participants(call.id)).find((row) => row.userId === a.id)?.leftAt, 'not once it ended').not.toBeNull();

            await callMoved(db, a.id, 'call:not-a-uuid', true);
            await callMoved(db, a.id, NOWHERE, true);
        });

        it('lets everybody out of every room at a start', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            await ports.calls.accept(b.id, call.id);
            await callMoved(db, a.id, roomOf(call.id), true);
            await callMoved(db, b.id, roomOf(call.id), true);

            expect(await ports.jobs.emptyCallRooms()).toBe(2);
            expect((await participants(call.id)).every((row) => row.leftAt !== null)).toBe(true);
            expect((await callOf(call.id)).state, 'the call itself goes on').toBe('live');
        });
    });

    describe('the bell and the room', () =>
    {
        it('rings the callee\'s bell while it rings, and lets go of it once it is answered, saying how long it lasted once it ends', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            await ago(call.id, 20);
            expect(await bell(b)).toEqual([{ kind: 'call', actor: a.id, ref: { conversationId: room }, key: `call:${ call.id }`, read: false }]);
            expect(await bell(a), 'nothing for whoever rang').toEqual([]);
            expect(told).toContainEqual({ userId: b.id, what: 'notifications' });

            await ports.calls.accept(b.id, call.id);
            expect(await bell(b), 'answered').toEqual([]);
            expect(await lines(room), 'nothing said while it goes on').toEqual([]);

            await db.query(`update calls set answered_at = answered_at - interval '312.6 seconds', created_at = created_at - interval '312.6 seconds' where id = $1`, [call.id]);
            await db.query(`update call_participants set joined_at = joined_at - interval '312.6 seconds', left_at = left_at - interval '312.6 seconds' where call_id = $1`, [call.id]);
            chats = [];
            await ports.calls.hangUp(a.id, call.id);

            const [said] = await lines(room);
            const unread = async (person: Person) => (await ports.chat.list(person.id)).conversations.find((one) => one.id === room)?.unread;

            expect(chats, 'the room is rung for its line').toEqual([room]);

            expect(said.params, 'its time in whole seconds, as every clock here says it').toEqual({ who: a.handle, ending: 'answered', seconds: '312' });
            expect(await unread(a), 'the caller\'s own line').toBe(0);
            expect(await unread(b)).toBe(1);
        });

        it('says a call nobody answered was missed, under the key it rang with, unread, and tells the room', async () =>
        {
            const { a, b, room } = await pair();
            const call = await ports.calls.ring(a.id, room);

            await db.query(`update notifications set read_at = now() where user_id = $1`, [b.id]);
            await ago(call.id, RING_SECONDS + 1);
            await ports.jobs.sweepCalls();

            expect(await bell(b)).toEqual([{ kind: 'call-missed', actor: a.id, ref: { conversationId: room }, key: `call:${ call.id }`, read: false }]);
            expect(await lines(room)).toEqual([{ key: 'chat.line.call', params: { who: a.handle, ending: 'missed' } }]);
        });

        it('says a ring called off was missed too, and a declined one leaves nothing in the bell', async () =>
        {
            const { a, b, room } = await pair();
            const cancelled = await ports.calls.ring(a.id, room);

            await ports.calls.hangUp(a.id, cancelled.id);
            expect((await bell(b)).map((row) => row.kind)).toEqual(['call-missed']);

            const declined = await ports.calls.ring(a.id, room);

            await ports.calls.decline(b.id, declined.id);
            expect((await bell(b)).map((row) => [row.kind, row.key])).toEqual([['call-missed', `call:${ cancelled.id }`]]);
            expect((await lines(room)).map((line) => line.params.ending)).toEqual(['cancelled', 'declined']);
        });

        it('tells a busy callee they missed a call they were never rung for, and the caller\'s room it was busy', async () =>
        {
            const { a, b, room } = await pair();
            const c = await makeUser();

            await befriend(c, b);

            const toB = await ports.chat.openDirect(c.id, b.handle);

            await ports.calls.ring(a.id, room);

            const busy = await ports.calls.ring(c.id, toB);

            expect((await bell(b)).map((row) => [row.kind, row.actor])).toEqual([['call', a.id], ['call-missed', c.id]]);
            expect(await lines(toB)).toEqual([{ key: 'chat.line.call', params: { who: c.handle, ending: 'busy' } }]);
            expect(busy.state).toBe('ended');
        });

        it('keeps a call ringing for somebody who switched calls off, with nothing in their bell, and says nothing in a room a block ended a call in', async () =>
        {
            const { a, b, room } = await pair();

            await ports.social.setMute(b.id, 'notice', 'calls', true);

            const call = await ports.calls.ring(a.id, room);

            expect(await bell(b)).toEqual([]);
            expect((await ports.calls.state(b.id)).calls.map((one) => one.state), 'the card is the call').toEqual(['ringing']);

            await ports.calls.accept(b.id, call.id);
            await ports.social.block(a.id, b.handle);

            expect((await callOf(call.id)).ending).toBe('failed');
            expect(await lines(room)).toEqual([]);
        });
    });

    describe('the people in it', () =>
    {
        it('ends a ring and a live call when one of them unfriends, blocks or is suspended, as failed', async () =>
        {
            const unfriended = await pair();
            const ringing = await ports.calls.ring(unfriended.a.id, unfriended.room);

            rung = [];
            await ports.social.removeFriend(unfriended.b.id, unfriended.a.handle);
            expect((await callOf(ringing.id)).ending).toBe('failed');
            expect(heardBy(ringing.id)).toHaveLength(1);

            const blocked = await pair();
            const live = await ports.calls.ring(blocked.a.id, blocked.room);

            await ports.calls.accept(blocked.b.id, live.id);
            await ports.social.block(blocked.a.id, blocked.b.handle);

            const failed = await callOf(live.id);

            expect(failed).toMatchObject({ state: 'ended', ending: 'failed' });
            expect(failed.answeredAt).not.toBeNull();

            const suspended = await pair();
            const owner = await makeUser();

            await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`, [owner.id, OWNER_WALLET]);

            const talking = await ports.calls.ring(suspended.a.id, suspended.room);

            await ports.calls.accept(suspended.b.id, talking.id);
            await ports.admin.suspend(owner.id, suspended.b.handle, { category: 'harassment', reason: 'Rude in every call this week' });
            expect((await callOf(talking.id)).ending, 'one of them suspended').toBe('failed');

            const kept = await pair();
            const other = await pair();
            const going = await ports.calls.ring(kept.a.id, kept.room);

            await ports.social.removeFriend(other.a.id, other.b.handle);
            expect((await callOf(going.id)).state, 'somebody else unfriending').toBe('ringing');
        });
    });
});

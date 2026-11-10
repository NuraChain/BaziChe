import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Call, CallParticipant, Message, Notification, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { callRoom, roomOf } from '../src/domains/call/rooms.ts';
import { EMPTY_SECONDS, GROUP_CALL_MOST } from '../src/domains/call/rules.ts';
import { SWITCH_DEFAULTS } from '../src/domains/group/roles.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * A group's voice chat, through the ports, against Postgres: begun, joined, left, ended by the
 * staff and by time, what the group says about who may do which, what its room and its bell say,
 * and who the hub may let into its room.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NOWHERE = '3f0e3c2a-1111-4222-8333-444455556666';

const OWNER_WALLET = '0x976EA74026E726554dB657fA54763abd0C3a0aa9';

let db: DataSource;
let ports: Services;
let seq = 0;

let rung: { callId: string; people: string[] }[] = [];
let voiceChats: string[] = [];
let told: { userId: string; what: string }[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
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
    voiceChatChanged: (conversationId) =>
    {
        voiceChats.push(conversationId);
    },
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vaultAddress: '',
    adminWallet: OWNER_WALLET
} as Parameters<typeof buildPorts>[1];

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({ handle: `vc${ seq }`, displayName: `Voice ${ seq }`, hue: seq % 360, kind: 'wallet', allowStrangerMessages: true });

    return { id: made.id, handle: made.handle };
};

/** The word and status a refusal answers with, or nothing when the work went through. */
const word = async (work: Promise<unknown>) =>
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

/** A group of the owner's with these people in it, and its room. */
const crew = async (owner: Person, ...people: Person[]) =>
{
    const made = await ports.group.create(owner.id, { name: `Crew ${ seq }`, blurb: '', crest: 'crest-crown', hue: 40, game: '', privacy: 'public' });

    for (const person of people)
    {
        await ports.group.join(person.id, made.slug);
    }

    return { slug: made.slug, room: made.conversationId! };
};

const switches = (owner: Person, slug: string, changed: Partial<typeof SWITCH_DEFAULTS>) =>
    ports.group.permissions(owner.id, slug, { switches: { ...SWITCH_DEFAULTS, ...changed }, approval: false });

const callOf = (id: string) => db.getRepository(Call).findOneByOrFail({ id });

const rowOf = (callId: string, person: Person) => db.getRepository(CallParticipant).findOneByOrFail({ callId, userId: person.id });

const into = (person: Person, callId: string) => ports.jobs.callMoved(person.id, roomOf(callId), true);

const outOf = (person: Person, callId: string) => ports.jobs.callMoved(person.id, roomOf(callId), false);

/** The voice chat's lines in a room, in order: each line's key, its params and who it is from. */
const lines = async (room: string) => (await db.getRepository(Message).find({ where: { conversationId: room, kind: 'system' }, order: { createdAt: 'ASC' } }))
    .map((row) => ({ ...(row.payload as { key: string; params: Record<string, string> }), by: row.senderId }))
    .filter((line) => line.key.startsWith('chat.line.voice.'));

/** A person's bell about voice chats: each row's kind, whoever it is about, where it leads and its key. */
const bell = async (person: Person) => (await db.getRepository(Notification).find({ where: { userId: person.id, kind: 'group-call' } }))
    .map((row) => ({ kind: row.kind, actorId: row.actorId, ref: row.ref, dedupeKey: row.dedupeKey }));

const log = async (slug: string) => await db.query(
    `select e.kind, e.actor_handle, e.actor_role, e.person_handle, e.details
       from group_events e join groups g on g.id = e.group_id
      where g.slug = $1 and e.kind = 'call'
      order by e.created_at, e.id`,
    [slug]
) as { kind: string; actor_handle: string | null; actor_role: string | null; person_handle: string | null; details: Record<string, string> }[];

describe.skipIf(!active)('a group\'s voice chat, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query('truncate table users cascade');
            await db.query('truncate table groups cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate table users cascade');
        await db.query('truncate table groups cascade');
        await db.query('truncate table conversations cascade');
        ports = buildPorts(db, CONFIG, listener);
        rung = [];
        voiceChats = [];
        told = [];
    });

    describe('begun and joined', () =>
    {
        it('is live from its start, with whoever began it out of its room until a socket brings them, said in the room and to every member', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const b = await makeUser();
            const { room } = await crew(owner, a, b);

            const started = await ports.calls.ring(a.id, room);

            expect(started).toMatchObject({ room, kind: 'group', state: 'live', out: true, rung: false });
            expect(started.answeredAt, 'answered at its start').toBeDefined();
            expect(started.person, 'nobody is the other one of a voice chat').toBeUndefined();
            expect(started.people).toEqual([{ who: a.handle, held: false, hand: false, here: false, role: 'member' }]);
            expect((await rowOf(started.id, a)).leftAt, 'out of its room').not.toBeNull();

            expect(await lines(room)).toEqual([{ key: 'chat.line.voice.started', params: { who: a.handle }, by: a.id }]);
            expect(await bell(a), 'nobody is told what they did').toEqual([]);

            for (const member of [owner, b])
            {
                expect(await bell(member)).toEqual([{ kind: 'group-call', actorId: a.id, ref: { conversationId: room }, dedupeKey: `call:${ started.id }` }]);
                expect(told).toContainEqual({ userId: member.id, what: 'notifications' });
            }

            expect(rung).toEqual([{ callId: started.id, people: [a.id] }]);
            expect(voiceChats).toEqual([room]);
            expect((await ports.calls.state(a.id)).calls.map((one) => one.id)).toEqual([started.id]);
            expect((await ports.calls.state(b.id)).calls, 'not in it until they join').toEqual([]);
        });

        it('is joined, not begun again, where one runs, and the same answer asked twice', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const b = await makeUser();
            const { room } = await crew(owner, a, b);

            const started = await ports.calls.ring(a.id, room);
            rung = [];
            voiceChats = [];

            const joined = await ports.calls.ring(b.id, room);

            expect(joined.id).toBe(started.id);
            expect(joined.out).toBe(false);
            expect(joined.person, 'nobody is the other one of a voice chat, however many are in it').toBeUndefined();
            expect(joined.people?.map((one) => one.who)).toEqual([a.handle, b.handle]);
            expect(rung).toEqual([{ callId: started.id, people: [a.id, b.id].sort() }]);
            expect(voiceChats).toEqual([room]);

            rung = [];
            voiceChats = [];

            expect((await ports.calls.join(b.id, started.id)).id).toBe(started.id);
            expect((await ports.calls.ring(b.id, room)).id).toBe(started.id);
            expect(rung, 'joined twice').toEqual([]);
            expect(voiceChats).toEqual([]);
            expect(await lines(room), 'begun once').toHaveLength(1);
            expect(await bell(b), 'told once').toHaveLength(1);
        });

        it('answers a voice chat that is not there, one in a room the reader is not in and one that ended in their own words', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const outsider = await makeUser();
            const { room } = await crew(owner, a);

            const started = await ports.calls.ring(a.id, room);

            expect(await word(ports.calls.join(outsider.id, started.id)), 'somebody not in the group').toBe('404 call-missing');
            expect(await word(ports.calls.ring(outsider.id, room)), 'the room of a group they are not in').toBe('404 call-room');
            expect(await word(ports.calls.join(a.id, 'not-a-uuid'))).toBe('404 call-missing');
            expect(await word(ports.calls.join(a.id, NOWHERE))).toBe('404 call-missing');
            await ports.calls.join(owner.id, started.id);

            expect(await word(ports.calls.accept(owner.id, started.id)), 'a voice chat is no ring to answer, even to somebody in it').toBe('404 call-missing');
            expect(await word(ports.calls.decline(owner.id, started.id))).toBe('404 call-missing');
            expect((await callOf(started.id)).state).toBe('live');

            await ports.calls.end(owner.id, started.id);

            expect(await word(ports.calls.join(owner.id, started.id))).toBe('409 call-ended');
        });

        it('keeps somebody in one call at a time', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const friend = await makeUser();
            const { room } = await crew(owner, a);
            const other = await crew(owner, a);

            await db.query(`insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)`, [a.id, friend.id]);
            const direct = await ports.chat.openDirect(a.id, friend.handle);
            const ringing = await ports.calls.ring(friend.id, direct);

            expect(await word(ports.calls.ring(a.id, room)), 'rung for a call').toBe('409 in-call');

            await ports.calls.decline(a.id, ringing.id);
            const started = await ports.calls.ring(a.id, room);
            await into(a, started.id);

            expect(await word(ports.calls.ring(a.id, other.room)), 'in the room of another voice chat').toBe('409 in-call');

            const elsewhere = await ports.calls.ring(owner.id, other.room);
            expect(await word(ports.calls.join(a.id, elsewhere.id))).toBe('409 in-call');

            await outOf(a, started.id);
            expect((await ports.calls.join(a.id, elsewhere.id)).people?.map((one) => one.who), 'out of the room, free to go to another').toContain(a.handle);
        });
    });

    describe('what the group says', () =>
    {
        it('lets a member begin one only while its members may, and the staff whose right it is whatever they may', async () =>
        {
            const owner = await makeUser();
            const admin = await makeUser();
            const moderator = await makeUser();
            const member = await makeUser();
            const { slug, room } = await crew(owner, admin, moderator, member);

            await ports.group.role(owner.id, slug, { id: admin.handle, role: 'admin', rights: ['calls'] });
            await ports.group.role(owner.id, slug, { id: moderator.handle, role: 'moderator' });
            await switches(owner, slug, { call: false });

            expect(await word(ports.calls.ring(member.id, room))).toBe('403 call-right');
            expect(await word(ports.calls.ring(moderator.id, room)), 'starting one is no moderator\'s').toBe('403 call-right');
            expect(await callRoomOpen(room), 'nothing begun by a refusal').toBe(false);

            const started = await ports.calls.ring(admin.id, room);

            expect(started.state).toBe('live');
            expect((await ports.calls.ring(member.id, room)).id, 'joining needs no right to begin').toBe(started.id);
        });

        it('lets in only whoever its members may join, and the staff whatever the switch says', async () =>
        {
            const owner = await makeUser();
            const moderator = await makeUser();
            const member = await makeUser();
            const { slug, room } = await crew(owner, moderator, member);

            await ports.group.role(owner.id, slug, { id: moderator.handle, role: 'moderator' });
            const started = await ports.calls.ring(owner.id, room);
            await switches(owner, slug, { joinCall: false });

            expect(await word(ports.calls.join(member.id, started.id))).toBe('403 call-right');
            expect(await word(ports.calls.ring(member.id, room))).toBe('403 call-right');
            expect((await ports.calls.join(moderator.id, started.id)).people?.map((one) => one.who)).toContain(moderator.handle);
        });

        it('holds a member who comes in while the members may not speak, and one kept quiet, and never the staff', async () =>
        {
            const owner = await makeUser();
            const moderator = await makeUser();
            const member = await makeUser();
            const quiet = await makeUser();
            const { slug, room } = await crew(owner, moderator, member, quiet);

            await ports.group.role(owner.id, slug, { id: moderator.handle, role: 'moderator' });
            await ports.group.mute(owner.id, slug, { id: quiet.handle });

            const started = await ports.calls.ring(owner.id, room);
            await ports.calls.join(quiet.id, started.id);

            await switches(owner, slug, { speak: false });
            await ports.calls.join(member.id, started.id);
            await ports.calls.join(moderator.id, started.id);

            const view = await ports.calls.view(owner.id, started.id);

            expect(view.people?.map((one) => [one.who, one.held])).toEqual([
                [owner.handle, false],
                [quiet.handle, true],
                [member.handle, true],
                [moderator.handle, false]
            ]);
            expect(await callRoom(db, member.id, roomOf(started.id))).toMatchObject({ held: true });
        });
    });

    describe('somebody who comes back', () =>
    {
        it('is held once they may no longer speak, and keeps a hold they had', async () =>
        {
            const owner = await makeUser();
            const member = await makeUser();
            const { slug, room } = await crew(owner, member);

            const started = await ports.calls.ring(owner.id, room);
            await ports.calls.join(member.id, started.id);
            await ports.calls.hangUp(member.id, started.id);
            await ports.group.mute(owner.id, slug, { id: member.handle });

            const back = await ports.calls.join(member.id, started.id);

            expect(back.people?.find((one) => one.who === member.handle)?.held).toBe(true);

            await ports.group.unmute(owner.id, slug, member.handle);
            await ports.calls.hangUp(member.id, started.id);

            const again = await ports.calls.join(member.id, started.id);

            expect(again.people?.find((one) => one.who === member.handle)?.held, 'a hold stands until somebody lets them speak').toBe(true);
        });
    });

    describe('its room', () =>
    {
        it('takes nobody past the most it holds, and somebody taken out of it never again', async () =>
        {
            const owner = await makeUser();
            const late = await makeUser();
            const removed = await makeUser();
            const { room } = await crew(owner, late, removed);

            const started = await ports.calls.ring(owner.id, room);
            await into(owner, started.id);

            const crowd = rowsOf<{ id: string }>(await db.query(
                `insert into users (handle, display_name, hue)
                 select 'crowd' || g, 'Crowd ' || g, 1 from generate_series(1, $1::int) g
                 returning id`,
                [GROUP_CALL_MOST - 1]
            ));

            await db.query(
                `insert into call_participants (call_id, user_id, joined_at, left_at, held)
                 select $1, u, now(), null, false from unnest($2::uuid[]) as u`,
                [started.id, crowd.map((one) => one.id)]
            );

            expect(await word(ports.calls.join(late.id, started.id))).toBe('409 call-full');
            expect(await word(ports.calls.ring(late.id, room))).toBe('409 call-full');

            await db.query(`update call_participants set left_at = now() where user_id = $1`, [crowd[0].id]);
            expect((await ports.calls.join(late.id, started.id)).people?.map((one) => one.who), 'a place came free').toContain(late.handle);

            await ports.calls.join(removed.id, started.id);
            await db.query(`update call_participants set left_at = now(), gone_at = now(), removed_at = now() where user_id = $1`, [removed.id]);

            expect(await word(ports.calls.join(removed.id, started.id))).toBe('403 call-removed');
            expect(await word(ports.calls.ring(removed.id, room))).toBe('403 call-removed');
            expect(await callRoom(db, removed.id, roomOf(started.id))).toBeNull();
        });

        it('lets the hub in only a live member who has not left, carried by this server alone', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const c = await makeUser();
            const { slug, room } = await crew(owner, a, c);

            const started = await ports.calls.ring(owner.id, room);
            await ports.calls.join(a.id, started.id);
            await ports.calls.join(c.id, started.id);

            expect(await callRoom(db, a.id, roomOf(started.id))).toEqual({ call: roomOf(started.id), held: false, lines: false, most: GROUP_CALL_MOST });
            expect(await callRoom(db, a.id, `call:${ started.id.toUpperCase() }`)).toMatchObject({ call: roomOf(started.id) });

            await db.query(`delete from conversation_members where conversation_id = $1 and user_id = $2`, [room, c.id]);
            expect(await callRoom(db, c.id, roomOf(started.id)), 'no longer in its conversation, whatever its own row says').toBeNull();

            await ports.group.leave(a.id, slug);
            expect(await callRoom(db, a.id, roomOf(started.id)), 'out of the group').toBeNull();

            await ports.calls.end(owner.id, started.id);
            expect(await callRoom(db, owner.id, roomOf(started.id)), 'ended').toBeNull();
        });

        it('tells the conversation whenever somebody comes into its room or goes, and says nothing of a direct call', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const friend = await makeUser();
            const { room } = await crew(owner, a);

            const started = await ports.calls.ring(a.id, room);
            voiceChats = [];

            await into(a, started.id);
            await into(a, started.id);
            await outOf(a, started.id);

            expect(voiceChats, 'once each way, and not for a move that moved nobody').toEqual([room, room]);
            expect((await rowOf(started.id, a)).leftAt).not.toBeNull();

            await db.query(`insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)`, [owner.id, friend.id]);
            const direct = await ports.chat.openDirect(owner.id, friend.handle);
            const call = await ports.calls.ring(owner.id, direct);
            await ports.calls.accept(friend.id, call.id);
            voiceChats = [];

            await into(owner, call.id);
            expect(voiceChats).toEqual([]);
        });

        it('is said from the head to the members of its conversation, and to nobody else', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const b = await makeUser();
            const outsider = await makeUser();
            const { room } = await crew(owner, a, b);

            expect(await ports.calls.room(owner.id, room), 'none running').toEqual({});

            const started = await ports.calls.ring(a.id, room);
            await into(a, started.id);
            await ports.calls.join(b.id, started.id);

            expect(await ports.calls.room(owner.id, room)).toEqual({ call: { id: started.id, here: 1, faces: [a.handle] } });

            await into(b, started.id);
            expect((await ports.calls.room(owner.id, room)).call?.faces).toEqual([a.handle, b.handle]);

            await db.query(`insert into blocks (user_id, blocked_id) values ($1, $2)`, [owner.id, a.id]);
            expect(await ports.calls.room(owner.id, room), 'somebody the reader blocked is counted and not drawn').toEqual({ call: { id: started.id, here: 2, faces: [b.handle] } });

            await db.query(`delete from blocks`);
            await db.query(`insert into blocks (user_id, blocked_id) values ($1, $2)`, [b.id, owner.id]);
            expect((await ports.calls.room(owner.id, room)).call?.faces, 'nor somebody who blocked the reader').toEqual([a.handle]);

            await db.query(`delete from blocks`);
            await db.query(`update users set is_suspended = true where id = $1`, [b.id]);
            expect((await ports.calls.room(owner.id, room)).call, 'nor anybody suspended').toEqual({ id: started.id, here: 2, faces: [a.handle] });

            expect(await word(ports.calls.room(outsider.id, room))).toMatch(/^404 /);
            expect(await word(ports.calls.room(owner.id, 'not-a-uuid'))).toMatch(/^404 /);
            expect(await word(ports.calls.room(owner.id, NOWHERE))).toMatch(/^404 /);
        });
    });

    describe('left, and ended', () =>
    {
        it('is left on purpose, goes on without whoever left, and takes them back with what was decided about them', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const { room } = await crew(owner, a);

            const started = await ports.calls.ring(owner.id, room);
            await ports.calls.join(a.id, started.id);
            await into(a, started.id);
            await db.query(`update call_participants set held = true, hand_at = now() where call_id = $1 and user_id = $2`, [started.id, a.id]);

            rung = [];
            const left = await ports.calls.hangUp(a.id, started.id);

            expect(left.state, 'it goes on').toBe('live');
            expect(left.people?.map((one) => one.who), 'whoever left is not among its people').toEqual([owner.handle]);
            expect((await rowOf(started.id, a)).goneAt).not.toBeNull();
            expect((await rowOf(started.id, a)).leftAt).not.toBeNull();
            expect(rung).toEqual([{ callId: started.id, people: [owner.id, a.id].sort() }]);
            expect((await ports.calls.state(a.id)).calls, 'not one of their calls any more').toEqual([]);
            expect(await callRoom(db, a.id, roomOf(started.id))).toBeNull();
            expect((await ports.calls.view(a.id, started.id)).state, 'still theirs to read').toBe('live');

            rung = [];
            await ports.calls.hangUp(a.id, started.id);
            expect(rung, 'left twice').toEqual([]);

            await into(a, started.id);
            expect((await rowOf(started.id, a)).leftAt, 'a socket that comes back brings nobody who left into its room').not.toBeNull();

            const back = await ports.calls.join(a.id, started.id);

            expect(back.people?.find((one) => one.who === a.handle)).toEqual({ who: a.handle, held: true, hand: true, here: false, role: 'member' });
            expect((await rowOf(started.id, a)).goneAt).toBeNull();
        });

        it('is ended for everybody by whoever the group lets, written into its log, said in the room with how long it ran and taken out of the bell', async () =>
        {
            const owner = await makeUser();
            const admin = await makeUser();
            const plain = await makeUser();
            const member = await makeUser();
            const outsider = await makeUser();
            const { slug, room } = await crew(owner, admin, plain, member);

            await ports.group.role(owner.id, slug, { id: admin.handle, role: 'admin', rights: ['calls'] });
            await ports.group.role(owner.id, slug, { id: plain.handle, role: 'admin', rights: ['pin'] });

            const started = await ports.calls.ring(member.id, room);
            await into(member, started.id);
            await db.query(`update calls set answered_at = answered_at - interval '95 seconds', created_at = created_at - interval '95 seconds' where id = $1`, [started.id]);

            expect(await word(ports.calls.end(member.id, started.id)), 'a member, who began it').toBe('403 call-right');
            expect(await word(ports.calls.end(plain.id, started.id)), 'an admin without the right').toBe('403 call-right');
            expect(await word(ports.calls.end(outsider.id, started.id))).toBe('404 call-missing');
            expect(await word(ports.calls.end(admin.id, NOWHERE))).toBe('404 call-missing');
            expect((await callOf(started.id)).state).toBe('live');

            rung = [];
            const ended = await ports.calls.end(admin.id, started.id);

            expect(ended).toMatchObject({ state: 'ended', ending: 'answered' });
            expect((await rowOf(started.id, member)).leftAt, 'everybody out of its room').not.toBeNull();
            expect(rung).toEqual([{ callId: started.id, people: [member.id] }]);
            expect(await log(slug)).toEqual([{ kind: 'call', actor_handle: admin.handle, actor_role: 'admin', person_handle: null, details: { act: 'end' } }]);

            const said = await lines(room);

            expect(said.map((line) => line.key)).toEqual(['chat.line.voice.started', 'chat.line.voice.ended']);
            expect(said[1].by).toBe(admin.id);
            expect(Number(said[1].params.seconds)).toBeGreaterThanOrEqual(95);
            expect(Number(said[1].params.seconds)).toBeLessThan(110);

            for (const person of [owner, admin, plain])
            {
                expect(await bell(person), 'nothing left to join').toEqual([]);
            }

            rung = [];
            expect((await ports.calls.end(owner.id, started.id)).state).toBe('ended');
            expect(rung, 'ended twice').toEqual([]);
            expect(await lines(room), 'said once').toHaveLength(2);
            expect(await log(slug), 'written once').toHaveLength(1);
            expect((await ports.calls.state(member.id)).calls.map((one) => one.state), 'shown a moment longer as it ended').toEqual(['ended']);
        });

        it('is in the history of whoever was in it, with its group and from whoever began it, and leaves it with the group', async () =>
        {
            const owner = await makeUser();
            const member = await makeUser();
            const away = await makeUser();
            const { slug, room } = await crew(owner, member, away);

            const started = await ports.calls.ring(owner.id, room);
            await ports.calls.join(member.id, started.id);
            await db.query(`update calls set answered_at = answered_at - interval '95 seconds', created_at = created_at - interval '95 seconds' where id = $1`, [started.id]);

            expect((await ports.calls.history(owner.id, null)).calls, 'nothing while it runs').toEqual([]);

            await ports.calls.end(owner.id, started.id);

            const said = (await lines(room)).find((line) => line.key === 'chat.line.voice.ended')?.params.seconds;
            const began = (await ports.calls.history(owner.id, null)).calls;

            expect(began).toEqual([{ id: started.id, room, kind: 'group', group: slug, out: true, ending: 'answered', at: began[0]?.at, seconds: Number(said) }]);
            expect((await ports.calls.history(member.id, null)).calls.map((one) => [one.id, one.out]), 'joined, not begun').toEqual([[started.id, false]]);
            expect((await ports.calls.history(away.id, null)).calls, 'never in it').toEqual([]);

            await ports.group.leave(member.id, slug);

            expect((await ports.calls.history(member.id, null)).calls, 'a room they are no longer in').toEqual([]);
        });

        it('ends by itself once nobody has been in its room for longer than it waits, as of when the last one went', async () =>
        {
            const owner = await makeUser();
            const a = await makeUser();
            const { room } = await crew(owner, a);

            const started = await ports.calls.ring(a.id, room);
            await into(a, started.id);
            await db.query(`update calls set answered_at = answered_at - interval '600 seconds', created_at = created_at - interval '600 seconds' where id = $1`, [started.id]);
            await db.query(`update call_participants set joined_at = joined_at - interval '600 seconds' where call_id = $1`, [started.id]);

            expect(await ports.jobs.sweepCalls(), 'somebody is in it').toEqual({ missed: 0, ended: 0 });

            await outOf(a, started.id);
            await db.query(`update call_participants set left_at = now() - make_interval(secs => $2) where call_id = $1`, [started.id, EMPTY_SECONDS - 10]);
            expect(await ports.jobs.sweepCalls(), 'not empty for long enough').toEqual({ missed: 0, ended: 0 });

            await db.query(`update call_participants set left_at = now() - make_interval(secs => $2) where call_id = $1`, [started.id, EMPTY_SECONDS + 5]);
            expect(await ports.jobs.sweepCalls()).toEqual({ missed: 0, ended: 1 });

            const ended = await callOf(started.id);
            const lastOut = (await rowOf(started.id, a)).leftAt!;

            expect(ended).toMatchObject({ state: 'ended', ending: 'answered' });
            expect(ended.endedAt?.getTime(), 'ended as the last one went').toBe(lastOut.getTime());

            const said = await lines(room);
            const seconds = Number(said.at(-1)?.params.seconds);

            expect(said.at(-1)).toMatchObject({ key: 'chat.line.voice.ended', by: null });
            expect(seconds).toBeGreaterThanOrEqual(600 - EMPTY_SECONDS - 6);
            expect(seconds).toBeLessThanOrEqual(600 - EMPTY_SECONDS - 4);
            expect(await bell(owner)).toEqual([]);
        });

        it('keeps one somebody came back into while the sweep was on its way to ending it', async () =>
        {
            const owner = await makeUser();
            const { room } = await crew(owner);

            const started = await ports.calls.ring(owner.id, room);
            await db.query(`update calls set answered_at = answered_at - interval '600 seconds', created_at = created_at - interval '600 seconds' where id = $1`, [started.id]);
            await db.query(`update call_participants set joined_at = joined_at - interval '600 seconds', left_at = now() - make_interval(secs => $2) where call_id = $1`, [started.id, EMPTY_SECONDS + 5]);

            // The sweep finds it empty, then waits to end it behind a lock on the table, and somebody comes back meanwhile.
            const holder = db.createQueryRunner();
            await holder.connect();
            await holder.startTransaction();
            await holder.query('lock table calls in share mode');

            const sweeping = ports.jobs.sweepCalls();

            await waitFor(async () => rowsOf<{ n: number }>(await db.query(
                `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update "calls"%'`
            ))[0].n > 0);

            await db.query(`update call_participants set left_at = null where call_id = $1`, [started.id]);
            await holder.commitTransaction();
            await holder.release();

            expect(await sweeping).toEqual({ missed: 0, ended: 0 });
            expect((await callOf(started.id)).state).toBe('live');
        });

        it('ends one nobody ever came into, and says it ran for no time at all', async () =>
        {
            const owner = await makeUser();
            const { room } = await crew(owner);

            const started = await ports.calls.ring(owner.id, room);
            await db.query(`update calls set answered_at = answered_at - make_interval(secs => $2), created_at = created_at - make_interval(secs => $2) where id = $1`, [started.id, EMPTY_SECONDS + 30]);
            await db.query(`update call_participants set joined_at = joined_at - make_interval(secs => $2), left_at = left_at - make_interval(secs => $2) where call_id = $1`, [started.id, EMPTY_SECONDS + 30]);

            expect(await ports.jobs.sweepCalls()).toEqual({ missed: 0, ended: 1 });
            expect((await lines(room)).at(-1)?.params.seconds).toBe('0');
        });

        it('takes whoever leaves the group, is taken out of it or banned from it out of its voice chat, which goes on', async () =>
        {
            const owner = await makeUser();
            const leaver = await makeUser();
            const removed = await makeUser();
            const banned = await makeUser();
            const { slug, room } = await crew(owner, leaver, removed, banned);

            const started = await ports.calls.ring(owner.id, room);

            for (const person of [leaver, removed, banned])
            {
                await ports.calls.join(person.id, started.id);
                await into(person, started.id);
            }

            rung = [];
            voiceChats = [];

            await ports.group.leave(leaver.id, slug);
            await ports.group.remove(owner.id, slug, removed.handle);
            await ports.group.ban(owner.id, slug, banned.handle);

            for (const person of [leaver, removed, banned])
            {
                const row = await rowOf(started.id, person);

                expect(row.goneAt, person.handle).not.toBeNull();
                expect(row.leftAt, person.handle).not.toBeNull();
                expect(rung).toContainEqual({ callId: started.id, people: [person.id] });
            }

            expect(voiceChats.filter((one) => one === room)).toHaveLength(3);
            expect((await callOf(started.id)).state).toBe('live');
            expect((await ports.calls.view(owner.id, started.id)).people?.map((one) => one.who)).toEqual([owner.handle]);
        });
    });
    describe('what is done in it', () =>
    {
        /** A group with an owner, an admin who holds the calls right, one who does not, a moderator and two members, all in a voice chat the owner began. */
        const staffed = async () =>
        {
            const owner = await makeUser();
            const admin = await makeUser();
            const plain = await makeUser();
            const moderator = await makeUser();
            const member = await makeUser();
            const other = await makeUser();
            const { slug, room } = await crew(owner, admin, plain, moderator, member, other);

            await ports.group.role(owner.id, slug, { id: admin.handle, role: 'admin', rights: ['calls'] });
            await ports.group.role(owner.id, slug, { id: plain.handle, role: 'admin', rights: ['pin'] });
            await ports.group.role(owner.id, slug, { id: moderator.handle, role: 'moderator' });

            const started = await ports.calls.ring(owner.id, room);

            for (const person of [admin, plain, moderator, member, other])
            {
                await ports.calls.join(person.id, started.id);
            }

            return { owner, admin, plain, moderator, member, other, slug, room, callId: started.id };
        };

        const personIn = async (reader: Person, callId: string, who: Person) =>
            (await ports.calls.view(reader.id, callId)).people?.find((one) => one.who === who.handle);

        it('tells each reader everybody\'s place in the group, and whether the reader holds the calls right there', async () =>
        {
            const { owner, admin, plain, moderator, member, other, slug, callId } = await staffed();
            const roles = (view: Awaited<ReturnType<typeof ports.calls.view>>) =>
                Object.fromEntries((view.people ?? []).map((one) => [one.who, one.role ?? null]));

            expect(roles(await ports.calls.view(member.id, callId))).toEqual({
                [owner.handle]: 'owner',
                [admin.handle]: 'admin',
                [plain.handle]: 'admin',
                [moderator.handle]: 'moderator',
                [member.handle]: 'member',
                [other.handle]: 'member'
            });

            for (const [reader, calls] of [[owner, true], [admin, true], [plain, false], [moderator, false], [member, false]] as const)
            {
                expect((await ports.calls.view(reader.id, callId)).may, reader.handle).toEqual({ calls });
            }

            await ports.group.role(owner.id, slug, { id: plain.handle, role: 'admin', rights: ['pin', 'calls'] });
            await ports.group.role(owner.id, slug, { id: member.handle, role: 'moderator' });

            expect((await ports.calls.view(plain.id, callId)).may, 'given the right in the middle of it').toEqual({ calls: true });
            expect(roles(await ports.calls.view(owner.id, callId))[member.handle], 'a role changed in the middle of it').toBe('moderator');
        });

        it('puts a hand up and down for whoever is in it, once each way', async () =>
        {
            const { owner, member, other, callId } = await staffed();

            rung = [];
            expect((await ports.calls.hand(member.id, callId, true)).people?.find((one) => one.who === member.handle)?.hand).toBe(true);
            expect(rung).toHaveLength(1);

            rung = [];
            await ports.calls.hand(member.id, callId, true);
            expect(rung, 'up twice').toEqual([]);

            expect((await ports.calls.hand(member.id, callId, false)).people?.find((one) => one.who === member.handle)?.hand).toBe(false);

            await ports.calls.hangUp(other.id, callId);
            expect(await word(ports.calls.hand(other.id, callId, true)), 'somebody who left').toBe('404 call-missing');
            expect(await word(ports.calls.hand(member.id, NOWHERE, true))).toBe('404 call-missing');

            await ports.calls.end(owner.id, callId);
            expect(await word(ports.calls.hand(member.id, callId, true))).toBe('409 call-ended');
        });

        it('holds somebody, and lets them speak with their hand down, by whoever holds the calls right, on somebody ranked below them', async () =>
        {
            const { owner, admin, plain, moderator, member, other, slug, callId } = await staffed();

            await ports.calls.hand(member.id, callId, true);

            rung = [];
            const held = await ports.calls.hold(admin.id, callId, member.handle.toUpperCase(), true);

            expect(held.people?.find((one) => one.who === member.handle)).toMatchObject({ held: true, hand: true });
            expect(rung).toHaveLength(1);
            expect(await callRoom(db, member.id, roomOf(callId))).toMatchObject({ held: true });

            rung = [];
            await ports.calls.hold(admin.id, callId, member.handle, true);
            expect(rung, 'held twice').toEqual([]);

            await ports.calls.hold(admin.id, callId, member.handle, false);
            expect(await personIn(owner, callId, member), 'let speak, the hand put down').toMatchObject({ held: false, hand: false });

            expect(await log(slug)).toEqual([
                { kind: 'call', actor_handle: admin.handle, actor_role: 'admin', person_handle: member.handle, details: { act: 'hold' } },
                { kind: 'call', actor_handle: admin.handle, actor_role: 'admin', person_handle: member.handle, details: { act: 'speak' } }
            ]);

            expect(await word(ports.calls.hold(plain.id, callId, member.handle, true)), 'an admin without the right').toBe('403 call-right');
            expect(await word(ports.calls.hold(member.id, callId, other.handle, true)), 'a member').toBe('403 call-right');
            expect(await word(ports.calls.hold(moderator.id, callId, member.handle, true)), 'a moderator').toBe('403 call-right');
            expect(await word(ports.calls.hold(admin.id, callId, owner.handle, true)), 'the owner').toBe('409 call-rank');
            expect(await word(ports.calls.hold(admin.id, callId, plain.handle, true)), 'another admin').toBe('409 call-rank');
            expect(await word(ports.calls.hold(admin.id, callId, admin.handle, true)), 'themselves').toBe('409 call-rank');
            expect(await word(ports.calls.hold(admin.id, callId, 'nobody.here', true))).toBe('404 call-nobody');
            expect(await word(ports.calls.hold((await makeUser()).id, callId, member.handle, true)), 'somebody not in the group').toBe('404 call-missing');

            await ports.calls.hangUp(other.id, callId);
            expect(await word(ports.calls.hold(admin.id, callId, other.handle, true)), 'somebody who left').toBe('404 call-nobody');
            expect(await word(ports.calls.hold(owner.id, callId, moderator.handle, true)), 'the owner on a moderator').toBeNull();
            expect(await log(slug), 'a refusal writes nothing').toHaveLength(3);
        });

        it('holds everybody ranked below the reader at once, and says so once', async () =>
        {
            const { owner, admin, plain, moderator, member, other, slug, callId } = await staffed();

            await ports.calls.holdAll(admin.id, callId);

            const people = (await ports.calls.view(owner.id, callId)).people ?? [];

            expect(people.filter((one) => one.held).map((one) => one.who).sort()).toEqual([moderator.handle, member.handle, other.handle].sort());
            expect(people.find((one) => one.who === plain.handle)?.held, 'another admin').toBe(false);
            expect(await log(slug)).toEqual([{ kind: 'call', actor_handle: admin.handle, actor_role: 'admin', person_handle: null, details: { act: 'hold-all' } }]);

            rung = [];
            await ports.calls.holdAll(admin.id, callId);
            expect(rung, 'nobody left to hold').toEqual([]);
            expect(await log(slug)).toHaveLength(1);
            expect(await word(ports.calls.holdAll(member.id, callId))).toBe('403 call-right');
        });

        it('takes somebody out for good, somebody who had left included, and lets nobody take out whoever is at or above them', async () =>
        {
            const { owner, admin, member, other, slug, room, callId } = await staffed();

            await into(member, callId);

            const after = await ports.calls.remove(admin.id, callId, member.handle);
            const row = await rowOf(callId, member);

            expect(after.people?.map((one) => one.who), 'gone from it').not.toContain(member.handle);
            expect(row.removedAt).not.toBeNull();
            expect(row.goneAt).not.toBeNull();
            expect(row.leftAt, 'out of its room').not.toBeNull();
            expect(await word(ports.calls.join(member.id, callId))).toBe('403 call-removed');
            expect((await ports.calls.room(member.id, room)).call?.removed, 'the head says so to whoever was taken out').toBe(true);
            expect((await ports.calls.room(admin.id, room)).call, 'and to nobody else').not.toHaveProperty('removed');

            rung = [];
            await ports.calls.remove(admin.id, callId, member.handle);
            expect(rung, 'taken out twice').toEqual([]);

            await ports.calls.hangUp(other.id, callId);
            expect((await ports.calls.room(other.id, room)).call, 'somebody who left of their own accord may come back').not.toHaveProperty('removed');
            await ports.calls.remove(admin.id, callId, other.handle);
            expect(await word(ports.calls.join(other.id, callId)), 'somebody who had left').toBe('403 call-removed');
            expect((await ports.calls.room(other.id, room)).call?.removed).toBe(true);

            expect(await word(ports.calls.remove(admin.id, callId, owner.handle))).toBe('409 call-rank');
            expect(await word(ports.calls.remove(admin.id, callId, 'nobody.here'))).toBe('404 call-nobody');
            expect((await log(slug)).map((one) => [one.details.act, one.person_handle])).toEqual([['remove', member.handle], ['remove', other.handle]]);
        });

        it('holds somebody kept quiet in the group who is in its voice chat, and nobody who is not', async () =>
        {
            const owner = await makeUser();
            const member = await makeUser();
            const outside = await makeUser();
            const { slug, room } = await crew(owner, member, outside);

            const started = await ports.calls.ring(owner.id, room);
            await ports.calls.join(member.id, started.id);

            rung = [];
            await ports.group.mute(owner.id, slug, { id: member.handle });

            expect((await rowOf(started.id, member)).held).toBe(true);
            expect(rung).toEqual([{ callId: started.id, people: [member.id] }]);

            rung = [];
            await ports.group.mute(owner.id, slug, { id: outside.handle });
            expect(rung, 'not in it').toEqual([]);
        });

        it('answers an act on a voice chat that ended as ended, and on a call that is no voice chat as a call that is not there', async () =>
        {
            const { owner, admin, member, callId } = await staffed();
            const friend = await makeUser();

            await ports.calls.end(owner.id, callId);

            expect(await word(ports.calls.hold(admin.id, callId, member.handle, true))).toBe('409 call-ended');
            expect(await word(ports.calls.holdAll(admin.id, callId))).toBe('409 call-ended');
            expect(await word(ports.calls.remove(admin.id, callId, member.handle))).toBe('409 call-ended');

            await db.query(`insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)`, [owner.id, friend.id]);
            const direct = await ports.calls.ring(owner.id, await ports.chat.openDirect(owner.id, friend.handle));

            expect(await word(ports.calls.hand(owner.id, direct.id, true))).toBe('404 call-missing');
            expect(await word(ports.calls.hold(owner.id, direct.id, friend.handle, true))).toBe('404 call-missing');
        });
    });
});

/** Whether a voice chat runs in a room. */
async function callRoomOpen(room: string)
{
    return await db.getRepository(Call).existsBy({ conversationId: room, state: 'live' });
}

/** Asks until the answer is yes, for a few seconds. */
async function waitFor(ready: () => Promise<boolean>)
{
    const until = Date.now() + 5000;

    while (!await ready())
    {
        if (Date.now() > until)
        {
            throw new Error('it never got there');
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

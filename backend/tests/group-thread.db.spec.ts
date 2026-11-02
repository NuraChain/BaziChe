import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Notification, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, type SealedInput } from '../src/domains/chat/service.ts';
import { PINS_MOST, SWITCH_DEFAULTS } from '../src/domains/group/roles.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * A room's head and what the staff of a group may take out of it, against a real database: lines
 * pinned in a direct chat and in a group, by whoever may, twenty at most, carried on the first page
 * and gone with their line; and somebody else's line taken away by the owner, an admin with the right
 * or a moderator, never above their rank, written in the group's log and told to nobody.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

const rooms: string[] = [];

const listener: WriteListener = {
    chatChanged: (conversationId) =>
    {
        rooms.push(conversationId);
    },
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    callChanged: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

let db: DataSource;
let ports: Services;
let chat: ReturnType<typeof createChatService>;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `pn${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Pin ${ seq }`,
        hue: seq % 360,
        kind: 'wallet',
        allowStrangerMessages: true
    });

    return { id: made.id, handle: made.handle };
};

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

const group = (owner: Person) => ports.group.create(owner.id, {
    name: 'Pin Crew',
    blurb: '',
    crest: 'crest-crown',
    hue: 40,
    game: '',
    privacy: 'public'
});

const seat = async (slug: string, ...people: Person[]) =>
{
    for (const person of people)
    {
        await ports.group.join(person.id, slug);
    }
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

/** The envelope the schema requires and none of the cryptography, as `chat.db.spec.ts` does. */
const sealed = async (userId: string, conversationId: string, kind: SealedInput['kind'], options: { target?: string; expiresAt?: number } = {}): Promise<SealedInput> =>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `pn${ deviceOf.size.toString().padStart(20, '0') }`;
        await db.query(
            `insert into devices (id, user_id, label, exchange_key, signing_key, attested,
                                  attested_address, attested_message, attested_signature)
             values ($1, $2, 'Test', 'exchange', 'signing', 'wallet',
                     '0x0000000000000000000000000000000000000000', 'message', 'signature')`,
            [device, userId]
        );
        deviceOf.set(userId, device);
    }

    if (!minted.has(conversationId))
    {
        await db.query(
            `insert into conversation_epochs (conversation_id, epoch, minted_by, recipients, signature, confirmation)
             values ($1, 1, $2, $3, 'signature', 'confirmation')`,
            [conversationId, device, device]
        );
        minted.add(conversationId);
    }

    const key = `${ conversationId }:${ device }`;
    const next = (seqOf.get(key) ?? 0) + 1;
    seqOf.set(key, next);

    return {
        id: crypto.randomUUID(),
        epoch: 1,
        seq: next,
        iv: 'nonce',
        body: 'a sealed document',
        senderDeviceId: device,
        signature: 'signature',
        clientAt: new Date().toISOString(),
        kind,
        ...(options.target === undefined ? {} : { target: options.target }),
        commitment: 'a-commitment',
        expiresAt: options.expiresAt ?? 0
    };
};

const say = async (person: Person, conversationId: string, kind: 'text' | 'reaction' | 'edit' = 'text', target?: string) =>
    chat.send(person.id, conversationId, null, await sealed(person.id, conversationId, kind, target === undefined ? {} : { target }));

const voiced = async (person: Person, conversationId: string) =>
{
    const file = crypto.randomUUID();
    await chat.storeVoice(person.id, file, new Uint8Array(4096).fill(7));
    return chat.send(person.id, conversationId, null, { ...await sealed(person.id, conversationId, 'voice'), voice: file });
};

/** The room's pins as its first page carries them: the line, who pinned it. */
const pinsOf = async (person: Person, conversationId: string) =>
    ((await ports.chat.messages(person.id, conversationId, undefined)).pins ?? []).map((pin) => [pin.message.id, pin.by ?? null]);

const kindOf = async (messageId: string) =>
    ((await db.query('select kind from messages where id = $1', [messageId])) as { kind: string }[])[0]?.kind ?? null;

const logOf = async (slug: string, kind: string) =>
    await db.query(
        `select e.actor_handle, e.person_handle, e.details from group_events e join groups g on g.id = e.group_id
          where g.slug = $1 and e.kind = $2 order by e.created_at, e.id`,
        [slug, kind]
    ) as { actor_handle: string | null; person_handle: string | null; details: Record<string, string> }[];

const linesIn = async (conversationId: string) =>
    ((await db.query(`select payload ->> 'key' as key from messages where conversation_id = $1 and kind = 'system' order by created_at, id`, [conversationId])) as { key: string }[]).map((row) => row.key);

describe.skipIf(!active)('a room\'s pins, and a line the staff take away, against a real database', () =>
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
            await db.query('truncate table tables cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate table users cascade');
        await db.query('truncate table groups cascade');
        await db.query('truncate table conversations cascade');
        await db.query('truncate table tables cascade');
        ports = buildPorts(db, CONFIG, listener);
        chat = createChatService(db, createSocialService(db), createFranking(CONFIG.secret));
        rooms.length = 0;
        deviceOf.clear();
        seqOf.clear();
        minted.clear();
    });

    describe('a pin', () =>
    {
        it('is either person\'s in a direct chat, carried on the first page with who pinned it, and once however often', async () =>
        {
            const [a, b] = [await makeUser(), await makeUser()];
            const room = await chat.openDirect(a.id, b.id);
            const first = await say(a, room);
            const second = await say(b, room);

            await ports.chat.pinLine(b.id, room, first.id);
            await ports.chat.pinLine(a.id, room, second.id);
            await ports.chat.pinLine(a.id, room, second.id);

            expect(await pinsOf(a, room), 'newest first').toEqual([[second.id, a.handle], [first.id, b.handle]]);
            expect(await pinsOf(b, room)).toEqual([[second.id, a.handle], [first.id, b.handle]]);
            expect(rooms.filter((one) => one === room), 'a pin that changed nothing rings nobody').toHaveLength(2);
            expect(await linesIn(room), 'a direct chat writes no line').toEqual([]);

            const later = await ports.chat.messages(a.id, room, `99999999999999999|${ crypto.randomUUID() }`);
            expect(later.messages.map((line) => line.id), 'a page further back').toEqual([first.id, second.id]);
            expect(later.pins, 'carries no pins').toBeUndefined();

            await ports.chat.unpinLine(b.id, room, second.id);
            await ports.chat.unpinLine(b.id, room, second.id);
            expect(await pinsOf(a, room)).toEqual([[first.id, b.handle]]);
        });

        it('carries the newest edit of a line, and goes with a line taken away or run out', async () =>
        {
            const [a, b] = [await makeUser(), await makeUser()];
            const room = await chat.openDirect(a.id, b.id);
            const edited = await say(a, room);
            const edit = await say(a, room, 'edit', edited.id);
            const gone = await say(a, room);
            const brief = await chat.send(a.id, room, null, await sealed(a.id, room, 'text'));

            for (const line of [edited, gone, brief])
            {
                await ports.chat.pinLine(b.id, room, line.id);
            }

            const page = await ports.chat.messages(b.id, room, undefined, '1');
            expect(page.messages.map((line) => line.id), 'a page of the newest line alone').toEqual([brief.id]);
            expect(page.pins?.find((pin) => pin.message.id === edited.id)?.message.edits?.map((one) => one.id), 'a pin older than the page').toEqual([edit.id]);

            await ports.chat.remove(a.id, room, gone.id);
            await db.query(`update messages set expires_at = now() - interval '1 minute' where id = $1`, [brief.id]);

            expect(await pinsOf(b, room)).toEqual([[edited.id, b.handle]]);
            expect(await db.query('select message_id from conversation_pins'), 'a line taken away takes its pin').toHaveLength(2);
        });

        it('is refused for what is no line of the room: a reaction, a server line, another room\'s, one run out, and at a table', async () =>
        {
            const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
            const room = await chat.openDirect(a.id, b.id);
            const elsewhere = await chat.openDirect(a.id, c.id);
            const line = await say(a, room);
            const reaction = await say(b, room, 'reaction', line.id);
            const theirs = await say(a, elsewhere);
            const ran = await say(a, room);
            await db.query(`update messages set expires_at = now() - interval '1 minute' where id = $1`, [ran.id]);
            const server = await chat.post(room, 'system', { key: 'chat.line.expiry.off', params: {} }, null);

            for (const id of [reaction.id, server.id, theirs.id, ran.id, 'not-an-id'])
            {
                expect(await word(ports.chat.pinLine(b.id, room, id)), id).toBe('404 not-found');
            }
            expect(await word(ports.chat.pinLine(c.id, room, line.id)), 'somebody not in the room').toBe('404 not-found');

            const host = await makeUser();
            const table = await ports.table.create(host.id, {
                game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: []
            });
            const tableRoom = table.conversationId!;
            const said = await say(host, tableRoom);
            expect(await word(ports.chat.pinLine(host.id, tableRoom, said.id)), 'at a table').toBe('404 not-found');

            expect(await db.query('select 1 from conversation_pins')).toHaveLength(0);
        });

        it('holds twenty at most in a room, and an unpin makes room for another', async () =>
        {
            const [a, b] = [await makeUser(), await makeUser()];
            const room = await chat.openDirect(a.id, b.id);
            const lines = [];
            for (let at = 0; at <= PINS_MOST; at += 1)
            {
                lines.push(await say(a, room));
            }

            for (const line of lines.slice(0, PINS_MOST))
            {
                await ports.chat.pinLine(a.id, room, line.id);
            }
            expect(await word(ports.chat.pinLine(b.id, room, lines[PINS_MOST].id))).toBe('409 pins-full');

            await ports.chat.unpinLine(b.id, room, lines[0].id);
            await ports.chat.pinLine(b.id, room, lines[PINS_MOST].id);
            expect(await pinsOf(a, room)).toHaveLength(PINS_MOST);
        });

        it('in a group is the owner\'s, an admin\'s with the right, and a member\'s while the members may; logged, and said in the room', async () =>
        {
            const [owner, admin, bare, member] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, admin, bare, member);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['pin'] });
            await ports.group.role(owner.id, made.slug, { id: bare.handle, role: 'admin', rights: [] });
            const room = made.conversationId!;
            const lines = [await say(member, room), await say(member, room), await say(member, room)];

            expect(await word(ports.chat.pinLine(member.id, room, lines[0].id)), 'a member while they may not').toBe('403 group-right');
            expect(await word(ports.chat.pinLine(bare.id, room, lines[0].id)), 'an admin without the right').toBe('403 group-right');

            await ports.chat.pinLine(owner.id, room, lines[0].id);
            await ports.chat.pinLine(admin.id, room, lines[1].id);
            await ports.group.permissions(owner.id, made.slug, { switches: { ...SWITCH_DEFAULTS, pin: true }, approval: false });
            await ports.chat.pinLine(member.id, room, lines[2].id);
            await ports.chat.pinLine(member.id, room, lines[2].id);
            await ports.chat.unpinLine(admin.id, room, lines[0].id);
            await ports.chat.unpinLine(admin.id, room, lines[0].id);

            expect(await pinsOf(owner, room)).toEqual([[lines[2].id, member.handle], [lines[1].id, admin.handle]]);
            expect((await logOf(made.slug, 'pinned')).map((row) => [row.actor_handle, row.details.message])).toEqual([
                [owner.handle, lines[0].id], [admin.handle, lines[1].id], [member.handle, lines[2].id]
            ]);
            expect((await logOf(made.slug, 'unpinned')).map((row) => [row.actor_handle, row.details.message])).toEqual([[admin.handle, lines[0].id]]);
            expect((await linesIn(room)).filter((key) => key === 'chat.line.group.pinned'), 'a line a pin, none for the unpin').toHaveLength(3);
        });
    });

    describe('a line the staff take away', () =>
    {
        it('goes as its author\'s own would: its reactions, edits and pin with it, the log naming whose it was, the author told nothing', async () =>
        {
            const [owner, moderator, member, other] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, moderator, member, other);
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            const room = made.conversationId!;

            const line = await say(member, room);
            await say(other, room, 'reaction', line.id);
            await say(member, room, 'edit', line.id);
            await ports.chat.pinLine(owner.id, room, line.id);
            const before = (await db.getRepository(Notification).findBy({ userId: member.id })).length;

            await ports.chat.remove(moderator.id, room, line.id);

            expect(await kindOf(line.id)).toBe('deleted');
            expect(await db.query(`select 1 from messages where target_id = $1`, [line.id]), 'its reactions and edits').toHaveLength(0);
            expect(await pinsOf(owner, room)).toEqual([]);
            expect((await logOf(made.slug, 'deleted')).map((row) => [row.actor_handle, row.person_handle, row.details.message])).toEqual([[moderator.handle, member.handle, line.id]]);
            expect(await db.getRepository(Notification).findBy({ userId: member.id }), 'nobody tells the author').toHaveLength(before);
        });

        it('is the owner\'s, an admin\'s with the right and a moderator\'s, and of nobody at or above them', async () =>
        {
            const [owner, deleter, bare, moderator, member] = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, deleter, bare, moderator, member);
            await ports.group.role(owner.id, made.slug, { id: deleter.handle, role: 'admin', rights: ['delete'] });
            await ports.group.role(owner.id, made.slug, { id: bare.handle, role: 'admin', rights: [] });
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            const room = made.conversationId!;

            const ofMember = [await say(member, room), await say(member, room), await say(member, room)];
            const ofAdmin = await say(deleter, room);
            const ofOwner = await say(owner, room);

            expect(await word(ports.chat.remove(member.id, room, ofAdmin.id)), 'a member').toBe('403 group-right');
            expect(await word(ports.chat.remove(bare.id, room, ofMember[0].id)), 'an admin without the right').toBe('403 group-right');
            expect(await word(ports.chat.remove(moderator.id, room, ofAdmin.id)), 'a moderator, an admin\'s line').toBe('409 group-rank');
            expect(await word(ports.chat.remove(deleter.id, room, ofOwner.id)), 'an admin, the owner\'s line').toBe('409 group-rank');

            await ports.chat.remove(owner.id, room, ofMember[0].id);
            await ports.chat.remove(deleter.id, room, ofMember[1].id);
            await ports.chat.remove(moderator.id, room, ofMember[2].id);
            await ports.chat.remove(owner.id, room, ofAdmin.id);

            expect(await Promise.all([...ofMember, ofAdmin].map((line) => kindOf(line.id)))).toEqual(['deleted', 'deleted', 'deleted', 'deleted']);
            expect(await kindOf(ofOwner.id)).toBe('text');
            expect(await logOf(made.slug, 'deleted')).toHaveLength(4);
        });

        it('reaches somebody who left as a member, lets a voice message\'s file go, and is no part of a direct chat or a reaction', async () =>
        {
            const [owner, moderator, member, reactor] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, moderator, member, reactor);
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            const room = made.conversationId!;

            const spoken = await voiced(member, room);
            const line = await say(member, room);
            const reaction = await say(reactor, room, 'reaction', line.id);
            await ports.group.leave(member.id, made.slug);

            await ports.chat.remove(moderator.id, room, spoken.id);
            expect(await kindOf(spoken.id)).toBe('deleted');
            expect(await db.query('select 1 from voice_notes where id = $1', [spoken.voice_id]), 'its file').toHaveLength(0);

            expect(await word(ports.chat.remove(moderator.id, room, reaction.id)), 'somebody else\'s reaction').toBe('404 not-found');
            expect(await kindOf(reaction.id)).toBe('reaction');

            const [a, b] = [await makeUser(), await makeUser()];
            const direct = await chat.openDirect(a.id, b.id);
            const theirs = await say(a, direct);
            expect(await word(ports.chat.remove(b.id, direct, theirs.id)), 'a direct chat is its author\'s').toBe('404 not-found');
            expect(await kindOf(theirs.id)).toBe('text');
        });
    });

    describe('whose line it is', () =>
    {
        it('travels with a group\'s line where its author stands above a member, and with its pin', async () =>
        {
            const [owner, admin, moderator, member, leaver] = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, admin, moderator, member, leaver);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: [] });
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            const room = made.conversationId!;

            const lines = [await say(owner, room), await say(admin, room), await say(moderator, room), await say(member, room), await say(leaver, room)];
            await ports.group.leave(leaver.id, made.slug);
            await ports.chat.pinLine(owner.id, room, lines[1].id);
            await group(member);

            const page = await ports.chat.messages(member.id, room, undefined);
            const rankOf = (id: string) => page.messages.find((line) => line.id === id)?.rank ?? null;

            expect(lines.map((line) => rankOf(line.id)), 'the owner, an admin, a moderator, a member who owns another group, and somebody who left').toEqual(['owner', 'admin', 'moderator', null, null]);
            expect(page.pins?.map((pin) => pin.message.rank ?? null), 'a pin says it too').toEqual(['admin']);
            expect(page.messages.filter((line) => line.kind === 'system').map((line) => line.rank ?? null).filter((rank) => rank !== null), 'a line the server wrote names nobody').toEqual([]);
        });

        it('follows a change of place, and is said in no room but a group\'s', async () =>
        {
            const [owner, admin] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, admin);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: [] });
            const room = made.conversationId!;
            const line = await say(admin, room);
            const rankOf = async () => (await ports.chat.messages(owner.id, room, undefined)).messages.find((one) => one.id === line.id)?.rank ?? null;

            expect(await rankOf()).toBe('admin');

            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'member' });

            expect(await rankOf(), 'an admin made a member again').toBeNull();

            const [a, b] = [await makeUser(), await makeUser()];
            const direct = await chat.openDirect(a.id, b.id);
            await say(a, direct);

            expect((await ports.chat.messages(b.id, direct, undefined)).messages.map((one) => one.rank ?? null), 'a direct chat').toEqual([null]);
        });
    });
});

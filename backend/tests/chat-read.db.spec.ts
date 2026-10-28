import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService } from '../src/domains/chat/service.ts';
import { createNotifyService } from '../src/domains/notify/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * A line of mine and whether it was read: the newest read watermark among the others in the room,
 * on the wire beside the line and on the list's last line, and a doorbell to whoever's line a read
 * has just passed, because their ticks are what changed.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;
let chat: ReturnType<typeof createChatService>;
let seq = 0;

const rung: string[] = [];

const selves: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: (conversationId, userId) =>
    {
        rung.push(`${ conversationId }:${ userId }`);
    },
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        selves.push(`${ userId }:${ what }`);
    },
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `r${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Reader ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    return made.id;
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

/** Says something with the envelope the schema requires and none of the cryptography, as `chat.db.spec.ts` does. */
const say = async (userId: string, conversationId: string, body: string) =>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `rd${ deviceOf.size.toString().padStart(20, '0') }`;
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

    return chat.send(userId, conversationId, device, {
        id: crypto.randomUUID(),
        epoch: 1,
        seq: next,
        iv: 'nonce',
        body,
        senderDeviceId: device,
        signature: 'signature',
        clientAt: new Date().toISOString(),
        kind: 'text',
        commitment: 'a-commitment',
        expiresAt: 0
    });
};

const readOf = async (reader: string, conversationId: string) =>
    Object.fromEntries((await ports.chat.messages(reader, conversationId, undefined)).messages.map((line) => [line.body, line.read === true]));

const lastOf = async (reader: string, conversationId: string) =>
    (await ports.chat.list(reader)).conversations.find((row) => row.id === conversationId)?.last;

describe.skipIf(!active)('whether a line was read, against a real database', () =>
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
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate users cascade');
        await db.query('truncate conversations cascade');
        deviceOf.clear();
        seqOf.clear();
        minted.clear();
        rung.length = 0;
        selves.length = 0;
        chat = createChatService(db, createSocialService(db), createFranking(CONFIG.secret));
        ports = buildPorts(db, CONFIG, listener);
    });

    it('calls a line of the reader’s read once the other person has read up to it, and nobody else’s', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await say(a, conversation, 'are you there');

        expect(await readOf(a, conversation), 'nobody has read it yet').toEqual({ 'are you there': false });
        expect((await lastOf(a, conversation))?.read, 'nor says the list').toBeUndefined();

        await ports.chat.markRead(b, conversation);

        expect(await readOf(a, conversation)).toEqual({ 'are you there': true });
        expect((await lastOf(a, conversation))?.read).toBe(true);

        await ports.chat.markRead(a, conversation);

        expect(await readOf(b, conversation), 'a line is read only to whoever wrote it, whoever has read it').toEqual({ 'are you there': false });
        expect((await lastOf(b, conversation))?.read).toBeUndefined();
    });

    it('rings whoever’s line a read has just passed, and nobody for a read that passes nothing new', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await say(a, conversation, 'first');

        rung.length = 0;
        await ports.chat.markRead(b, conversation);

        expect(rung.sort(), 'the reader for their own list, and the writer for the ticks').toEqual([`${ conversation }:${ a }`, `${ conversation }:${ b }`].sort());

        rung.length = 0;
        await ports.chat.markRead(b, conversation);

        expect(rung, 'the reader alone, when nothing new was passed').toEqual([`${ conversation }:${ b }`]);
    });

    it('takes a reply as having read what it answers', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await say(a, conversation, 'question');
        await say(b, conversation, 'answer');

        expect(await readOf(a, conversation)).toEqual({ question: true, answer: false });
    });

    it('calls a line in a room of three read once any one of the others has read it', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const table = (await db.query(
            `insert into tables (game, code, host_id, seats, mode, privacy, target, cube, blinds, chat, voice, teams)
             values ('ludo', $2, $1, 3, 'live', 'public', 0, false, 'low', true, 'off', false)
             returning id`,
            [a, `r${ Math.floor(Math.random() * 1000000) }`]
        ) as { id: string }[])[0].id;
        const room = (await db.query(
            `insert into conversations (kind, table_id, game) values ('game', $1, 'ludo') returning id`,
            [table]
        ) as { id: string }[])[0].id;

        await db.query(
            'insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3), ($1, $4)',
            [room, a, b, c]
        );

        await say(a, room, 'to everybody');

        expect(await readOf(a, room)).toEqual({ 'to everybody': false });

        await ports.chat.markRead(c, room);

        expect(await readOf(a, room)).toEqual({ 'to everybody': true });
        expect(rung).toContain(`${ room }:${ a }`);
    });

    describe('the bell about a conversation, once it is read there', () =>
    {
        const told = async (to: string, from: string, conversationId: string) =>
        {
            await createNotifyService(db, createSocialService(db)).tellAll([to], {
                kind: 'message',
                actorId: from,
                ref: { conversationId },
                dedupeKey: `chat:${ conversationId }`
            });
        };

        const unreadOf = async (userId: string) =>
            (await db.query('select dedupe_key, kind from notifications where user_id = $1 and read_at is null', [userId]) as { dedupe_key: string; kind: string }[])
                .map((row) => `${ row.kind }:${ row.dedupe_key }`)
                .sort();

        it('reads the notification of a conversation the reader has read, and rings their bell', async () =>
        {
            const [a, b] = [await makeUser(), await makeUser()];
            const conversation = await chat.openDirect(a, b);

            await say(a, conversation, 'hello');
            await told(b, a, conversation);

            expect(await unreadOf(b)).toEqual([`message:chat:${ conversation }`]);

            await ports.chat.markRead(b, conversation);

            expect(await unreadOf(b), 'read where it happened, so the bell has nothing left to say').toEqual([]);
            expect(selves).toContain(`${ b }:notifications`);
        });

        it('leaves it unread when a line came after what was read, and rings nobody for nothing', async () =>
        {
            const [a, b] = [await makeUser(), await makeUser()];
            const conversation = await chat.openDirect(a, b);

            await ports.chat.markRead(b, conversation);
            await say(a, conversation, 'later');
            await told(b, a, conversation);

            expect(await unreadOf(b)).toEqual([`message:chat:${ conversation }`]);

            await db.query(
                "update notifications set created_at = now() + interval '1 minute' where user_id = $1",
                [b]
            );
            selves.length = 0;
            await ports.chat.markRead(b, conversation);

            expect(await unreadOf(b), 'told after the moment read up to: news the reader has not seen').toEqual([`message:chat:${ conversation }`]);
            expect(selves, 'nothing read, nobody rung').not.toContain(`${ b }:notifications`);
        });

        it('reads only that conversation’s notification, and only the reader’s', async () =>
        {
            const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
            const read = await chat.openDirect(a, b);
            const other = await chat.openDirect(c, b);
            const theirs = await chat.openDirect(a, c);

            await told(b, a, read);
            await told(b, c, other);
            await told(c, a, theirs);
            await told(a, b, read);
            await createNotifyService(db, createSocialService(db)).tell({ userId: b, kind: 'friend-request', actorId: c, ref: {}, dedupeKey: `chat:${ read }` });

            await ports.chat.markRead(b, read);

            expect(await unreadOf(b), 'another conversation stays unread, and so does another kind under the same key').toEqual(
                [`friend-request:chat:${ read }`, `message:chat:${ other }`].sort()
            );
            expect(await unreadOf(c), 'another reader’s bell is theirs').toEqual([`message:chat:${ theirs }`]);
            expect(await unreadOf(a), 'and so is the other side’s, about the same conversation').toEqual([`message:chat:${ read }`]);
        });
    });
});

import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { ChatFile, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, type SealedInput } from '../src/domains/chat/service.ts';
import { FILE_HOLD_MINUTES, FILE_SEALED_LEAST, FILE_SEALED_MOST } from '../src/domains/chat/files.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * A photo, a video or a file against a real database: kept as its sender's browser sealed it,
 * answered to whoever may fetch it and to nobody else, named by a message as a line is sent, and let
 * go with the last message that names it.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;
let chat: ReturnType<typeof createChatService>;
let seq = 0;

const changed: string[] = [];
const seen: string[] = [];

const listener: WriteListener = {
    chatChanged: (conversationId) =>
    {
        changed.push(conversationId);
    },
    chatSeen: (conversationId, userId) =>
    {
        seen.push(`${ conversationId }:${ userId }`);
    },
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
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

/** Small enough to reach in a spec. */
const LIMITS = { dayBytes: 64 * 1024, pending: 3 };

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `f${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Sender ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    return made.id;
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

/** The envelope the schema requires and none of the cryptography, as `chat.db.spec.ts` does. */
const sealed = async (userId: string, conversationId: string, kind: SealedInput['kind'], options: { target?: string; voice?: string; file?: string; expiresAt?: number } = {}): Promise<SealedInput> =>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `cf${ deviceOf.size.toString().padStart(20, '0') }`;
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
        ...(options.voice === undefined ? {} : { voice: options.voice }),
        ...(options.file === undefined ? {} : { file: options.file }),
        commitment: 'a-commitment',
        expiresAt: options.expiresAt ?? 0
    };
};

const sealedFile = (size = 4096, fill = 9) => new Uint8Array(size).fill(fill);

const upload = async (userId: string, size = 4096) =>
{
    const id = crypto.randomUUID();
    await chat.storeFile(userId, id, sealedFile(size));
    return id;
};

const sendFile = async (userId: string, conversationId: string, file: string, options: { expiresAt?: number } = {}) =>
    chat.send(userId, conversationId, null, await sealed(userId, conversationId, 'file', { file, ...options }));

const refusalOf = async (attempt: Promise<unknown>) =>
{
    try
    {
        await attempt;
        return null;
    }
    catch (error)
    {
        return { status: (error as { status?: number }).status ?? 0, code: (error as { code?: string }).code ?? '' };
    }
};

const fetchedBy = async (userId: string, id: string) => (await chat.file(userId, id)) !== null;

const filesHeld = async () => db.getRepository(ChatFile).count();

describe.skipIf(!active)('a photo, a video or a file, against a real database', () =>
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
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate users cascade');
        await db.query('truncate conversations cascade');
        await db.query('truncate chat_files cascade');
        deviceOf.clear();
        seqOf.clear();
        minted.clear();
        changed.length = 0;
        seen.length = 0;
        chat = createChatService(db, createSocialService(db), createFranking(CONFIG.secret), undefined, LIMITS);
        ports = buildPorts(db, CONFIG, listener);
    });

    it('keeps an upload under the id its browser chose, and the same upload again is the same file', async () =>
    {
        const a = await makeUser();
        const id = crypto.randomUUID();

        expect(await chat.storeFile(a, id, sealedFile(4096, 3)), 'kept').toEqual({ id, size: 4096, fresh: true });
        expect(await chat.storeFile(a, id, sealedFile(4096, 3)), 'a retry is the file already kept').toEqual({ id, size: 4096, fresh: false });
        expect(await filesHeld(), 'one file').toBe(1);
        expect(Buffer.from((await chat.file(a, id))!).equals(Buffer.from(sealedFile(4096, 3))), 'the bytes as they came').toBe(true);
    });

    it('refuses an id somebody else holds, an id that is not one, and a file too small or too large', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const id = await upload(a);

        expect(await refusalOf(chat.storeFile(b, id, sealedFile())), 'somebody else’s').toEqual({ status: 409, code: 'file-taken' });
        expect(await refusalOf(chat.storeFile(a, 'not-an-id', sealedFile())), 'no id').toEqual({ status: 404, code: 'file-missing' });
        expect(await refusalOf(chat.storeFile(a, crypto.randomUUID(), sealedFile(FILE_SEALED_LEAST - 1))), 'too small').toEqual({ status: 413, code: 'file-size' });
        expect(await refusalOf(chat.storeFile(a, crypto.randomUUID(), sealedFile(FILE_SEALED_MOST + 1))), 'too large').toEqual({ status: 413, code: 'file-size' });
        expect(await filesHeld(), 'nothing more kept').toBe(1);
    });

    it('holds an account to its day’s budget and to the files it has not sent yet', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);

        await sendFile(a, room, await upload(a, 40 * 1024));

        expect(await refusalOf(chat.storeFile(a, crypto.randomUUID(), sealedFile(30 * 1024))), 'over the day').toEqual({ status: 429, code: 'file-budget' });

        const answers = await Promise.all(Array.from({ length: 5 }, () => refusalOf(chat.storeFile(a, crypto.randomUUID(), sealedFile(1024)))));

        expect(answers.filter((one) => one === null), 'as many as may wait').toHaveLength(LIMITS.pending);
        expect(answers.filter((one) => one !== null), 'the rest refused').toEqual(Array.from({ length: 5 - LIMITS.pending }, () => ({ status: 429, code: 'file-pending' })));
    });

    it('answers a file to its uploader and to the room that holds a message naming it, and to nobody else', async () =>
    {
        const [a, b, stranger] = [await makeUser(), await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const id = await upload(a);

        expect(await fetchedBy(a, id), 'the uploader, before it is sent').toBe(true);
        expect(await fetchedBy(b, id), 'nobody else before it is sent').toBe(false);

        const sent = await sendFile(a, room, id);

        expect(sent.file_id, 'the message names it').toBe(id);
        expect(await fetchedBy(b, id), 'the room, once it is sent').toBe(true);
        expect(await fetchedBy(stranger, id), 'a stranger').toBe(false);
        expect(await fetchedBy(b, 'not-an-id'), 'no id').toBe(false);
        expect((await ports.chat.messages(b, room, undefined)).messages.find((one) => one.id === sent.id)?.file, 'the wire names it').toBe(id);
    });

    it('refuses a message naming a file its sender may not fetch, a file on a line, and a voice file id as a file', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const elsewhere = await chat.openDirect(c, b);
        const theirs = await upload(c);

        await sendFile(c, elsewhere, theirs);

        expect(await refusalOf(sendFile(a, room, theirs)), 'a file of a room they are not in').toEqual({ status: 404, code: 'file-missing' });
        expect(await refusalOf(chat.send(a, room, null, await sealed(a, room, 'text', { file: await upload(a) }))), 'a line names no file').toMatchObject({ status: 400 });
        expect(await refusalOf(chat.send(a, room, null, await sealed(a, room, 'file'))), 'a file message names one').toEqual({ status: 404, code: 'file-missing' });
    });

    it('lets a member forward a file they may fetch, which references it rather than copying it', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const first = await chat.openDirect(a, b);
        const second = await chat.openDirect(b, c);
        const id = await upload(a);

        await sendFile(a, first, id);
        await sendFile(b, second, id);

        expect(await fetchedBy(c, id), 'where it was forwarded').toBe(true);
        expect(await filesHeld(), 'one file').toBe(1);
    });

    it('lets a file go with the last message naming it, deleted or run out, and keeps it while another names it', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const first = await chat.openDirect(a, b);
        const second = await chat.openDirect(b, c);
        const id = await upload(a);

        const original = await sendFile(a, first, id);
        const forwarded = await sendFile(b, second, id);

        await chat.remove(a, first, original.id);
        expect(await filesHeld(), 'kept while the forward names it').toBe(1);
        expect(await fetchedBy(a, id), 'its uploader still may').toBe(true);

        await chat.remove(b, second, forwarded.id);
        expect(await filesHeld(), 'gone with the last').toBe(0);

        const brief = await upload(a);

        await db.query('update conversations set expire_after = 60 where id = $1', [first]);
        const sent = await sendFile(a, first, brief, { expiresAt: Date.now() + 60_000 });

        await db.query(`update messages set expires_at = now() - interval '1 second' where id = $1`, [sent.id]);
        await chat.sweepExpired();
        expect(await filesHeld(), 'gone when its message ran out').toBe(0);
    });

    it('lets go of an upload nobody sent once it is older than the hold, and keeps the rest', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const old = await upload(a);
        const sent = await upload(a);
        const fresh = await upload(a);

        await sendFile(a, room, sent);
        await db.query(`update chat_files set created_at = now() - make_interval(mins => $1) where id in ($2, $3)`, [FILE_HOLD_MINUTES + 1, old, sent]);

        expect(await chat.sweepFiles(), 'one let go').toBe(1);
        expect(await fetchedBy(a, old), 'the old upload').toBe(false);
        expect(await fetchedBy(a, sent), 'the sent one').toBe(true);
        expect(await fetchedBy(a, fresh), 'the fresh one').toBe(true);
    });
});

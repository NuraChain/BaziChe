import 'reflect-metadata';

import { createHmac, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { ChatFile, Notification, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, type SealedInput } from '../src/domains/chat/service.ts';
import { FILE_HOLD_MINUTES, FILE_SEALED_LEAST, FILE_SEALED_MOST, type FileAs } from '../src/domains/chat/files.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { firstRow, rowsOf } from '../src/lib/rows.ts';
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
const sealed = async (userId: string, conversationId: string, kind: SealedInput['kind'], options: { target?: string; voice?: string; file?: string; fileAs?: FileAs | null; expiresAt?: number } = {}): Promise<SealedInput> =>
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
        ...(options.fileAs === null || (kind !== 'file' && options.fileAs === undefined) ? {} : { fileAs: options.fileAs ?? 'photo' }),
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

    it('keeps what each file was sent as, hands it back with the line, and refuses a file message that does not say', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const photo = await sendFile(a, room, await upload(a));
        const document = await chat.send(a, room, null, await sealed(a, room, 'file', { file: await upload(a), fileAs: 'file' }));
        const page = (await ports.chat.messages(b, room, undefined)).messages;

        expect([photo.file_as, document.file_as]).toEqual(['photo', 'file']);
        expect(page.find((one) => one.id === photo.id)?.fileAs, 'the wire says it').toBe('photo');
        expect(page.find((one) => one.id === document.id)?.fileAs).toBe('file');
        expect((await ports.chat.list(b)).conversations.find((one) => one.id === room)?.last?.fileAs, 'and the list’s last line').toBe('file');

        expect(await refusalOf(chat.send(a, room, null, await sealed(a, room, 'file', { file: await upload(a), fileAs: null }))), 'a file that does not say').toMatchObject({ status: 400 });
        expect(await refusalOf(chat.send(a, room, null, await sealed(a, room, 'text', { fileAs: 'photo' }))), 'a line was sent as nothing').toMatchObject({ status: 400 });

        await chat.remove(a, room, photo.id);
        expect(rowsOf<{ kind: string; file_as: string | null }>(await db.query('select kind, file_as from messages where id = $1', [photo.id]))[0], 'a tombstone says nothing').toEqual({ kind: 'deleted', file_as: null });
    });

    it('holds what a row was sent as to its kind, and an album to photos and videos, whoever writes it', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const photo = await sendFile(a, room, await upload(a));
        const line = await chat.send(a, room, null, await sealed(a, room, 'text'));
        const broken = async (sql: string, params: unknown[]) =>
            db.query(sql, params).then(() => null, (error: { code?: string; constraint?: string }) => error.constraint ?? error.code ?? 'refused');

        expect(await broken('update messages set file_as = null where id = $1', [photo.id]), 'a file says what it was sent as').toBe('messages_file_says_as');
        expect(await broken(`update messages set file_as = 'sticker' where id = $1`, [photo.id]), 'one of three').toBe('messages_file_as_known');
        expect(await broken(`update messages set file_as = 'photo' where id = $1`, [line.id]), 'a line was sent as nothing').toBe('messages_file_says_as');
        expect(await broken('update messages set album_id = gen_random_uuid() where id = $1', [line.id]), 'a line is in no album').toBe('messages_album_is_media');

        await db.query('update messages set album_id = gen_random_uuid() where id = $1', [photo.id]);

        expect(await broken(`update messages set file_as = 'file' where id = $1`, [photo.id]), 'an album holds photos and videos alone').toBe('messages_album_is_media');
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

    it('keeps a reported file for the staff when its message is deleted, and answers it to them and to nobody else', async () =>
    {
        const [a, b, staff] = [await makeUser(), await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const id = await upload(a);
        const frankingKey = randomBytes(32).toString('base64url');
        const document = JSON.stringify({ file: { id } });
        const commitment = createHmac('sha256', Buffer.from(frankingKey, 'base64url')).update(document, 'utf8').digest('base64url');
        const sent = await chat.send(a, room, null, { ...await sealed(a, room, 'file', { file: id }), commitment });
        const handle = (await db.getRepository(User).findOneByOrFail({ id: a })).handle;
        const reported = await ports.social.report(b, handle, 'harassment', { conversationId: room, messageId: sent.id, text: document, frankingKey });
        const unseen = await ports.social.report(b, handle, 'spam');

        expect(firstRow<{ file_id: string }>(await db.query('select file_id from reports where id = $1', [reported]))?.file_id, 'kept beside what it disclosed').toBe(id);

        await chat.remove(a, room, sent.id);

        expect(await filesHeld(), 'deleting the message keeps the file').toBe(1);
        expect(await fetchedBy(b, id), 'which the room no longer fetches').toBe(false);

        await db.query(`insert into staff_members (user_id, role) values ($1, 'moderator')`, [staff]);

        expect(await ports.admin.reportFile(staff, reported), 'to whoever reads the reports').toEqual(sealedFile());
        expect(await ports.admin.reportFile(b, reported), 'and to nobody else').toBeNull();
        expect(await ports.admin.reportFile(staff, unseen), 'a report that disclosed none').toBeNull();
        expect(await ports.admin.reportFile(staff, 'not-a-report'), 'an id that is none').toBeNull();
        expect(await ports.admin.reportVoice(staff, reported), 'nor is a file a voice message').toBeNull();
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
    describe('an album, and the gallery', () =>
    {
        /** A service whose limits let an album of ten wait to be sent. */
        const roomy = () => createChatService(db, createSocialService(db), createFranking(CONFIG.secret), undefined, { dayBytes: 64 * 1024 * 24, pending: 16 });

        const items = async (service: ReturnType<typeof roomy>, userId: string, conversationId: string, kinds: readonly ('photo' | 'video')[]) =>
        {
            const made: SealedInput[] = [];

            for (const kind of kinds)
            {
                const file = crypto.randomUUID();
                await service.storeFile(userId, file, sealedFile());
                made.push(await sealed(userId, conversationId, 'file', { file, fileAs: kind }));
            }
            return made;
        };

        const messagesIn = async (conversationId: string) => Number(rowsOf<{ n: string }>(await db.query('select count(*) as n from messages where conversation_id = $1', [conversationId]))[0].n);

        it('writes two to ten photos and videos as one album, in the order chosen, and counts each for the room', async () =>
        {
            const [a, b] = [await makeUser(), await makeUser()];
            const service = roomy();
            const room = await service.openDirect(a, b);
            const album = crypto.randomUUID();
            const asked = await service.send(b, room, null, await sealed(b, room, 'text'));
            const sent = await items(service, a, room, ['photo', 'video', 'photo']);

            const { messages } = await ports.chat.sendAlbum(a, crypto.randomUUID(), room, { album, messages: sent });

            expect(messages.map((one) => one.id), 'in the order chosen').toEqual(sent.map((one) => one.id));
            expect(messages.map((one) => [one.album, one.fileAs])).toEqual([[album, 'photo'], [album, 'video'], [album, 'photo']]);

            const stored = rowsOf<{ id: string; at: string }>(await db.query(`select id, (extract(epoch from created_at) * 1000000)::bigint::text as at from messages where album_id = $1 order by created_at, id`, [album]));

            expect(stored.map((one) => one.id), 'each at its own instant, so the thread keeps the order').toEqual(sent.map((one) => one.id));
            expect(new Set(stored.map((one) => one.at)).size).toBe(3);

            const page = (await ports.chat.messages(b, room, undefined)).messages;

            expect(page.filter((one) => one.album === album).map((one) => one.id), 'the reader is handed the album').toEqual(sent.map((one) => one.id));
            expect((await db.getRepository(Notification).findOneByOrFail({ userId: b, dedupeKey: `chat:${ room }` })).count, 'the room counts each item').toBe(3);
            expect((await ports.chat.list(a)).conversations.find((one) => one.id === room)?.unread, 'nothing of it unread to its sender').toBe(0);
            expect(page.find((one) => one.id === asked.id)?.read, 'sending it read what came before it').toBe(true);
        });

        it('refuses an album that is not one, and writes nothing of it', async () =>
        {
            const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
            const service = roomy();
            const room = await service.openDirect(a, b);
            const before = await messagesIn(room);
            const two = await items(service, a, room, ['photo', 'photo']);
            const send = (album: string, inputs: SealedInput[]) => refusalOf(service.sendAlbum(a, room, null, album, inputs));

            expect(await send(crypto.randomUUID(), two.slice(0, 1)), 'one is no album').toMatchObject({ status: 400 });
            expect(await send(crypto.randomUUID(), await items(service, a, room, ['photo', 'photo', 'photo', 'photo', 'photo', 'photo', 'photo', 'photo', 'photo', 'photo', 'photo'])), 'eleven is too many').toMatchObject({ status: 400 });
            expect(await send('an-album', two), 'an id that is no uuid').toMatchObject({ status: 400 });
            expect(await send(crypto.randomUUID(), [two[0], { ...two[1], fileAs: 'file' }]), 'a file in an album').toMatchObject({ status: 400 });
            expect(await send(crypto.randomUUID(), [two[0], await sealed(a, room, 'text')]), 'a line in an album').toMatchObject({ status: 400 });
            expect(await send(crypto.randomUUID(), [two[0], { ...two[1], id: two[0].id }]), 'one message twice').toMatchObject({ status: 400 });

            const theirs = crypto.randomUUID();
            await service.storeFile(c, theirs, sealedFile());

            expect(await send(crypto.randomUUID(), [two[0], await sealed(a, room, 'file', { file: theirs, fileAs: 'photo' })]), 'somebody else’s file').toEqual({ status: 404, code: 'file-missing' });
            expect(await messagesIn(room), 'nothing of any of them written').toBe(before);

            const album = crypto.randomUUID();
            await service.sendAlbum(a, room, null, album, two);

            expect(await send(album, await items(service, a, room, ['photo', 'video'])), 'an album id already sent').toMatchObject({ status: 409 });
        });

        it('holds every item to what the group lets its members send', async () =>
        {
            const [owner, member] = [await makeUser(), await makeUser()];
            const service = roomy();
            const made = await ports.group.create(owner, { name: `Album crew ${ Math.floor(Math.random() * 100000) }`, blurb: '', crest: 'crest-moon', hue: 200, game: '', privacy: 'public' });
            const slug = made.id;

            await ports.group.join(member, slug);

            const room = rowsOf<{ id: string }>(await db.query(`select c.id from conversations c join groups g on g.id = c.group_id where g.slug = $1 and c.kind = 'group'`, [slug]))[0].id;

            await db.query(`update groups set members_media = false where slug = $1`, [slug]);

            expect(await refusalOf(service.sendAlbum(member, room, null, crypto.randomUUID(), await items(service, member, room, ['photo', 'video']))), 'media kept to the staff').toMatchObject({ status: 403 });
        });

        it('takes an album away whole, its files with it, and never somebody else’s', async () =>
        {
            const [a, b] = [await makeUser(), await makeUser()];
            const service = roomy();
            const room = await service.openDirect(a, b);
            const album = crypto.randomUUID();
            const sent = await items(service, a, room, ['photo', 'photo', 'video']);

            await service.sendAlbum(a, room, null, album, sent);

            const held = await filesHeld();

            expect(await refusalOf(service.removeAlbum(b, room, album)), 'not theirs to take').toMatchObject({ status: 404 });
            expect(await refusalOf(service.removeAlbum(a, room, crypto.randomUUID())), 'no album there').toMatchObject({ status: 404 });
            expect(await refusalOf(service.removeAlbum(a, room, 'nonsense')), 'no album there').toMatchObject({ status: 404 });

            await service.removeAlbum(a, room, album);

            const left = rowsOf<{ kind: string; album_id: string | null; file_id: string | null }>(await db.query('select kind, album_id, file_id from messages where id = any($1)', [sent.map((one) => one.id)]));

            expect(left, 'every item a tombstone').toEqual(sent.map(() => ({ kind: 'deleted', album_id: null, file_id: null })));
            expect(await filesHeld(), 'its files let go').toBe(held - 3);
        });

        it('lists a room’s photos and videos, its files and its voice apart, newest first, a page at a time', async () =>
        {
            const [a, b, stranger] = [await makeUser(), await makeUser(), await makeUser()];
            const service = roomy();
            const room = await service.openDirect(a, b);
            const album = await items(service, a, room, ['photo', 'video']);

            await service.sendAlbum(a, room, null, crypto.randomUUID(), album);

            const document = crypto.randomUUID();
            await service.storeFile(a, document, sealedFile());
            const filed = await service.send(a, room, null, await sealed(a, room, 'file', { file: document, fileAs: 'file' }));

            const voice = crypto.randomUUID();
            await service.storeVoice(a, voice, new Uint8Array(512).fill(3));
            const spoken = await service.send(a, room, null, await sealed(a, room, 'voice', { voice }));

            await service.send(a, room, null, await sealed(a, room, 'text'));

            const read = async (kind: 'media' | 'files' | 'voice', cursor?: string) => ports.chat.media(b, room, kind, cursor);

            expect((await read('media')).messages.map((one) => one.id), 'photos and videos, newest first').toEqual([album[1].id, album[0].id]);
            expect((await read('files')).messages.map((one) => one.id)).toEqual([filed.id]);
            expect((await read('voice')).messages.map((one) => one.id)).toEqual([spoken.id]);
            expect(await refusalOf(ports.chat.media(stranger, room, 'media', undefined)), 'a stranger is answered as nothing').toMatchObject({ status: 404 });

            await db.query(`update messages set expires_at = now() - interval '1 second' where id = $1`, [filed.id]);
            expect((await read('files')).messages, 'what has run out is gone').toEqual([]);

            // Fifty-two photos more, the two that meet at the page's edge a microsecond apart.
            await db.query(
                `insert into messages (id, conversation_id, sender_id, kind, body, epoch, seq, iv, sender_device_id, signature, client_at,
                                       commitment, frank, file_id, file_as, created_at)
                 select gen_random_uuid(), m.conversation_id, m.sender_id, 'file', m.body, m.epoch, 1000 + n, m.iv, m.sender_device_id,
                        m.signature, m.client_at, m.commitment, m.frank, m.file_id, 'photo',
                        timestamptz '2026-01-01' + make_interval(secs => case when n = 5 then 4 else n end) + (case when n = 5 then interval '1 microsecond' else interval '0' end)
                 from messages m, generate_series(1, 52) n
                 where m.id = $1`,
                [album[0].id]
            );

            const first = await read('media');
            const second = await read('media', first.cursor);
            const all = [...first.messages, ...second.messages];

            expect(first.messages, 'fifty a page').toHaveLength(50);
            expect(first.cursor, 'and a way to the rest').toBeDefined();
            expect(second.cursor, 'and none past the end').toBeUndefined();
            expect(new Set(all.map((one) => one.id)).size, 'every one once, across a millisecond').toBe(54);
        });
    });
});

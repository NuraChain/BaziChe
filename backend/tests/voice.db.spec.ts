import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { User, VoiceNote, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, type SealedInput } from '../src/domains/chat/service.ts';
import { VOICE_FILE_LEAST, VOICE_FILE_MOST, VOICE_HOLD_MINUTES } from '../src/domains/chat/voice.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { firstRow } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * A voice message against a real database: its file kept as its sender's browser sealed it, answered
 * to whoever may hear it and to nobody else, named by a message as a line is sent, let go with the
 * last message that names it, and marked played.
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
        handle: `v${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Speaker ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    return made.id;
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

/** The envelope the schema requires and none of the cryptography, as `chat.db.spec.ts` does. */
const sealed = async (userId: string, conversationId: string, kind: SealedInput['kind'], options: { target?: string; voice?: string; expiresAt?: number } = {}): Promise<SealedInput> =>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `vo${ deviceOf.size.toString().padStart(20, '0') }`;
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
        commitment: 'a-commitment',
        expiresAt: options.expiresAt ?? 0
    };
};

const recording = (size = 4096, fill = 9) => new Uint8Array(size).fill(fill);

const upload = async (userId: string, size = 4096) =>
{
    const id = crypto.randomUUID();
    await chat.storeVoice(userId, id, recording(size));
    return id;
};

const speak = async (userId: string, conversationId: string, voice: string) =>
    chat.send(userId, conversationId, null, await sealed(userId, conversationId, 'voice', { voice }));

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

const heardBy = async (userId: string, id: string) => (await chat.voiceFile(userId, id)) !== null;

const pageOf = async (reader: string, conversationId: string) => (await ports.chat.messages(reader, conversationId, undefined)).messages;

const filesHeld = async () => db.getRepository(VoiceNote).count();

describe.skipIf(!active)('a voice message, against a real database', () =>
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
        await db.query('truncate voice_notes cascade');
        deviceOf.clear();
        seqOf.clear();
        minted.clear();
        changed.length = 0;
        seen.length = 0;
        chat = createChatService(db, createSocialService(db), createFranking(CONFIG.secret), LIMITS);
        ports = buildPorts(db, CONFIG, listener);
    });

    it('keeps an upload under the id its browser chose, and the same upload again is the same file', async () =>
    {
        const a = await makeUser();
        const id = crypto.randomUUID();

        expect(await chat.storeVoice(a, id, recording(4096, 3)), 'kept').toEqual({ id, size: 4096, fresh: true });
        expect(await chat.storeVoice(a, id, recording(4096, 3)), 'a retry is the file already kept').toEqual({ id, size: 4096, fresh: false });
        expect(await filesHeld(), 'one file').toBe(1);
        expect(Buffer.from((await chat.voiceFile(a, id))!).equals(Buffer.from(recording(4096, 3))), 'the bytes as they came').toBe(true);
    });

    it('refuses an id somebody else holds, an id that is not one, and a file too small or too large', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const id = await upload(a);

        expect(await refusalOf(chat.storeVoice(b, id, recording())), 'somebody else’s').toEqual({ status: 409, code: 'voice-taken' });
        expect(await refusalOf(chat.storeVoice(a, 'not-an-id', recording())), 'no id').toEqual({ status: 404, code: 'voice-missing' });
        expect(await refusalOf(chat.storeVoice(a, crypto.randomUUID(), recording(VOICE_FILE_LEAST - 1))), 'too small').toEqual({ status: 413, code: 'voice-size' });
        expect(await refusalOf(chat.storeVoice(a, crypto.randomUUID(), recording(VOICE_FILE_MOST + 1))), 'too large').toEqual({ status: 413, code: 'voice-size' });
        expect(await filesHeld(), 'nothing more kept').toBe(1);
    });

    it('holds an account to its day’s budget, counting only the last day', async () =>
    {
        const a = await makeUser();
        const old = await upload(a, 40 * 1024);

        await db.query(`update voice_notes set created_at = now() - interval '25 hours' where id = $1`, [old]);
        await upload(a, 40 * 1024);

        expect(await refusalOf(chat.storeVoice(a, crypto.randomUUID(), recording(30 * 1024))), 'over the day').toEqual({ status: 429, code: 'voice-budget' });
        expect(await refusalOf(chat.storeVoice(a, crypto.randomUUID(), recording(20 * 1024))), 'within it').toBeNull();
    });

    it('holds an account to the files it has not sent yet, one upload after another however many come at once', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);

        await speak(a, room, await upload(a));

        const answers = await Promise.all(Array.from({ length: 6 }, () => refusalOf(chat.storeVoice(a, crypto.randomUUID(), recording()))));

        expect(answers.filter((one) => one === null), 'as many as may wait').toHaveLength(LIMITS.pending);
        expect(answers.filter((one) => one !== null), 'the rest refused').toEqual(Array(6 - LIMITS.pending).fill({ status: 429, code: 'voice-pending' }));
    });

    it('answers a file to its uploader before it is sent, and to nobody else', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        await chat.openDirect(a, b);
        const id = await upload(a);

        expect(await heardBy(a, id), 'its uploader').toBe(true);
        expect(await heardBy(b, id), 'not yet the room').toBe(false);
        expect(await heardBy(a, 'not-an-id'), 'no id').toBe(false);
        expect(await heardBy(a, crypto.randomUUID()), 'no file').toBe(false);
    });

    it('answers a sent file to the room, and never to a stranger, across a block, or once its message is deleted or has run out', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const said = await upload(a);
        const spoken = await speak(a, room, said);

        expect(await heardBy(b, said), 'the room').toBe(true);
        expect(await heardBy(c, said), 'a stranger').toBe(false);

        await db.query('insert into blocks (user_id, blocked_id) values ($1, $2)', [b, a]);
        expect(await heardBy(b, said), 'across a block').toBe(false);
        await db.query('delete from blocks');
        expect(await heardBy(b, said), 'the block lifted').toBe(true);

        await db.query(`update messages set expires_at = now() - interval '1 second' where id = $1`, [spoken.id]);
        expect(await heardBy(b, said), 'run out, before the sweep').toBe(false);

        await db.query('update messages set expires_at = null where id = $1', [spoken.id]);
        await chat.remove(a, room, spoken.id);
        expect(await heardBy(b, said), 'deleted').toBe(false);
        expect(await heardBy(a, said), 'the file went with it').toBe(false);
        expect(await filesHeld(), 'nothing kept').toBe(0);
    });

    it('lets a sender name only a file they may hear, and a forward reuse the file it heard', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const elsewhere = await chat.openDirect(b, c);
        const unsent = await upload(a);

        expect(await refusalOf(speak(b, room, unsent)), 'somebody else’s upload').toEqual({ status: 404, code: 'voice-missing' });
        expect(await refusalOf(speak(c, elsewhere, unsent)), 'from outside the room').toEqual({ status: 404, code: 'voice-missing' });

        await speak(a, room, unsent);
        const forwarded = await speak(b, elsewhere, unsent);

        expect(forwarded.voice_id, 'the same file').toBe(unsent);
        expect(await heardBy(c, unsent), 'heard where it was forwarded').toBe(true);
        expect(await filesHeld(), 'kept once').toBe(1);
    });

    it('refuses a voice message naming no file, a line of words naming one, and a voice message about another message', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const said = await upload(a);
        const line = await chat.send(a, room, null, await sealed(a, room, 'text'));

        expect(await refusalOf(chat.send(a, room, null, await sealed(a, room, 'voice'))), 'no file').toEqual({ status: 404, code: 'voice-missing' });
        expect(await refusalOf(chat.send(a, room, null, await sealed(a, room, 'voice', { voice: 'not-an-id' }))), 'no id').toEqual({ status: 404, code: 'voice-missing' });
        expect((await refusalOf(chat.send(a, room, null, await sealed(a, room, 'text', { voice: said }))))?.status, 'words naming a file').toBe(400);
        expect((await refusalOf(chat.send(a, room, null, await sealed(a, room, 'voice', { voice: said, target: line.id }))))?.status, 'about a line').toBe(400);
        expect((await refusalOf(chat.send(a, room, null, await sealed(a, room, 'reaction', { voice: said, target: line.id }))))?.status, 'a reaction naming a file').toBe(400);
    });

    it('deletes a voice message as a tombstone naming no file, keeping the file while a forward still names it', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const elsewhere = await chat.openDirect(b, c);
        const said = await upload(a);
        const spoken = await speak(a, room, said);
        const forwarded = await speak(b, elsewhere, said);

        await chat.remove(a, room, spoken.id);

        const page = await pageOf(b, room);

        expect(page.map((one) => [one.kind, one.voice, one.body]), 'a tombstone in its place, as any deleted line leaves').toEqual([['deleted', undefined, undefined]]);
        expect((await db.query('select kind, voice_id from messages where id = $1', [spoken.id]))[0], 'a tombstone').toEqual({ kind: 'deleted', voice_id: null });
        expect(await heardBy(c, said), 'the forward still plays').toBe(true);

        await chat.remove(b, elsewhere, forwarded.id);
        expect(await filesHeld(), 'gone with the last message naming it').toBe(0);
    });

    it('lets the sweeps take a file once no message names it, and only then', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const expiring = await upload(a);
        const spoken = await speak(a, room, expiring);
        const named = await upload(a);
        await speak(a, room, named);
        const forgotten = await upload(a);

        await db.query(`update messages set expires_at = now() - interval '1 second' where id = $1`, [spoken.id]);

        expect(await chat.sweepExpired(), 'the run-out message').toBe(1);
        expect(await heardBy(a, expiring), 'its file with it').toBe(false);

        expect(await chat.sweepVoice(), 'nothing old enough yet').toBe(0);

        await db.query(`update voice_notes set created_at = now() - make_interval(mins => $1 + 1)`, [VOICE_HOLD_MINUTES]);

        expect(await chat.sweepVoice(), 'only the upload nobody sent').toBe(1);
        expect(await heardBy(a, forgotten), 'gone').toBe(false);
        expect(await heardBy(b, named), 'the named one stays').toBe(true);
    });

    it('counts a voice message as a line: unread, the list’s last line naming its file, a notification and the room rung', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const said = await upload(a);

        await ports.chat.send(a, '00000000-0000-4000-8000-000000000000', room, await sealed(a, room, 'voice', { voice: said }));

        const row = (await ports.chat.list(b)).conversations.find((one) => one.id === room);

        expect(row?.unread, 'unread').toBe(1);
        expect([row?.last?.kind, row?.last?.voice], 'the last line, naming its file').toEqual(['voice', said]);
        expect((await ports.notify.page(b, undefined)).items.map((one) => one.kind), 'told').toEqual(['message']);
        expect(changed, 'the room rung').toContain(room);
    });

    it('carries the file, reactions and the reader’s played mark on the page', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const room = firstRow<{ id: string }>(await db.query("insert into conversations (kind) values ('group') returning id"))!.id;

        await db.query('insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3), ($1, $4)', [room, a, b, c]);

        const said = await upload(a);
        const spoken = await speak(a, room, said);

        await chat.send(b, room, null, await sealed(b, room, 'reaction', { target: spoken.id }));

        const before = (await pageOf(b, room)).find((one) => one.id === spoken.id);

        expect([before?.voice, before?.reactions?.length, before?.played], 'named, reacted to, not played').toEqual([said, 1, undefined]);

        seen.length = 0;
        await ports.chat.played(b, room, spoken.id);

        expect((await pageOf(b, room)).find((one) => one.id === spoken.id)?.played, 'played by the reader').toBe(true);
        expect((await pageOf(c, room)).find((one) => one.id === spoken.id)?.played, 'not by another').toBeUndefined();
        expect((await pageOf(a, room)).find((one) => one.id === spoken.id)?.heard, 'heard, for its sender').toBe(true);
        expect(seen, 'the reader and the sender rung').toEqual([`${ room }:${ b }`, `${ room }:${ a }`]);

        seen.length = 0;
        await ports.chat.played(c, room, spoken.id);
        await ports.chat.played(c, room, spoken.id);
        expect(seen, 'a later play rings only the reader').toEqual([`${ room }:${ c }`, `${ room }:${ c }`]);

        await ports.chat.played(a, room, spoken.id);
        expect((await pageOf(a, room)).find((one) => one.id === spoken.id)?.played, 'a sender’s own play is never marked').toBeUndefined();
    });

    it('refuses a played mark outside the room, on a line of words, and on what is not there', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const spoken = await speak(a, room, await upload(a));
        const line = await chat.send(a, room, null, await sealed(a, room, 'text'));

        expect((await refusalOf(ports.chat.played(c, room, spoken.id)))?.status, 'outside the room').toBe(404);
        expect((await refusalOf(ports.chat.played(b, room, line.id)))?.status, 'words').toBe(404);
        expect((await refusalOf(ports.chat.played(b, room, 'not-an-id')))?.status, 'no id').toBe(404);
        expect((await refusalOf(ports.chat.played(b, room, crypto.randomUUID())))?.status, 'nothing').toBe(404);
    });

    it('rings whoever’s voice messages a read passes', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);

        await speak(a, room, await upload(a));

        seen.length = 0;
        await ports.chat.markRead(b, room);

        expect(seen, 'the reader, and whoever spoke').toEqual([`${ room }:${ b }`, `${ room }:${ a }`]);
    });
});

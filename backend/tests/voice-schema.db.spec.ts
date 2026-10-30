import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, Message, User, VoiceNote, VoicePlay, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { VOICE_FILE_LEAST, VOICE_FILE_MOST } from '../src/domains/chat/voice.ts';

/**
 * The rows a voice message is made of: its file, the message that names it, and who has played it.
 * Each rule here is the database's, so it holds whoever writes the row.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    return (await db.getRepository(User).save({ handle: `voice${ seq }`, displayName: `Voice ${ seq }`, hue: 200, kind: 'wallet' })).id;
};

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

const file = (uploaderId: string | null, size = 4096) =>
{
    const id = crypto.randomUUID();

    return { id, write: db.getRepository(VoiceNote).insert({ id, uploaderId, bytes: Buffer.alloc(size, 7), size }) };
};

let room = '';
let sender = '';
let device = '';

/** A sealed row, every column of the envelope present, as the send writes one. */
const line = (kind: 'text' | 'voice', voiceId: string | null) =>
{
    seq += 1;
    const id = crypto.randomUUID();

    return {
        id,
        write: db.getRepository(Message).insert({
            id,
            conversationId: room,
            senderId: sender,
            kind,
            body: 'ciphertext',
            epoch: 1,
            seq: String(seq),
            iv: 'nonce',
            senderDeviceId: device,
            signature: 'signature',
            clientAt: new Date(),
            commitment: 'commitment',
            frank: 'frank',
            voiceId
        })
    };
};

describe.skipIf(!active)('a voice message\'s rows', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: [] });
        await db.initialize();
        await syncSchema(db);
    }, 180_000);

    afterAll(async () =>
    {
        await db?.destroy();
    });

    beforeEach(async () =>
    {
        await db.query('delete from voice_plays');
        await db.query('delete from messages');
        await db.query('delete from voice_notes');
        await db.query('delete from conversation_epochs');
        await db.query('delete from devices');
        await db.query('delete from conversations');
        await db.getRepository(User).createQueryBuilder().delete().execute();

        sender = await makeUser();
        room = (await db.getRepository(Conversation).save({ kind: 'group' })).id;
        device = `vd${ String(seq).padStart(20, '0') }`;
        await db.query(
            `insert into devices (id, user_id, label, exchange_key, signing_key, attested,
                                  attested_address, attested_message, attested_signature)
             values ($1, $2, 'Test', 'exchange', 'signing', 'wallet',
                     '0x0000000000000000000000000000000000000000', 'message', 'signature')`,
            [device, sender]
        );
    });

    it('name a file the database holds, and a voice message always names one', async () =>
    {
        const held = file(sender);
        await held.write;

        expect(await refusal(line('voice', held.id).write)).toBeNull();
        expect(await refusal(line('voice', null).write)).toBe('23514');
        expect(await refusal(line('voice', crypto.randomUUID()).write)).toBe('23503');
    });

    it('never let a line of words name a file', async () =>
    {
        const held = file(sender);
        await held.write;

        expect(await refusal(line('text', held.id).write)).toBe('23514');
        expect(await refusal(line('text', null).write)).toBeNull();
    });

    it('seal a voice message as a line is: without its envelope it is refused', async () =>
    {
        const held = file(sender);
        await held.write;

        const id = crypto.randomUUID();

        expect(await refusal(db.getRepository(Message).insert({
            id,
            conversationId: room,
            senderId: sender,
            kind: 'voice',
            body: 'ciphertext',
            voiceId: held.id
        }))).toBe('23514');
    });

    it('leave a tombstone that names no file', async () =>
    {
        const held = file(sender);
        await held.write;
        const spoken = line('voice', held.id);
        await spoken.write;

        const emptied = { kind: 'deleted' as const, body: null, iv: null, signature: null, commitment: null, frank: null };

        expect(await refusal(db.getRepository(Message).update({ id: spoken.id }, emptied))).toBe('23514');
        expect(await refusal(db.getRepository(Message).update({ id: spoken.id }, { ...emptied, voiceId: null }))).toBeNull();
    });

    it('keep a file while a message names it', async () =>
    {
        const held = file(sender);
        await held.write;
        await line('voice', held.id).write;

        expect(await refusal(db.getRepository(VoiceNote).delete({ id: held.id }))).toBe('23503');
    });

    it('hold a file to its bounds and its size to its length', async () =>
    {
        expect(await refusal(file(sender, VOICE_FILE_LEAST - 1).write)).toBe('23514');
        expect(await refusal(file(sender, VOICE_FILE_LEAST).write)).toBeNull();
        expect(await refusal(file(sender, VOICE_FILE_MOST).write)).toBeNull();
        expect(await refusal(file(sender, VOICE_FILE_MOST + 1).write)).toBe('23514');

        const id = crypto.randomUUID();

        expect(await refusal(db.getRepository(VoiceNote).insert({ id, uploaderId: sender, bytes: Buffer.alloc(4096), size: 4095 }))).toBe('23514');
    });

    it('keep a file when its uploader is gone, naming nobody', async () =>
    {
        const other = await makeUser();
        const held = file(other);
        await held.write;

        await db.getRepository(User).delete({ id: other });

        expect((await db.getRepository(VoiceNote).findOneByOrFail({ id: held.id })).uploaderId).toBeNull();
    });

    it('forget who played a voice message with the message, and with whoever played it', async () =>
    {
        const listener = await makeUser();
        const held = file(sender);
        await held.write;
        const spoken = line('voice', held.id);
        await spoken.write;

        await db.getRepository(VoicePlay).insert({ messageId: spoken.id, userId: listener });
        await db.getRepository(VoicePlay).insert({ messageId: spoken.id, userId: sender });

        expect(await refusal(db.getRepository(VoicePlay).insert({ messageId: spoken.id, userId: listener }))).toBe('23505');

        await db.getRepository(User).delete({ id: listener });
        expect(await db.getRepository(VoicePlay).countBy({ messageId: spoken.id })).toBe(1);

        await db.getRepository(Message).delete({ id: spoken.id });
        expect(await db.getRepository(VoicePlay).countBy({ messageId: spoken.id })).toBe(0);
    });
});

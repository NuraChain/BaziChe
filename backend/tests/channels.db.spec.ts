import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService } from '../src/domains/chat/service.ts';
import { createChannelService } from '../src/domains/channel/service.ts';
import { FILE_HOLD_MINUTES } from '../src/domains/chat/files.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * Channels against a real database: who may read, post, vote and invite; a private channel answering
 * as none to a stranger; a poll's tally, and an anonymous poll that names nobody to anybody; a post's
 * file fetched by the channel's readers and kept while the post names it.
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
    callChanged: () => undefined,
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
        handle: `c${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Sender ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    return made.id;
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

const KEY = 'k'.repeat(43);

const IV = 'i'.repeat(16);

let channels: ReturnType<typeof createChannelService>;

const refusalOf = async (attempt: Promise<unknown>) =>
{
    try
    {
        await attempt;
        return null;
    }
    catch (error)
    {
        return { status: (error as { status?: number }).status ?? 0 };
    }
};

const handleOf = async (userId: string) =>
    (await db.query('select handle from users where id = $1', [userId]) as { handle: string }[])[0].handle;

const made = async (owner: string, privacy: 'public' | 'private' = 'public') =>
    channels.create(owner, { name: `Channel ${ seq }`, bio: 'News', photo: '', privacy });

const upload = async (userId: string) =>
{
    const id = crypto.randomUUID();
    await chat.storeFile(userId, id, new Uint8Array(4096).fill(7));
    return id;
};

const photo = (id: string) => ({ id, key: KEY, iv: IV, as: 'photo' as const, mime: 'image/jpeg', name: 'beach.jpg', bytes: 4080, w: 4, h: 3 });

const poll = (anonymous: boolean, multiple = false) => ({ question: 'Which game tonight?', answers: ['Chess', 'Hokm', 'Poker'], anonymous, multiple });

describe.skipIf(!active)('channels, against a real database', () =>
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
        await db.query('truncate channels cascade');
        await db.query('truncate chat_files cascade');
        deviceOf.clear();
        seqOf.clear();
        minted.clear();
        changed.length = 0;
        seen.length = 0;
        const social = createSocialService(db);
        chat = createChatService(db, social, createFranking(CONFIG.secret));
        channels = createChannelService(db, social, CONFIG.origin);
        ports = buildPorts(db, CONFIG, listener);
    });

    it('makes a channel its maker owns, under a slug from its name, and lists it as theirs', async () =>
    {
        const owner = await makeUser();
        const channel = await made(owner);

        expect(channel).toMatchObject({ name: expect.stringContaining('Channel'), bio: 'News', privacy: 'public', role: 'owner', memberCount: 1, owner: await handleOf(owner) });
        expect(channel.slug).toMatch(/^channel-/);
        expect((await channels.mine(owner)).map((one) => one.id)).toEqual([channel.id]);
    });

    it('lets anybody read and join a public channel, and answers a private one as none to a stranger', async () =>
    {
        const [owner, reader] = [await makeUser(), await makeUser()];
        const open = await made(owner);
        const closed = await made(owner, 'private');

        expect((await channels.view(reader, open.slug)).role, 'read before joining').toBeUndefined();
        expect((await channels.discover(reader, 10)).map((one) => one.id)).toEqual([open.id]);
        expect((await channels.join(reader, open.slug)).channel.role).toBe('member');

        expect(await refusalOf(channels.view(reader, closed.slug)), 'a private one is not there').toEqual({ status: 404 });
        expect(await refusalOf(channels.join(reader, closed.slug))).toEqual({ status: 404 });
        expect(await refusalOf(channels.posts(reader, closed.slug, undefined))).toEqual({ status: 404 });
    });

    it('lets the owner and the admins post, and nobody else', async () =>
    {
        const [owner, admin, member] = [await makeUser(), await makeUser(), await makeUser()];
        const channel = await made(owner);

        await channels.join(admin, channel.slug);
        await channels.join(member, channel.slug);
        await channels.setRole(owner, channel.slug, admin, 'admin');

        expect((await channels.post(owner, channel.slug, { kind: 'text', text: 'Hello' })).post.text).toBe('Hello');
        expect((await channels.post(admin, channel.slug, { kind: 'text', text: 'Hi' })).post.from).toBe(await handleOf(admin));
        expect(await refusalOf(channels.post(member, channel.slug, { kind: 'text', text: 'Me too' })), 'a member').toEqual({ status: 403 });
        expect(await refusalOf(channels.setRole(admin, channel.slug, member, 'admin')), 'only the owner names admins').toEqual({ status: 403 });

        const page = await channels.posts(member, channel.slug, undefined);

        expect(page.posts.map((one) => one.text), 'oldest first within the page').toEqual(['Hello', 'Hi']);
        expect((await channels.view(member, channel.slug)).unread, 'two the member has not read').toBe(2);

        await channels.markRead(member, channel.slug);
        expect((await channels.view(member, channel.slug)).unread).toBe(0);
    });

    it('lets any member invite, as the messaging rule allows, and refuses a stranger who takes nothing from strangers', async () =>
    {
        const [owner, member, friendly, closedOff] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
        const channel = await made(owner, 'private');

        expect((await channels.invite(owner, channel.slug, member)).arrived, 'seated now, so told').toBe(true);
        expect((await channels.invite(owner, channel.slug, member)).arrived, 'already in, so not told again').toBe(false);
        await db.query('update users set allow_stranger_messages = false where id = $1', [closedOff]);

        expect((await channels.invite(member, channel.slug, friendly)).channel.memberCount).toBe(3);
        expect(await refusalOf(channels.invite(member, channel.slug, closedOff))).toEqual({ status: 403 });
        expect((await channels.view(friendly, channel.slug)).role, 'the invited can read the private channel').toBe('member');
    });

    it('carries a file its poster may fetch, which its readers may fetch while the post names it, and lets it go with the post', async () =>
    {
        const [owner, reader, stranger] = [await makeUser(), await makeUser(), await makeUser()];
        const open = await made(owner);
        const closed = await made(owner, 'private');
        const shown = await upload(owner);
        const hidden = await upload(owner);

        const posted = await channels.post(owner, open.slug, { kind: 'file', text: 'At the beach', file: photo(shown) });

        await channels.post(owner, closed.slug, { kind: 'file', text: '', file: photo(hidden) });

        expect(posted.post.file?.id).toBe(shown);
        expect(await chat.file(reader, shown), 'a public channel’s reader').not.toBeNull();
        expect(await chat.file(stranger, hidden), 'not a private channel’s stranger').toBeNull();
        expect(await refusalOf(channels.post(owner, open.slug, { kind: 'file', text: '', file: photo(await upload(stranger)) })), 'somebody else’s file').toEqual({ status: 404 });
        expect(await refusalOf(channels.post(owner, open.slug, { kind: 'file', text: '', file: { ...photo(shown), name: '../x' } })), 'a name no reader takes').toEqual({ status: 400 });

        await db.query(`update chat_files set created_at = now() - make_interval(mins => $1)`, [FILE_HOLD_MINUTES + 1]);
        await chat.sweepFiles();
        expect(await chat.file(reader, shown), 'not swept while a post names it').not.toBeNull();

        // Its files posted, the owner has none waiting: one more upload is let through a limit of one.
        const held = createChatService(db, createSocialService(db), createFranking(CONFIG.secret), undefined, { dayBytes: 1024 * 1024, pending: 1 });

        expect(await refusalOf(held.storeFile(owner, crypto.randomUUID(), new Uint8Array(4096).fill(3))), 'and not counted as waiting to be sent').toBeNull();

        await channels.removePost(owner, open.slug, posted.post.id);
        expect(await chat.file(owner, shown), 'gone with its post').toBeNull();
    });

    it('counts a poll’s votes, takes one answer or several as it says, and nothing once it is closed', async () =>
    {
        const [owner, a, b] = [await makeUser(), await makeUser(), await makeUser()];
        const channel = await made(owner);

        await channels.join(a, channel.slug);
        await channels.join(b, channel.slug);

        const one = (await channels.post(owner, channel.slug, { kind: 'poll', text: '', poll: poll(false) })).post;
        const several = (await channels.post(owner, channel.slug, { kind: 'poll', text: '', poll: poll(false, true) })).post;

        expect(await refusalOf(channels.vote(a, channel.slug, one.id, [0, 1])), 'one answer').toEqual({ status: 400 });
        expect(await refusalOf(channels.vote(a, channel.slug, one.id, [3])), 'an answer it does not have').toEqual({ status: 400 });

        await channels.vote(a, channel.slug, one.id, [0]);
        await channels.vote(a, channel.slug, one.id, [1]);

        const voted = (await channels.vote(b, channel.slug, one.id, [1])).post.poll!;

        expect(voted.answers.map((answer) => answer.votes), 'a changed vote moves').toEqual([0, 2, 0]);
        expect(voted.voters).toBe(2);
        expect(voted.mine).toEqual([1]);
        expect(voted.answers[1].voters, 'named, as the poll is not anonymous').toEqual(expect.arrayContaining([await handleOf(a), await handleOf(b)]));

        expect((await channels.vote(a, channel.slug, several.id, [0, 2])).post.poll!.mine).toEqual([0, 2]);
        expect((await channels.vote(a, channel.slug, several.id, [])).post.poll!.voters, 'taken back').toBe(0);

        await channels.closePoll(owner, channel.slug, one.id);
        expect(await refusalOf(channels.vote(a, channel.slug, one.id, [2])), 'closed').toEqual({ status: 403 });
    });

    it('never says who chose what in an anonymous poll, to anybody, its poster included', async () =>
    {
        const [owner, a] = [await makeUser(), await makeUser()];
        const channel = await made(owner);

        await channels.join(a, channel.slug);

        const asked = (await channels.post(owner, channel.slug, { kind: 'poll', text: '', poll: poll(true) })).post;

        await channels.vote(a, channel.slug, asked.id, [2]);

        for (const reader of [owner, a])
        {
            const page = await ports.channels.posts(reader, channel.slug, undefined);
            const said = JSON.stringify(page);

            expect(page.posts[0].poll?.answers.map((answer) => answer.votes)).toEqual([0, 0, 1]);
            expect(page.posts[0].poll?.answers.every((answer) => answer.voters === undefined), 'no names beside an answer').toBe(true);
            expect(said, 'the voter’s handle nowhere on the wire').not.toContain(await handleOf(a));
        }
    });

    it('hands an owner’s channel on when they leave, and goes with the last one out', async () =>
    {
        const [owner, admin, member] = [await makeUser(), await makeUser(), await makeUser()];
        const channel = await made(owner);

        await channels.join(member, channel.slug);
        await channels.join(admin, channel.slug);
        await channels.setRole(owner, channel.slug, admin, 'admin');
        await channels.leave(owner, channel.slug);

        expect((await channels.view(admin, channel.slug)).role, 'the admin before the longer-standing member').toBe('owner');

        await channels.leave(admin, channel.slug);
        await channels.leave(member, channel.slug);

        expect(await refusalOf(channels.view(member, channel.slug)), 'gone').toEqual({ status: 404 });
    });
});

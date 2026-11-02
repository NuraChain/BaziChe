import 'reflect-metadata';

import { createHmac, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { GroupReport, Notification, Report, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, type SealedInput } from '../src/domains/chat/service.ts';
import { GROUP_REPORTS_PAGE } from '../src/domains/group/roles.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * A group's own reports against a real database (MS-D40 to MS-D45): a report about a line in its room
 * copied for its staff when the reporter asks, read by whoever may work reports and outranks the person
 * reported and by nobody else, never naming who filed it, told to them in one notice, and closed with
 * the log's row in the transaction that closes it.
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

const rung: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: (...ids) =>
    {
        rung.push(...ids);
    },
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
        handle: `gr${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Report ${ seq }`,
        hue: seq % 360,
        kind: 'wallet',
        allowStrangerMessages: true
    });

    return { id: made.id, handle: made.handle };
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

/** The envelope the schema requires and none of the cryptography, as `chat.db.spec.ts` does. */
const sealed = async (userId: string, conversationId: string, kind: SealedInput['kind']): Promise<SealedInput> =>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `gr${ deviceOf.size.toString().padStart(20, '0') }`;
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
        commitment: 'a-commitment',
        expiresAt: 0
    };
};

const crew = async (owner: Person, ...members: Person[]) =>
{
    const made = await ports.group.create(owner.id, { name: 'Report Crew', blurb: '', crest: 'crest-crown', hue: 40, game: '', privacy: 'public' });

    for (const person of members)
    {
        await ports.group.join(person.id, made.slug);
    }

    return { slug: made.slug, room: made.conversationId ?? '' };
};

/** A place in the group set by hand, as the staff's own routes are held elsewhere. */
const placed = async (slug: string, person: Person, role: 'admin' | 'moderator' | 'member', rights: string[] | null = null) =>
{
    await db.query(
        `update group_members set role = $3::varchar, rights = $4::varchar[], role_since = case when $3::varchar = 'member' then null else now() end
          where group_id = (select id from groups where slug = $1) and user_id = $2`,
        [slug, person.id, role, rights]
    );
};

/** A line of `speaker`'s, sealed under a real commitment, and reported by `reporter` with it disclosed. */
const reported = async (speaker: Person, reporter: Person, room: string, options: { group?: true; document?: string } = {}) =>
{
    const frankingKey = randomBytes(32).toString('base64url');
    const document = options.document ?? JSON.stringify({ text: `words from ${ speaker.handle }` });
    const commitment = createHmac('sha256', Buffer.from(frankingKey, 'base64url')).update(document, 'utf8').digest('base64url');
    const line = await chat.send(speaker.id, room, null, { ...await sealed(speaker.id, room, 'text'), commitment });
    const id = await ports.social.report(reporter.id, speaker.handle, 'harassment', {
        conversationId: room,
        messageId: line.id,
        text: document,
        frankingKey,
        ...(options.group === undefined ? {} : { group: options.group })
    });

    return { line: line.id, report: id };
};

const copies = async () => (await db.getRepository(GroupReport).find({ order: { createdAt: 'ASC' } })).map((row) => row.state);

const noticesOf = async (person: Person) =>
    (await db.getRepository(Notification).find({ where: { userId: person.id, kind: 'group-report' } })).map((row) => row.count);

const listOf = async (person: Person, slug: string, list?: 'open' | 'closed' | 'all') =>
    ports.group.reports(person.id, slug, list === undefined ? {} : { list });

describe.skipIf(!active)('a group\'s own reports, against a real database', () =>
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
        chat = createChatService(db, createSocialService(db), createFranking(CONFIG.secret));
        rung.length = 0;
        deviceOf.clear();
        seqOf.clear();
        minted.clear();
    });

    describe('filing', () =>
    {
        it('copies a report about a line in a group\'s room for its staff only when the reporter asks', async () =>
        {
            const [owner, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser()];
            const { room } = await crew(owner, speaker, reporter);

            await reported(speaker, reporter, room);
            expect(await copies(), 'not asked').toEqual([]);

            const { report } = await reported(speaker, reporter, room, { group: true });

            expect(await copies()).toEqual(['open']);
            expect((await db.getRepository(GroupReport).findOneByOrFail({ reportId: report })).closedAt).toBeNull();
            expect(await db.getRepository(Report).count(), 'Nura\'s team has both').toBe(2);
        });

        it('copies nothing for a line of a direct chat, nor for a report with no line shown', async () =>
        {
            const [speaker, reporter] = [await makeUser(), await makeUser()];
            const direct = await chat.openDirect(reporter.id, speaker.id);

            await reported(speaker, reporter, direct, { group: true });
            await ports.social.report(reporter.id, speaker.handle, 'spam');

            expect(await copies()).toEqual([]);
            expect(await db.getRepository(Report).count()).toBe(2);
        });

        it('tells whoever may work it and outranks the person reported, one row a group counting up, and nobody else', async () =>
        {
            const [owner, admin, bare, moderator, speaker, reporter, other] = [
                await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()
            ];
            const { slug, room } = await crew(owner, admin, bare, moderator, speaker, reporter, other);

            await placed(slug, admin, 'admin', ['delete']);
            await placed(slug, bare, 'admin', ['ban']);
            await placed(slug, moderator, 'moderator');

            await reported(speaker, reporter, room, { group: true });
            await reported(speaker, reporter, room, { group: true });

            expect(await noticesOf(owner)).toEqual([2]);
            expect(await noticesOf(admin)).toEqual([2]);
            expect(await noticesOf(moderator)).toEqual([2]);
            expect(await noticesOf(bare), 'an admin without the right to delete').toEqual([]);
            expect(await noticesOf(speaker), 'the person reported').toEqual([]);
            expect(await noticesOf(reporter)).toEqual([]);
            expect(await noticesOf(other)).toEqual([]);

            const row = await db.getRepository(Notification).findOneByOrFail({ userId: owner.id, kind: 'group-report' });

            expect(row.actorId, 'nobody is named').toBeNull();
            expect(row.ref).toEqual({ groupId: slug });
            expect(rung, 'the panel\'s count is rung').toEqual(expect.arrayContaining([owner.id, admin.id, moderator.id]));
        });

        it('tells only those above a member of the staff reported, and nobody in the group about its owner', async () =>
        {
            const [owner, admin, moderator, peer, reporter] = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, admin, moderator, peer, reporter);

            await placed(slug, admin, 'admin', ['delete']);
            await placed(slug, moderator, 'moderator');
            await placed(slug, peer, 'moderator');

            await reported(moderator, reporter, room, { group: true });

            expect(await noticesOf(owner)).toEqual([1]);
            expect(await noticesOf(admin)).toEqual([1]);
            expect(await noticesOf(moderator), 'never about themselves').toEqual([]);
            expect(await noticesOf(peer), 'nor a moderator beside them').toEqual([]);

            await reported(owner, reporter, room, { group: true });

            expect(await noticesOf(owner)).toEqual([1]);
            expect(await noticesOf(admin), 'the owner is above everybody').toEqual([1]);
            expect(await copies(), 'Nura\'s team still has it, and the copy waits for nobody').toEqual(['open', 'open']);
        });

        it('tells a member of the staff who filed it nothing of their own report', async () =>
        {
            const [owner, moderator, speaker] = [await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, moderator, speaker);

            await placed(slug, moderator, 'moderator');
            await reported(speaker, moderator, room, { group: true });

            expect(await noticesOf(owner)).toEqual([1]);
            expect(await noticesOf(moderator)).toEqual([]);
            expect((await listOf(moderator, slug))?.reports, 'though it is theirs to work all the same').toHaveLength(1);
        });
    });

    describe('reading', () =>
    {
        it('shows the staff what was said, about whom and when, and never who filed it', async () =>
        {
            const [owner, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, speaker, reporter);
            const { line } = await reported(speaker, reporter, room, { group: true });

            const read = await listOf(owner, slug);

            expect(read?.reports.map((row) => [row.person.id, row.category, row.state, row.said, row.line])).toEqual([
                [speaker.handle, 'harassment', 'open', { text: `words from ${ speaker.handle }` }, line]
            ]);
            expect(JSON.stringify(read), 'the reporter is in no corner of it').not.toContain(reporter.handle);
            expect(JSON.stringify(read)).not.toContain(reporter.id);
        });

        it('says a voice message and a file as what they are, never with what opens them', async () =>
        {
            const [owner, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, speaker, reporter);

            await reported(speaker, reporter, room, { group: true, document: JSON.stringify({ voice: { id: 'v', key: 'THE-KEY', iv: 'IV', mime: 'audio/webm', ms: 12_400, wave: 'AA', bytes: 9 } }) });
            await reported(speaker, reporter, room, { group: true, document: JSON.stringify({ file: { id: 'f', key: 'THE-KEY', iv: 'IV', as: 'photo', mime: 'image/webp', name: 'beach.webp', bytes: 9, thumb: 'THUMB' }, caption: 'look' }) });

            const read = await listOf(owner, slug);

            expect(read?.reports.map((row) => row.said)).toEqual([
                { file: { name: 'beach.webp', as: 'photo' }, text: 'look' },
                { voice: 12_400 }
            ]);
            expect(JSON.stringify(read)).not.toContain('THE-KEY');
            expect(JSON.stringify(read)).not.toContain('THUMB');
        });

        it('names an edited line by the line itself, with the words the edit gave it', async () =>
        {
            const [owner, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, speaker, reporter);
            const said = await chat.send(speaker.id, room, null, await sealed(speaker.id, room, 'text'));
            const frankingKey = randomBytes(32).toString('base64url');
            const document = JSON.stringify({ edit: 'now worse', on: said.id });
            const commitment = createHmac('sha256', Buffer.from(frankingKey, 'base64url')).update(document, 'utf8').digest('base64url');
            const edit = await chat.send(speaker.id, room, null, { ...await sealed(speaker.id, room, 'edit'), target: said.id, commitment });

            await ports.social.report(reporter.id, speaker.handle, 'harassment', { conversationId: room, messageId: edit.id, text: document, frankingKey, group: true });

            const [row] = (await listOf(owner, slug))?.reports ?? [];

            expect([row?.line, row?.said]).toEqual([said.id, { text: 'now worse' }]);
        });

        it('says when the line has gone from the room, and keeps what was said', async () =>
        {
            const [owner, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, speaker, reporter);
            const { line } = await reported(speaker, reporter, room, { group: true });

            await chat.remove(speaker.id, room, line);

            const [row] = (await listOf(owner, slug))?.reports ?? [];

            expect(row?.line).toBeUndefined();
            expect(row?.said).toEqual({ text: `words from ${ speaker.handle }` });
        });

        it('answers nothing to a member, and keeps from the staff every copy about somebody at or above them', async () =>
        {
            const [owner, admin, moderator, peer, member, reporter] = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, admin, moderator, peer, member, reporter);

            await placed(slug, admin, 'admin', ['delete']);
            await placed(slug, moderator, 'moderator');
            await placed(slug, peer, 'moderator');

            await reported(member, reporter, room, { group: true });
            await reported(peer, reporter, room, { group: true });
            await reported(admin, reporter, room, { group: true });

            expect(await listOf(member, slug)).toBeNull();
            expect((await listOf(moderator, slug))?.reports.map((row) => row.person.id), 'never a moderator beside them').toEqual([member.handle]);
            expect((await listOf(owner, slug))?.reports.map((row) => row.person.id)).toEqual([admin.handle, peer.handle, member.handle]);
            expect((await ports.group.view(moderator.id, slug))?.reports, 'the count is what they may read').toBe(1);
            expect((await ports.group.view(owner.id, slug))?.reports).toBe(3);
            expect((await ports.group.view(member.id, slug))?.reports).toBeUndefined();
        });

        it('lists the open first by default, the closed apart, and pages by the microsecond keyset', async () =>
        {
            const [owner, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, speaker, reporter);

            for (let at = 0; at < GROUP_REPORTS_PAGE + 1; at += 1)
            {
                await reported(speaker, reporter, room, { group: true });
            }

            const first = await listOf(owner, slug);

            expect(first?.reports).toHaveLength(GROUP_REPORTS_PAGE);
            expect(first?.cursor).toBeDefined();

            const second = await ports.group.reports(owner.id, slug, { cursor: first?.cursor ?? '' });

            expect(second?.reports).toHaveLength(1);
            expect(new Set([...first?.reports ?? [], ...second?.reports ?? []].map((row) => row.id)).size).toBe(GROUP_REPORTS_PAGE + 1);

            await ports.group.closeReport(owner.id, slug, second?.reports[0]?.id ?? '', 'dismissed');

            expect((await listOf(owner, slug, 'closed'))?.reports.map((row) => row.state)).toEqual(['dismissed']);
            expect((await listOf(owner, slug, 'all'))?.reports).toHaveLength(GROUP_REPORTS_PAGE);
        });
    });

    describe('closing', () =>
    {
        it('closes a copy with its outcome and the log\'s row in one transaction, and a second close changes nothing', async () =>
        {
            const [owner, moderator, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, moderator, speaker, reporter);

            await placed(slug, moderator, 'moderator');
            await reported(speaker, reporter, room, { group: true });

            const [open] = (await listOf(moderator, slug))?.reports ?? [];
            const closed = await ports.group.closeReport(moderator.id, slug, open?.id ?? '', 'actioned');

            expect([closed?.state, closed?.closedBy]).toEqual(['actioned', moderator.handle]);

            const again = await ports.group.closeReport(owner.id, slug, open?.id ?? '', 'dismissed');

            expect([again?.state, again?.closedBy], 'it stays as it was closed').toEqual(['actioned', moderator.handle]);

            const logged = await db.query(
                `select e.kind, e.actor_handle, e.person_handle, e.details from group_events e join groups g on g.id = e.group_id where g.slug = $1 and e.kind = 'report'`,
                [slug]
            ) as { kind: string; actor_handle: string; person_handle: string; details: Record<string, string> }[];

            expect(logged.map((row) => [row.actor_handle, row.person_handle, row.details])).toEqual([[moderator.handle, speaker.handle, { report: open?.id, to: 'actioned' }]]);
            expect(JSON.stringify(logged), 'the log names no reporter either').not.toContain(reporter.handle);
        });

        it('answers a copy the reader may not read, or one that is no copy, as nothing there', async () =>
        {
            const [owner, admin, bare, moderator, member, reporter] = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, admin, bare, moderator, member, reporter);

            await placed(slug, admin, 'admin', ['delete']);
            await placed(slug, bare, 'admin', ['ban']);
            await placed(slug, moderator, 'moderator');
            await reported(admin, reporter, room, { group: true });
            await reported(member, reporter, room, { group: true });

            const [aboutMember, aboutAdmin] = (await listOf(owner, slug))?.reports ?? [];

            expect(await ports.group.closeReport(moderator.id, slug, aboutAdmin?.id ?? '', 'dismissed'), 'a copy about somebody above them').toBeNull();
            expect(await ports.group.closeReport(member.id, slug, aboutAdmin?.id ?? '', 'dismissed'), 'a member').toBeNull();
            expect(await ports.group.closeReport(bare.id, slug, aboutMember?.id ?? '', 'dismissed'), 'an admin who may not delete, about a member below them').toBeNull();
            expect(await ports.group.reports(bare.id, slug, {}), 'nor read them').toBeNull();
            expect(await ports.group.closeReport(owner.id, slug, 'not-a-copy', 'dismissed')).toBeNull();

            const elsewhere = await crew(owner);

            expect(await ports.group.closeReport(owner.id, elsewhere.slug, aboutAdmin?.id ?? '', 'dismissed'), 'by another group of theirs').toBeNull();
            expect(await ports.group.closeReport(owner.id, slug, crypto.randomUUID(), 'dismissed')).toBeNull();
            expect(await copies()).toEqual(['open', 'open']);
        });

        it('takes the notice back from whoever has no open copy left to read', async () =>
        {
            const [owner, moderator, speaker, reporter] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const { slug, room } = await crew(owner, moderator, speaker, reporter);

            await placed(slug, moderator, 'moderator');
            await reported(speaker, reporter, room, { group: true });
            await reported(speaker, reporter, room, { group: true });

            const [one, two] = (await listOf(owner, slug))?.reports ?? [];

            await ports.group.closeReport(owner.id, slug, one?.id ?? '', 'dismissed');

            expect(await noticesOf(moderator), 'one still open').toEqual([2]);

            await ports.group.closeReport(moderator.id, slug, two?.id ?? '', 'actioned');

            expect(await noticesOf(moderator)).toEqual([]);
            expect(await noticesOf(owner)).toEqual([]);
            expect((await ports.group.view(owner.id, slug))?.reports).toBe(0);
        });
    });
});

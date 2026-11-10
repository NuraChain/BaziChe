import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { GroupInvite, Notification, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { SWITCH_DEFAULTS } from '../src/domains/group/roles.ts';
import { createGroupService } from '../src/domains/group/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * Coming into a group by a link and by asking, against a real database: links made, used, ended,
 * used up and revoked, every way a link stops working answered alike, a limit raced, a request asked
 * and answered both ways, and who is told what.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

const rung: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: (...userIds) =>
    {
        rung.push(...userIds);
    },
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    callChanged: () => undefined,
    voiceChatChanged: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

let db: DataSource;
let ports: Services;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (overrides: Partial<Pick<User, 'isSuspended' | 'allowStrangerMessages'>> = {}): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `gl${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Link ${ seq }`,
        hue: seq % 360,
        kind: 'wallet',
        allowStrangerMessages: true,
        ...overrides
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

const group = (owner: Person, privacy: 'private' | 'public' = 'private', name = 'Link Crew') => ports.group.create(owner.id, {
    name,
    blurb: 'Come in',
    crest: 'crest-crown',
    hue: 40,
    game: '',
    privacy
});

/** The token at the end of a link's address. */
const tokenOf = (link: string) => link.slice(link.lastIndexOf('/') + 1);

const newest = async (owner: Person, slug: string, input: { hours?: number; uses?: number; approval: boolean }) =>
{
    const made = await ports.group.makeLink(owner.id, slug, input);
    return made.links[0];
};

const kinds = async (person: Person) =>
    (await db.getRepository(Notification).find({ where: { userId: person.id }, order: { createdAt: 'ASC' } })).map((row) => row.kind);

describe.skipIf(!active)('coming into a group by a link and by asking, against a real database', () =>
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
        rung.length = 0;
    });

    describe('a link', () =>
    {
        it('is made by whoever may make one, with the server\'s address and a token nobody could guess, and logged', async () =>
        {
            const owner = await makeUser();
            const [admin, member] = [await makeUser(), await makeUser()];
            const made = await group(owner, 'public');
            await ports.group.join(admin.id, made.slug);
            await ports.group.join(member.id, made.slug);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['invite'] });

            expect(await word(ports.group.makeLink(member.id, made.slug, { approval: false })), 'a member').toBe('403 group-right');
            expect(await ports.group.links(member.id, made.slug), 'a member reads none').toBeNull();

            const link = await newest(admin, made.slug, { hours: 24, uses: 10, approval: false });

            expect(link.link.startsWith(`${ CONFIG.origin }/app/g/`)).toBe(true);
            expect(tokenOf(link.link)).toMatch(/^[A-Za-z0-9_-]{22}$/);
            expect(link).toMatchObject({ by: admin.handle, most: 10, uses: 0, approval: false, live: true });
            expect(link.ends).toBeDefined();

            const rows = await db.query(`select details from group_events where kind = 'invite'`) as { details: Record<string, string> }[];
            expect(rows.map((row) => row.details)).toEqual([{ to: 'made', link: link.id, approval: 'off', hours: '24', uses: '10' }]);
        });

        it('opens a private group\'s face to whoever holds it, and nothing to anybody else', async () =>
        {
            const owner = await makeUser();
            const stranger = await makeUser();
            const made = await group(owner, 'private');
            const link = await newest(owner, made.slug, { approval: false });

            expect(await ports.group.view(stranger.id, made.slug), 'without the link').toBeNull();

            const face = await ports.group.byLink(stranger.id, tokenOf(link.link));
            expect(face?.group.name).toBe('Link Crew');
            expect(face?.group.memberCount).toBe(1);
            expect(face?.group.conversationId, 'and no thread').toBeUndefined();
            expect(face?.can).toBe('join');
        });

        it('brings somebody in, counts the use, and says so in the log', async () =>
        {
            const owner = await makeUser();
            const guest = await makeUser();
            const made = await group(owner);
            const link = await newest(owner, made.slug, { uses: 10, approval: false });

            const joined = await ports.group.joinByLink(guest.id, tokenOf(link.link));
            expect(joined.can).toBe('member');
            expect(joined.group.role).toBe('member');
            expect(joined.group.conversationId).toBeDefined();
            expect((await ports.group.links(owner.id, made.slug))?.links[0].uses).toBe(1);

            const again = await ports.group.joinByLink(guest.id, tokenOf(link.link));
            expect(again.group.role, 'a member coming back by it').toBe('member');
            expect((await ports.group.links(owner.id, made.slug))?.links[0].uses, 'counts nothing').toBe(1);

            const rows = await db.query(`select actor_handle, details from group_events where kind = 'joined' order by created_at`) as { actor_handle: string; details: Record<string, string> }[];
            expect(rows.at(-1)).toEqual({ actor_handle: guest.handle, details: { by: 'link', link: link.id } });
        });

        it('stops working ended, used up or revoked, and a token that is none, all in the same words', async () =>
        {
            const owner = await makeUser();
            const [first, second, third] = [await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);

            const once = await newest(owner, made.slug, { uses: 1, approval: false });
            await ports.group.joinByLink(first.id, tokenOf(once.link));

            const ended = await newest(owner, made.slug, { hours: 1, approval: false });
            await db.getRepository(GroupInvite).update({ id: ended.id }, { createdAt: () => `now() - interval '2 hours'`, expiresAt: () => `now() - interval '1 hour'` });

            const revoked = await newest(owner, made.slug, { approval: false });
            await ports.group.revokeLink(owner.id, made.slug, revoked.id);
            await ports.group.revokeLink(owner.id, made.slug, revoked.id);

            for (const token of [tokenOf(once.link), tokenOf(ended.link), tokenOf(revoked.link), 'A'.repeat(22), 'not a token'])
            {
                expect(await word(ports.group.byLink(second.id, token)), token).toBe('404 group-link');
                expect(await word(ports.group.joinByLink(third.id, token)), token).toBe('404 group-link');
            }

            const listed = (await ports.group.links(owner.id, made.slug))?.links ?? [];
            expect(listed.map((one) => one.live)).toEqual([false, false, false]);
            expect(listed[0].revoked).toBeDefined();

            const rows = await db.query(`select details ->> 'to' as to from group_events where kind = 'invite' order by created_at`) as { to: string }[];
            expect(rows.map((row) => row.to), 'a second revoke writes nothing').toEqual(['made', 'made', 'made', 'revoked']);
        });

        it('works for an hour, a day, a week or for good, and once, ten times, a hundred or always, and nothing else', async () =>
        {
            const owner = await makeUser();
            const made = await group(owner);

            expect(await word(ports.group.makeLink(owner.id, made.slug, { hours: 5, approval: false })), 'five hours').toBe('422 validation-failed');
            expect(await word(ports.group.makeLink(owner.id, made.slug, { uses: 7, approval: false })), 'seven uses').toBe('422 validation-failed');
            expect((await ports.group.links(owner.id, made.slug))?.links).toEqual([]);

            await ports.group.makeLink(owner.id, made.slug, { hours: 168, uses: 100, approval: false });
            expect((await ports.group.links(owner.id, made.slug))?.links.map((one) => [one.most, one.ends !== undefined])).toEqual([[100, true]]);
        });

        it('is answered first by the request that made it, whatever was made after it', async () =>
        {
            const owner = await makeUser();
            const made = await group(owner);
            const other = await newest(owner, made.slug, { approval: false });

            // Stamped after the next one, as a link another admin made in the same moment would be.
            await db.query(`update group_invites set created_at = now() + interval '1 minute' where id = $1`, [other.id]);

            const answer = await ports.group.makeLink(owner.id, made.slug, { approval: true });

            expect(answer.links.map((one) => one.approval), 'the one just made leads the answer').toEqual([true, false]);
            expect((await ports.group.links(owner.id, made.slug))?.links.map((one) => one.approval), 'the list itself is newest first').toEqual([false, true]);
        });

        it('lets in no more than its limit when people use it at once', async () =>
        {
            const owner = await makeUser();
            const made = await group(owner);
            const link = await newest(owner, made.slug, { uses: 1, approval: false });
            const people = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];

            // The group's row held, so every one of them reads the link as live and then waits for its
            // turn: the use has to be counted again in the statement that admits each of them.
            const holder = db.createQueryRunner();
            await holder.connect();
            await holder.startTransaction();
            await holder.query('select id from groups where slug = $1 for update', [made.slug]);

            const racing = Promise.allSettled(people.map((person) => ports.group.joinByLink(person.id, tokenOf(link.link))));

            for (let waited = 0; waited < 100; waited += 1)
            {
                const [held] = await db.query(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`) as { n: number }[];
                if (held.n >= people.length)
                {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            await holder.commitTransaction();
            await holder.release();

            const results = await racing;

            expect(results.filter((result) => result.status === 'fulfilled').length).toBe(1);

            const refusals = await Promise.all(results.flatMap((result) => result.status === 'rejected' ? [word(Promise.reject(result.reason))] : []));
            expect(refusals, 'each turned away as a link that no longer works').toEqual(['404 group-link', '404 group-link', '404 group-link']);
            expect((await ports.group.view(owner.id, made.slug))?.memberCount).toBe(2);
            expect((await ports.group.links(owner.id, made.slug))?.links[0].uses).toBe(1);
        });

        it('keeps a banned person out, and says to them that they cannot join', async () =>
        {
            const owner = await makeUser();
            const kept = await makeUser();
            const made = await group(owner);
            const link = await newest(owner, made.slug, { approval: false });
            await ports.group.ban(owner.id, made.slug, kept.handle);

            expect((await ports.group.byLink(kept.id, tokenOf(link.link)))?.can).toBe('banned');
            expect(await word(ports.group.joinByLink(kept.id, tokenOf(link.link)))).toBe('403 group-banned');
        });
    });

    describe('a request', () =>
    {
        it('is what a link that asks first makes, told to everybody who may answer, and answered in', async () =>
        {
            const owner = await makeUser();
            const [approver, plain, asker] = [await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner, 'public');
            await ports.group.join(approver.id, made.slug);
            await ports.group.join(plain.id, made.slug);
            await ports.group.role(owner.id, made.slug, { id: approver.handle, role: 'admin', rights: ['approve'] });
            await ports.group.role(owner.id, made.slug, { id: plain.handle, role: 'admin', rights: [] });

            const link = await newest(owner, made.slug, { approval: true });
            expect((await ports.group.byLink(asker.id, tokenOf(link.link)))?.can).toBe('request');

            const asked = await ports.group.joinByLink(asker.id, tokenOf(link.link));
            expect(asked.can).toBe('requested');
            expect(asked.group.role).toBeUndefined();
            expect(asked.group.requested).toBe(true);
            expect((await ports.group.byLink(asker.id, tokenOf(link.link)))?.can).toBe('requested');
            expect((await ports.group.links(owner.id, made.slug))?.links[0].uses, 'asking uses nothing').toBe(0);

            expect(await kinds(owner)).toContain('group-request');
            expect(await kinds(approver)).toContain('group-request');
            expect(await kinds(plain), 'an admin who may not answer').not.toContain('group-request');

            expect((await ports.group.view(approver.id, made.slug))?.requests).toBe(1);
            expect((await ports.group.view(plain.id, made.slug))?.requests, 'counted only for whoever may answer').toBeUndefined();

            expect(await ports.group.requests(plain.id, made.slug)).toBeNull();
            expect((await ports.group.requests(approver.id, made.slug))?.requests.map((one) => [one.person.handle, one.byLink])).toEqual([[asker.handle, true]]);

            await ports.group.answer(approver.id, made.slug, { id: asker.handle, approve: true });

            expect((await ports.group.view(asker.id, made.slug))?.role).toBe('member');
            expect((await ports.group.links(owner.id, made.slug))?.links[0].uses, 'the use is counted on the way in').toBe(1);
            expect(await kinds(asker)).toContain('group-approved');
            expect(await kinds(owner), 'the queue empty, its notice goes').not.toContain('group-request');
            expect(await kinds(approver)).not.toContain('group-request');
        });

        it('is what joining a public group that asks first makes, and turned away it tells nobody', async () =>
        {
            const owner = await makeUser();
            const asker = await makeUser();
            const made = await group(owner, 'public');
            await ports.group.permissions(owner.id, made.slug, { switches: SWITCH_DEFAULTS, approval: true });

            const asked = await ports.group.join(asker.id, made.slug);
            expect(asked.role).toBeUndefined();
            expect(asked.requested).toBe(true);

            await ports.group.answer(owner.id, made.slug, { id: asker.handle, approve: false });

            expect((await ports.group.view(asker.id, made.slug))?.requested).toBeUndefined();
            expect((await ports.group.view(asker.id, made.slug))?.role).toBeUndefined();
            expect(await kinds(asker)).toEqual([]);

            const rows = await db.query(`select kind, details ->> 'to' as to from group_events where kind = 'request'`) as { kind: string; to: string }[];
            expect(rows).toEqual([{ kind: 'request', to: 'declined' }]);
        });

        it('is asked of a private group through its link, which is how the asker sees it and takes it back', async () =>
        {
            const owner = await makeUser();
            const asker = await makeUser();
            const made = await group(owner);
            const link = await newest(owner, made.slug, { approval: true });

            const asked = await ports.group.joinByLink(asker.id, tokenOf(link.link));
            expect(asked.can).toBe('requested');
            expect(asked.group.name).toBe('Link Crew');
            expect(asked.group.requested).toBe(true);
            expect(await ports.group.view(asker.id, made.slug), 'still nothing by its name').toBeNull();
            expect(await kinds(owner)).toEqual(['group-request']);

            const taken = await ports.group.withdrawByLink(asker.id, tokenOf(link.link));
            expect(taken.can).toBe('request');
            expect(taken.group.requested).toBeUndefined();
            expect((await ports.group.requests(owner.id, made.slug))?.requests).toEqual([]);
            expect(await kinds(owner), 'the queue empty, its notice goes').toEqual([]);

            expect((await ports.group.withdrawByLink(asker.id, tokenOf(link.link))).can, 'taken back twice').toBe('request');
            await ports.group.revokeLink(owner.id, made.slug, link.id);
            expect(await word(ports.group.withdrawByLink(asker.id, tokenOf(link.link))), 'a link that stopped').toBe('404 group-link');
        });

        it('can be taken back, is asked once however often, and an answer to nothing changes nothing', async () =>
        {
            const owner = await makeUser();
            const asker = await makeUser();
            const made = await group(owner, 'public');
            await ports.group.permissions(owner.id, made.slug, { switches: SWITCH_DEFAULTS, approval: true });

            await ports.group.join(asker.id, made.slug);
            await ports.group.join(asker.id, made.slug);
            expect((await ports.group.requests(owner.id, made.slug))?.requests.length).toBe(1);

            await ports.group.withdraw(asker.id, made.slug);
            expect((await ports.group.requests(owner.id, made.slug))?.requests.length).toBe(0);
            expect(await kinds(owner), 'the queue empty, its notice goes').toEqual([]);

            expect(await word(ports.group.answer(owner.id, made.slug, { id: asker.handle, approve: true })), 'nothing to answer').toBeNull();
            expect((await ports.group.view(asker.id, made.slug))?.role).toBeUndefined();
        });

        it('waits the longest first, leaves a suspended asker out, and is taken back by its own asker alone', async () =>
        {
            const owner = await makeUser();
            const [first, gone, second] = [await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner, 'public');
            await ports.group.permissions(owner.id, made.slug, { switches: SWITCH_DEFAULTS, approval: true });

            for (const asker of [first, gone, second])
            {
                await ports.group.join(asker.id, made.slug);
            }
            await db.getRepository(User).update({ id: gone.id }, { isSuspended: true });

            const waiting = async () => ((await ports.group.requests(owner.id, made.slug))?.requests ?? []).map((one) => one.person.handle);

            expect(await waiting()).toEqual([first.handle, second.handle]);

            // Left out by the queue's own read, so a suspended account takes none of its places.
            const [{ id }] = await db.query('select id from groups where slug = $1', [made.slug]) as { id: string }[];
            const queue = await createGroupService(db, createSocialService(db)).requests(owner.id, id);
            expect(queue?.map((row) => row.user_id)).toEqual([first.id, second.id]);

            await ports.group.withdraw(second.id, made.slug);
            expect(await waiting(), 'somebody else\'s stays').toEqual([first.handle]);
        });

        it('is answered only by whoever may, and goes when the asker is banned', async () =>
        {
            const owner = await makeUser();
            const [member, asker] = [await makeUser(), await makeUser()];
            const made = await group(owner, 'public');
            await ports.group.join(member.id, made.slug);
            await ports.group.permissions(owner.id, made.slug, { switches: SWITCH_DEFAULTS, approval: true });
            await ports.group.join(asker.id, made.slug);

            expect(await word(ports.group.answer(member.id, made.slug, { id: asker.handle, approve: true }))).toBe('403 group-right');

            await ports.group.ban(owner.id, made.slug, asker.handle);
            expect((await ports.group.requests(owner.id, made.slug))?.requests.length).toBe(0);
        });
    });

    describe('handing a group on', () =>
    {
        it('tells the new owner, by a hand-over and by an owner leaving', async () =>
        {
            const owner = await makeUser();
            const heir = await makeUser();
            const made = await group(owner, 'public');
            await ports.group.join(heir.id, made.slug);

            await ports.group.transfer(owner.id, made.slug, heir.handle);
            const handed = await db.getRepository(Notification).findOneByOrFail({ userId: heir.id, kind: 'group-owner' });
            expect(handed.actorId).toBe(owner.id);

            // The old owner stayed on as an admin, so they are the heir when the new one walks out.
            await ports.group.leave(heir.id, made.slug);
            const back = await db.getRepository(Notification).findOneByOrFail({ userId: owner.id, kind: 'group-owner' });
            expect(back.actorId).toBe(heir.id);
        });
    });
});

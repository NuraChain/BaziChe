import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Avatar, Friendship, GroupEvent, GroupMember, GroupMute, Notification, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, type SealedInput } from '../src/domains/chat/service.ts';
import { GROUP_RIGHTS, MEMBERS_PAGE, SWITCH_DEFAULTS } from '../src/domains/group/roles.ts';
import { createGroupService } from '../src/domains/group/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * Running a group, against a real database: who holds which role and which rights, what each may do
 * to whom, what the members may do, who is kept out or kept quiet, the hand-over and the heir, the
 * members a page at a time, the log, the picture, and the chat asking the group before a line is kept.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const OWNER_WALLET = '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc';

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: OWNER_WALLET
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

const makeUser = async (overrides: Partial<Pick<User, 'displayName' | 'isSuspended' | 'allowStrangerMessages'>> = {}): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `ga${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Crew ${ seq }`,
        hue: seq % 360,
        kind: 'wallet',
        allowStrangerMessages: true,
        ...overrides
    });

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

const group = (owner: Person, name = 'The Crew', extra: Partial<Parameters<Services['group']['create']>[1]> = {}) => ports.group.create(owner.id, {
    name,
    blurb: '',
    crest: 'crest-crown',
    hue: 40,
    game: '',
    privacy: 'public',
    ...extra
});

const seat = async (slug: string, ...people: Person[]) =>
{
    for (const person of people)
    {
        await ports.group.join(person.id, slug);
    }
};

const roleIn = async (slug: string, person: Person) =>
{
    const found = await ports.group.view(person.id, slug);
    return found?.role ?? null;
};

const log = async (slug: string, kind?: GroupEvent['kind']) =>
{
    const rows = await db.query(
        `select e.kind, e.actor_handle, e.actor_role, e.person_handle, e.details
           from group_events e join groups g on g.id = e.group_id
          where g.slug = $1 ${ kind === undefined ? '' : 'and e.kind = $2' }
          order by e.created_at, e.id`,
        kind === undefined ? [slug] : [slug, kind]
    ) as { kind: string; actor_handle: string | null; actor_role: string | null; person_handle: string | null; details: Record<string, string> }[];

    return rows;
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

/** The envelope the schema requires and none of the cryptography, as `chat.db.spec.ts` does. */
const sealed = async (userId: string, conversationId: string, kind: SealedInput['kind'], options: { target?: string } = {}): Promise<SealedInput> =>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `ga${ deviceOf.size.toString().padStart(20, '0') }`;
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
        expiresAt: 0
    };
};

const say = async (person: Person, conversationId: string, kind: 'text' | 'reaction' = 'text', target?: string) =>
    chat.send(person.id, conversationId, null, await sealed(person.id, conversationId, kind, target === undefined ? {} : { target }));

/** One voice file of the sender's own, so a voice message can be named. */
const voiced = async (person: Person, conversationId: string) =>
{
    const file = crypto.randomUUID();
    await chat.storeVoice(person.id, file, new Uint8Array(4096).fill(7));
    return chat.send(person.id, conversationId, null, { ...await sealed(person.id, conversationId, 'voice'), voice: file });
};

/** One sealed photo, video or file of the sender's own, sent into the room: held to the media switch as a voice message is. */
const filed = async (person: Person, conversationId: string) =>
{
    const file = crypto.randomUUID();
    await chat.storeFile(person.id, file, new Uint8Array(4096).fill(9));
    return chat.send(person.id, conversationId, null, { ...await sealed(person.id, conversationId, 'file'), file, fileAs: 'photo' });
};

/** A picture this server keeps, by the address it answers it under. */
const picture = async (fill: number) =>
{
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill, fill, fill]);
    return (await ports.identity.uploadAvatar(Buffer.from(png).toString('base64'))).url;
};

describe.skipIf(!active)('running a group, against a real database', () =>
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
        await db.query('truncate table avatars cascade');
        ports = buildPorts(db, CONFIG, listener);
        const social = createSocialService(db);
        chat = createChatService(db, social, createFranking(CONFIG.secret));
        rung.length = 0;
        deviceOf.clear();
        seqOf.clear();
        minted.clear();
    });

    describe('roles and rights', () =>
    {
        it('lets the owner make an admin with the rights it chooses, says so in the log, and hands the admin their rights', async () =>
        {
            const owner = await makeUser();
            const admin = await makeUser();
            const made = await group(owner);
            await seat(made.slug, admin);

            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['pin', 'remove', 'remove'] });

            const seen = await ports.group.view(admin.id, made.slug);
            expect(seen?.role).toBe('admin');
            expect(seen?.rights, 'the rights in the list\'s own order, once each').toEqual(['remove', 'pin']);

            const rows = await log(made.slug, 'role');
            expect(rows).toEqual([{ kind: 'role', actor_handle: owner.handle, actor_role: 'owner', person_handle: admin.handle, details: { from: 'member', to: 'admin', rights: 'remove,pin' } }]);
        });

        it('changes nothing and writes nothing for a role and rights already held', async () =>
        {
            const owner = await makeUser();
            const admin = await makeUser();
            const made = await group(owner);
            await seat(made.slug, admin);

            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['pin'] });
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['pin'] });
            expect((await log(made.slug, 'role')).length).toBe(1);
            expect((await log(made.slug, 'rights')).length).toBe(0);

            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['pin', 'ban'] });
            expect((await log(made.slug, 'rights')).map((row) => row.details)).toEqual([{ from: 'pin', to: 'ban,pin' }]);
        });

        it('keeps the making of admins to the owner, and moderators to the owner and an admin with members', async () =>
        {
            const owner = await makeUser();
            const [keeper, helper, member, other] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, keeper, helper, member, other);

            await ports.group.role(owner.id, made.slug, { id: keeper.handle, role: 'admin', rights: [...GROUP_RIGHTS] });
            await ports.group.role(owner.id, made.slug, { id: helper.handle, role: 'admin', rights: ['pin'] });

            expect(await word(ports.group.role(keeper.id, made.slug, { id: member.handle, role: 'admin', rights: ['pin'] })), 'an admin making an admin').toBe('403 group-right');
            expect(await word(ports.group.role(keeper.id, made.slug, { id: helper.handle, role: 'member' })), 'an admin unmaking an admin').toBe('403 group-right');
            expect(await word(ports.group.role(keeper.id, made.slug, { id: helper.handle, role: 'moderator' })), 'an admin turning an admin into a moderator').toBe('403 group-right');
            expect(await word(ports.group.role(helper.id, made.slug, { id: member.handle, role: 'moderator' })), 'an admin without members').toBe('403 group-right');

            expect(await word(ports.group.role(keeper.id, made.slug, { id: member.handle, role: 'moderator' })), 'an admin with members').toBeNull();
            expect(await roleIn(made.slug, member)).toBe('moderator');

            expect(await word(ports.group.role(member.id, made.slug, { id: other.handle, role: 'moderator' })), 'a moderator making a moderator').toBe('403 group-right');
            expect(await word(ports.group.role(other.id, made.slug, { id: member.handle, role: 'member' })), 'a member unmaking a moderator').toBe('403 group-right');

            expect(await word(ports.group.role(keeper.id, made.slug, { id: member.handle, role: 'member' })), 'and back').toBeNull();
            expect(await roleIn(made.slug, member)).toBe('member');
        });

        it('lets nobody set their own role or the owner\'s, and refuses rights nobody has heard of', async () =>
        {
            const owner = await makeUser();
            const admin = await makeUser();
            const made = await group(owner);
            await seat(made.slug, admin);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: [...GROUP_RIGHTS] });

            expect(await word(ports.group.role(owner.id, made.slug, { id: owner.handle, role: 'admin', rights: [] })), 'the owner on themselves').toBe('409 group-self');
            expect(await word(ports.group.role(admin.id, made.slug, { id: admin.handle, role: 'moderator' })), 'an admin on themselves').toBe('403 group-right');

            const groups = createGroupService(db, createSocialService(db));
            const id = (await groups.bySlug(owner.id, made.slug))!.id;
            expect(await word(groups.setRole(owner.id, id, admin.id, 'admin', ['remove', 'everything'])), 'a right nobody has heard of').toBe('422 group-rights');

            const member = await makeUser();
            await seat(made.slug, member);
            expect(await word(groups.setRole(admin.id, id, member.id, 'moderator')), 'an admin with every right, on a member').toBeNull();
            expect(await word(groups.setRole(member.id, id, member.id, 'member')), 'a moderator on themselves').toBe('403 group-right');
        });
    });

    describe('what each may do to whom', () =>
    {
        it('removes only somebody ranked lower, and only with the right to', async () =>
        {
            const owner = await makeUser();
            const [remover, plain, moderator, member, other] = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, remover, plain, moderator, member, other);
            await ports.group.role(owner.id, made.slug, { id: remover.handle, role: 'admin', rights: ['remove'] });
            await ports.group.role(owner.id, made.slug, { id: plain.handle, role: 'admin', rights: [] });
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });

            expect(await word(ports.group.remove(plain.id, made.slug, member.handle)), 'an admin without the right').toBe('403 group-right');
            expect(await word(ports.group.remove(moderator.id, made.slug, member.handle)), 'a moderator').toBe('403 group-right');
            expect(await word(ports.group.remove(member.id, made.slug, other.handle)), 'a member').toBe('403 group-right');
            expect(await word(ports.group.remove(remover.id, made.slug, plain.handle)), 'another admin').toBe('409 group-rank');
            expect(await word(ports.group.remove(remover.id, made.slug, owner.handle)), 'the owner').toBe('409 group-rank');

            expect(await word(ports.group.remove(remover.id, made.slug, moderator.handle)), 'a moderator, by an admin with the right').toBeNull();
            expect(await word(ports.group.remove(remover.id, made.slug, member.handle)), 'a member').toBeNull();
            expect(await roleIn(made.slug, member)).toBeNull();
            expect((await log(made.slug, 'removed')).map((row) => row.person_handle)).toEqual([moderator.handle, member.handle]);
        });

        it('keeps a banned person out of every way in until it is lifted, and takes them out if they were in', async () =>
        {
            const owner = await makeUser();
            const [banner, member, stranger] = [await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, banner, member);
            await ports.group.role(owner.id, made.slug, { id: banner.handle, role: 'admin', rights: ['ban'] });

            await ports.group.ban(banner.id, made.slug, member.handle);
            await ports.group.ban(banner.id, made.slug, stranger.handle);
            expect(await roleIn(made.slug, member), 'taken out').toBeNull();

            expect(await word(ports.group.join(member.id, made.slug)), 'joining').toBe('403 group-banned');
            expect(await word(ports.group.join(stranger.id, made.slug)), 'a stranger kept out beforehand').toBe('403 group-banned');
            expect(await word(ports.group.add(owner.id, made.slug, member.handle)), 'being added').toBe('403 group-banned');
            expect((await ports.group.discover(member.id, 24)).map((one) => one.slug), 'offered to them').not.toContain(made.slug);

            expect((await ports.group.banned(banner.id, made.slug))?.people.map((one) => one.person.handle).sort()).toEqual([member.handle, stranger.handle].sort());
            expect(await ports.group.banned(owner.id, made.slug), 'the owner reads it too').not.toBeNull();

            await ports.group.unban(banner.id, made.slug, member.handle);
            await ports.group.unban(banner.id, made.slug, member.handle);
            expect(await word(ports.group.join(member.id, made.slug)), 'once lifted').toBeNull();

            expect((await log(made.slug)).filter((row) => row.kind === 'banned' || row.kind === 'unbanned').map((row) => `${ row.kind } ${ row.person_handle }`)).toEqual([
                `banned ${ member.handle }`,
                `banned ${ stranger.handle }`,
                `unbanned ${ member.handle }`
            ]);
        });

        it('lets nobody but the owner and an admin with ban read who is kept out', async () =>
        {
            const owner = await makeUser();
            const [moderator, member] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, moderator, member);
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });

            expect(await ports.group.banned(moderator.id, made.slug)).toBeNull();
            expect(await ports.group.banned(member.id, made.slug)).toBeNull();
        });
    });

    describe('a mute', () =>
    {
        it('keeps a member from sending a line, a voice message or an edit, and lets them react', async () =>
        {
            const owner = await makeUser();
            const [moderator, member] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, moderator, member);
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            const room = made.conversationId!;

            const before = await say(member, room);
            const ownLine = await say(owner, room);

            await ports.group.mute(moderator.id, made.slug, { id: member.handle, hours: 24 });

            const seen = await ports.group.view(member.id, made.slug);
            expect(seen?.muted?.until, 'the member is told until when').toBeDefined();

            expect(await word(say(member, room)), 'a line').toBe('403 group-muted');

            const refusal = await say(member, room).then(() => null, (error: unknown) => errorResponse(error).json()) as { error: { details?: { until?: string } } } | null;
            expect(Date.parse(refusal?.error.details?.until ?? ''), 'the refusal says until when').toBeGreaterThan(Date.now());
            expect(await word(voiced(member, room)), 'a voice message').toBe('403 group-muted');
            expect(await word(chat.send(member.id, room, null, await sealed(member.id, room, 'edit', { target: before.id }))), 'an edit').toBe('403 group-muted');
            expect(await word(say(member, room, 'reaction', ownLine.id)), 'a reaction').toBeNull();
        });

        it('reaches only somebody ranked lower, with the right to, and holds through leaving and coming back', async () =>
        {
            const owner = await makeUser();
            const [moderator, admin, member] = [await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, moderator, admin, member);
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['pin'] });

            expect(await word(ports.group.mute(moderator.id, made.slug, { id: admin.handle })), 'a moderator on an admin').toBe('409 group-rank');
            expect(await word(ports.group.mute(admin.id, made.slug, { id: member.handle })), 'an admin without members').toBe('403 group-right');
            expect(await word(ports.group.mute(member.id, made.slug, { id: moderator.handle })), 'a member').toBe('403 group-right');
            expect(await word(ports.group.mute(moderator.id, made.slug, { id: member.handle, hours: 2 })), 'two hours').toBe('422 validation-failed');

            await ports.group.mute(moderator.id, made.slug, { id: member.handle });
            await ports.group.leave(member.id, made.slug);
            await ports.group.join(member.id, made.slug);

            const back = await ports.group.view(member.id, made.slug);
            expect(back?.muted, 'until lifted, still').toEqual({});
            expect(await word(say(member, back!.conversationId!)), 'still quiet').toBe('403 group-muted');

            await ports.group.unmute(moderator.id, made.slug, member.handle);
            expect(await word(say(member, back!.conversationId!)), 'lifted').toBeNull();
            expect((await log(made.slug)).filter((row) => row.kind === 'muted' || row.kind === 'unmuted').map((row) => row.kind)).toEqual(['muted', 'unmuted']);
        });

        it('ends by itself when its time is up', async () =>
        {
            const owner = await makeUser();
            const member = await makeUser();
            const made = await group(owner);
            await seat(made.slug, member);

            await ports.group.mute(owner.id, made.slug, { id: member.handle, hours: 1 });
            await db.query(`update group_mutes set created_at = now() - interval '2 hours', until = now() - interval '1 hour'`);

            expect((await ports.group.view(member.id, made.slug))?.muted).toBeUndefined();
            expect(await word(say(member, made.conversationId!))).toBeNull();
        });

        it('is shown in the members list to the staff and to nobody else', async () =>
        {
            const owner = await makeUser();
            const [member, other] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, member, other);
            await ports.group.mute(owner.id, made.slug, { id: member.handle, hours: 168 });

            const byStaff = (await ports.group.members(owner.id, made.slug, undefined, undefined)).members.find((row) => row.person.handle === member.handle);
            const byMember = (await ports.group.members(other.id, made.slug, undefined, undefined)).members.find((row) => row.person.handle === member.handle);

            expect(byStaff?.muted?.until).toBeDefined();
            expect(byMember?.muted).toBeUndefined();
        });
    });

    describe('what the members may do', () =>
    {
        it('is the owner\'s to set, changes nothing when it is already so, and says what moved', async () =>
        {
            const owner = await makeUser();
            const admin = await makeUser();
            const made = await group(owner);
            await seat(made.slug, admin);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: [...GROUP_RIGHTS] });

            const quiet = { ...SWITCH_DEFAULTS, send: false, pin: true };

            expect(await word(ports.group.permissions(admin.id, made.slug, { switches: quiet, approval: false })), 'an admin with every right').toBe('403 group-right');

            await ports.group.permissions(owner.id, made.slug, { switches: quiet, approval: true });
            await ports.group.permissions(owner.id, made.slug, { switches: quiet, approval: true });

            const seen = await ports.group.view(admin.id, made.slug);
            expect(seen?.switches).toEqual(quiet);
            expect(seen?.approval).toBe(true);
            expect((await log(made.slug, 'permissions')).map((row) => row.details)).toEqual([{ on: 'pin', off: 'send', approval: 'on' }]);
        });

        it('keeps the line to the staff when members may not write, and photos and voice to them when members may not send those', async () =>
        {
            const owner = await makeUser();
            const [admin, moderator, member] = [await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, admin, moderator, member);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: [] });
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            const room = made.conversationId!;

            await ports.group.permissions(owner.id, made.slug, { switches: { ...SWITCH_DEFAULTS, media: false }, approval: false });
            expect(await word(voiced(member, room)), 'a member\'s voice message').toBe('403 group-no-media');
            expect(await word(filed(member, room)), 'a member\'s photo, video or file').toBe('403 group-no-media');
            expect(await word(filed(moderator, room)), 'a moderator\'s photo, video or file').toBeNull();
            expect(await word(say(member, room)), 'a member\'s line').toBeNull();
            expect(await word(voiced(moderator, room)), 'a moderator\'s voice message').toBeNull();

            await ports.group.permissions(owner.id, made.slug, { switches: { ...SWITCH_DEFAULTS, send: false }, approval: false });
            expect(await word(say(member, room)), 'a member\'s line').toBe('403 group-quiet');
            expect(await word(say(admin, room)), 'an admin\'s').toBeNull();
            expect(await word(say(moderator, room)), 'a moderator\'s').toBeNull();
            expect(await word(say(owner, room)), 'the owner\'s').toBeNull();
        });

        it('lets a member change how the group looks only when members may, and its doors only ever the owner', async () =>
        {
            const owner = await makeUser();
            const [admin, member] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, admin, member);
            await ports.group.role(owner.id, made.slug, { id: admin.handle, role: 'admin', rights: ['info'] });

            const edit = (by: Person, extra: Partial<Parameters<Services['group']['edit']>[2]> = {}) =>
                ports.group.edit(by.id, made.slug, { name: 'The Crew', blurb: '', crest: 'crest-crown', game: '', privacy: 'public', ...extra });

            expect(await word(edit(member, { name: 'Members Rule' })), 'a member, by default').toBe('403 group-right');
            expect(await word(edit(admin, { name: 'Admins Rule' })), 'an admin with info').toBeNull();
            expect(await word(edit(admin, { privacy: 'private' })), 'an admin on the doors').toBe('403 group-right');

            await ports.group.permissions(owner.id, made.slug, { switches: { ...SWITCH_DEFAULTS, info: true }, approval: false });
            expect(await word(edit(member, { name: 'Members Rule' })), 'a member, once members may').toBeNull();
            expect(await word(edit(owner, { name: 'Members Rule', privacy: 'private' })), 'the owner closing it').toBeNull();

            expect((await log(made.slug, 'info')).map((row) => row.details)).toEqual([
                { fields: 'name', from: 'The Crew', to: 'Admins Rule' },
                { fields: 'name', from: 'Admins Rule', to: 'Members Rule' }
            ]);
        });

        it('lets a member add people only while members may', async () =>
        {
            const owner = await makeUser();
            const [member, friend] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, member);

            await ports.group.permissions(owner.id, made.slug, { switches: { ...SWITCH_DEFAULTS, add: false }, approval: false });
            expect(await word(ports.group.add(member.id, made.slug, friend.handle))).toBe('403 group-right');

            await ports.group.permissions(owner.id, made.slug, { switches: SWITCH_DEFAULTS, approval: false });
            expect(await word(ports.group.add(member.id, made.slug, friend.handle))).toBeNull();
            expect((await log(made.slug, 'joined')).at(-1)).toMatchObject({ actor_handle: member.handle, person_handle: friend.handle, details: { by: 'add' } });
        });
    });

    describe('handing it on', () =>
    {
        it('makes the other the owner and keeps the old owner as an admin with every right, once', async () =>
        {
            const owner = await makeUser();
            const heir = await makeUser();
            const made = await group(owner);
            await seat(made.slug, heir);

            await ports.group.transfer(owner.id, made.slug, heir.handle);

            expect(await roleIn(made.slug, heir)).toBe('owner');
            const before = await ports.group.view(owner.id, made.slug);
            expect(before?.role).toBe('admin');
            expect(before?.rights).toEqual([...GROUP_RIGHTS]);
            expect(before?.owner).toBe(heir.handle);

            expect(await word(ports.group.transfer(owner.id, made.slug, owner.handle)), 'the old owner, handing it on again').toBe('403 group-right');
            expect((await log(made.slug, 'owner')).map((row) => [row.actor_handle, row.person_handle])).toEqual([[owner.handle, heir.handle]]);
        });

        it('hands it to a member and not to somebody outside it, nor to an account that is suspended', async () =>
        {
            const owner = await makeUser();
            const [stranger, held] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, held);
            await db.getRepository(User).update({ id: held.id }, { isSuspended: true });

            expect(await word(ports.group.transfer(owner.id, made.slug, stranger.handle))).toBe('404 group-member');

            const groups = createGroupService(db, createSocialService(db));
            const id = (await groups.bySlug(owner.id, made.slug))!.id;
            expect(await word(groups.transfer(owner.id, id, held.id))).toBe('409 group-suspended');
            expect(await roleIn(made.slug, owner)).toBe('owner');
        });

        it('hands it on once when it is handed to two people at the same moment, and leaves one owner', async () =>
        {
            for (let round = 0; round < 4; round += 1)
            {
                const owner = await makeUser();
                const [first, second] = [await makeUser(), await makeUser()];
                const made = await group(owner, `Race ${ round }`);
                await seat(made.slug, first, second);

                const results = await Promise.allSettled([
                    ports.group.transfer(owner.id, made.slug, first.handle),
                    ports.group.transfer(owner.id, made.slug, second.handle)
                ]);

                expect(results.filter((result) => result.status === 'fulfilled').length, `round ${ round }`).toBe(1);

                const lost = results.find((result) => result.status === 'rejected');
                expect(await word(Promise.reject(lost?.reason)), 'the second finds its caller no longer the owner').toBe('403 group-right');

                const owners = await db.query(
                    `select count(*)::int as n from group_members gm join groups g on g.id = gm.group_id where g.slug = $1 and gm.role = 'owner'`,
                    [made.slug]
                ) as { n: number }[];
                expect(owners[0].n).toBe(1);
                expect((await log(made.slug, 'owner')).length).toBe(1);
            }
        });

        it('passes from an owner who leaves to the admin made first, else a moderator, else the longest member', async () =>
        {
            const owner = await makeUser();
            const [early, later, moderator, member] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, member, moderator, later, early);
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });
            await ports.group.role(owner.id, made.slug, { id: early.handle, role: 'admin', rights: [] });
            await ports.group.role(owner.id, made.slug, { id: later.handle, role: 'admin', rights: [] });

            await ports.group.leave(owner.id, made.slug);
            expect(await roleIn(made.slug, early), 'the admin made first').toBe('owner');
            // Both rows are written in one transaction, so they share its time: their order is not the point.
            expect((await log(made.slug)).slice(-2).map((row) => `${ row.kind } ${ row.actor_handle ?? '-' } ${ row.person_handle ?? '-' }`).sort()).toEqual([
                `left ${ owner.handle } -`,
                `owner - ${ early.handle }`
            ]);

            await ports.group.leave(early.id, made.slug);
            expect(await roleIn(made.slug, later)).toBe('owner');

            await ports.group.leave(later.id, made.slug);
            expect(await roleIn(made.slug, moderator), 'a moderator when no admin is left').toBe('owner');

            await ports.group.leave(moderator.id, made.slug);
            expect(await roleIn(made.slug, member)).toBe('owner');
        });
    });

    describe('the members', () =>
    {
        it('are a page at a time, the staff first and then by when they joined, each once', async () =>
        {
            const owner = await makeUser();
            const made = await group(owner);
            const people: Person[] = [];

            for (let index = 0; index < MEMBERS_PAGE + 7; index += 1)
            {
                people.push(await makeUser());
            }
            await seat(made.slug, ...people);
            await ports.group.role(owner.id, made.slug, { id: people[40].handle, role: 'moderator' });
            await ports.group.role(owner.id, made.slug, { id: people[50].handle, role: 'admin', rights: ['pin'] });

            const first = await ports.group.members(owner.id, made.slug, undefined, undefined);
            expect(first.members.length).toBe(MEMBERS_PAGE);
            expect(first.count).toBe(MEMBERS_PAGE + 8);
            expect(first.members.slice(0, 3).map((row) => [row.person.handle, row.role])).toEqual([
                [owner.handle, 'owner'],
                [people[50].handle, 'admin'],
                [people[40].handle, 'moderator']
            ]);
            expect(first.members[1].rights).toEqual(['pin']);

            const second = await ports.group.members(owner.id, made.slug, undefined, first.cursor);
            expect(second.cursor).toBeUndefined();

            const all = [...first.members, ...second.members].map((row) => row.person.handle);
            expect(all.length).toBe(MEMBERS_PAGE + 8);
            expect(new Set(all).size).toBe(all.length);
            expect(all.slice(3)).toEqual(people.filter((_, index) => index !== 40 && index !== 50).map((person) => person.handle));
        });

        it('are found by a name or a handle, folded, and leave out whoever is blocked or suspended', async () =>
        {
            const owner = await makeUser();
            const [sara, blocked, held] = [await makeUser({ displayName: 'Sara Kamali' }), await makeUser({ displayName: 'Sara Blocked' }), await makeUser({ displayName: 'Sara Held' })];
            const made = await group(owner);
            await seat(made.slug, sara, blocked, held);
            await db.query('insert into blocks (user_id, blocked_id) values ($1, $2)', [blocked.id, owner.id]);
            await db.getRepository(User).update({ id: held.id }, { isSuspended: true });

            const found = await ports.group.members(owner.id, made.slug, 'SARA', undefined);
            expect(found.members.map((row) => row.person.handle)).toEqual([sara.handle]);
            expect(found.count, 'every member is counted').toBe(4);

            expect((await ports.group.members(owner.id, made.slug, sara.handle.slice(0, 6), undefined)).members.map((row) => row.person.handle)).toEqual([sara.handle]);

            // The page itself leaves them out, so a full page is fifty people anybody can be shown.
            const groups = createGroupService(db, createSocialService(db));
            const rows = await groups.members(owner.id, (await groups.bySlug(owner.id, made.slug))!.id, undefined, undefined);
            expect(rows.rows.map((row) => row.user_id).sort()).toEqual([owner.id, sara.id].sort());
        });
    });

    describe('who can be added', () =>
    {
        const befriend = async (one: Person, other: Person) =>
            db.getRepository(Friendship).insert([{ userId: one.id, friendId: other.id }, { userId: other.id, friendId: one.id }]);

        it('offers the reader\'s friends who are not in the group, not kept out of it and not suspended', async () =>
        {
            const owner = await makeUser();
            const [inside, outside, banned, suspended] = [await makeUser(), await makeUser(), await makeUser(), await makeUser({ isSuspended: true })];
            const stranger = await makeUser();
            const made = await group(owner);

            for (const one of [inside, outside, banned, suspended])
            {
                await befriend(owner, one);
            }
            await seat(made.slug, inside, banned, stranger);
            await ports.group.ban(owner.id, made.slug, banned.handle);

            const offered = await ports.group.addable(owner.id, made.slug);
            expect(offered?.people.map((person) => person.handle)).toEqual([outside.handle]);

            const groups = createGroupService(db, createSocialService(db));
            const id = (await groups.bySlug(owner.id, made.slug))!.id;
            expect(await groups.addable(owner.id, id), 'the domain leaves out a suspended friend itself').toEqual([outside.id]);
        });

        it('is nothing to somebody outside the group, nor to a member once members may not add', async () =>
        {
            const owner = await makeUser();
            const [member, stranger] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, member);

            expect(await ports.group.addable(member.id, made.slug), 'a member may add while the switch is on').toEqual({ people: [] });
            expect(await ports.group.addable(stranger.id, made.slug), 'somebody who can see a public group is not in it').toBeNull();

            await ports.group.permissions(owner.id, made.slug, { switches: { ...SWITCH_DEFAULTS, add: false }, approval: false });

            expect(await ports.group.addable(member.id, made.slug)).toBeNull();
            expect(await ports.group.addable(owner.id, made.slug)).toEqual({ people: [] });
        });
    });

    describe('the log', () =>
    {
        it('is read by the staff, newest first, and is a page that is not there to a member', async () =>
        {
            const owner = await makeUser();
            const [moderator, member] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, moderator, member);
            await ports.group.role(owner.id, made.slug, { id: moderator.handle, role: 'moderator' });

            const read = await ports.group.log(moderator.id, made.slug, undefined);
            expect(read?.rows.map((row) => row.kind)).toEqual(['role', 'joined', 'joined', 'created']);
            expect(read?.rows[0]).toMatchObject({ actor: owner.handle, actorRole: 'owner', person: moderator.handle, details: { from: 'member', to: 'moderator' } });

            expect(await ports.group.log(member.id, made.slug, undefined)).toBeNull();
        });

        it('turns its pages without losing a row', async () =>
        {
            const owner = await makeUser();
            const made = await group(owner);
            const member = await makeUser();
            await seat(made.slug, member);

            for (let index = 0; index < 60; index += 1)
            {
                await ports.group.mute(owner.id, made.slug, { id: member.handle, hours: 1 });
            }

            const first = await ports.group.log(owner.id, made.slug, undefined);
            const second = await ports.group.log(owner.id, made.slug, first?.cursor);

            expect(first?.rows.length).toBe(50);
            expect(second?.cursor).toBeUndefined();
            expect((first?.rows.length ?? 0) + (second?.rows.length ?? 0)).toBe(62);
            expect(new Set([...first!.rows, ...second!.rows].map((row) => row.id)).size).toBe(62);
        });
    });

    describe('a group made with what it starts with', () =>
    {
        it('logs one change\'s rows in the order they were written, the making first and each member after it', async () =>
        {
            const owner = await makeUser();
            const firsts = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];

            const made = await group(owner, 'In Order', { members: firsts.map((one) => one.handle) });
            const read = await ports.group.log(owner.id, made.slug, undefined);

            expect(read?.rows.map((row) => `${ row.kind } ${ row.person ?? '-' }`), 'newest first')
                .toEqual([...firsts.map((one) => `joined ${ one.handle }`).reverse(), 'created -']);
        });

        it('seats its first members, tells them, keeps what members may do, and leaves out anybody the policy refuses', async () =>
        {
            const owner = await makeUser();
            const [friend, closed] = [await makeUser(), await makeUser({ allowStrangerMessages: false })];

            const made = await group(owner, 'Starters', {
                members: [friend.handle, closed.handle, 'nobody-here'],
                switches: { ...SWITCH_DEFAULTS, media: false },
                approval: true
            });

            expect(made.memberCount).toBe(2);
            expect(made.switches.media).toBe(false);
            expect(made.approval).toBe(true);
            expect(await roleIn(made.slug, friend)).toBe('member');
            expect(await roleIn(made.slug, closed)).toBeNull();

            const told = await db.getRepository(Notification).findBy({ userId: friend.id, kind: 'group-added' });
            expect(told.length).toBe(1);
            expect((await log(made.slug)).map((row) => `${ row.kind } ${ row.person_handle ?? '-' }`).sort()).toEqual(['created -', `joined ${ friend.handle }`]);
        });
    });

    describe('the picture', () =>
    {
        it('is one uploaded here, said in the thread, taken away with nothing, and kept when the staff clear a person\'s', async () =>
        {
            const owner = await makeUser();
            const shown = await picture(1);

            expect(await word(group(owner, 'Faked', { photo: 'https://elsewhere.test/avatars/abc.png' }))).toBe('422 group-picture');

            const made = await group(owner, 'Pictured', { photo: shown });
            expect(made.photo).toBe(shown);

            const other = await picture(2);
            const changed = await ports.group.edit(owner.id, made.slug, { name: 'Pictured', blurb: '', crest: 'crest-crown', game: '', privacy: 'public', photo: other });
            expect(changed.photo).toBe(other);

            const lines = await db.query(
                `select m.payload ->> 'key' as key from messages m where m.conversation_id = $1 and m.kind = 'system' order by m.created_at`,
                [made.conversationId]
            ) as { key: string }[];
            expect(lines.map((line) => line.key)).toEqual(['chat.line.group.created', 'chat.line.group.photo']);

            const cleared = await ports.group.edit(owner.id, made.slug, { name: 'Pictured', blurb: '', crest: 'crest-crown', game: '', privacy: 'public', photo: '' });
            expect(cleared.photo).toBeUndefined();

            const staff = await makeUser();
            await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`, [staff.id, OWNER_WALLET]);
            const wearer = await makeUser();
            await db.getRepository(User).update({ id: wearer.id }, { avatar: shown });
            await ports.group.edit(owner.id, made.slug, { name: 'Pictured', blurb: '', crest: 'crest-crown', game: '', privacy: 'public', photo: shown });

            await ports.admin.clear(staff.id, wearer.handle, { part: 'picture', reason: 'Not a picture for here' });

            const hash = /avatars\/([0-9a-f]{64})\./.exec(shown)?.[1];
            expect(await db.getRepository(Avatar).existsBy({ hash }), 'the file a group still shows').toBe(true);
        });
    });

    describe('what is rung', () =>
    {
        it('rings the person a change was about as well as the group', async () =>
        {
            const owner = await makeUser();
            const member = await makeUser();
            const made = await group(owner);
            await seat(made.slug, member);

            rung.length = 0;
            await ports.group.mute(owner.id, made.slug, { id: member.handle, hours: 1 });
            expect(rung).toContain(member.id);
            expect(await db.getRepository(GroupMute).countBy({ userId: member.id })).toBe(1);
            expect(await db.getRepository(GroupMember).countBy({ userId: member.id })).toBe(1);
        });

        it('hands each person who is no longer in it the ring of their going', async () =>
        {
            const owner = await makeUser();
            const [banned, removed] = [await makeUser(), await makeUser()];
            const made = await group(owner);
            await seat(made.slug, banned, removed);

            rung.length = 0;
            await ports.group.ban(owner.id, made.slug, banned.handle);
            expect(rung, 'the banned').toContain(banned.id);

            rung.length = 0;
            await ports.group.unban(owner.id, made.slug, banned.handle);
            expect(rung, 'the ban lifted').toContain(banned.id);

            rung.length = 0;
            await ports.group.remove(owner.id, made.slug, removed.handle);
            expect(rung, 'the removed').toContain(removed.id);
        });

        it('draws up to six faces, the staff first, and nobody this viewer is apart from', async () =>
        {
            const owner = await makeUser();
            const people: Person[] = [];
            for (let index = 0; index < 7; index += 1)
            {
                people.push(await makeUser());
            }
            const made = await group(owner);
            await seat(made.slug, ...people);
            await ports.group.role(owner.id, made.slug, { id: people[6].handle, role: 'moderator' });
            await db.query('insert into blocks (user_id, blocked_id) values ($1, $2)', [owner.id, people[0].id]);

            const seen = await ports.group.view(owner.id, made.slug);
            expect(seen?.faces).toEqual([owner.handle, people[6].handle, people[1].handle, people[2].handle, people[3].handle, people[4].handle]);
        });
    });
});

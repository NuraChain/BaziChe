import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, type QueryDeepPartialEntity } from 'typeorm';

import { Conversation, ConversationPin, Group, GroupBan, GroupEvent, GroupInvite, GroupMember, GroupMute, GroupRequest, Message, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { SWITCH_DEFAULTS } from '../src/domains/group/roles.ts';

/**
 * The rows a group is run with: who holds which role and which rights, what its members may do, who
 * is kept out or kept quiet, the links and the requests, the log, and the pins of a conversation.
 * Each rule here is the database's, so it holds whoever writes.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let seq = 0;

const CHECK = '23514';
const UNIQUE = '23505';
const NOT_NULL = '23502';
const TOO_LONG = '22001';

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

const makeUser = async () =>
{
    seq += 1;

    return (await db.getRepository(User).save({ handle: `crew${ seq }`, displayName: `Crew ${ seq }`, hue: 120, kind: 'wallet' })).id;
};

const switches = {
    membersSend: SWITCH_DEFAULTS.send,
    membersMedia: SWITCH_DEFAULTS.media,
    membersAdd: SWITCH_DEFAULTS.add,
    membersPin: SWITCH_DEFAULTS.pin,
    membersInfo: SWITCH_DEFAULTS.info,
    membersCall: SWITCH_DEFAULTS.call,
    membersJoinCall: SWITCH_DEFAULTS.joinCall,
    membersSpeak: SWITCH_DEFAULTS.speak
};

const makeGroup = async (extra: Partial<Group> = {}) =>
{
    seq += 1;

    const inserted = await db.getRepository(Group).insert({
        slug: `crew-${ seq }`,
        name: `Crew ${ seq }`,
        crest: 'crest-crown',
        hue: 20,
        privacy: 'public',
        approval: false,
        ...switches,
        ...extra
    });

    return inserted.identifiers[0].id as string;
};

const seat = (groupId: string, userId: string, extra: Partial<GroupMember> = {}) => db.getRepository(GroupMember).insert({ groupId, userId, role: 'member', rights: null, roleSince: null, ...extra });

describe.skipIf(!active)('a group\'s rows', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: [] });
        await db.initialize();
        await syncSchema(db);
    }, 180_000);

    const clear = async () =>
    {
        await db.query('delete from conversation_pins');
        await db.query('delete from group_events');
        await db.query('delete from group_requests');
        await db.query('delete from group_invites');
        await db.query('delete from group_mutes');
        await db.query('delete from group_bans');
        await db.query('delete from messages');
        await db.query('delete from conversations');
        await db.query('delete from group_members');
        await db.query('delete from groups');
        await db.getRepository(User).createQueryBuilder().delete().execute();
    };

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await clear();
            await db.destroy();
        }
    });

    beforeEach(clear);

    describe('a group', () =>
    {
        it('says every switch of what its members may do, and whether joining is a request', async () =>
        {
            for (const left of [...Object.keys(switches), 'approval'])
            {
                const row: Record<string, unknown> = { slug: `unsaid-${ left.toLowerCase() }`, name: 'Unsaid', crest: 'crest-crown', hue: 1, privacy: 'public', approval: false, ...switches };
                delete row[left];

                expect(await refusal(db.getRepository(Group).insert(row)), left).toBe(NOT_NULL);
            }

            expect(await refusal(makeGroup({ photo: 'https://example.test/avatars/a.png' })), 'with a photo').toBeNull();
        });
    });

    describe('a member', () =>
    {
        it('holds one of four roles, and a group has one owner', async () =>
        {
            const groupId = await makeGroup();
            const [owner, other, third] = [await makeUser(), await makeUser(), await makeUser()];

            expect(await refusal(seat(groupId, owner, { role: 'owner', roleSince: new Date() }))).toBeNull();
            expect(await refusal(seat(groupId, other, { role: 'owner', roleSince: new Date() })), 'a second owner').toBe(UNIQUE);
            expect(await refusal(seat(groupId, other, { role: 'moderator', roleSince: new Date() })), 'a moderator').toBeNull();
            expect(await refusal(seat(groupId, third, { role: 'chief' as GroupMember['role'], roleSince: new Date() })), 'a role nobody has heard of').toBe(CHECK);
        });

        it('holds rights exactly when an admin, and only rights the group knows', async () =>
        {
            const groupId = await makeGroup();
            const people = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];

            expect(await refusal(seat(groupId, people[0], { role: 'admin', rights: ['remove', 'pin'], roleSince: new Date() })), 'an admin with rights').toBeNull();
            expect(await refusal(seat(groupId, people[1], { role: 'admin', rights: [], roleSince: new Date() })), 'an admin with none of them').toBeNull();
            expect(await refusal(seat(groupId, people[2], { role: 'admin', rights: null, roleSince: new Date() })), 'an admin with no list').toBe(CHECK);
            expect(await refusal(seat(groupId, people[3], { role: 'moderator', rights: ['delete'], roleSince: new Date() })), 'a moderator with rights').toBe(CHECK);
            expect(await refusal(seat(groupId, people[4], { role: 'admin', rights: ['remove', 'everything'] as GroupMember['rights'], roleSince: new Date() })), 'a right nobody has heard of').toBe(CHECK);
        });

        it('says since when a role above member was given, and a member has no such time', async () =>
        {
            const groupId = await makeGroup();
            const [first, second, third] = [await makeUser(), await makeUser(), await makeUser()];

            expect(await refusal(seat(groupId, first, { role: 'member', roleSince: new Date() })), 'a member with a time').toBe(CHECK);
            expect(await refusal(seat(groupId, second, { role: 'moderator', roleSince: null })), 'a moderator without one').toBe(CHECK);
            expect(await refusal(seat(groupId, third, { role: 'owner', roleSince: null })), 'an owner without one').toBe(CHECK);
        });
    });

    describe('kept out, and kept quiet', () =>
    {
        it('is one ban and one mute a person a group, and a mute ends after it began', async () =>
        {
            const groupId = await makeGroup();
            const [person, staff] = [await makeUser(), await makeUser()];

            await db.getRepository(GroupBan).insert({ groupId, userId: person, bannedBy: staff });
            expect(await refusal(db.getRepository(GroupBan).insert({ groupId, userId: person, bannedBy: staff })), 'banned twice').toBe(UNIQUE);

            expect(await refusal(db.getRepository(GroupMute).insert({ groupId, userId: person, mutedBy: staff, until: null })), 'until lifted').toBeNull();
            expect(await refusal(db.getRepository(GroupMute).insert({ groupId, userId: person, mutedBy: staff, until: null })), 'muted twice').toBe(UNIQUE);

            const other = await makeUser();
            expect(await refusal(db.getRepository(GroupMute).insert({ groupId, userId: other, mutedBy: staff, until: () => `now() - interval '1 minute'` })), 'ending before it began').toBe(CHECK);
        });

        it('outlives the staff member who did it, and goes with the person or the group', async () =>
        {
            const groupId = await makeGroup();
            const [person, staff] = [await makeUser(), await makeUser()];

            await db.getRepository(GroupBan).insert({ groupId, userId: person, bannedBy: staff });
            await db.getRepository(GroupMute).insert({ groupId, userId: person, mutedBy: staff, until: null });

            await db.getRepository(User).delete({ id: staff });

            expect((await db.getRepository(GroupBan).findOneByOrFail({ groupId, userId: person })).bannedBy, 'the ban stays').toBeNull();
            expect((await db.getRepository(GroupMute).findOneByOrFail({ groupId, userId: person })).mutedBy, 'the mute stays').toBeNull();

            await db.getRepository(Group).delete({ id: groupId });

            expect(await db.getRepository(GroupBan).countBy({ userId: person })).toBe(0);
            expect(await db.getRepository(GroupMute).countBy({ userId: person })).toBe(0);
        });
    });

    describe('a link', () =>
    {
        const link = (groupId: string, extra: QueryDeepPartialEntity<GroupInvite> = {}) => db.getRepository(GroupInvite).insert({
            groupId,
            token: 'A'.repeat(22),
            approval: false,
            ...extra
        });

        it('is a token of twenty-two letters of base64url that nobody else holds', async () =>
        {
            const groupId = await makeGroup();

            for (const token of ['A'.repeat(21), `${ 'A'.repeat(21) }+`, `${ 'A'.repeat(21) }=`, `${ 'A'.repeat(21) } `])
            {
                expect(await refusal(link(groupId, { token })), token).toBe(CHECK);
            }

            expect(await refusal(link(groupId, { token: 'A'.repeat(23) })), 'a letter too many').toBe(TOO_LONG);

            expect(await refusal(link(groupId, { token: 'aZ09_-'.repeat(3) + 'abcd' }))).toBeNull();
            expect(await refusal(link(groupId, { token: 'aZ09_-'.repeat(3) + 'abcd' })), 'the same token twice').toBe(UNIQUE);
        });

        it('ends after it was made, is used between nought and its limit, and is revoked no earlier than made', async () =>
        {
            const groupId = await makeGroup();
            const token = (n: number) => `${ String(n).padStart(2, '0') }${ 'b'.repeat(20) }`;

            expect(await refusal(link(groupId, { token: token(1), expiresAt: () => `now() - interval '1 second'` })), 'ending before it was made').toBe(CHECK);
            expect(await refusal(link(groupId, { token: token(2), maxUses: 0 })), 'a limit of none').toBe(CHECK);
            expect(await refusal(link(groupId, { token: token(3), maxUses: 2, uses: 3 })), 'used past its limit').toBe(CHECK);
            expect(await refusal(link(groupId, { token: token(4), uses: -1 })), 'used less than never').toBe(CHECK);
            expect(await refusal(link(groupId, { token: token(5), revokedAt: () => `now() - interval '1 second'` })), 'revoked before it was made').toBe(CHECK);
            expect(await refusal(link(groupId, { token: token(6), maxUses: 10, uses: 10, expiresAt: () => `now() + interval '1 day'` })), 'used up, on time').toBeNull();
        });

        it('keeps the requests it brought when it goes, and a request is one a person a group', async () =>
        {
            const groupId = await makeGroup();
            const person = await makeUser();

            const inviteId = (await link(groupId)).identifiers[0].id as string;
            await db.getRepository(GroupRequest).insert({ groupId, userId: person, inviteId });

            expect(await refusal(db.getRepository(GroupRequest).insert({ groupId, userId: person, inviteId: null })), 'asked twice').toBe(UNIQUE);

            await db.getRepository(GroupInvite).delete({ id: inviteId });

            expect((await db.getRepository(GroupRequest).findOneByOrFail({ groupId, userId: person })).inviteId).toBeNull();
        });
    });

    describe('the log', () =>
    {
        const event = (groupId: string, extra: QueryDeepPartialEntity<GroupEvent> = {}) => db.getRepository(GroupEvent).insert({ groupId, kind: 'joined', details: {}, ...extra });

        it('knows its kinds and its roles, and names whoever it is about', async () =>
        {
            const groupId = await makeGroup();
            const person = await makeUser();

            expect(await refusal(event(groupId, { kind: 'shouted' as GroupEvent['kind'] })), 'a kind nobody has heard of').toBe(CHECK);
            expect(await refusal(event(groupId, { actorId: person, actorHandle: 'crew', actorRole: 'chief' as GroupEvent['actorRole'] })), 'a role nobody has heard of').toBe(CHECK);
            expect(await refusal(event(groupId, { actorId: person, actorHandle: null })), 'an actor with no handle').toBe(CHECK);
            expect(await refusal(event(groupId, { personId: person, personHandle: null })), 'a person with no handle').toBe(CHECK);
            expect(await refusal(event(groupId, { details: () => `'["said"]'::jsonb` })), 'details that are not an object').toBe(CHECK);
            expect(await refusal(event(groupId, { kind: 'call', actorId: null, actorHandle: null })), 'an end nobody made').toBeNull();
        });

        it('still reads once the account is gone, and goes with its group', async () =>
        {
            const groupId = await makeGroup();
            const [staff, person] = [await makeUser(), await makeUser()];

            await event(groupId, { kind: 'removed', actorId: staff, actorHandle: 'crew.staff', actorRole: 'admin', personId: person, personHandle: 'crew.person' });

            await db.getRepository(User).delete({ id: staff });
            await db.getRepository(User).delete({ id: person });

            const kept = await db.getRepository(GroupEvent).findOneByOrFail({ groupId });

            expect([kept.actorId, kept.actorHandle, kept.personId, kept.personHandle]).toEqual([null, 'crew.staff', null, 'crew.person']);

            await db.getRepository(Group).delete({ id: groupId });

            expect(await db.getRepository(GroupEvent).count()).toBe(0);
        });
    });

    describe('a pin', () =>
    {
        it('is one a message, and goes with the message', async () =>
        {
            const conversationId = (await db.getRepository(Conversation).insert({ kind: 'group', groupId: await makeGroup() })).identifiers[0].id as string;
            const messageId = (await db.getRepository(Message).insert({ conversationId, kind: 'system', payload: { key: 'chat.line.group.created', params: {} } })).identifiers[0].id as string;
            const pinner = await makeUser();

            await db.getRepository(ConversationPin).insert({ conversationId, messageId, pinnedBy: pinner });
            expect(await refusal(db.getRepository(ConversationPin).insert({ conversationId, messageId, pinnedBy: pinner })), 'pinned twice').toBe(UNIQUE);

            await db.getRepository(User).delete({ id: pinner });
            expect((await db.getRepository(ConversationPin).findOneByOrFail({ messageId })).pinnedBy, 'the pin stays').toBeNull();

            await db.getRepository(Message).delete({ id: messageId });
            expect(await db.getRepository(ConversationPin).count()).toBe(0);
        });
    });
});

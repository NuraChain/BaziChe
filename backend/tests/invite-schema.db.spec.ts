import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { InviteBoardOff, InviteCampaign, InviteCode, InviteReward, InviteVisit, Referral, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';

/**
 * The rows an invite is made of: a person's code, the devices that opened it, the campaigns the
 * staff run and the looks they give. Each rule here is the database's, so it holds whoever writes.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    return (await db.getRepository(User).save({ handle: `invite${ seq }`, displayName: `Invite ${ seq }`, hue: 200, kind: 'wallet' })).id;
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

const CHECK = '23514';
const UNIQUE = '23505';
const FOREIGN = '23503';

const campaign = (extra: Partial<InviteCampaign> = {}) => db.getRepository(InviteCampaign).insert({
    name: 'Bring a friend',
    state: 'draft',
    inviterItem: 'decoration.jade',
    inviteeItem: 'nameplate.jade',
    milestones: [{ count: 5, item: 'theme.jade' }],
    most: null,
    review: false,
    ...extra
});

const reward = (campaignId: string, userId: string, extra: Partial<InviteReward> = {}) => db.getRepository(InviteReward).insert({
    campaignId,
    userId,
    inviteeId: null,
    kind: 'inviter',
    milestone: null,
    itemId: 'decoration.jade',
    state: 'review',
    delivered: null,
    decidedAt: null,
    reason: null,
    ...extra
});

describe.skipIf(!active)('an invite\'s rows', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: [] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 180_000);

    const clear = async () =>
    {
        await db.query('delete from invite_rewards');
        await db.query('delete from referrals');
        await db.query('delete from invite_campaigns');
        await db.query('delete from invite_visits');
        await db.query('delete from invite_codes');
        await db.query('delete from invite_board_off');
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

    describe('a code', () =>
    {
        it('is eight of the alphabet\'s letters, in capitals', async () =>
        {
            const owner = await makeUser();

            for (const code of ['abcd2345', 'ABCD234O', 'ABCD2341', 'ABCD234I', 'ABCD234L', 'ABCD234'])
            {
                expect(await refusal(db.getRepository(InviteCode).insert({ code, userId: owner })), code).toBe(CHECK);
            }

            expect(await refusal(db.getRepository(InviteCode).insert({ code: 'ABCD2345', userId: owner }))).toBeNull();
        });

        it('is live one at a time a person, and a retired one makes room for the next', async () =>
        {
            const owner = await makeUser();

            await db.getRepository(InviteCode).insert({ code: 'AAAA2222', userId: owner });

            expect(await refusal(db.getRepository(InviteCode).insert({ code: 'BBBB3333', userId: owner })), 'a second live code').toBe(UNIQUE);

            await db.getRepository(InviteCode).update({ code: 'AAAA2222' }, { retiredAt: () => 'now()' });

            expect(await refusal(db.getRepository(InviteCode).insert({ code: 'BBBB3333', userId: owner })), 'once the first is retired').toBeNull();
            expect(await refusal(db.getRepository(InviteCode).update({ code: 'AAAA2222' }, { retiredAt: () => `created_at - interval '1 second'` })), 'retired before it was made').toBe(CHECK);
        });
    });

    describe('a visit', () =>
    {
        it('is a device a day, kept by a token it made up and nothing else, and goes with its code', async () =>
        {
            const owner = await makeUser();
            const visitor = 'aB3_-'.repeat(4) + 'zz';

            await db.getRepository(InviteCode).insert({ code: 'CCCC4444', userId: owner });
            await db.getRepository(InviteVisit).insert({ code: 'CCCC4444', visitor, day: '2026-10-30' });

            expect(await refusal(db.getRepository(InviteVisit).insert({ code: 'CCCC4444', visitor, day: '2026-10-30' })), 'the same day again').toBe(UNIQUE);
            expect(await refusal(db.getRepository(InviteVisit).insert({ code: 'CCCC4444', visitor, day: '2026-10-31' })), 'the next day').toBeNull();
            expect(await refusal(db.getRepository(InviteVisit).insert({ code: 'CCCC4444', visitor: 'short', day: '2026-10-30' })), 'no token').toBe(CHECK);
            expect(await refusal(db.getRepository(InviteVisit).insert({ code: 'DDDD5555', visitor, day: '2026-10-30' })), 'a code nobody holds').toBe(FOREIGN);

            await db.getRepository(User).delete({ id: owner });

            expect(await db.getRepository(InviteVisit).count(), 'gone with the code and its owner').toBe(0);
        });
    });

    describe('a campaign', () =>
    {
        it('is active one at a time, beside any number written, paused or over', async () =>
        {
            await campaign({ state: 'active' });

            expect(await refusal(campaign({ state: 'active' })), 'a second active').toBe(UNIQUE);
            expect(await refusal(campaign({ state: 'paused' }))).toBeNull();
            expect(await refusal(campaign({ state: 'ended' }))).toBeNull();
            expect(await refusal(campaign({ state: 'draft' }))).toBeNull();
            expect(await refusal(campaign({ state: 'running' as InviteCampaign['state'] })), 'a state nobody has heard of').toBe(CHECK);
        });

        it('gives looks the shop sells, never a bundle, over a window that ends after it starts', async () =>
        {
            expect(await refusal(campaign({ inviterItem: 'bundle.jade' })), 'a bundle').toBe(CHECK);
            expect(await refusal(campaign({ inviteeItem: 'frame.nowhere' })), 'a look nobody sells').toBe(FOREIGN);
            expect(await refusal(campaign({ inviterItem: null, inviteeItem: null })), 'a campaign giving nothing yet').toBeNull();
            expect(await refusal(campaign({ startsAt: new Date('2026-11-02'), endsAt: new Date('2026-11-01') })), 'ending before it starts').toBe(CHECK);
            expect(await refusal(campaign({ most: 0 })), 'a limit of nothing').toBe(CHECK);
            expect(await refusal(campaign({ milestones: { count: 5 } as unknown as InviteCampaign['milestones'] })), 'milestones that are no list').toBe(CHECK);
            expect(await refusal(campaign({ name: 'ab' })), 'a name too short').toBe(CHECK);
        });
    });

    describe('a reward', () =>
    {
        it('is given once for an invite in a campaign, and once a milestone', async () =>
        {
            const inviter = await makeUser();
            const friend = await makeUser();
            const first = (await campaign()).identifiers[0].id as string;
            const second = (await campaign()).identifiers[0].id as string;

            await reward(first, inviter, { inviteeId: friend });

            expect(await refusal(reward(first, inviter, { inviteeId: friend })), 'the inviter\'s twice').toBe(UNIQUE);
            expect(await refusal(reward(first, friend, { inviteeId: friend, kind: 'invitee' })), 'the friend\'s own').toBeNull();
            expect(await refusal(reward(first, friend, { inviteeId: friend, kind: 'invitee' })), 'the friend\'s twice').toBe(UNIQUE);
            expect(await refusal(reward(second, inviter, { inviteeId: friend })), 'in another campaign').toBeNull();

            await reward(first, inviter, { kind: 'milestone', milestone: 5, itemId: 'theme.jade' });

            expect(await refusal(reward(first, inviter, { kind: 'milestone', milestone: 5, itemId: 'theme.jade' })), 'a milestone twice').toBe(UNIQUE);
            expect(await refusal(reward(first, inviter, { kind: 'milestone', milestone: 10, itemId: 'theme.jade' })), 'the next milestone').toBeNull();
        });

        it('says its milestone, its decision and what it gave in the states that have them', async () =>
        {
            const inviter = await makeUser();
            const friend = await makeUser();
            const id = (await campaign()).identifiers[0].id as string;

            expect(await refusal(reward(id, inviter, { kind: 'milestone' })), 'a milestone at no number').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { kind: 'milestone', milestone: 5, inviteeId: friend })), 'a milestone of one friend').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { inviteeId: friend, milestone: 5 })), 'an invite\'s with a number').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { inviteeId: friend, decidedAt: new Date() })), 'waiting, yet decided').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { inviteeId: friend, state: 'given', decidedAt: new Date() })), 'given, nothing said of what').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { inviteeId: friend, state: 'refused', decidedAt: new Date(), delivered: false })), 'refused, yet delivered').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { inviteeId: friend, state: 'refused', decidedAt: new Date(), reason: 'no' })), 'a reason too short').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { inviteeId: friend, itemId: 'bundle.jade' })), 'a bundle').toBe(CHECK);
            expect(await refusal(reward(id, inviter, { inviteeId: friend, state: 'given', decidedAt: new Date(), delivered: true })), 'given, and said so').toBeNull();
        });
    });

    describe('a referral', () =>
    {
        it('carries flags once it has counted, and only the flags there are', async () =>
        {
            const inviter = await makeUser();
            const friend = await makeUser();
            const other = await makeUser();

            expect(await refusal(db.getRepository(Referral).insert({ inviteeId: friend, inviterId: inviter, flags: [] })), 'flags before it counted').toBe(CHECK);
            expect(await refusal(db.getRepository(Referral).insert({ inviteeId: friend, inviterId: inviter, countedAt: new Date(), flags: ['quick', 'odd' as 'quick'] })), 'a flag nobody has heard of').toBe(CHECK);
            expect(await refusal(db.getRepository(Referral).insert({ inviteeId: friend, inviterId: inviter, countedAt: new Date(), flags: ['quick', 'ring'] }))).toBeNull();
            expect(await refusal(db.getRepository(Referral).insert({ inviteeId: other, inviterId: inviter, code: 'EEEE6666' })), 'a code nobody holds').toBe(FOREIGN);
        });

        it('keeps the invite, with nobody\'s code, when whoever invited is gone', async () =>
        {
            const inviter = await makeUser();
            const friend = await makeUser();

            await db.getRepository(InviteCode).insert({ code: 'FFFF7777', userId: inviter });
            await db.getRepository(Referral).insert({ inviteeId: friend, inviterId: inviter, code: 'FFFF7777' });
            await db.getRepository(User).delete({ id: inviter });

            expect(await db.getRepository(Referral).findOneBy({ inviteeId: friend })).toMatchObject({ inviterId: null, code: null });
        });
    });

    it('lists nobody among the top inviters twice', async () =>
    {
        const owner = await makeUser();

        await db.getRepository(InviteBoardOff).insert({ userId: owner });

        expect(await refusal(db.getRepository(InviteBoardOff).insert({ userId: owner }))).toBe(UNIQUE);
    });
});

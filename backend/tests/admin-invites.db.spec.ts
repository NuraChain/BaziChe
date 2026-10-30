import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { EquippedItem, InviteCampaign, InviteCode, InviteReward, InviteVisit, Notification, OwnedItem, Referral, StaffAction, User, entities } from '../src/entities/index.ts';
import { INVITE_DAYS, INVITES_PAGE } from '../src/domains/admin/roles.ts';
import type { InviteFlag, RewardKind, RewardState } from '../src/domains/invite/policy.ts';
import { createInviteService } from '../src/domains/invite/service.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'
];

const OWNER = 5;

const REASON = 'Getting the spring campaign ready';

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    vaultAddress: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

let rung: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        rung.push(`${ userId } ${ what }`);
    },
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
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number | null = null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({ handle: `v${ seq }x${ Math.floor(Math.random() * 100000) }`, displayName: `Person ${ seq }`, hue: seq % 360, kind: 'wallet' });

    if (wallet !== null)
    {
        await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`, [made.id, WALLETS[wallet]]);
    }

    return { id: made.id, handle: made.handle };
};

/** The status and word a refusal answers with, or nothing when the call went through. */
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

const staff = async () =>
{
    const owner = await makeUser(OWNER);
    const admin = await makeUser(1);

    await ports.admin.setStaff(owner.id, { handle: admin.handle, role: 'admin', reason: 'Runs the invites this spring' });

    return { owner, admin };
};

const CAMPAIGN = { name: 'Bring a friend', inviterItem: 'dice.glow', inviteeItem: 'pawns.glow', milestones: [], review: false, reason: REASON };

const written = async (by: Person, extra: Partial<Parameters<Services['admin']['writeCampaign']>[1]> = {}) =>
    (await ports.admin.writeCampaign(by.id, { ...CAMPAIGN, ...extra }))!;

const started = async (by: Person, extra: Partial<Parameters<Services['admin']['writeCampaign']>[1]> = {}) =>
{
    const campaign = await written(by, extra);

    return (await ports.admin.moveCampaign(by.id, campaign.id, { to: 'active', reason: REASON }))!;
};

const logged = async (kind: 'invite-campaign' | 'invite-reward') =>
    (await db.getRepository(StaffAction).find({ where: { kind }, order: { createdAt: 'ASC' } }))
        .map((row) => ({ staff: row.staffHandle, role: row.staffRole, person: row.personHandle, reason: row.reason, details: row.details }));

/** A friend of `inviter` brought in under `campaignId`, counted when `counted` says so. */
const referred = async (inviter: Person, campaignId: string | null, counted = true, flags: InviteFlag[] | null = null) =>
{
    const friend = await makeUser();

    await db.getRepository(Referral).insert({ inviteeId: friend.id, inviterId: inviter.id, code: null, campaignId, countedAt: counted ? new Date() : null, flags: counted ? flags : null });

    return friend;
};

/** A reward written by hand as a count or a decision would have left it. */
const rewarded = async (campaignId: string, person: Person, extra: { kind?: RewardKind; invitee?: Person | null; milestone?: number; item?: string; state?: RewardState; delivered?: boolean } = {}) =>
{
    const state = extra.state ?? 'review';
    const kind = extra.kind ?? 'inviter';
    const made = await db.getRepository(InviteReward).save({
        campaignId,
        userId: person.id,
        inviteeId: kind === 'milestone' ? null : (extra.invitee === undefined ? person.id : extra.invitee?.id ?? null),
        kind,
        milestone: kind === 'milestone' ? extra.milestone ?? 2 : null,
        itemId: extra.item ?? 'dice.glow',
        state,
        delivered: state === 'given' || state === 'taken' ? extra.delivered ?? true : null,
        decidedAt: state === 'review' ? null : new Date()
    });

    return made.id;
};

const looks = async (userId: string) =>
    (await db.getRepository(OwnedItem).find({ where: { userId }, order: { itemId: 'ASC' } })).map((one) => `${ one.itemId } ${ one.via }`);

const waitingOnLocks = async () =>
    rowsOf<{ count: number }>(await db.query(`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`))[0].count;

/** Asks several things at once with every write to `table` held until all of them wait, so each has read what it reads before any has written. */
const crossing = async <T>(count: number, ask: (index: number) => Promise<T>, table: string) =>
{
    const gate = db.createQueryRunner();

    await gate.connect();
    await gate.startTransaction();
    await gate.query(`lock table ${ table } in share mode`);

    const answers = Array.from({ length: count }, (_, index) => ask(index).then((value) => ({ value }), (error: unknown) => ({ error })));

    try
    {
        await vi.waitFor(async () => expect(await waitingOnLocks()).toBe(count), { timeout: 5_000, interval: 5 });
    }
    finally
    {
        await gate.commitTransaction();
        await gate.release();
    }

    return await Promise.all(answers);
};

describe.skipIf(!active)('Admin › Invites, against a real database', () =>
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
            await db.query('delete from invite_campaigns');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        rung = [];
        await db.query('truncate table users cascade');
        await db.query('delete from invite_campaigns');
    });

    it('answers a moderator, a player and a suspended admin as a page that is not there on every route, and changes nothing for them', async () =>
    {
        const { owner, admin } = await staff();
        const moderator = await makeUser(2);
        const player = await makeUser();
        const campaign = await written(owner);
        const reward = await rewarded(campaign.id, player);

        await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the reports' });
        await db.getRepository(User).update({ id: admin.id }, { isSuspended: true });

        for (const who of [moderator, player, admin])
        {
            expect(await ports.admin.invites(who.id)).toBeNull();
            expect(await ports.admin.campaigns(who.id, {})).toBeNull();
            expect(await ports.admin.writeCampaign(who.id, CAMPAIGN)).toBeNull();
            expect(await ports.admin.changeCampaign(who.id, campaign.id, { ...CAMPAIGN, name: 'Taken over' })).toBeNull();
            expect(await ports.admin.moveCampaign(who.id, campaign.id, { to: 'active', reason: REASON })).toBeNull();
            expect(await ports.admin.rewards(who.id, {})).toBeNull();
            expect(await ports.admin.decideReward(who.id, reward, { to: 'given', reason: REASON })).toBeNull();
        }

        expect((await db.getRepository(InviteCampaign).find()).map((one) => [one.name, one.state])).toEqual([['Bring a friend', 'draft']]);
        expect((await db.getRepository(InviteReward).findOneByOrFail({ id: reward })).state).toBe('review');
        expect(await looks(player.id)).toEqual([]);
    });

    describe('campaigns', () =>
    {
        it('writes a campaign as a draft that gives nothing yet, in the log with its reason', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin, { milestones: [{ count: 10, item: 'decoration.jade' }, { count: 3, item: 'nameplate.glow' }], most: 4, review: true });

            expect(campaign).toEqual({
                id: campaign.id,
                name: 'Bring a friend',
                state: 'draft',
                inviterItem: 'dice.glow',
                inviteeItem: 'pawns.glow',
                milestones: [{ count: 3, item: 'nameplate.glow' }, { count: 10, item: 'decoration.jade' }],
                most: 4,
                review: true,
                at: campaign.at,
                by: admin.handle,
                running: false,
                gave: false,
                joined: 0,
                played: 0,
                given: 0,
                waiting: 0,
                refused: 0,
                taken: 0
            });
            expect(await logged('invite-campaign')).toEqual([{ staff: admin.handle, role: 'admin', person: null, reason: REASON, details: { campaign: campaign.id, name: 'Bring a friend', to: 'draft' } }]);
        });

        it('refuses one that gives nothing, a look the shop does not sell, a bundle, two milestones at one count and a window that ends first, and writes nothing', async () =>
        {
            const { admin } = await staff();
            const write = (extra: Partial<Parameters<Services['admin']['writeCampaign']>[1]>) => word(ports.admin.writeCampaign(admin.id, { ...CAMPAIGN, ...extra }));

            expect(await write({ inviterItem: undefined, inviteeItem: undefined })).toBe('422 staff-campaign-empty');
            expect(await write({ inviterItem: 'dice.nowhere' })).toBe('422 staff-campaign-look');
            expect(await write({ inviteeItem: 'bundle.glow' })).toBe('422 staff-campaign-look');
            expect(await write({ milestones: [{ count: 3, item: 'nameplate.nowhere' }] }), 'a milestone\'s look').toBe('422 staff-campaign-look');
            expect(await write({ milestones: [{ count: 3, item: 'nameplate.glow' }, { count: 3, item: 'decoration.jade' }] })).toBe('422 staff-campaign-milestone');
            expect(await write({ startsAt: '2027-03-01T00:00:00Z', endsAt: '2027-02-01T00:00:00Z' })).toBe('422 staff-campaign-window');
            expect(await write({ startsAt: 'the first of spring' })).toBe('422 staff-campaign-window');
            expect(await db.getRepository(InviteCampaign).count()).toBe(0);
            expect(await logged('invite-campaign')).toEqual([]);
        });

        it('starts, pauses, starts again and ends a campaign, each in the log, one running at a time, and an ended one for good', async () =>
        {
            const { admin } = await staff();
            const first = await written(admin);
            const second = await written(admin, { name: 'Second wave' });
            const move = (id: string, to: 'active' | 'paused' | 'ended') => ports.admin.moveCampaign(admin.id, id, { to, reason: REASON });

            expect(await word(move(first.id, 'paused')), 'a draft').toBe('409 staff-campaign-move');
            expect(await move(first.id, 'active')).toMatchObject({ state: 'active', running: true });
            expect(await move(first.id, 'active'), 'where it is').toMatchObject({ state: 'active' });
            expect(await word(move(second.id, 'active'))).toBe('409 staff-campaign-running');
            expect(await move(first.id, 'paused')).toMatchObject({ state: 'paused', running: false });
            expect(await move(second.id, 'active')).toMatchObject({ state: 'active', running: true });
            expect(await word(move(first.id, 'active')), 'the second runs now').toBe('409 staff-campaign-running');
            expect(await move(first.id, 'ended')).toMatchObject({ state: 'ended', running: false });
            expect(await word(move(first.id, 'paused'))).toBe('409 staff-campaign-ended');
            expect(await word(ports.admin.changeCampaign(admin.id, first.id, { ...CAMPAIGN, name: 'Back again' }))).toBe('409 staff-campaign-ended');
            expect((await logged('invite-campaign')).map((row) => [row.details.name, row.details.to])).toEqual([
                ['Bring a friend', 'draft'],
                ['Second wave', 'draft'],
                ['Bring a friend', 'active'],
                ['Bring a friend', 'paused'],
                ['Second wave', 'active'],
                ['Bring a friend', 'ended']
            ]);
        });

        it('starts one whose window has not come as active and not running, and refuses to start one whose end has passed', async () =>
        {
            const { admin } = await staff();
            const later = await written(admin, { startsAt: new Date(Date.now() + 86_400_000).toISOString() });
            const past = await written(admin, { name: 'Last winter', endsAt: new Date(Date.now() - 86_400_000).toISOString() });

            expect(await ports.admin.moveCampaign(admin.id, later.id, { to: 'active', reason: REASON })).toMatchObject({ state: 'active', running: false });

            await ports.admin.moveCampaign(admin.id, later.id, { to: 'ended', reason: REASON });

            expect(await word(ports.admin.moveCampaign(admin.id, past.id, { to: 'active', reason: REASON }))).toBe('422 staff-campaign-window');
            expect(await ports.admin.moveCampaign(admin.id, 'not-a-campaign', { to: 'active', reason: REASON })).toBeNull();
            expect(await ports.admin.moveCampaign(admin.id, '3f0e3c2a-1111-4222-8333-444455556666', { to: 'active', reason: REASON })).toBeNull();
        });

        it('changes what a campaign gives only while it has written no reward, anything else at any time, and writes nothing for a change to nothing', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const change = (extra: Partial<Parameters<Services['admin']['writeCampaign']>[1]>) => ports.admin.changeCampaign(admin.id, campaign.id, { ...CAMPAIGN, ...extra });

            expect(await change({ name: 'Bring two friends', most: 3 })).toMatchObject({ name: 'Bring two friends', most: 3 });
            expect(await change({ name: 'Bring two friends', most: 3 }), 'nothing changed').toMatchObject({ name: 'Bring two friends' });
            expect(await change({ name: 'Bring two friends', most: 3, milestones: [{ count: 5, item: 'decoration.jade' }, { count: 2, item: 'nameplate.glow' }] }))
                .toMatchObject({ milestones: [{ count: 2, item: 'nameplate.glow' }, { count: 5, item: 'decoration.jade' }] });

            await rewarded(campaign.id, await makeUser());

            expect(await word(change({ name: 'Bring two friends', most: 3, inviterItem: 'dice.jade' }))).toBe('409 staff-campaign-gave');
            expect(await word(change({ name: 'Bring two friends', most: 3, milestones: [] }))).toBe('409 staff-campaign-gave');
            expect(await change({ name: 'Bring two friends', most: 3, milestones: [{ count: 2, item: 'nameplate.glow' }, { count: 5, item: 'decoration.jade' }], review: true })).toMatchObject({ review: true, gave: true });
            expect((await logged('invite-campaign')).map((row) => [row.details.to, row.details.fields ?? ''])).toEqual([
                ['draft', ''],
                ['changed', 'name most'],
                ['changed', 'milestones'],
                ['changed', 'review']
            ]);
            expect(await ports.admin.changeCampaign(admin.id, '3f0e3c2a-1111-4222-8333-444455556666', CAMPAIGN)).toBeNull();
        });

        it('makes a change to what a campaign gives wait for a count giving under it, and then refuses it', async () =>
        {
            const { admin } = await staff();
            const campaign = await started(admin);
            const inviter = await makeUser();
            const friend = await referred(inviter, campaign.id);
            const gate = db.createQueryRunner();

            await gate.connect();
            await gate.startTransaction();
            await gate.query('lock table invite_rewards in share mode');

            const giving = createInviteService(db, () => []).reward({ inviterId: inviter.id, inviteeId: friend.id, flags: null, campaignId: campaign.id });

            await vi.waitFor(async () => expect(await waitingOnLocks()).toBe(1), { timeout: 5_000, interval: 5 });

            const changing = word(ports.admin.changeCampaign(admin.id, campaign.id, { ...CAMPAIGN, inviterItem: 'dice.jade' }));

            await vi.waitFor(async () => expect(await waitingOnLocks()).toBe(2), { timeout: 5_000, interval: 5 });
            await gate.commitTransaction();
            await gate.release();

            expect((await giving).map((one) => one.itemId).sort()).toEqual(['dice.glow', 'pawns.glow']);
            expect(await changing).toBe('409 staff-campaign-gave');
            expect((await db.getRepository(InviteCampaign).findOneByOrFail({ id: campaign.id })).inviterItem).toBe('dice.glow');
        });

        it('starts one of two campaigns started at once', async () =>
        {
            const { admin } = await staff();
            const both = [await written(admin), await written(admin, { name: 'Second wave' })];
            const answers = await crossing(2, (index) => word(ports.admin.moveCampaign(admin.id, both[index].id, { to: 'active', reason: REASON })), 'invite_campaigns');

            expect(answers.map((answer) => ('value' in answer ? answer.value : 'threw')).sort((left, right) => String(left).localeCompare(String(right)))).toEqual(['409 staff-campaign-running', null]);
            expect(await db.getRepository(InviteCampaign).countBy({ state: 'active' })).toBe(1);
        });

        it('lists every campaign newest first, fifty a page, with what came of each', async () =>
        {
            const { admin } = await staff();
            const oldest = await written(admin, { name: 'The first one' });

            for (let at = 0; at < INVITES_PAGE; at += 1)
            {
                await written(admin, { name: `Campaign ${ at }` });
            }

            const inviter = await makeUser();
            const friend = await referred(inviter, oldest.id);

            await referred(inviter, oldest.id, false);
            await rewarded(oldest.id, inviter, { invitee: friend, state: 'given' });
            await rewarded(oldest.id, friend, { kind: 'invitee', item: 'pawns.glow' });

            const first = (await ports.admin.campaigns(admin.id, {}))!;
            const second = (await ports.admin.campaigns(admin.id, { cursor: first.cursor }))!;

            expect(first.campaigns.map((one) => one.name)).toEqual(Array.from({ length: INVITES_PAGE }, (_, at) => `Campaign ${ INVITES_PAGE - 1 - at }`));
            expect(second.campaigns).toEqual([expect.objectContaining({ name: 'The first one', joined: 2, played: 1, given: 1, waiting: 1, refused: 0, taken: 0, gave: true })]);
            expect(second.cursor).toBeUndefined();
        });
    });

    describe('rewards', () =>
    {
        it('gives a reward that waits, owned as a reward with the person told, and refuses another with nobody told', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const inviter = await makeUser();
            const friend = await referred(inviter, campaign.id, true, ['quick']);
            const theirs = await rewarded(campaign.id, inviter, { invitee: friend });
            const friends = await rewarded(campaign.id, friend, { kind: 'invitee', invitee: friend, item: 'pawns.glow' });

            expect(await ports.admin.decideReward(admin.id, theirs, { to: 'given', reason: 'Sara is a real friend of theirs' })).toMatchObject({
                state: 'given',
                delivered: true,
                decidedBy: admin.handle,
                reason: 'Sara is a real friend of theirs',
                flags: ['quick']
            });
            expect(await looks(inviter.id)).toEqual(['dice.glow reward']);
            expect(rung).toContain(`${ inviter.id } shop`);
            expect((await db.getRepository(Notification).findBy({ userId: inviter.id, kind: 'invite-reward' })).map((one) => [one.actorId, one.ref])).toEqual([[friend.id, { item: 'dice.glow' }]]);

            rung = [];

            expect(await ports.admin.decideReward(admin.id, friends, { to: 'refused', reason: 'Played only the one quick game' })).toMatchObject({ state: 'refused', decidedBy: admin.handle });
            expect(await looks(friend.id)).toEqual([]);
            expect(rung).toEqual([]);
            expect(await db.getRepository(Notification).countBy({ userId: friend.id, kind: 'invite-reward' })).toBe(0);
            expect((await logged('invite-reward')).map((row) => [row.staff, row.person, row.details.to, row.details.item, row.details.reward])).toEqual([
                [admin.handle, inviter.handle, 'given', 'dice.glow', theirs],
                [admin.handle, friend.handle, 'refused', 'pawns.glow', friends]
            ]);
        });

        it('takes a given reward back off every slot it was worn in, ringing a profile only for a profile\'s look, and keeps a look the reward did not bring', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const inviter = await makeUser();
            const frame = await rewarded(campaign.id, inviter, { kind: 'milestone', item: 'decoration.jade', state: 'given' });
            const dice = await rewarded(campaign.id, inviter, { invitee: await referred(inviter, campaign.id), state: 'given', delivered: false });

            await db.getRepository(OwnedItem).insert([
                { userId: inviter.id, itemId: 'decoration.jade', via: 'reward', orderId: null, giverId: null },
                { userId: inviter.id, itemId: 'dice.glow', via: 'grant', orderId: null, giverId: null }
            ]);
            await db.getRepository(EquippedItem).insert({ userId: inviter.id, slot: 'profile.decoration', itemId: 'decoration.jade' });

            expect(await ports.admin.decideReward(admin.id, frame, { to: 'taken', reason: 'The ring of friends was one person' })).toMatchObject({ state: 'taken', delivered: true });
            expect(await looks(inviter.id)).toEqual(['dice.glow grant']);
            expect(await db.getRepository(EquippedItem).countBy({ userId: inviter.id })).toBe(0);
            expect(rung).toEqual([`${ inviter.id } shop`, `${ inviter.id } profile`]);

            rung = [];

            expect(await ports.admin.decideReward(admin.id, dice, { to: 'taken', reason: 'The ring of friends was one person' })).toMatchObject({ state: 'taken', delivered: false });
            expect(await looks(inviter.id), 'given by the staff before, not by the reward').toEqual(['dice.glow grant']);
            expect(rung).toEqual([]);
        });

        it('refuses a decision a reward\'s state does not allow and giving to a suspended account, and writes nothing for one it has', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const person = await makeUser();
            const waiting = await rewarded(campaign.id, person);
            const given = await rewarded(campaign.id, person, { invitee: await makeUser(), item: 'pawns.glow', state: 'given' });
            const refused = await rewarded(campaign.id, person, { invitee: await makeUser(), item: 'nameplate.glow', state: 'refused' });
            const decide = (id: string, to: 'given' | 'refused' | 'taken') => ports.admin.decideReward(admin.id, id, { to, reason: REASON });

            expect(await word(decide(waiting, 'taken'))).toBe('409 staff-reward-move');
            expect(await word(decide(given, 'refused'))).toBe('409 staff-reward-move');
            expect(await word(decide(refused, 'given'))).toBe('409 staff-reward-move');
            expect(await decide(given, 'given'), 'given already').toMatchObject({ state: 'given' });

            await db.getRepository(User).update({ id: person.id }, { isSuspended: true });

            expect(await word(decide(waiting, 'given'))).toBe('409 staff-reward-suspended');
            expect(await decide(waiting, 'refused')).toMatchObject({ state: 'refused' });
            expect((await logged('invite-reward')).map((row) => row.details.to)).toEqual(['refused']);
            expect(await decide('not-a-reward', 'given')).toBeNull();
            expect(await decide('3f0e3c2a-1111-4222-8333-444455556666', 'given')).toBeNull();
        });

        it('holds a decision to the rank rule: nobody decides their own reward, nor one of somebody at or above them', async () =>
        {
            const { owner, admin } = await staff();
            const other = await makeUser(3);
            const campaign = await written(owner);

            await ports.admin.setStaff(owner.id, { handle: other.handle, role: 'admin', reason: 'Helps with the invites' });

            const adminsOwn = await rewarded(campaign.id, admin);
            const ownersReward = await rewarded(campaign.id, owner, { invitee: await makeUser() });
            const peersReward = await rewarded(campaign.id, other, { invitee: await makeUser() });

            expect(await word(ports.admin.decideReward(admin.id, adminsOwn, { to: 'given', reason: REASON }))).toBe('409 staff-self');
            expect(await word(ports.admin.decideReward(admin.id, ownersReward, { to: 'given', reason: REASON }))).toBe('409 staff-rank');
            expect(await word(ports.admin.decideReward(admin.id, peersReward, { to: 'given', reason: REASON }))).toBe('409 staff-rank');
            expect(await ports.admin.decideReward(owner.id, peersReward, { to: 'given', reason: REASON })).toMatchObject({ state: 'given' });
            expect((await logged('invite-reward')).map((row) => row.staff)).toEqual([owner.handle]);
        });

        it('decides once when two decide one reward at once', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const person = await makeUser();
            const reward = await rewarded(campaign.id, person, { invitee: await makeUser() });
            const answers = await crossing(2, () => ports.admin.decideReward(admin.id, reward, { to: 'given', reason: REASON }), 'staff_actions');

            expect(answers.map((answer) => ('value' in answer ? answer.value?.state : 'threw'))).toEqual(['given', 'given']);
            expect(await logged('invite-reward')).toHaveLength(1);
            expect(await looks(person.id)).toEqual(['dice.glow reward']);
            expect((await db.getRepository(InviteReward).findOneByOrFail({ id: reward })).delivered).toBe(true);
        });

        it('lists them by how they stand, newest first, fifty a page, with the invite\'s flags and the friend each came through', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const inviter = await makeUser();
            const friend = await referred(inviter, campaign.id, true, ['ring', 'many']);

            for (let at = 0; at < INVITES_PAGE; at += 1)
            {
                await rewarded(campaign.id, await makeUser(), { invitee: null, kind: 'milestone', milestone: at + 1 });
            }

            const theirs = await rewarded(campaign.id, inviter, { invitee: friend });
            const friends = await rewarded(campaign.id, friend, { kind: 'invitee', item: 'pawns.glow', state: 'given' });
            const first = (await ports.admin.rewards(admin.id, {}))!;
            const second = (await ports.admin.rewards(admin.id, { cursor: first.cursor }))!;

            expect(first.waiting).toBe(INVITES_PAGE + 1);
            expect(first.rewards[0]).toMatchObject({
                id: theirs,
                kind: 'inviter',
                item: 'dice.glow',
                state: 'review',
                campaign: { id: campaign.id, name: 'Bring a friend' },
                flags: ['ring', 'many'],
                person: { handle: inviter.handle, suspended: false },
                friend: { handle: friend.handle }
            });
            expect(first.rewards.every((one) => one.state === 'review')).toBe(true);
            expect(second.rewards.map((one) => one.kind)).toEqual(['milestone']);
            expect(second.rewards[0].friend, 'a milestone came through nobody').toBeUndefined();
            expect((await ports.admin.rewards(admin.id, { list: 'given' }))!.rewards).toEqual([
                expect.objectContaining({ id: friends, kind: 'invitee', delivered: true, person: expect.objectContaining({ handle: friend.handle }), friend: expect.objectContaining({ handle: inviter.handle }) })
            ]);
            expect((await ports.admin.rewards(admin.id, { list: 'all' }))!.rewards).toHaveLength(INVITES_PAGE);
        });

        it('lists only one person\'s rewards where a handle is named, whatever its case and with an @, the count waiting still everybody\'s', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const one = await makeUser();
            const theirs = await rewarded(campaign.id, one, { kind: 'milestone' });

            await rewarded(campaign.id, await makeUser(), { kind: 'milestone' });

            for (const named of [one.handle, one.handle.toUpperCase(), `@${ one.handle }`])
            {
                expect((await ports.admin.rewards(admin.id, { list: 'all', person: named }))!.rewards.map((row) => row.id), named).toEqual([theirs]);
            }

            expect((await ports.admin.rewards(admin.id, { list: 'all', person: 'nobody' }))!.rewards).toEqual([]);
            expect((await ports.admin.rewards(admin.id, { person: one.handle }))!.waiting).toBe(2);
        });
    });

    describe('one person', () =>
    {
        it('reads on a person\'s page who invited them, what came of their own invites and their rewards newest first, for every role on the staff', async () =>
        {
            const { owner, admin } = await staff();
            const moderator = await makeUser(2);
            const campaign = await written(admin, { name: 'Spring friends' });
            const inviter = await makeUser();
            const person = await referred(inviter, campaign.id, true, ['quick']);
            const theirs = [await referred(person, campaign.id, true, ['ring']), await referred(person, campaign.id, false), await referred(person, null, true)];
            const older = await rewarded(campaign.id, person, { invitee: theirs[0] });
            const newer = await rewarded(campaign.id, person, { kind: 'invitee', item: 'pawns.glow', state: 'given' });

            await db.getRepository(InviteCode).insert({ code: 'ABCDEFGH', userId: inviter.id });
            await db.getRepository(Referral).update({ inviteeId: person.id }, { code: 'ABCDEFGH' });
            await db.query(`update invite_rewards set created_at = now() - interval '1 hour' where id = $1`, [older]);
            await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the reports' });

            const referral = await db.getRepository(Referral).findOneByOrFail({ inviteeId: person.id });

            expect((await ports.admin.person(moderator.id, person.handle))!.invites).toEqual({
                by: {
                    person: { handle: inviter.handle, displayName: expect.any(String), hue: expect.any(Number) },
                    code: 'ABCDEFGH',
                    at: referral.createdAt.toISOString(),
                    countedAt: referral.countedAt!.toISOString(),
                    flags: ['quick'],
                    campaign: { id: campaign.id, name: 'Spring friends' }
                },
                invited: { joined: 3, played: 2, flagged: 1 },
                rewards: [
                    expect.objectContaining({ id: newer, kind: 'invitee', state: 'given' }),
                    expect.objectContaining({ id: older, kind: 'inviter', state: 'review', friend: expect.objectContaining({ handle: theirs[0].handle }) })
                ]
            });
            expect((await ports.admin.person(admin.id, inviter.handle))!.invites, 'nobody invited the inviter').toEqual({ invited: { joined: 1, played: 1, flagged: 1 }, rewards: [] });
        });

        it('says an invite whose inviter is gone with no face, and keeps a person\'s newest fifty rewards, saying there are more', async () =>
        {
            const { admin } = await staff();
            const campaign = await written(admin);
            const inviter = await makeUser();
            const person = await referred(inviter, campaign.id, false);

            for (let at = 0; at <= INVITES_PAGE; at += 1)
            {
                await rewarded(campaign.id, person, { kind: 'milestone', milestone: at + 1 });
            }

            await db.getRepository(User).delete({ id: inviter.id });

            const read = (await ports.admin.person(admin.id, person.handle))!.invites;

            expect(read.by).toEqual({ at: expect.any(String), campaign: { id: campaign.id, name: 'Bring a friend' } });
            expect(read.rewards).toHaveLength(INVITES_PAGE);
            expect(read.more).toBe(true);
        });

        it('counts the rewards waiting on the overview for a role that opens Invites, and for nobody else', async () =>
        {
            const { owner, admin } = await staff();
            const moderator = await makeUser(2);
            const campaign = await written(admin);

            await rewarded(campaign.id, await makeUser(), { kind: 'milestone' });
            await rewarded(campaign.id, await makeUser(), { kind: 'milestone', state: 'given' });
            await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the reports' });

            expect((await ports.admin.overview(admin.id))!.invites).toEqual({ waiting: 1 });
            expect((await ports.admin.overview(owner.id))!.invites).toEqual({ waiting: 1 });
            expect((await ports.admin.overview(moderator.id))!.invites).toBeUndefined();
        });
    });

    it('counts what came of inviting friends by UTC day: today, the week and all, each of the last fourteen days, the top inviters, the campaign running and the rewards waiting', async () =>
    {
        const { admin } = await staff();
        const campaign = await started(admin);
        const busy = await makeUser();
        const quiet = await makeUser();
        const midnight = `(((now() at time zone 'utc')::date)::timestamp at time zone 'utc')`;
        const daysAgo = async (table: string, column: string, where: string, ids: string[], days: number) =>
            db.query(`update ${ table } set ${ column } = ${ midnight } - make_interval(days => $2) + interval '1 minute' where ${ where } = any($1)`, [ids, days]);

        await db.getRepository(InviteCode).insert({ code: 'ABCDEFGH', userId: busy.id });

        const today = rowsOf<{ day: string }>(await db.query(`select ((now() at time zone 'utc')::date)::text as day`))[0].day;
        const dayBefore = (back: number) => new Date(Date.parse(`${ today }T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);

        await db.getRepository(InviteVisit).insert([
            { code: 'ABCDEFGH', visitor: 'a'.repeat(22), day: today },
            { code: 'ABCDEFGH', visitor: 'b'.repeat(22), day: dayBefore(3) },
            { code: 'ABCDEFGH', visitor: 'c'.repeat(22), day: dayBefore(10) },
            { code: 'ABCDEFGH', visitor: 'd'.repeat(22), day: dayBefore(30) }
        ]);

        const now = await referred(busy, campaign.id, true, ['quick']);
        const week = await referred(busy, campaign.id, true);
        const old = await referred(busy, campaign.id, false);
        const other = await referred(quiet, campaign.id, false);

        await daysAgo('referrals', 'created_at', 'invitee_id', [now.id, other.id], 0);
        await daysAgo('referrals', 'counted_at', 'invitee_id', [now.id], 0);
        await daysAgo('referrals', 'created_at', 'invitee_id', [week.id], 3);
        await daysAgo('referrals', 'counted_at', 'invitee_id', [week.id], 3);
        await daysAgo('referrals', 'created_at', 'invitee_id', [old.id], 20);

        const waiting = await rewarded(campaign.id, busy, { invitee: now });
        const given = await rewarded(campaign.id, now, { kind: 'invitee', item: 'pawns.glow', state: 'given' });
        const refused = await rewarded(campaign.id, busy, { invitee: week, state: 'refused' });

        await daysAgo('invite_rewards', 'created_at', 'id', [waiting, given], 0);
        await daysAgo('invite_rewards', 'created_at', 'id', [refused], 5);

        const seen = (await ports.admin.invites(admin.id))!;

        expect(seen.today).toEqual({ visits: 1, joined: 2, played: 1, flagged: 1, given: 1, review: 1, refused: 0, taken: 0 });
        expect(seen.week).toEqual({ visits: 2, joined: 3, played: 2, flagged: 1, given: 1, review: 1, refused: 1, taken: 0 });
        expect(seen.all).toEqual({ visits: 4, joined: 4, played: 2, flagged: 1, given: 1, review: 1, refused: 1, taken: 0 });
        expect(seen.days).toHaveLength(INVITE_DAYS);
        expect(seen.days[0].day).toBe(dayBefore(INVITE_DAYS - 1));
        expect(seen.days.at(-1)).toEqual({ day: today, visits: 1, joined: 2, played: 1 });
        expect(seen.days.find((one) => one.day === dayBefore(3))).toEqual({ day: dayBefore(3), visits: 1, joined: 1, played: 1 });
        expect(seen.days.find((one) => one.day === dayBefore(10))).toEqual({ day: dayBefore(10), visits: 1, joined: 0, played: 0 });
        expect(seen.top.map((one) => [one.person.handle, one.joined, one.played, one.flagged])).toEqual([[busy.handle, 3, 2, 1], [quiet.handle, 1, 0, 0]]);
        expect(seen.running).toMatchObject({ id: campaign.id, running: true, joined: 4, played: 2 });
        expect(seen.waiting).toBe(1);

        await ports.admin.moveCampaign(admin.id, campaign.id, { to: 'paused', reason: REASON });

        expect((await ports.admin.invites(admin.id))!.running, 'nothing runs').toBeUndefined();
    });
});

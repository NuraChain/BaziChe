import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { EquippedItem, EstablishedPlayer, InviteCampaign, InviteCode, InviteVisit, OwnedItem, Referral, StaffMember, User, Wallet, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createInviteService } from '../src/domains/invite/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
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
    chainId: '',
    rpcUrl: '',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    vaultAddress: '',
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

const SHAPE = /^[2-9A-HJKMNP-Z]{8}$/;

const DAY = 24 * 60 * 60 * 1000;

let db: DataSource;
let ports: Services;
let seq = 0;

const idOf = async (handle: string) => (await db.getRepository(User).findOneByOrFail({ handle })).id;

/** A wallet's first sign-in, carrying an invite code when one is given. */
const enter = async (invite?: string) =>
{
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { nonce, message } = await ports.identity.challenge(wallet.address);
    const established = await ports.identity.signInWithWallet({ address: wallet.address, nonce, signature: await wallet.signMessage({ message }), userAgent: 'test', invite });

    return { wallet, account: established.account, id: await idOf(established.account.handle) };
};

const again = async (wallet: ReturnType<typeof privateKeyToAccount>, invite?: string) =>
{
    const { nonce, message } = await ports.identity.challenge(wallet.address);

    return await ports.identity.signInWithWallet({ address: wallet.address, nonce, signature: await wallet.signMessage({ message }), userAgent: 'test', invite });
};

const referrals = async () =>
    (await db.getRepository(Referral).find({ relations: { invitee: true, inviter: true } }))
        .map((row) => ({ invitee: row.invitee.handle, inviter: row.inviter?.handle ?? null, code: row.code, campaign: row.campaignId, counted: row.countedAt !== null }))
        .sort((left, right) => left.invitee.localeCompare(right.invitee));

/** The word a refusal carries and what it says beside it, or nothing when the call went through. */
const refusal = async (call: Promise<unknown>) =>
{
    try
    {
        await call;
        return null;
    }
    catch (error)
    {
        const { status, code, details, message } = error as { status?: number; code?: string; details?: Record<string, string>; message: string };

        return { status, code, message, ...(details === undefined ? {} : { details }) };
    }
};

const MISSING = { status: 404, code: 'invite-missing', message: 'That invite link no longer works.' };

const waitingOnLocks = async () =>
    rowsOf<{ count: number }>(await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ))[0].count;

/**
 * Asks the same thing several times at once with every write to `invite_codes` held until all of
 * them wait there, so each has read what it reads before any has written: a share lock lets a read
 * through and stops an insert.
 */
const crossing = async <T>(count: number, ask: () => Promise<T>) =>
{
    const gate = db.createQueryRunner();

    await gate.connect();
    await gate.startTransaction();
    await gate.query('lock table invite_codes in share mode');

    const answers = Array.from({ length: count }, () => ask().then((value) => ({ value }), (error: unknown) => ({ error })));

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

/** Somebody an invite may count through. */
const vouch = async (id: string) =>
{
    await db.getRepository(EstablishedPlayer).insert({ userId: id });
};

/** The invite service, with the owners the server names as given. */
const invitesWith = (owners: readonly string[] = []) => createInviteService(db, () => owners);

const campaign = async (extra: Partial<InviteCampaign> = {}) =>
    (await db.getRepository(InviteCampaign).save({ name: 'Bring a friend', state: 'active', inviterItem: null, inviteeItem: null, milestones: [], most: null, review: false, ...extra })).id;

/** A game of Ludo for these people, finished with these results, or still being played when nobody has one. */
const game = async (seats: readonly { id: string; result?: 'won' | 'lost' | 'drawn' | 'abandoned' | 'void' }[]) =>
{
    seq += 1;
    const finished = seats.every((seat) => seat.result !== undefined);
    const tableId = rowsOf<{ id: string }>(await db.query(
        `insert into tables (game, code, host_id, seats, mode, privacy, target, cube, blinds, chat, voice, teams)
         values ('ludo', $1, $2, $3, 'live', 'public', 0, false, 'low', true, 'off', false)
         returning id`,
        [`i${ seq }${ Math.floor(Math.random() * 1_000_000) }`, seats[0].id, seats.length]
    ))[0].id;
    const matchId = rowsOf<{ id: string }>(await db.query(
        finished
            ? `insert into matches (table_id, game, variant, seats, state, rev, finished_at, outcome)
               values ($1, 'ludo', 'standard', $2, '{"rev": 0}'::jsonb, 0, now(), 'won') returning id`
            : `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
               values ($1, 'ludo', 'standard', $2, '{"rev": 0}'::jsonb, 0, now() + interval '1 hour') returning id`,
        [tableId, seats.length]
    ))[0].id;

    for (const [seat, player] of seats.entries())
    {
        await db.query(`insert into match_players (match_id, seat, user_id, result) values ($1, $2, $3, $4)`, [matchId, seat, player.id, player.result ?? null]);
    }

    return matchId;
};

describe.skipIf(!active)('invites, against a real database', () =>
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
            await db.query('truncate table users, avatars cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        await db.query('truncate table users, avatars cascade');
        await db.query('delete from invite_campaigns');
    });

    describe('a code of one\'s own', () =>
    {
        it('is made the first time it is asked for, and kept, with the link that carries it', async () =>
        {
            const { id } = await enter();

            expect(await db.getRepository(InviteCode).countBy({ userId: id }), 'nothing made before it was asked for').toBe(0);

            const first = await ports.invites.summary(id);

            expect(first.code).toMatch(SHAPE);
            expect(first.link).toBe(`${ CONFIG.origin }/join/${ first.code }`);
            expect(Math.abs(Date.parse(first.since) - Date.now())).toBeLessThan(60_000);
            expect(first).not.toHaveProperty('next');
            expect(await ports.invites.summary(id)).toEqual(first);
            expect(await db.getRepository(InviteCode).countBy({ userId: id })).toBe(1);
        });

        it('is one code for asks that cross, each having found none before any was made', async () =>
        {
            const { id } = await enter();
            const codes = (await crossing(6, () => ports.invites.summary(id))).map((one) => ('value' in one ? one.value.code : `refused: ${ String(one.error) }`));

            expect(new Set(codes).size, codes.join(', ')).toBe(1);
            expect(codes[0]).toMatch(SHAPE);
            expect(await db.getRepository(InviteCode).countBy({ userId: id })).toBe(1);
        });

        it('is a different code for each person', async () =>
        {
            const people = await Promise.all(Array.from({ length: 4 }, () => enter()));
            const codes = await Promise.all(people.map((one) => ports.invites.summary(one.id)));

            expect(new Set(codes.map((one) => one.code)).size).toBe(4);
        });

        it('is retired for a new one at most once a day, which says when the next may be made', async () =>
        {
            const { id } = await enter();
            const first = await ports.invites.summary(id);
            const renewed = await ports.invites.renew(id);

            expect(renewed.code).toMatch(SHAPE);
            expect(renewed.code).not.toBe(first.code);
            expect(renewed.link).toBe(`${ CONFIG.origin }/join/${ renewed.code }`);
            expect(Math.abs(Date.parse(renewed.next!) - Date.now() - DAY)).toBeLessThan(60_000);
            expect(await ports.invites.summary(id), 'the new code, and when the next may be made').toEqual(renewed);
            expect(await refusal(ports.invites.card(first.code)), 'a link with the old code no longer works').toEqual(MISSING);

            expect(await refusal(ports.invites.renew(id)), 'a second the same day').toEqual({
                status: 409,
                code: 'invite-code-soon',
                message: 'A new code can be made once a day.',
                details: { at: renewed.next }
            });

            await db.query(`update invite_codes set created_at = created_at - interval '1 day', retired_at = retired_at - interval '1 day' where user_id = $1 and retired_at is not null`, [id]);

            const later = await ports.invites.renew(id);

            expect(later.code).not.toBe(renewed.code);
            expect(await db.getRepository(InviteCode).countBy({ userId: id })).toBe(3);
            expect(await db.query(`select count(*)::int as live from invite_codes where user_id = $1 and retired_at is null`, [id])).toEqual([{ live: 1 }]);
        });

        it('is simply made when the first one asked for is a new one', async () =>
        {
            const { id } = await enter();
            const made = await ports.invites.renew(id);

            expect(made.code).toMatch(SHAPE);
            expect(made).not.toHaveProperty('next');
            expect(await ports.invites.summary(id)).toEqual(made);
        });

        it('is renewed once when two asks for a new one cross', async () =>
        {
            const { id } = await enter();
            const first = await ports.invites.summary(id);
            const answers = await crossing(2, () => refusal(ports.invites.renew(id)));
            const refused = answers.map((one) => ('value' in one ? one.value : { thrown: String(one.error) }));

            expect(refused.filter((one) => one === null)).toHaveLength(1);
            expect(refused.filter((one) => one !== null)).toMatchObject([{ status: 409, code: 'invite-code-soon' }]);
            expect(await db.getRepository(InviteCode).countBy({ userId: id })).toBe(2);
            expect((await ports.invites.summary(id)).code).not.toBe(first.code);
        });
    });

    describe('the page a link opens', () =>
    {
        it('shows whoever invited as their public profile shows them, and nothing more', async () =>
        {
            const { id, account } = await enter();
            await db.getRepository(User).update({ id }, { displayName: 'Sara Kamali', hue: 140 });
            const { code } = await ports.invites.summary(id);

            expect(await ports.invites.card(code)).toEqual({ inviter: { handle: account.handle, displayName: 'Sara Kamali', hue: 140 } });
            expect(await ports.invites.card(code.toLowerCase()), 'in any case').toEqual({ inviter: { handle: account.handle, displayName: 'Sara Kamali', hue: 140 } });
        });

        it('shows no face for a minor, whose link still works', async () =>
        {
            const { id } = await enter();
            await db.getRepository(User).update({ id }, { isMinor: true, allowStrangerMessages: false });
            const { code } = await ports.invites.summary(id);

            expect(await ports.invites.card(code)).toEqual({});
        });

        it('answers a retired code, one nobody holds, one that is no code and a suspended account\'s alike', async () =>
        {
            const { id } = await enter();
            const { id: suspended } = await enter();
            const retired = (await ports.invites.summary(id)).code;
            await ports.invites.renew(id);
            const theirs = (await ports.invites.summary(suspended)).code;
            await db.getRepository(User).update({ id: suspended }, { isSuspended: true });

            for (const code of [retired, 'ZZZZ2222', 'not-a-code', '', theirs])
            {
                expect(await refusal(ports.invites.card(code)), code).toEqual(MISSING);
                expect(await refusal(ports.invites.visit(code, 'v'.repeat(22), null)), code).toEqual(MISSING);
            }
        });
    });

    describe('a visit', () =>
    {
        it('is a device once a day, never the code\'s own owner, a signed-in stranger counted as anybody', async () =>
        {
            const { id } = await enter();
            const { id: stranger } = await enter();
            const { code } = await ports.invites.summary(id);

            await ports.invites.visit(code, 'a'.repeat(22), null);
            await ports.invites.visit(code.toLowerCase(), 'a'.repeat(22), null);
            await ports.invites.visit(code, 'b'.repeat(22), stranger);
            await ports.invites.visit(code, 'c'.repeat(22), id);

            const visits = await db.getRepository(InviteVisit).find({ order: { visitor: 'asc' } });

            expect(visits.map((one) => [one.code, one.visitor])).toEqual([[code, 'a'.repeat(22)], [code, 'b'.repeat(22)]]);
            expect(await db.query(`select bool_and(day = (now() at time zone 'utc')::date) as today from invite_visits`)).toEqual([{ today: true }]);
        });

        it('is counted again on another day', async () =>
        {
            const { id } = await enter();
            const { code } = await ports.invites.summary(id);

            await ports.invites.visit(code, 'a'.repeat(22), null);
            await db.query(`update invite_visits set day = day - 1`);
            await ports.invites.visit(code, 'a'.repeat(22), null);

            expect(await db.getRepository(InviteVisit).countBy({ code })).toBe(2);
        });
    });

    describe('a new account', () =>
    {
        it('is credited to the live code it came by, in any case, with the campaign running when it was made', async () =>
        {
            const { id: inviterId, account: inviter } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            const running = await campaign();
            const { account: first } = await enter(code.toLowerCase());

            await db.getRepository(InviteCampaign).update({ id: running }, { state: 'ended' });
            await campaign({ state: 'draft' });
            const { account: second } = await enter(` ${ code } `);

            expect(await referrals()).toEqual([
                { invitee: first.handle, inviter: inviter.handle, code, campaign: running, counted: false },
                { invitee: second.handle, inviter: inviter.handle, code, campaign: null, counted: false }
            ].sort((left, right) => left.invitee.localeCompare(right.invitee)));
        });

        it('belongs to no campaign that is active outside its window', async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            const later = await campaign({ startsAt: new Date(Date.now() + DAY) });
            await enter(code);

            await db.getRepository(InviteCampaign).update({ id: later }, { startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - DAY) });
            await enter(code);

            expect((await referrals()).map((one) => one.campaign)).toEqual([null, null]);
        });

        it('is credited once, at its first sign-in, and never moved', async () =>
        {
            const { id: inviterId, account: inviter } = await enter();
            const { id: otherId } = await enter();
            const [mine, theirs] = await Promise.all([ports.invites.summary(inviterId), ports.invites.summary(otherId)]);
            const { wallet, account: invitee } = await enter(mine.code);

            await again(wallet, theirs.code);

            expect((await referrals()).map((one) => [one.invitee, one.inviter])).toEqual([[invitee.handle, inviter.handle]]);

            const { wallet: late } = await enter();
            await again(late, mine.code);

            expect(await referrals(), 'an account that already existed is nobody\'s invite').toHaveLength(1);
        });

        it('is let go of, without a word, for a code nobody holds, a retired one, a suspended inviter\'s and anything that is no code', async () =>
        {
            const { id } = await enter();
            const { id: suspended } = await enter();
            const retired = (await ports.invites.summary(id)).code;
            await ports.invites.renew(id);
            const theirs = (await ports.invites.summary(suspended)).code;
            await db.getRepository(User).update({ id: suspended }, { isSuspended: true });

            for (const invite of ['ZZZZ2222', retired, theirs, 'sara.k', '', 'x'.repeat(32)])
            {
                const { account } = await enter(invite);

                expect(account.handle, invite).not.toBe('');
            }

            expect(await referrals()).toEqual([]);
        });
    });

    describe('a friend who played', () =>
    {
        it('counts once the friend finishes a game the inviter did not play in, and names who invited them', async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            const { id: friend } = await enter(code);
            const { id: stranger } = await enter();
            const invites = invitesWith();

            await vouch(stranger);
            expect(await invites.countedBy(await game([{ id: friend, result: 'won' }, { id: inviterId, result: 'lost' }])), 'a game with the inviter').toEqual({ game: 'ludo', counted: [] });
            expect(await invites.countedBy(await game([{ id: friend }, { id: stranger }])), 'a game still being played').toEqual({ game: 'ludo', counted: [] });
            expect(await invites.countedBy(await game([{ id: friend, result: 'abandoned' }, { id: stranger }, { id: (await enter()).id }])), 'a game the friend walked out of that goes on').toEqual({ game: 'ludo', counted: [] });
            expect(await invites.countedBy(await game([{ id: friend, result: 'void' }, { id: stranger, result: 'void' }])), 'a game that counted for nobody').toEqual({ game: 'ludo', counted: [] });
            expect((await referrals()).map((one) => one.counted)).toEqual([false]);

            const played = await game([{ id: friend, result: 'lost' }, { id: stranger, result: 'won' }]);

            expect(await invites.countedBy(played)).toEqual({ game: 'ludo', counted: [{ inviterId, inviteeId: friend, flags: ['quick'], campaignId: null }] });
            expect(await invites.countedBy(played), 'counted once').toEqual({ game: 'ludo', counted: [] });
            expect((await referrals()).map((one) => one.counted)).toEqual([true]);
        });

        it('counts every friend in a game the inviter did not play in, flagged as a ring, and none in one they did', async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            const [one, two, three] = await Promise.all([enter(code), enter(code), enter(code)]);
            const { id: stranger } = await enter();
            const invites = invitesWith();

            await vouch(stranger);
            expect(await invites.countedBy(await game([{ id: one.id, result: 'won' }, { id: two.id, result: 'lost' }, { id: stranger, result: 'lost' }, { id: inviterId, result: 'lost' }]))).toEqual({ game: 'ludo', counted: [] });

            const counted = (await invites.countedBy(await game([{ id: one.id, result: 'won' }, { id: two.id, result: 'abandoned' }, { id: three.id, result: 'lost' }, { id: stranger, result: 'lost' }]))).counted;

            expect(counted.map((row) => row.inviteeId).sort()).toEqual([one.id, two.id, three.id].sort());
            expect(counted.every((row) => row.inviterId === inviterId)).toBe(true);
            expect(counted.map((row) => row.flags)).toEqual([['quick', 'ring'], ['quick', 'ring'], ['quick', 'ring']]);
        });

        it('counts nothing for a game nobody has heard of', async () =>
        {
            expect(await invitesWith().countedBy('3f0e3c2a-1111-4222-8333-444455556666')).toEqual({ game: '', counted: [] });
        });
    });

    describe('who an invite counts through', () =>
    {
        /** A friend of a new inviter, and somebody nobody brought in. */
        const pair = async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            const { id: friend } = await enter(code);
            const { id: stranger, wallet } = await enter();

            return { inviterId, code, friend, stranger, address: wallet.address.toLowerCase() };
        };

        it('counts nothing through a game where nobody vouches for it, and counts once somebody does', async () =>
        {
            const { friend, stranger } = await pair();

            expect((await invitesWith().countedBy(await game([{ id: friend, result: 'won' }, { id: stranger, result: 'lost' }]))).counted).toEqual([]);

            await vouch(stranger);

            expect((await invitesWith().countedBy(await game([{ id: friend, result: 'lost' }, { id: stranger, result: 'won' }]))).counted.map((row) => row.inviteeId)).toEqual([friend]);
        });

        it('counts through a member of the staff and through the owner, with no row of their own', async () =>
        {
            const staffed = await pair();
            const owned = await pair();

            await db.getRepository(StaffMember).insert({ userId: staffed.stranger, role: 'moderator', grantedBy: null });

            expect((await invitesWith().countedBy(await game([{ id: staffed.friend, result: 'won' }, { id: staffed.stranger, result: 'lost' }]))).counted.map((row) => row.inviteeId)).toEqual([staffed.friend]);
            expect((await invitesWith().countedBy(await game([{ id: owned.friend, result: 'won' }, { id: owned.stranger, result: 'lost' }]))).counted, 'nobody the server names').toEqual([]);
            expect((await invitesWith([owned.address]).countedBy(await game([{ id: owned.friend, result: 'won' }, { id: owned.stranger, result: 'lost' }]))).counted.map((row) => row.inviteeId)).toEqual([owned.friend]);
            expect(await db.getRepository(EstablishedPlayer).count()).toBe(0);
        });

        it('takes no word from somebody the same inviter brought in, a suspended account or a player who walked out', async () =>
        {
            const { code, friend, stranger } = await pair();
            const { id: sibling } = await enter(code);
            const { id: walker } = await enter();

            await Promise.all([vouch(stranger), vouch(sibling), vouch(walker)]);
            await db.getRepository(User).update({ id: stranger }, { isSuspended: true });

            for (const [why, other] of [['brought in by the same inviter', sibling], ['suspended', stranger]] as const)
            {
                expect((await invitesWith().countedBy(await game([{ id: friend, result: 'won' }, { id: other, result: 'lost' }]))).counted, why).toEqual([]);
            }

            expect((await invitesWith().countedBy(await game([{ id: friend, result: 'won' }, { id: walker, result: 'abandoned' }]))).counted, 'walked out').toEqual([]);
            expect((await referrals()).filter((one) => one.counted)).toEqual([]);
        });

        it('flags a first game finished within ten minutes of joining, a ring, and the sixth of a day, and nothing else', async () =>
        {
            const { inviterId, code, friend, stranger } = await pair();
            const { id: sibling } = await enter(code);
            const older = async (id: string, minutes: number) => db.query(`update referrals set created_at = now() - make_interval(mins => $2) where invitee_id = $1`, [id, minutes]);

            await vouch(stranger);
            await older(friend, 11);

            expect((await invitesWith().countedBy(await game([{ id: friend, result: 'won' }, { id: stranger, result: 'lost' }]))).counted.map((row) => row.flags), 'eleven minutes after joining').toEqual([null]);
            expect((await invitesWith().countedBy(await game([{ id: sibling, result: 'won' }, { id: friend, result: 'lost' }, { id: stranger, result: 'lost' }]))).counted.map((row) => row.flags), 'with a friend of the same inviter').toEqual([['quick', 'ring']]);

            const today = await Promise.all([0, 1, 2].map(() => enter(code)));

            await db.query(`update referrals set counted_at = now() - interval '2 hours' where invitee_id = any($1)`, [today.map((one) => one.id)]);

            const { id: sixth } = await enter(code);

            await older(sixth, 30);

            expect((await invitesWith().countedBy(await game([{ id: sixth, result: 'won' }, { id: stranger, result: 'lost' }]))).counted.map((row) => row.flags), 'the sixth counted in a day').toEqual([['many']]);
            expect(await db.getRepository(Referral).countBy({ inviterId })).toBe(6);
        });
    });

    describe('a player established', () =>
    {
        /** A player whose account is `days` old, and somebody who vouches. */
        const aged = async (days: number) =>
        {
            const { id: player } = await enter();
            const { id: anchor } = await enter();

            await db.query(`update users set created_at = now() - make_interval(days => $2) where id = $1`, [player, days]);
            await vouch(anchor);

            return { player, anchor };
        };

        /** `count` games the player played out against somebody, each finished, the last one's id answered. */
        const played = async (player: string, other: string, count: number, theirs: 'won' | 'lost' | 'abandoned' = 'won', mine: 'won' | 'lost' | 'void' = 'lost') =>
        {
            let last = '';

            for (let one = 0; one < count; one += 1)
            {
                last = await game([{ id: player, result: mine }, { id: other, result: theirs }]);
            }

            return last;
        };

        it('is somebody a week old who played out five games with somebody who vouches, and is made one once', async () =>
        {
            const { player, anchor } = await aged(8);
            const fifth = await played(player, anchor, 5);

            expect(await invitesWith().establish(fifth)).toEqual([player]);
            expect(await db.getRepository(EstablishedPlayer).findOneBy({ userId: player })).not.toBeNull();
            expect(await invitesWith().establish(fifth), 'once').toEqual([]);
        });

        it('is not somebody short of a week, of five games, of games played out, or of somebody who vouched for them', async () =>
        {
            const young = await aged(6);
            const few = await aged(8);
            const walked = await aged(8);
            const voided = await aged(8);
            const alone = await aged(8);
            const { id: nobody } = await enter();

            expect(await invitesWith().establish(await played(young.player, young.anchor, 5)), 'six days old').toEqual([]);
            expect(await invitesWith().establish(await played(few.player, few.anchor, 4)), 'four games').toEqual([]);
            expect(await invitesWith().establish(await played(walked.player, walked.anchor, 5, 'abandoned')), 'the one who vouches walked out').toEqual([]);
            expect(await invitesWith().establish(await played(voided.player, voided.anchor, 5, 'won', 'void')), 'games that counted for nobody').toEqual([]);
            expect(await invitesWith().establish(await played(alone.player, nobody, 5)), 'nobody who vouches').toEqual([]);
            expect(await db.getRepository(EstablishedPlayer).count()).toBe(5);
        });

        it('is never a suspended account', async () =>
        {
            const { player, anchor } = await aged(8);
            const fifth = await played(player, anchor, 5);

            await db.getRepository(User).update({ id: player }, { isSuspended: true });

            expect(await invitesWith().establish(fifth)).toEqual([]);
        });
    });

    describe('what came of it', () =>
    {
        it('counts the devices that opened any of the person\'s links, the friends who joined and those who played', async () =>
        {
            const { id: inviterId } = await enter();
            const first = (await ports.invites.summary(inviterId)).code;

            await ports.invites.visit(first, 'a'.repeat(22), null);
            await ports.invites.visit(first, 'b'.repeat(22), null);
            await ports.invites.renew(inviterId);

            const second = (await ports.invites.summary(inviterId)).code;

            await ports.invites.visit(second, 'a'.repeat(22), null);

            const { id: friend } = await enter(second);
            await enter(second);
            const { id: gone } = await enter(second);
            const { id: stranger } = await enter();

            await vouch(stranger);
            await invitesWith().countedBy(await game([{ id: friend, result: 'won' }, { id: stranger, result: 'lost' }]));
            await invitesWith().countedBy(await game([{ id: gone, result: 'won' }, { id: stranger, result: 'lost' }]));
            await db.getRepository(User).update({ id: gone }, { isSuspended: true });

            const { id: other } = await enter();
            await ports.invites.visit((await ports.invites.summary(other)).code, 'c'.repeat(22), null);

            expect(await ports.invites.summary(inviterId), 'a retired link\'s visits still counted, a suspended friend not').toMatchObject({ code: second, visits: 3, joined: 2, played: 1 });
            expect(await ports.invites.summary(other)).toMatchObject({ visits: 1, joined: 0, played: 0 });
        });

        it('answers a new code with the counts beside it', async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            await enter(code);

            const renewed = await ports.invites.renew(inviterId);

            expect(renewed).toMatchObject({ visits: 0, joined: 1, played: 0 });
            expect(renewed.code).not.toBe(code);
            expect(renewed.next).toBeDefined();
        });
    });

    describe('the people invited', () =>
    {
        const all = async (inviterId: string) =>
        {
            const seen: { handle: string; played: boolean; joinedAt: string }[] = [];
            let cursor: string | undefined;
            let pages = 0;

            do
            {
                const page = await ports.invites.people(inviterId, cursor ?? null);

                pages += 1;
                seen.push(...page.people.map((one) => ({ handle: one.person.handle, played: one.played, joinedAt: one.joinedAt })));
                cursor = page.cursor;
            }
            while (cursor !== undefined && pages < 10);

            return { seen, pages };
        };

        it('lists them newest first, twenty a page, a page cut in the middle of a millisecond losing nobody', async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            const friends: { id: string; handle: string }[] = [];

            for (let one = 0; one < 23; one += 1)
            {
                const { id, account } = await enter(code);
                friends.push({ id, handle: account.handle });
            }

            for (const [at, friend] of friends.entries())
            {
                await db.query(`update referrals set created_at = timestamptz '2026-10-30 10:00:00+00' + $2 * interval '300 microseconds' where invitee_id = $1`, [friend.id, at]);
            }

            const { seen, pages } = await all(inviterId);

            expect(pages).toBe(2);
            expect(seen.map((one) => one.handle)).toEqual(friends.map((one) => one.handle).reverse());
            expect([seen[0].joinedAt, seen[22].joinedAt], 'when each joined, newest and oldest').toEqual(['2026-10-30T10:00:00.006Z', '2026-10-30T10:00:00.000Z']);
        });

        it('says when each joined and whether they have played, as lists draw a person and nothing more', async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.summary(inviterId);
            const { id: friend, account } = await enter(code);
            const { id: stranger } = await enter();
            await vouch(stranger);
            await db.getRepository(User).update({ id: friend }, { displayName: 'Mina Rad', hue: 300 });
            await invitesWith().countedBy(await game([{ id: friend, result: 'won' }, { id: stranger, result: 'lost' }]));

            const { id: framed, account: dressed } = await enter(code);
            await db.getRepository(User).update({ id: framed }, { displayName: 'Omid', hue: 120, avatar: 'http://localhost:1/avatars/omid.webp' });
            await db.getRepository(OwnedItem).insert({ userId: framed, itemId: 'decoration.jade', via: 'grant', orderId: null, giverId: null });
            await db.getRepository(EquippedItem).insert({ userId: framed, slot: 'profile.decoration', itemId: 'decoration.jade' });

            const page = await ports.invites.people(inviterId, null);

            expect(page.people.map((one) => one.person)).toEqual([
                { handle: dressed.handle, displayName: 'Omid', avatar: 'http://localhost:1/avatars/omid.webp', hue: 120, deco: 'decoration.jade' },
                { handle: account.handle, displayName: 'Mina Rad', hue: 300 }
            ]);
            expect(page.people.map((one) => one.played)).toEqual([false, true]);
            expect(Math.abs(Date.parse(page.people[1].joinedAt) - Date.now())).toBeLessThan(60_000);
            expect(page).not.toHaveProperty('cursor');
        });

        it('leaves out a suspended friend and anybody somebody else invited, and reads a cursor that is none from the top', async () =>
        {
            const { id: inviterId } = await enter();
            const { id: otherId } = await enter();
            const [mine, theirs] = await Promise.all([ports.invites.summary(inviterId), ports.invites.summary(otherId)]);
            const { account: kept } = await enter(mine.code);
            const { id: suspended } = await enter(mine.code);
            await enter(theirs.code);
            await db.getRepository(User).update({ id: suspended }, { isSuspended: true });

            expect((await all(inviterId)).seen.map((one) => one.handle)).toEqual([kept.handle]);
            expect((await ports.invites.people(inviterId, 'not-a-cursor')).people.map((one) => one.person.handle)).toEqual([kept.handle]);
        });
    });
});

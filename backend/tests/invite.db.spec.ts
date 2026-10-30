import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { InviteCampaign, InviteCode, InviteVisit, Referral, User, entities } from '../src/entities/index.ts';
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

            const first = await ports.invites.code(id);

            expect(first.code).toMatch(SHAPE);
            expect(first.link).toBe(`${ CONFIG.origin }/join/${ first.code }`);
            expect(Math.abs(Date.parse(first.since) - Date.now())).toBeLessThan(60_000);
            expect(first).not.toHaveProperty('next');
            expect(await ports.invites.code(id)).toEqual(first);
            expect(await db.getRepository(InviteCode).countBy({ userId: id })).toBe(1);
        });

        it('is one code for asks that cross, each having found none before any was made', async () =>
        {
            const { id } = await enter();
            const codes = (await crossing(6, () => ports.invites.code(id))).map((one) => ('value' in one ? one.value.code : `refused: ${ String(one.error) }`));

            expect(new Set(codes).size, codes.join(', ')).toBe(1);
            expect(codes[0]).toMatch(SHAPE);
            expect(await db.getRepository(InviteCode).countBy({ userId: id })).toBe(1);
        });

        it('is a different code for each person', async () =>
        {
            const people = await Promise.all(Array.from({ length: 4 }, () => enter()));
            const codes = await Promise.all(people.map((one) => ports.invites.code(one.id)));

            expect(new Set(codes.map((one) => one.code)).size).toBe(4);
        });

        it('is retired for a new one at most once a day, which says when the next may be made', async () =>
        {
            const { id } = await enter();
            const first = await ports.invites.code(id);
            const renewed = await ports.invites.renew(id);

            expect(renewed.code).toMatch(SHAPE);
            expect(renewed.code).not.toBe(first.code);
            expect(renewed.link).toBe(`${ CONFIG.origin }/join/${ renewed.code }`);
            expect(Math.abs(Date.parse(renewed.next!) - Date.now() - DAY)).toBeLessThan(60_000);
            expect(await ports.invites.code(id), 'the new code, and when the next may be made').toEqual(renewed);
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
            expect(await ports.invites.code(id)).toEqual(made);
        });

        it('is renewed once when two asks for a new one cross', async () =>
        {
            const { id } = await enter();
            const first = await ports.invites.code(id);
            const answers = await crossing(2, () => refusal(ports.invites.renew(id)));
            const refused = answers.map((one) => ('value' in one ? one.value : { thrown: String(one.error) }));

            expect(refused.filter((one) => one === null)).toHaveLength(1);
            expect(refused.filter((one) => one !== null)).toMatchObject([{ status: 409, code: 'invite-code-soon' }]);
            expect(await db.getRepository(InviteCode).countBy({ userId: id })).toBe(2);
            expect((await ports.invites.code(id)).code).not.toBe(first.code);
        });
    });

    describe('the page a link opens', () =>
    {
        it('shows whoever invited as their public profile shows them, and nothing more', async () =>
        {
            const { id, account } = await enter();
            await db.getRepository(User).update({ id }, { displayName: 'Sara Kamali', hue: 140 });
            const { code } = await ports.invites.code(id);

            expect(await ports.invites.card(code)).toEqual({ inviter: { handle: account.handle, displayName: 'Sara Kamali', hue: 140 } });
            expect(await ports.invites.card(code.toLowerCase()), 'in any case').toEqual({ inviter: { handle: account.handle, displayName: 'Sara Kamali', hue: 140 } });
        });

        it('shows no face for a minor, whose link still works', async () =>
        {
            const { id } = await enter();
            await db.getRepository(User).update({ id }, { isMinor: true, allowStrangerMessages: false });
            const { code } = await ports.invites.code(id);

            expect(await ports.invites.card(code)).toEqual({});
        });

        it('answers a retired code, one nobody holds, one that is no code and a suspended account\'s alike', async () =>
        {
            const { id } = await enter();
            const { id: suspended } = await enter();
            const retired = (await ports.invites.code(id)).code;
            await ports.invites.renew(id);
            const theirs = (await ports.invites.code(suspended)).code;
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
            const { code } = await ports.invites.code(id);

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
            const { code } = await ports.invites.code(id);

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
            const { code } = await ports.invites.code(inviterId);
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
            const { code } = await ports.invites.code(inviterId);
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
            const [mine, theirs] = await Promise.all([ports.invites.code(inviterId), ports.invites.code(otherId)]);
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
            const retired = (await ports.invites.code(id)).code;
            await ports.invites.renew(id);
            const theirs = (await ports.invites.code(suspended)).code;
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
            const { code } = await ports.invites.code(inviterId);
            const { id: friend } = await enter(code);
            const { id: stranger } = await enter();
            const invites = createInviteService(db);

            expect(await invites.countedBy(await game([{ id: friend, result: 'won' }, { id: inviterId, result: 'lost' }])), 'a game with the inviter').toEqual({ game: 'ludo', counted: [] });
            expect(await invites.countedBy(await game([{ id: friend }, { id: stranger }])), 'a game still being played').toEqual({ game: 'ludo', counted: [] });
            expect(await invites.countedBy(await game([{ id: friend, result: 'abandoned' }, { id: stranger }, { id: (await enter()).id }])), 'a game the friend walked out of that goes on').toEqual({ game: 'ludo', counted: [] });
            expect(await invites.countedBy(await game([{ id: friend, result: 'void' }, { id: stranger, result: 'void' }])), 'a game that counted for nobody').toEqual({ game: 'ludo', counted: [] });
            expect((await referrals()).map((one) => one.counted)).toEqual([false]);

            const played = await game([{ id: friend, result: 'lost' }, { id: stranger, result: 'won' }]);

            expect(await invites.countedBy(played)).toEqual({ game: 'ludo', counted: [{ inviterId, inviteeId: friend }] });
            expect(await invites.countedBy(played), 'counted once').toEqual({ game: 'ludo', counted: [] });
            expect((await referrals()).map((one) => one.counted)).toEqual([true]);
        });

        it('counts every friend in a game the inviter did not play in, and none in one they did', async () =>
        {
            const { id: inviterId } = await enter();
            const { code } = await ports.invites.code(inviterId);
            const [one, two, three] = await Promise.all([enter(code), enter(code), enter(code)]);
            const invites = createInviteService(db);

            expect(await invites.countedBy(await game([{ id: one.id, result: 'won' }, { id: two.id, result: 'lost' }, { id: inviterId, result: 'lost' }]))).toEqual({ game: 'ludo', counted: [] });

            const counted = (await invites.countedBy(await game([{ id: one.id, result: 'won' }, { id: two.id, result: 'abandoned' }, { id: three.id, result: 'lost' }]))).counted;

            expect(counted.map((row) => row.inviteeId).sort()).toEqual([one.id, two.id, three.id].sort());
            expect(counted.every((row) => row.inviterId === inviterId)).toBe(true);
        });

        it('counts nothing for a game nobody has heard of', async () =>
        {
            expect(await createInviteService(db).countedBy('3f0e3c2a-1111-4222-8333-444455556666')).toEqual({ game: '', counted: [] });
        });
    });
});

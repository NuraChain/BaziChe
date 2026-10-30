import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { decodeFunctionData, getAddress, toHex, type Hex } from 'viem';

import { TIPS_ABI, tipIdOf } from '../src/chain/tips.ts';
import { Block, Donation, DonationsOff, Message, Notification, PaidAccount, Table, User, Wallet, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import { FAKE_TIPS, fakeTips } from './fake-tips.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NURA = 10n ** 18n;

const HASH: Hex = `0x${ 'cd'.repeat(32) }`;

let db: DataSource;

let seq = 0;

const rung: [string, string][] = [];

const chats: string[] = [];

const listener: WriteListener = {
    chatChanged: (conversationId) =>
    {
        chats.push(conversationId);
    },
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        rung.push([userId, what]);
    },
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
    shopAddress: '',
    tipsAddress: '',
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

const door = (fake = fakeTips()): { ports: Services; fake: ReturnType<typeof fakeTips> } =>
    ({ ports: buildPorts(db, CONFIG, listener, undefined, undefined, undefined, undefined, undefined, fake.tips), fake });

interface Person
{
    id: string;
    handle: string;
    address: string | null;
}

const person = async (options: { wallet?: boolean; minor?: boolean; terms?: boolean; resting?: boolean; suspended?: boolean } = {}): Promise<Person> =>
{
    seq += 1;

    const minor = options.minor ?? false;
    const user = await db.getRepository(User).save({
        handle: `giver${ seq }`,
        displayName: `Giver ${ seq }`,
        hue: 40,
        kind: 'wallet',
        isMinor: minor,
        allowStrangerMessages: !minor,
        isSuspended: options.suspended ?? false
    });
    const address = options.wallet === false ? null : getAddress(`0x${ (0xd0e70000 + seq).toString(16).padStart(40, '0') }`);

    if (address !== null)
    {
        await db.getRepository(Wallet).insert({ userId: user.id, address, attestation: 'wallet', lastUsedAt: new Date() });
    }

    if (options.terms !== false)
    {
        await db.getRepository(PaidAccount).insert({ userId: user.id, acceptedAt: new Date(), breakUntil: options.resting === true ? new Date(Date.now() + 86_400_000) : null });
    }

    return { id: user.id, handle: user.handle, address };
};

/** A live game of Ludo between `players` at a table open to anybody, unless it is by invitation. */
const liveGame = async (ports: Services, players: readonly Person[], privacy: 'public' | 'invite' = 'public') =>
{
    const table = await ports.table.create(players[0].id, {
        game: 'ludo',
        seats: players.length,
        mode: 'live',
        privacy,
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: privacy === 'invite' ? players.slice(1).map((one) => one.handle) : []
    });

    for (const player of players.slice(1))
    {
        await ports.table.claim(player.id, table.id);
    }

    for (const player of players)
    {
        await ports.table.setReady(player.id, table.id, true);
    }

    const match = await ports.match.start(players[0].id, table.id);

    return { tableId: table.id, matchId: match.id };
};

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
        const { status, code, message, details } = error as { status?: number; code?: string; message?: string; details?: unknown };

        return { status, code, message, ...(details === undefined ? {} : { details }) };
    }
};

const gift = (id: string) => db.getRepository(Donation).findOneByOrFail({ id });

/** A game of two, a watcher, and the watcher's gift of five NURA to the first player prepared. */
const prepared = async (amount = 5n * NURA) =>
{
    const { ports, fake } = door();
    const host = await person();
    const guest = await person();
    const watcher = await person();
    const game = await liveGame(ports, [host, guest]);
    const paying = await ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: amount.toString() });

    return { ports, fake, host, guest, watcher, game, paying, amount };
};

describe.skipIf(!active)('donations, against a real database', () =>
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
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        rung.length = 0;
        chats.length = 0;
    });

    describe('what the reader is told', () =>
    {
        it('is closed where no gifts contract is configured, and refuses what would need one', async () =>
        {
            const { ports } = door(fakeTips(false));
            const one = await person();

            expect(await ports.donate.state(one.id)).toEqual({ open: false });
            expect(await refusal(ports.donate.players(one.id, '00000000-0000-4000-8000-000000000000'))).toMatchObject({ status: 404, code: 'donate-off' });
            expect(await refusal(ports.donate.prepare(one.id, { match: 'x', to: 'y', amount: NURA.toString() }))).toMatchObject({ status: 404, code: 'donate-off' });
        });

        it('says whether the reader takes donations, whether they may give, and the amounts in wei', async () =>
        {
            const { ports } = door();
            const one = await person();

            expect(await ports.donate.state(one.id)).toEqual({
                open: true,
                accepting: true,
                may: 'yes',
                presets: ['1', '5', '10', '25', '50', '100'].map((nura) => (BigInt(nura) * NURA).toString()),
                least: NURA.toString(),
                most: (1000n * NURA).toString()
            });
        });

        it('asks of a giver what playing for NURA asks: a wallet, an adult, the terms and no break, in that order', async () =>
        {
            const { ports } = door();

            expect((await ports.donate.state((await person({ wallet: false })).id) as { may: string }).may).toBe('donate-wallet');
            expect((await ports.donate.state((await person({ minor: true })).id) as { may: string }).may).toBe('donate-minor');
            expect((await ports.donate.state((await person({ terms: false })).id) as { may: string }).may).toBe('donate-terms');
            expect((await ports.donate.state((await person({ resting: true })).id) as { may: string }).may).toBe('donate-break');
        });

        it('turns donations off for the reader alone, and on again, ringing the reader', async () =>
        {
            const { ports } = door();
            const one = await person();
            const other = await person();

            expect(await ports.donate.accept(one.id, false)).toEqual({ accepting: false });
            expect(await ports.donate.accept(one.id, false), 'turned off twice').toEqual({ accepting: false });
            expect((await ports.donate.state(one.id) as { accepting: boolean }).accepting).toBe(false);
            expect((await ports.donate.state(other.id) as { accepting: boolean }).accepting).toBe(true);
            expect(await db.getRepository(DonationsOff).countBy({ userId: one.id })).toBe(1);

            await ports.donate.accept(one.id, true);

            expect((await ports.donate.state(one.id) as { accepting: boolean }).accepting).toBe(true);
            expect(await db.getRepository(DonationsOff).countBy({ userId: one.id })).toBe(0);
            expect(rung).toContainEqual([one.id, 'donations']);
        });
    });

    describe('who may be given NURA', () =>
    {
        it('names the players of a game the reader watches, and whether each may be given NURA', async () =>
        {
            const { ports } = door();
            const host = await person();
            const guest = await person();
            const watcher = await person();
            const game = await liveGame(ports, [host, guest]);

            expect(await ports.donate.players(watcher.id, game.matchId)).toEqual({ players: [{ who: host.handle, may: true }, { who: guest.handle, may: true }] });
        });

        it('offers nobody who has no wallet, is under 18, is suspended, takes none or is apart from the reader', async () =>
        {
            const { ports } = door();
            const watcher = await person();
            const plain = await person();
            const walletless = await person({ wallet: false });
            const minor = await person({ minor: true });
            const off = await person();
            const blocked = await person();
            const blocker = await person();
            const game = await liveGame(ports, [plain, walletless, minor, off]);
            const other = await liveGame(ports, [await person(), blocked, blocker]);

            await ports.donate.accept(off.id, false);
            await db.getRepository(Block).insert([{ userId: watcher.id, blockedId: blocked.id }, { userId: blocker.id, blockedId: watcher.id }]);

            expect((await ports.donate.players(watcher.id, game.matchId)).players).toEqual([
                { who: plain.handle, may: true },
                { who: walletless.handle, may: false },
                { who: minor.handle, may: false },
                { who: off.handle, may: false }
            ]);
            expect((await ports.donate.players(watcher.id, other.matchId)).players.map((one) => one.may), 'a block either way').toEqual([true, false, false]);

            await db.getRepository(User).update(plain.id, { isSuspended: true });

            expect((await ports.donate.players(watcher.id, game.matchId)).players[0].may).toBe(false);
        });

        it('offers a player of the game nobody to give to, and somebody who cannot watch the game no players', async () =>
        {
            const { ports } = door();
            const host = await person();
            const guest = await person();
            const stranger = await person();
            const open = await liveGame(ports, [host, guest]);
            const invited = await liveGame(ports, [await person(), await person()], 'invite');

            expect((await ports.donate.players(guest.id, open.matchId)).players.map((one) => one.may)).toEqual([false, false]);
            expect(await ports.donate.players(stranger.id, invited.matchId)).toEqual({ players: [] });
            expect(await ports.donate.players(stranger.id, 'not-a-uuid')).toEqual({ players: [] });

            await db.getRepository(Block).insert({ userId: host.id, blockedId: stranger.id });

            expect(await ports.donate.players(stranger.id, open.matchId), 'a host apart from the reader keeps the game from them').toEqual({ players: [] });
        });

        it('offers no players of a game that has ended', async () =>
        {
            const { ports } = door();
            const host = await person();
            const guest = await person();
            const watcher = await person();
            const game = await liveGame(ports, [host, guest]);

            await db.query(`update matches set finished_at = now(), outcome = 'abandoned', deadline_at = null where id = $1`, [game.matchId]);

            expect(await ports.donate.players(watcher.id, game.matchId)).toEqual({ players: [] });
        });
    });

    describe('a gift prepared', () =>
    {
        it('is written for its giver, its player, its game and its amount, good for half an hour, and handed over as the call', async () =>
        {
            const { fake, host, watcher, game, paying, amount } = await prepared();
            const row = await gift(paying.donation.id);
            const call = fake.calls.at(-1)!;
            const decoded = decodeFunctionData({ abi: TIPS_ABI, data: paying.call.data as Hex });
            const left = (Date.parse(paying.donation.deadline) - Date.now()) / 60_000;

            expect(row).toMatchObject({ giverId: watcher.id, receiverId: host.id, matchId: game.matchId, amount: amount.toString(), state: 'prepared' });
            expect(row.giverAddress).toBe(watcher.address!.toLowerCase());
            expect(row.receiverAddress).toBe(host.address!.toLowerCase());
            expect(left).toBeGreaterThan(29);
            expect(left).toBeLessThanOrEqual(30);
            expect(paying.donation).toMatchObject({ to: host.handle, amount: amount.toString(), state: 'prepared', game: 'ludo' });
            expect(paying.call).toMatchObject({ from: watcher.address, to: FAKE_TIPS, value: toHex(amount), chainId: 31337 });
            expect(decoded.functionName).toBe('tip');
            expect(decoded.args).toEqual([tipIdOf(row.id), getAddress(host.address!), BigInt(Math.floor(row.deadline.getTime() / 1000))]);
            expect(call, 'the call was asked of the contract from the giver first').toMatchObject({ from: getAddress(watcher.address!), id: tipIdOf(row.id), amount });
            expect(rung).toContainEqual([watcher.id, 'donations']);
        });

        it('is handed back when it is asked for again, and a new one is written for another amount', async () =>
        {
            const { ports, host, watcher, game, paying } = await prepared();
            const again = await ports.donate.prepare(watcher.id, { match: game.matchId, to: `@${ host.handle.toUpperCase() }`, amount: (5n * NURA).toString() });
            const other = await ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: (10n * NURA).toString() });

            expect(again.donation.id).toBe(paying.donation.id);
            expect(other.donation.id).not.toBe(paying.donation.id);
            expect(await db.getRepository(Donation).countBy({ giverId: watcher.id })).toBe(2);
        });

        it('is written afresh when the one held has too little time left to be sent', async () =>
        {
            const { ports, host, watcher, game, paying, amount } = await prepared();

            await db.query(`update donations set deadline = now() + interval '90 seconds' where id = $1`, [paying.donation.id]);

            const again = await ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: amount.toString() });

            expect(again.donation.id).not.toBe(paying.donation.id);
            expect(await db.getRepository(Donation).countBy({ giverId: watcher.id })).toBe(2);
        });

        it('is between one and a thousand NURA', async () =>
        {
            const { ports } = door();
            const host = await person();
            const guest = await person();
            const watcher = await person();
            const game = await liveGame(ports, [host, guest]);

            for (const amount of [NURA - 1n, 1000n * NURA + 1n, 0n])
            {
                expect(await refusal(ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: amount.toString() })), amount.toString())
                    .toMatchObject({ status: 422, code: 'donate-amount' });
            }

            expect(await refusal(ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: (1000n * NURA).toString() }))).toBeNull();
            expect(await refusal(ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: NURA.toString() }))).toBeNull();
        });

        it('answers everybody who cannot be given NURA there, and every game that cannot be, in the same bytes', async () =>
        {
            const { ports } = door();
            const host = await person();
            const minor = await person({ minor: true });
            const watcher = await person();
            const game = await liveGame(ports, [host, minor]);
            const invited = await liveGame(ports, [await person(), await person()], 'invite');
            const amount = (5n * NURA).toString();
            const answers = await Promise.all([
                refusal(ports.donate.prepare(watcher.id, { match: game.matchId, to: minor.handle, amount })),
                refusal(ports.donate.prepare(watcher.id, { match: game.matchId, to: 'nobody.here', amount })),
                refusal(ports.donate.prepare(watcher.id, { match: invited.matchId, to: host.handle, amount })),
                refusal(ports.donate.prepare(watcher.id, { match: 'not-a-uuid', to: host.handle, amount }))
            ]);

            for (const answer of answers)
            {
                expect(answer).toEqual({ status: 404, code: 'donate-nobody', message: 'No one by that name can be given NURA here.' });
            }

            expect(await db.getRepository(Donation).count()).toBe(0);
        });

        it('refuses a player of the game, and a giver who may not give, each in its own word', async () =>
        {
            const { ports } = door();
            const host = await person();
            const guest = await person();
            const game = await liveGame(ports, [host, guest]);
            const amount = (5n * NURA).toString();
            const ask = (giver: Person) => refusal(ports.donate.prepare(giver.id, { match: game.matchId, to: host.handle, amount }));

            expect(await ask(guest)).toMatchObject({ status: 409, code: 'donate-playing' });
            expect(await ask(await person({ wallet: false }))).toMatchObject({ status: 409, code: 'donate-wallet' });
            expect(await ask(await person({ minor: true }))).toMatchObject({ status: 409, code: 'donate-minor' });
            expect(await ask(await person({ terms: false }))).toMatchObject({ status: 409, code: 'donate-terms' });
            expect(await ask(await person({ resting: true }))).toMatchObject({ status: 409, code: 'donate-break' });
        });

        it('is not written when the giver\'s wallet does not hold the amount, or when the contract would refuse it', async () =>
        {
            const { ports, fake } = door();
            const host = await person();
            const guest = await person();
            const watcher = await person();
            const game = await liveGame(ports, [host, guest]);
            const ask = () => refusal(ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: (5n * NURA).toString() }));

            fake.state.balance = 5n * NURA - 1n;
            expect(await ask()).toMatchObject({ status: 409, code: 'donate-funds', details: { amount: (5n * NURA).toString(), held: (5n * NURA - 1n).toString() } });

            fake.state.balance = 10n ** 24n;
            fake.state.refuse = 'InsufficientFunds';
            expect(await ask(), 'a node that will not move what the wallet holds').toMatchObject({ status: 409, code: 'donate-funds', details: { held: (10n ** 24n).toString() } });

            fake.state.refuse = 'EnforcedPause';
            expect(await ask()).toMatchObject({ status: 409, code: 'donate-closed' });

            fake.state.refuse = 'TipUsed';
            expect(await ask()).toMatchObject({ status: 409, code: 'donate-refused', details: { error: 'TipUsed' } });

            expect(await db.getRepository(Donation).count()).toBe(0);
        });
    });

    describe('the transaction the wallet sent', () =>
    {
        it('is taken once, for the giver\'s own gift', async () =>
        {
            const { ports, watcher, paying, game, host } = await prepared();
            const sent = await ports.donate.sent(watcher.id, paying.donation.id, HASH.toUpperCase().replace('0X', '0x'));
            const other = await ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: (7n * NURA).toString() });

            expect(sent).toMatchObject({ state: 'sent', hash: HASH });
            expect((await gift(paying.donation.id)).sentAt).not.toBeNull();
            expect(await refusal(ports.donate.sent(watcher.id, other.donation.id, HASH))).toMatchObject({ status: 409, code: 'donate-hash' });
            expect(await refusal(ports.donate.sent(host.id, paying.donation.id, HASH))).toMatchObject({ status: 404, code: 'donate-missing' });
            expect(await refusal(ports.donate.sent(host.id, other.donation.id, `0x${ 'cd'.repeat(32) }`))).toMatchObject({ status: 404, code: 'donate-missing' });
            expect(await gift(other.donation.id), 'somebody else\'s word moved a gift that is not theirs').toMatchObject({ state: 'prepared', txHash: null });
            expect(await refusal(ports.donate.sent(watcher.id, 'not-a-uuid', HASH))).toMatchObject({ status: 404, code: 'donate-missing' });
            expect(await refusal(ports.donate.one(host.id, paying.donation.id))).toMatchObject({ status: 404, code: 'donate-missing' });
        });
    });

    describe('the worker', () =>
    {
        it('confirms a gift the contract holds as it was prepared, tells the player once and says so at the table', async () =>
        {
            const { ports, fake, host, watcher, paying, amount } = await prepared();

            fake.give(watcher.address!, tipIdOf(paying.donation.id), host.address!, amount);
            rung.length = 0;

            expect(await ports.jobs.sweepDonations(4_000)).toMatchObject({ confirmed: 1, faults: [] });
            expect(await ports.jobs.sweepDonations(4_000)).toMatchObject({ confirmed: 0 });

            const row = await gift(paying.donation.id);
            const notices = await db.getRepository(Notification).findBy({ userId: host.id, kind: 'donation' });
            const lines = await db.getRepository(Message).createQueryBuilder('m')
                .where(`m.kind = 'system' and m.payload ->> 'key' = 'chat.line.donation'`)
                .getMany();

            expect(row.state).toBe('confirmed');
            expect(row.confirmedAt).not.toBeNull();
            expect(notices).toHaveLength(1);
            expect(notices[0]).toMatchObject({ actorId: watcher.id, ref: { amount: amount.toString() }, dedupeKey: `donation:${ row.id }` });
            expect(lines).toHaveLength(1);
            expect(lines[0].payload).toEqual({ key: 'chat.line.donation', params: { who: watcher.handle, to: host.handle, amount: amount.toString() } });
            expect(chats).toContain(lines[0].conversationId);
            expect(rung).toEqual(expect.arrayContaining([[watcher.id, 'donations'], [host.id, 'donations'], [host.id, 'notifications']]));
        });

        it('fails a gift the contract holds as something else under its id, and tells nobody', async () =>
        {
            for (const held of ['too little', 'for another player'] as const)
            {
                const { ports, fake, host, guest, watcher, paying, amount } = await prepared();
                const short = held === 'too little';

                fake.give(watcher.address!, tipIdOf(paying.donation.id), short ? host.address! : guest.address!, short ? 1n : amount);

                expect(await ports.jobs.sweepDonations(4_000), held).toMatchObject({ failed: 1 });
                expect(await gift(paying.donation.id), held).toMatchObject({ state: 'failed', failure: 'mismatch' });
            }

            expect(await db.getRepository(Notification).countBy({ kind: 'donation' })).toBe(0);
        });

        it('marks a gift whose transaction the chain refused, with the contract\'s word for it', async () =>
        {
            const { ports, fake, watcher, paying } = await prepared();

            await ports.donate.sent(watcher.id, paying.donation.id, HASH);
            fake.receipts.set(HASH, 'reverted');
            fake.state.refuse = 'EnforcedPause';

            expect(await ports.jobs.sweepDonations(4_000)).toMatchObject({ reverted: 1 });
            expect(await gift(paying.donation.id)).toMatchObject({ state: 'reverted', failure: 'EnforcedPause' });
        });

        it('waits on a transaction still on its way', async () =>
        {
            const { ports, watcher, paying } = await prepared();

            await ports.donate.sent(watcher.id, paying.donation.id, HASH);

            expect(await ports.jobs.sweepDonations(4_000)).toMatchObject({ confirmed: 0, reverted: 0, expired: 0, failed: 0 });
            expect((await gift(paying.donation.id)).state).toBe('sent');
        });

        it('lets go of a gift nobody made once its deadline is well past, and not before', async () =>
        {
            const { ports, paying } = await prepared();

            await db.query(`update donations set deadline = now() - interval '4 minutes' where id = $1`, [paying.donation.id]);
            await ports.jobs.sweepDonations(4_000);
            expect((await gift(paying.donation.id)).state, 'let go inside the lapse').toBe('prepared');

            await db.query(`update donations set deadline = now() - interval '6 minutes' where id = $1`, [paying.donation.id]);

            expect(await ports.jobs.sweepDonations(4_000)).toMatchObject({ expired: 1 });
            expect((await gift(paying.donation.id)).state).toBe('expired');
        });

        it('asks about a gift nobody said they sent only every half minute', async () =>
        {
            const { ports, fake, paying } = await prepared();
            const id = tipIdOf(paying.donation.id);

            await ports.jobs.sweepDonations(4_000);
            await ports.jobs.sweepDonations(4_000);

            expect(fake.asked.filter((one) => one === `tip ${ id }`)).toHaveLength(1);
        });

        it('stops when NuraChain cannot be reached, and moves nothing', async () =>
        {
            const { ports, fake, paying, watcher, game, host } = await prepared();
            const second = await ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: (9n * NURA).toString() });

            fake.state.away = true;

            const swept = await ports.jobs.sweepDonations(4_000);

            expect(swept).toMatchObject({ confirmed: 0, reverted: 0, expired: 0, failed: 0 });
            expect(swept.faults, 'the pass went on asking a chain that had not answered').toHaveLength(1);
            expect((await gift(paying.donation.id)).state).toBe('prepared');
            expect((await gift(second.donation.id)).state).toBe('prepared');
        });
    });

    describe('history', () =>
    {
        it('lists what the reader gave in every state, and what they were given once it was confirmed, newest first', async () =>
        {
            const { ports, fake, host, watcher, game, paying, amount } = await prepared();
            const later = await ports.donate.prepare(watcher.id, { match: game.matchId, to: host.handle, amount: (9n * NURA).toString() });

            fake.give(watcher.address!, tipIdOf(paying.donation.id), host.address!, amount);
            await ports.jobs.sweepDonations(4_000);

            const given = await ports.donate.history(watcher.id, 'given', null);
            const received = await ports.donate.history(host.id, 'received', null);

            expect(given.donations.map((one) => [one.id, one.state, one.to])).toEqual([[later.donation.id, 'prepared', host.handle], [paying.donation.id, 'confirmed', host.handle]]);
            expect(received.donations.map((one) => [one.id, one.from, one.amount])).toEqual([[paying.donation.id, watcher.handle, amount.toString()]]);
            expect(received.donations[0].confirmedAt).toBeDefined();
            expect(await ports.donate.history(host.id, 'given', null)).toEqual({ donations: [] });
        });

        it('reads fifty at a time, every gift once', async () =>
        {
            const { ports, host, watcher, game } = await prepared();

            await db.query(
                `insert into donations (giver_id, receiver_id, match_id, amount, giver_address, receiver_address, deadline, state, created_at)
                 select $1, $2, $3, $4, $5, $6, now(), 'expired', now() - (n || ' seconds')::interval from generate_series(1, 60) as n`,
                [watcher.id, host.id, game.matchId, (2n * NURA).toString(), watcher.address!.toLowerCase(), host.address!.toLowerCase()]
            );

            const first = await ports.donate.history(watcher.id, 'given', null);
            const second = await ports.donate.history(watcher.id, 'given', first.cursor ?? null);
            const ids = [...first.donations, ...second.donations].map((one) => one.id);

            expect(first.donations).toHaveLength(50);
            expect(first.cursor).toBeDefined();
            expect(second.donations).toHaveLength(11);
            expect(second.cursor).toBeUndefined();
            expect(new Set(ids).size).toBe(61);
        });
    });
});

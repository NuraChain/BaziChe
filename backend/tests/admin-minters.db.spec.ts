import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, In } from 'typeorm';
import { decodeFunctionData, getAddress, type Hex } from 'viem';

import { errorResponse } from '@azerothjs/http';

import { NFT_ABI } from '../src/chain/minting.ts';
import { MinterChange, StaffAction, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import type { AdminMinterAsked, AdminMinters } from '../src/schemas.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import { FAKE_ACHIEVEMENTS, FAKE_LOOKS, FAKE_MINTER, MINTER_ROLE, fakeNft } from './fake-nft.ts';

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

const REASON = 'The minter was refused on the looks';

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

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
    callChanged: () => undefined,
    voiceChatChanged: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

let db: DataSource;
let ports: Services;
let fake: ReturnType<typeof fakeNft>;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const door = (nft = fakeNft()) =>
{
    fake = nft;
    ports = buildPorts(db, CONFIG, listener, undefined, undefined, undefined, undefined, undefined, undefined, undefined, nft.chain);
};

const makeUser = async (wallet: number, overrides: Partial<Pick<User, 'isSuspended'>> = {}): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({ handle: `n${ seq }x${ Math.floor(Math.random() * 100000) }`, displayName: `Person ${ seq }`, hue: seq % 360, kind: 'wallet', ...overrides });

    await db.query(
        `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
        [made.id, WALLETS[wallet]]
    );

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

const staff = async () =>
{
    const owner = await makeUser(OWNER);
    const admin = await makeUser(1);
    const moderator = await makeUser(2);
    const coOwner = await makeUser(3);
    const player = await makeUser(4);

    await ports.admin.setStaff(owner.id, { handle: admin.handle, role: 'admin', reason: 'Runs the money' });
    await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the reports' });
    await ports.admin.setStaff(owner.id, { handle: coOwner.handle, role: 'co-owner', reason: 'Runs the server beside me' });

    return { owner, admin, moderator, coOwner, player };
};

/** The owner's wallet holds `DEFAULT_ADMIN_ROLE` on every contract, as the deployer's does. */
const ownsContracts = () =>
{
    for (const held of fake.state.admins.values())
    {
        held.add(WALLETS[OWNER]);
    }
};

const hash = (n: number): Hex => `0x${ n.toString(16).padStart(64, '0') }`;

const board = async (actor: Person) =>
{
    const read = await ports.admin.minters(actor.id);

    if (read === null || !read.configured)
    {
        throw new Error('The page was not there.');
    }

    return read;
};

const cardOf = (read: Extract<AdminMinters, { configured: true }>, key: string) => read.contracts.find((one) => one.key === key);

const grant = (actor: Person, key = 'looks', reason = REASON) => ports.admin.minterGrant(actor.id, key, { reason });

const revoke = (actor: Person, key = 'looks', reason = REASON) => ports.admin.minterRevoke(actor.id, key, { reason });

const reported = (actor: Person, change: string, sent: Hex) => ports.admin.minterSent(actor.id, change, { hash: sent });

/** The owner's wallet sends what it was asked for under `sent`, and says so. */
const walletSends = async (actor: Person, asked: AdminMinterAsked | null, sent: Hex, receipt: 'success' | 'reverted' | 'pending' = 'success') =>
{
    if (asked === null)
    {
        throw new Error('Nothing was asked.');
    }

    if (receipt !== 'pending')
    {
        fake.sends(sent, asked.call, receipt);
    }

    return await reported(actor, asked.change, sent);
};

const logged = async () =>
    (await db.getRepository(StaffAction).find({ where: { kind: In(['minter-grant', 'minter-revoke']) }, order: { createdAt: 'ASC', id: 'ASC' } }))
        .map((row) => [row.kind, row.staffHandle, row.staffRole, row.reason, row.details]);

const changes = async () => (await db.getRepository(MinterChange).find({ order: { createdAt: 'ASC' } })).map((row) => [row.contract, row.operation, row.state, row.failure]);

describe.skipIf(!active)('the NFT minter\'s permissions, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.getRepository(MinterChange).createQueryBuilder().delete().execute();
            await db.getRepository(StaffAction).createQueryBuilder().delete().execute();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(MinterChange).createQueryBuilder().delete().execute();
        await db.getRepository(StaffAction).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        door();
    });

    describe('who may see it and who may change it', () =>
    {
        it('shows it to an admin, a co-owner and the owner, and to nobody below, and lets the owner alone change it', async () =>
        {
            const { owner, admin, moderator, coOwner, player } = await staff();
            const suspended = await makeUser(0, { isSuspended: true });

            ownsContracts();

            const asked = await grant(owner);

            for (const reader of [owner, admin, coOwner])
            {
                expect((await board(reader)).contracts).toHaveLength(2);
            }

            for (const nobody of [moderator, player, suspended])
            {
                expect(await ports.admin.minters(nobody.id)).toBeNull();
            }

            for (const somebody of [admin, coOwner, moderator, player, suspended])
            {
                expect(await grant(somebody)).toBeNull();
                expect(await revoke(somebody)).toBeNull();
                expect(await reported(somebody, asked?.change ?? '', hash(1))).toBeNull();
            }

            expect(await changes()).toEqual([['looks', 'grant', 'asked', '']]);
        });

        it('says it is not set up where the worker has no key, no node or no contract, and refuses to compose anything there', async () =>
        {
            door(fakeNft(false));

            const { owner } = await staff();

            expect(await ports.admin.minters(owner.id)).toEqual({ configured: false });
            expect(await word(grant(owner))).toBe('409 staff-minter-off');
            expect(await word(reported(owner, '00000000-0000-4000-8000-000000000000', hash(1)))).toBe('409 staff-minter-off');
        });
    });

    describe('the dashboard', () =>
    {
        it('reads every contract on its own, so one holding the minter\'s role and one lacking it are told apart, and says whose wallet it asked about', async () =>
        {
            const { owner, admin } = await staff();

            ownsContracts();
            fake.state.minters.get('looks')?.add(FAKE_MINTER.toLowerCase());

            const read = await board(owner);

            expect(read).toMatchObject({ configured: true, chainId: 31337, minter: FAKE_MINTER, admin: getAddress(WALLETS[OWNER]) });
            expect(read.contracts).toEqual([
                { key: 'looks', name: 'Baziche Looks', address: FAKE_LOOKS, state: 'ready', role: MINTER_ROLE, minter: true, admin: true },
                { key: 'achievements', name: 'Baziche Achievements', address: FAKE_ACHIEVEMENTS, state: 'ready', role: MINTER_ROLE, minter: false, admin: true }
            ]);
            expect(read.changes).toEqual([]);
            expect(read).not.toHaveProperty('updatedAt');
            expect(cardOf(await board(admin), 'looks')).toMatchObject({ minter: true, admin: false });
        });

        it('reads the chain as it is every time, so a role changed from outside is seen at once', async () =>
        {
            const { owner } = await staff();

            ownsContracts();
            expect(cardOf(await board(owner), 'achievements')?.minter).toBe(false);

            fake.state.minters.get('achievements')?.add(FAKE_MINTER.toLowerCase());
            expect(cardOf(await board(owner), 'achievements')?.minter).toBe(true);

            fake.state.minters.get('achievements')?.clear();
            expect(cardOf(await board(owner), 'achievements')?.minter).toBe(false);
        });

        it('says why a contract could not be read: another chain, no contract, no roles, or no answer, each for its own contract', async () =>
        {
            const { owner } = await staff();

            fake.state.bare.add('looks');
            fake.state.plain.add('achievements');

            expect((await board(owner)).contracts.map((one) => [one.key, one.state, one.minter ?? null])).toEqual([['looks', 'no-contract', null], ['achievements', 'no-roles', null]]);

            fake.state.bare.clear();
            fake.state.plain.clear();
            fake.state.node = 1020;

            expect((await board(owner)).contracts.map((one) => [one.state, one.node])).toEqual([['wrong-chain', 1020], ['wrong-chain', 1020]]);

            fake.state.node = 31337;
            fake.state.away = true;

            const away = await board(owner);

            expect(away.contracts.map((one) => one.state)).toEqual(['unreachable', 'unreachable']);
            expect(away.changes).toEqual([]);
        });

        it('creates nothing by being read, however many roles are missing: no role is ever granted without the owner asking', async () =>
        {
            const { owner } = await staff();

            ownsContracts();
            await board(owner);
            await board(owner);

            expect(await changes()).toEqual([]);
            expect(await logged()).toEqual([]);
            expect(fake.state.composed).toEqual([]);
            expect([...fake.state.minters.values()].every((held) => held.size === 0)).toBe(true);
        });
    });

    describe('granting the role', () =>
    {
        it('composes grantRole for the minter\'s own address for the owner\'s wallet, writes nothing until a transaction is reported, and logs the result once it is mined and the role reads as asked', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const asked = await grant(owner, 'looks', REASON);

            expect(asked?.call).toMatchObject({ from: getAddress(WALLETS[OWNER]), to: FAKE_LOOKS, value: '0x0', chainId: 31337 });
            expect(decodeFunctionData({ abi: NFT_ABI, data: asked?.call.data as Hex })).toEqual({ functionName: 'grantRole', args: [MINTER_ROLE, FAKE_MINTER] });
            expect(fake.state.composed).toEqual([{ key: 'looks', admin: getAddress(WALLETS[OWNER]), grant: true }]);
            expect(await logged()).toEqual([]);
            expect(cardOf(await board(owner), 'looks')).toMatchObject({ minter: false, open: { state: 'asked', operation: 'grant', by: owner.handle, reason: REASON } });

            const done = await walletSends(owner, asked, hash(1));
            const settled = done !== null && done.configured ? done : null;

            expect(settled?.contracts[0]).toMatchObject({ key: 'looks', state: 'ready', minter: true, admin: true });
            expect(settled?.contracts[0]).not.toHaveProperty('open');
            expect(settled?.changes).toMatchObject([{ operation: 'grant', contract: 'looks', state: 'confirmed', hash: hash(1), by: owner.handle, reason: REASON }]);
            expect(typeof settled?.updatedAt).toBe('string');
            expect(await logged()).toEqual([[
                'minter-grant',
                owner.handle,
                'owner',
                REASON,
                { contract: 'looks', minter: FAKE_MINTER.toLowerCase(), signer: WALLETS[OWNER], hash: hash(1), result: 'confirmed' }
            ]]);
        });

        it('leaves the other contract as it was: each is granted on its own', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            await walletSends(owner, await grant(owner, 'achievements'), hash(2));

            const read = await board(owner);

            expect([cardOf(read, 'looks')?.minter, cardOf(read, 'achievements')?.minter]).toEqual([false, true]);
        });

        it('keeps a change pending while NuraChain has no receipt, refuses another change to that contract meanwhile, and settles it once it is mined', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const asked = await grant(owner);
            const waiting = await walletSends(owner, asked, hash(3), 'pending');

            expect(waiting?.configured && cardOf(waiting, 'looks')?.open).toMatchObject({ state: 'pending', hash: hash(3) });
            expect(await word(grant(owner))).toBe('409 staff-minter-busy');
            expect(await word(revoke(owner))).toBe('409 staff-minter-lacks');
            expect(await grant(owner, 'achievements')).not.toBeNull();
            expect(await logged()).toEqual([]);

            fake.sends(hash(3), asked?.call ?? { from: '', to: '', data: '' });

            const [one, other] = await Promise.all([board(owner), board(owner)]);

            expect([cardOf(one, 'looks')?.minter, cardOf(other, 'looks')?.minter]).toEqual([true, true]);
            expect(await changes()).toEqual([['looks', 'grant', 'confirmed', ''], ['achievements', 'grant', 'asked', '']]);
            expect(await logged(), 'two readers wrote one row').toHaveLength(1);
        });

        it('does not take a second grant for a role the minter holds, nor a revoke of one it lacks, and writes nothing', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            expect(await word(revoke(owner))).toBe('409 staff-minter-lacks');

            fake.state.minters.get('looks')?.add(FAKE_MINTER.toLowerCase());

            expect(await word(grant(owner))).toBe('409 staff-minter-held');
            expect(await changes()).toEqual([]);
        });
    });

    describe('revoking the role', () =>
    {
        it('composes revokeRole, and confirms it once the role reads as gone', async () =>
        {
            const { owner } = await staff();

            ownsContracts();
            fake.state.minters.get('looks')?.add(FAKE_MINTER.toLowerCase());

            const asked = await revoke(owner, 'looks', 'The key was replaced');

            expect(decodeFunctionData({ abi: NFT_ABI, data: asked?.call.data as Hex })).toEqual({ functionName: 'revokeRole', args: [MINTER_ROLE, FAKE_MINTER] });

            const done = await walletSends(owner, asked, hash(4));

            expect(done?.configured && cardOf(done, 'looks')?.minter).toBe(false);
            expect(await logged()).toEqual([[
                'minter-revoke',
                owner.handle,
                'owner',
                'The key was replaced',
                { contract: 'looks', minter: FAKE_MINTER.toLowerCase(), signer: WALLETS[OWNER], hash: hash(4), result: 'confirmed' }
            ]]);
        });
    });

    describe('what is refused before a wallet is asked', () =>
    {
        it('refuses a wallet that does not hold DEFAULT_ADMIN_ROLE on the contract, by the contract\'s word as well as before it', async () =>
        {
            const { owner } = await staff();

            expect(await word(grant(owner))).toBe('409 staff-minter-admin');

            ownsContracts();
            fake.state.admins.get('looks')?.delete(WALLETS[OWNER]);
            fake.state.admins.get('achievements')?.add(WALLETS[OWNER]);

            expect(await word(grant(owner, 'looks'))).toBe('409 staff-minter-admin');
            expect(await grant(owner, 'achievements')).not.toBeNull();

            fake.state.refuse = 'AccessControlUnauthorizedAccount';
            expect(await word(grant(owner, 'achievements'))).toBe('409 staff-minter-admin');
            fake.state.refuse = 'ZeroAddress';
            expect(await word(grant(owner, 'achievements'))).toBe('409 staff-minter-refused');
        });

        it('refuses a node on another chain, a contract that is not there and one with no roles, each in its own word', async () =>
        {
            const { owner } = await staff();

            ownsContracts();
            fake.state.node = 1020;
            expect(await word(grant(owner))).toBe('409 staff-minter-chain');

            fake.state.node = 31337;
            fake.state.bare.add('looks');
            expect(await word(grant(owner, 'looks'))).toBe('409 staff-minter-code');

            fake.state.plain.add('achievements');
            expect(await word(grant(owner, 'achievements'))).toBe('409 staff-minter-roles');
            expect(await changes()).toEqual([]);
        });

        it('knows only the contracts the worker mints on, by their keys: an address, a key it has not got and a path are a page that is not there', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            for (const key of [FAKE_LOOKS, FAKE_LOOKS.toLowerCase(), 'bogus', '../looks', 'LOOKS', ''])
            {
                expect(await grant(owner, key), key).toBeNull();
                expect(await revoke(owner, key), key).toBeNull();
            }

            expect(await changes()).toEqual([]);
            expect(fake.state.composed).toEqual([]);
        });

        it('does not guess when NuraChain cannot be reached: the answer is that, and nothing is written', async () =>
        {
            const { owner } = await staff();

            ownsContracts();
            fake.state.away = true;

            expect(await word(grant(owner))).toBe('503 chain-unreachable');
            expect(await changes()).toEqual([]);
        });
    });

    describe('a change that does not end as asked', () =>
    {
        it('fails, with its reason, when the transaction reverted, and logs the failure', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const done = await walletSends(owner, await grant(owner), hash(5), 'reverted');

            expect(done?.configured && cardOf(done, 'looks')).toMatchObject({ minter: false });
            expect(done?.configured && done.changes[0]).toMatchObject({ state: 'failed', failure: 'reverted', hash: hash(5) });
            expect(await logged()).toEqual([[
                'minter-grant',
                owner.handle,
                'owner',
                REASON,
                { contract: 'looks', minter: FAKE_MINTER.toLowerCase(), signer: WALLETS[OWNER], hash: hash(5), result: 'failed', failure: 'reverted' }
            ]]);
            expect(await grant(owner), 'a failed change stood in the way of the next').not.toBeNull();
        });

        it('fails as unchanged when it was mined and the role still does not read as asked', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const asked = await grant(owner);

            fake.sends(hash(6), asked?.call ?? { from: '', to: '', data: '' });
            fake.state.minters.get('looks')?.clear();

            const done = await reported(owner, asked?.change ?? '', hash(6));

            expect(done?.configured && done.changes[0]).toMatchObject({ state: 'failed', failure: 'unchanged' });
        });

        it('fails as foreign when the transaction is not the change that was asked for: another wallet sent it, or it called something else', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const first = await grant(owner);

            fake.sends(hash(7), { ...(first?.call ?? { from: '', to: '', data: '' }), from: WALLETS[1] });

            const byAnother = await reported(owner, first?.change ?? '', hash(7));

            expect(byAnother?.configured && byAnother.changes[0]).toMatchObject({ state: 'failed', failure: 'foreign' });

            const second = await grant(owner, 'achievements');

            fake.sends(hash(8), { ...(second?.call ?? { from: '', to: '', data: '' }), to: FAKE_LOOKS });

            const elsewhere = await reported(owner, second?.change ?? '', hash(8));

            expect(elsewhere?.configured && elsewhere.changes[0]).toMatchObject({ state: 'failed', failure: 'foreign', contract: 'achievements' });
            expect((await logged()).map((row) => (row[4] as Record<string, string>).result)).toEqual(['failed', 'failed']);
        });

        it('is taken for dropped when no receipt has come for half an hour, by the database\'s clock, and not before', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const asked = await grant(owner);

            await walletSends(owner, asked, hash(9), 'pending');
            await db.query(`update minter_changes set updated_at = now() - interval '25 minutes'`);
            expect(cardOf(await board(owner), 'looks')?.open).toMatchObject({ state: 'pending' });

            await db.query(`update minter_changes set updated_at = now() - interval '31 minutes'`);

            const read = await board(owner);

            expect(cardOf(read, 'looks')).not.toHaveProperty('open');
            expect(read.changes[0]).toMatchObject({ state: 'failed', failure: 'dropped' });
            expect((await logged())[0]?.[4]).toMatchObject({ result: 'failed', failure: 'dropped', hash: hash(9) });
        });

        it('says nothing and leaves it pending while NuraChain cannot be asked', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const asked = await grant(owner);

            await walletSends(owner, asked, hash(10), 'pending');
            fake.sends(hash(10), asked?.call ?? { from: '', to: '', data: '' });
            fake.state.away = true;

            const read = await board(owner);

            expect(read.changes[0]).toMatchObject({ state: 'pending' });
            expect(await logged()).toEqual([]);

            fake.state.away = false;

            expect((await board(owner)).changes[0]).toMatchObject({ state: 'confirmed' });
        });
    });

    describe('one change at a time, and only the owner\'s own', () =>
    {
        it('lets a call asked for and never sent be asked for again, and lets it go after ten minutes', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const first = await grant(owner);
            const second = await grant(owner);

            expect(second?.change).not.toBe(first?.change);
            expect(await changes()).toEqual([['looks', 'grant', 'lapsed', ''], ['looks', 'grant', 'asked', '']]);
            expect(await word(reported(owner, first?.change ?? '', hash(11)))).toBe('409 staff-minter-change');

            await db.query(`update minter_changes set created_at = now() - interval '11 minutes' where state = 'asked'`);

            const read = await board(owner);

            expect(cardOf(read, 'looks')).not.toHaveProperty('open');
            expect(read.changes.map((one) => one.state)).toEqual(['lapsed', 'lapsed']);
            expect(await logged(), 'a call never sent was logged as a change').toEqual([]);
        });

        it('takes the hash from the one who asked, once, and is a page that is not there to anybody else or for anything else', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const asked = await grant(owner);

            expect(await reported(owner, 'not-an-id', hash(12))).toBeNull();
            expect(await reported(owner, '00000000-0000-4000-8000-000000000000', hash(12))).toBeNull();

            const other = await makeUser(0);

            await db.query(`update minter_changes set staff_id = $1`, [other.id]);
            expect(await reported(owner, asked?.change ?? '', hash(12))).toBeNull();
            await db.query(`update minter_changes set staff_id = $1`, [owner.id]);

            await walletSends(owner, asked, hash(12), 'pending');
            expect(await reported(owner, asked?.change ?? '', hash(12)), 'the same hash again').not.toBeNull();
            expect(await word(reported(owner, asked?.change ?? '', hash(13)))).toBe('409 staff-minter-change');
            expect(await changes()).toEqual([['looks', 'grant', 'pending', '']]);
        });

        it('takes one hash for one change: a transaction already another change\'s is refused', async () =>
        {
            const { owner } = await staff();

            ownsContracts();

            const first = await grant(owner, 'looks');

            await walletSends(owner, first, hash(14), 'pending');

            const second = await grant(owner, 'achievements');

            expect(await word(reported(owner, second?.change ?? '', hash(14)))).toBe('409 staff-minter-change');
        });

        it('keeps the owner as they were when it was asked, in the log, whoever settles it and whatever their account has become', async () =>
        {
            const { owner, admin } = await staff();

            ownsContracts();

            const asked = await grant(owner);

            await walletSends(owner, asked, hash(15), 'pending');
            fake.sends(hash(15), asked?.call ?? { from: '', to: '', data: '' });
            await board(admin);

            expect((await logged())[0]?.slice(0, 3)).toEqual(['minter-grant', owner.handle, 'owner']);

            await db.query(`update minter_changes set staff_id = null`);
            await db.getRepository(User).delete({ id: owner.id });

            expect((await db.getRepository(StaffAction).findOneByOrFail({ kind: 'minter-grant' })).staffHandle).toBe(owner.handle);
        });
    });
});

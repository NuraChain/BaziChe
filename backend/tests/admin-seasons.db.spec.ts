import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { SEASON_DAYS } from '../src/domains/admin/roles.ts';
import { PlayerStats, Season, StaffAction, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
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

let db: DataSource;
let ports: Services;
let seq = 0;

const listener = new Proxy({}, { get: () => () => undefined }) as WriteListener;

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number | null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({ handle: `s${ seq }x${ Math.floor(Math.random() * 100000) }`, displayName: `Played ${ seq }`, hue: seq % 360 });

    if (wallet !== null)
    {
        await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`, [made.id, WALLETS[wallet]]);
    }

    return { id: made.id, handle: made.handle };
};

const rated = (person: Person, rating: number, peak = Math.max(rating, 1200)) =>
    db.getRepository(PlayerStats).insert({ userId: person.id, game: 'ludo', rating, peakRating: peak, played: 10, won: 5 });

const ratingOf = async (person: Person) => (await db.getRepository(PlayerStats).findOneByOrFail({ userId: person.id, game: 'ludo' })).rating;

const ask = (name = 'Nowruz') => ({ name, reason: 'A fresh start for spring' });

const refusal = async (work: Promise<unknown>) =>
{
    const error = await work.then(() => null, (thrown: unknown) => thrown);

    if (error === null)
    {
        return null;
    }

    const response = errorResponse(error);

    return { status: response.status, code: (await response.json() as { error: { code: string } }).error.code };
};

describe.skipIf(!active)('seasons, against a real database', () =>
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
            await db.query('truncate table users, seasons cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        await db.query('truncate table users, seasons cascade');
    });

    it('starts a 45-day season, pulls every rating halfway to 1200, and writes it in the log', async () =>
    {
        const owner = await makeUser(OWNER);
        const strong = await makeUser(null);
        const weak = await makeUser(null);
        const fresh = await makeUser(null);

        await rated(strong, 1800, 1850);
        await rated(weak, 1000);
        await rated(fresh, 1200);

        const view = await ports.admin.startSeason(owner.id, ask());
        const [row] = await db.getRepository(Season).find();

        expect(view?.current).toMatchObject({ number: row.id, name: 'Nowruz', ratingsReset: 2, by: owner.handle });
        expect(row.endsAt.getTime() - row.startedAt.getTime()).toBe(SEASON_DAYS * 86_400_000);
        expect([await ratingOf(strong), await ratingOf(weak), await ratingOf(fresh)]).toEqual([1500, 1100, 1200]);
        expect((await db.getRepository(PlayerStats).findOneByOrFail({ userId: strong.id, game: 'ludo' })).peakRating).toBe(1850);

        const logged = await db.getRepository(StaffAction).find({ where: { kind: 'season' } });

        expect(logged.map((one) => [one.staffHandle, one.reason, one.details])).toEqual([
            [owner.handle, 'A fresh start for spring', { number: String(row.id), name: 'Nowruz', days: String(SEASON_DAYS), ratings: '2' }]
        ]);
    });

    it('refuses a second season while one runs, and leaves the ratings as they were', async () =>
    {
        const owner = await makeUser(OWNER);
        const player = await makeUser(null);

        await rated(player, 1800);
        await ports.admin.startSeason(owner.id, ask());

        expect(await refusal(ports.admin.startSeason(owner.id, ask('Again')))).toEqual({ status: 409, code: 'staff-season-running' });
        expect(await ratingOf(player)).toBe(1500);
        expect(await db.getRepository(Season).count()).toBe(1);
    });

    it('makes exactly one season when two staff press start at once', async () =>
    {
        const owner = await makeUser(OWNER);

        const both = await Promise.allSettled([ports.admin.startSeason(owner.id, ask('One')), ports.admin.startSeason(owner.id, ask('Two'))]);

        expect(both.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
        expect(await db.getRepository(Season).count()).toBe(1);
    });

    it('starts the next once the last has run its days, numbered after it', async () =>
    {
        const owner = await makeUser(OWNER);

        await ports.admin.startSeason(owner.id, ask('Spring'));
        await db.query(`update seasons set started_at = now() - interval '50 days', ends_at = now() - interval '5 days'`);

        const view = await ports.admin.startSeason(owner.id, ask('Summer'));

        expect(view?.current?.name).toBe('Summer');
        expect(view?.seasons.map((one) => one.name)).toEqual(['Summer', 'Spring']);
        expect(view!.current!.number).toBe(view!.seasons[1].number + 1);
    });

    it('is not shown or started by a moderator', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);

        await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Watches the tables' });

        expect(await ports.admin.seasons(moderator.id)).toBeNull();
        expect(await ports.admin.startSeason(moderator.id, ask())).toBeNull();
        expect(await db.getRepository(Season).count()).toBe(0);
    });

    it('ranks the season board from the season start, and says which season; between seasons it is empty', async () =>
    {
        const owner = await makeUser(OWNER);

        expect(await ports.match.leaderboard('ludo', 'season')).toEqual({ game: 'ludo', window: 'season', standings: [] });

        await ports.admin.startSeason(owner.id, ask());

        const board = await ports.match.leaderboard('ludo', 'season');

        expect(board.season).toMatchObject({ name: 'Nowruz' });
        expect(board.standings).toEqual([]);
    });
});

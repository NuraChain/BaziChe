import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, Match, Table, TableSeat, Tournament, TournamentEntry, TournamentGame, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;
let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    return (await db.getRepository(User).save({ handle: `t${ seq }x${ Math.floor(Math.random() * 100000) }`, displayName: `Player ${ seq }`, hue: seq % 360 })).id;
};

const crowd = async (size: number) =>
{
    const people: string[] = [];

    for (let index = 0; index < size; index += 1)
    {
        people.push(await makeUser());
    }

    return people;
};

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

const open = (host: string, patch: Partial<Parameters<Services['tournament']['create']>[1]> = {}) =>
    ports.tournament.create(host, { name: 'Friday', game: 'backgammon', format: 'single', size: 4, bestOf: 1, listed: true, startsAt: inAnHour(), ...patch });

const row = (code: string) => db.getRepository(Tournament).findOneByOrFail({ code });

const games = async (code: string) => db.getRepository(TournamentGame).find({ where: { tournamentId: (await row(code)).id }, order: { phase: 'ASC', slot: 'ASC' } });

/** Everybody who was told to wait has waited: the next pass may deal. */
const breakOver = async (code: string) =>
{
    await db.query(`update tournaments set next_round_at = now() - interval '1 second' where code = $1`, [code]);
};

const finishLive = async (code: string, winnerSeat: number | null) =>
{
    const live = (await games(code)).filter((game) => game.dealt && game.how === null);

    for (const game of live)
    {
        await db.query(
            `update matches set finished_at = now(), deadline_at = null, outcome = $2, winner_seat = $3 where id = $1`,
            [game.matchId, winnerSeat === null ? 'drawn' : 'won', winnerSeat]
        );
    }
};

const filled = async (patch: Parameters<typeof open>[1] = {}, size = 4) =>
{
    const people = await crowd(size);
    const made = await open(people[0], { size, ...patch });
    const code = (made as { code: string }).code;

    for (const person of people.slice(1))
    {
        await ports.tournament.join(person, code);
    }

    return { code, people };
};

describe.skipIf(!active)('a tournament, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        ports = buildPorts(db, {
            secret: 'a-test-secret-that-is-long-enough-to-use',
            origin: 'http://localhost:1',
            env: 'test',
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: '',
            adminWallet: ''
        } as Parameters<typeof buildPorts>[1]);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Tournament).createQueryBuilder().delete().execute();
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    it('seats the creator in the first place, and gives each person the next free one', async () =>
    {
        const [host, guest] = await crowd(2);
        const made = await open(host);
        const code = (made as { code: string }).code;
        const joined = await ports.tournament.join(guest, code);

        expect(made?.spot).toBe(1);
        expect(joined?.spot).toBe(2);
    });

    it('refuses a second place, and a place in a full tournament, even when everybody asks at once', async () =>
    {
        const people = await crowd(8);
        const made = await open(people[0]);
        const code = (made as { code: string }).code;

        await expect(ports.tournament.join(people[0], code)).rejects.toMatchObject({ code: 'tournament-entered' });

        await Promise.allSettled(people.slice(1).map((person) => ports.tournament.join(person, code)));

        expect(await db.getRepository(TournamentEntry).countBy({ tournamentId: (await row(code)).id })).toBe(4);
    });

    it('starts the moment the last place is taken, with a break before the first games', async () =>
    {
        const { code } = await filled();

        expect((await row(code)).status).toBe('running');
        expect((await row(code)).nextRoundAt).not.toBeNull();
        expect((await games(code)).filter((game) => game.dealt)).toEqual([]);
    });

    it('cancels at the start time with fewer than four', async () =>
    {
        const [host] = await crowd(1);
        const code = ((await open(host)) as { code: string }).code;

        await db.query(`update tournaments set starts_at = now() - interval '1 second' where code = $1`, [code]);
        await ports.jobs.sweepTournaments();

        expect((await row(code)).status).toBe('cancelled');
    });

    it('runs a whole knockout by itself, to one champion', async () =>
    {
        const { code, people } = await filled();

        for (let phase = 0; phase < 2; phase += 1)
        {
            await breakOver(code);
            await ports.jobs.sweepTournaments();

            expect((await games(code)).some((game) => game.dealt && game.how === null)).toBe(true);

            await finishLive(code, 0);
            await ports.jobs.sweepTournaments();
        }

        const done = await row(code);

        expect(done.status).toBe('finished');
        expect(people).toContain(done.winnerId);
    });

    it('never deals a round twice, however many sweeps run at once', async () =>
    {
        const { code } = await filled();

        await breakOver(code);
        await Promise.all([ports.jobs.sweepTournaments(), ports.jobs.sweepTournaments(), ports.jobs.sweepTournaments()]);

        expect(await db.getRepository(Match).count()).toBe(2);
    });

    it('plays a knockout game with no winner once more, then sends the better seed through', async () =>
    {
        const { code } = await filled();

        await breakOver(code);
        await ports.jobs.sweepTournaments();
        await finishLive(code, null);
        await ports.jobs.sweepTournaments();

        expect((await games(code)).filter((game) => game.round === 1).every((game) => game.attempt === 2 && !game.dealt)).toBe(true);

        await breakOver(code);
        await ports.jobs.sweepTournaments();
        await finishLive(code, null);
        await ports.jobs.sweepTournaments();

        expect((await games(code)).filter((game) => game.round === 1).every((game) => game.how === 'seed')).toBe(true);
    });

    it('will not let anybody take a chair or play again at a tournament table', async () =>
    {
        const { code, people } = await filled();
        const outsider = await makeUser();

        await breakOver(code);
        await ports.jobs.sweepTournaments();

        const [game] = await games(code);
        const tableId = game.tableId as string;
        const seated = (await db.getRepository(TableSeat).findBy({ tableId })).map((chair) => chair.userId);

        await finishLive(code, 0);
        await expect(ports.match.start(seated[0] as string, tableId)).rejects.toMatchObject({ code: 'table-closed' });
        await expect(ports.table.claim(outsider, tableId)).rejects.toMatchObject({ code: 'table-closed' });
        expect(people).toContain(seated[0]);
    });

    it('keeps a link-only tournament out of the list, and finds it by its link', async () =>
    {
        const [host, stranger] = await crowd(2);
        const code = ((await open(host, { listed: false })) as { code: string }).code;

        expect((await ports.tournament.list(stranger, {})).tournaments).toEqual([]);
        expect((await ports.tournament.detail(stranger, code))?.can).toBe('join');
    });

    it('lets only its creator call it off', async () =>
    {
        const [host, stranger] = await crowd(2);
        const code = ((await open(host)) as { code: string }).code;

        await expect(ports.tournament.cancel(stranger, code)).rejects.toMatchObject({ status: 404 });
        expect((await ports.tournament.cancel(host, code))?.status).toBe('cancelled');
    });

    it('runs every format through its first round', async () =>
    {
        for (const format of ['double', 'round-robin', 'swiss', 'groups'] as const)
        {
            const { code } = await filled({ format }, 8);

            await breakOver(code);
            await ports.jobs.sweepTournaments();

            expect((await games(code)).some((game) => game.dealt), format).toBe(true);
        }
    });
});

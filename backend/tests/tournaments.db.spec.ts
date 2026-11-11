import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, Match, StaffMember, StaffAction, Table, TableSeat, Tournament, TournamentEntry, TournamentGame, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { tableList, tableSummary } from '../src/schemas.ts';
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

/** The tables of this tournament still waiting for their players. */
const waiting = async (code: string) => (await games(code)).filter((game) => game.dealt && game.how === null && game.tableId !== null && game.matchId === null);

/** Both players at every waiting table say they are ready, and the next pass deals their games. */
const readyAll = async (code: string) =>
{
    const tables = (await waiting(code)).map((game) => game.tableId as string);

    if (tables.length > 0)
    {
        await db.query(`update table_seats set ready = true where table_id = any($1::uuid[])`, [tables]);
        await ports.jobs.sweepTournaments();
    }
};

/** As if the wait for the players had run out at every table still waiting. */
const waitRunsOut = async (code: string) =>
{
    const tables = (await waiting(code)).map((game) => game.tableId as string);

    await db.query(`update tables set created_at = now() - interval '6 minutes' where id = any($1::uuid[])`, [tables]);
};

const finishLive = async (code: string, winnerSeat: number | null) =>
{
    await readyAll(code);

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

const staffed = async (role: 'moderator' | 'admin') =>
{
    const id = await makeUser();

    await db.getRepository(StaffMember).insert({ userId: id, role, grantedBy: null });

    return id;
};

const handleOf = async (id: string) => (await db.getRepository(User).findOneByOrFail({ id })).handle;

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

        expect(await db.getRepository(Table).count(), 'a round opened twice').toBe(2);

        await db.query(`update table_seats set ready = true`);
        await Promise.all([ports.jobs.sweepTournaments(), ports.jobs.sweepTournaments(), ports.jobs.sweepTournaments()]);

        expect(await db.getRepository(Match).count(), 'a game dealt twice').toBe(2);
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

    it('opens each table to wait for its players, says until when, and deals the game only once both are ready', async () =>
    {
        const { code } = await filled();

        await breakOver(code);
        await ports.jobs.sweepTournaments();

        const [game] = await waiting(code);
        const tableId = game.tableId as string;
        const chairs = await db.getRepository(TableSeat).find({ where: { tableId }, order: { seat: 'ASC' } });
        const first = chairs[0].userId as string;
        const second = chairs[1].userId as string;

        expect(chairs.map((chair) => chair.ready), 'a chair was ready before anybody said so').toEqual([false, false]);
        expect(await db.getRepository(Match).count(), 'a game was dealt before its players were there').toBe(0);

        const shown = (await ports.table.view(first, tableId))!;

        expect(Date.parse(shown.readyBy as string) - Date.parse(shown.createdAt)).toBe(5 * 60_000);

        await ports.table.setReady(first, tableId, true);
        await ports.jobs.sweepTournaments();

        expect((await games(code)).find((one) => one.id === game.id)?.matchId, 'one ready dealt the game').toBeNull();

        await ports.table.setReady(second, tableId, true);

        const dealt = (await ports.table.view(first, tableId))!;

        expect(dealt.matchId, 'the second ready did not deal the game at once').toBeDefined();
        expect(dealt).not.toHaveProperty('readyBy');
    });

    it('gives the game to whoever was ready when the wait runs out, and closes the table', async () =>
    {
        const { code } = await filled();

        await breakOver(code);
        await ports.jobs.sweepTournaments();

        const [game] = await waiting(code);
        const tableId = game.tableId as string;
        const chairs = await db.getRepository(TableSeat).find({ where: { tableId }, order: { seat: 'ASC' } });

        await db.query(`update table_seats set ready = true where table_id = $1 and seat = 1`, [tableId]);
        await ports.jobs.sweepTournaments();

        expect((await games(code)).find((one) => one.id === game.id)?.how, 'it was settled before the wait ran out').toBeNull();

        await waitRunsOut(code);
        await ports.jobs.sweepTournaments();

        const settled = (await games(code)).find((one) => one.id === game.id) as TournamentGame;

        expect(settled.how).toBe('seed');
        expect(settled.winnerSeed).toBe(settled.seedB);
        expect((await db.getRepository(Table).findOneByOrFail({ id: tableId })).status).toBe('closed');
        expect(chairs.map((chair) => chair.userId)).toHaveLength(2);
        expect(await db.getRepository(Match).countBy({ tableId }), 'a walked-over game was dealt').toBe(0);
    });

    it('treats a game nobody turned up to as one with no winner: once more, then the better seed', async () =>
    {
        const { code } = await filled();

        await breakOver(code);
        await ports.jobs.sweepTournaments();
        await waitRunsOut(code);
        await ports.jobs.sweepTournaments();

        expect((await games(code)).filter((game) => game.round === 1).every((game) => game.attempt === 2 && !game.dealt && game.how === null)).toBe(true);

        await breakOver(code);
        await ports.jobs.sweepTournaments();

        expect(await waiting(code), 'the second attempt opened no new tables').toHaveLength(2);

        await waitRunsOut(code);
        await ports.jobs.sweepTournaments();

        expect((await games(code)).filter((game) => game.round === 1).every((game) => game.how === 'seed' && game.winnerSeed === Math.min(game.seedA as number, game.seedB as number))).toBe(true);
        expect(await db.getRepository(Table).countBy({ status: 'open' }), 'a table nobody came to was left open').toBe(0);
    });

    it('closes the tables still waiting when the staff call the tournament off', async () =>
    {
        const { code } = await filled();
        const admin = await staffed('admin');

        await breakOver(code);
        await ports.jobs.sweepTournaments();

        expect(await waiting(code)).toHaveLength(2);

        await ports.admin.cancelTournament(admin, code, { reason: 'Called off for the night.' });

        expect(await db.getRepository(Table).countBy({ status: 'open' })).toBe(0);
    });

    it('shows its players a tournament table, which has no host, in the shape the api promises', async () =>
    {
        const { code } = await filled();

        await breakOver(code);
        await ports.jobs.sweepTournaments();

        const [game] = await games(code);
        const tableId = game.tableId as string;
        const player = (await db.getRepository(TableSeat).findBy({ tableId })).find((chair) => chair.userId !== null)!.userId as string;
        const table = (await ports.table.view(player, tableId))!;

        expect(table.chairs.map((chair) => chair.host), 'a chair of a hostless table said null rather than no').toEqual(table.chairs.map(() => false));
        expect(tableSummary.safeParse(table).ok).toBe(true);
        expect(tableList.safeParse({ tables: await ports.table.mine(player) }).ok).toBe(true);
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

    it('lets the staff take a player out mid-game: the game in hand is theirs to lose, and the rest plays on to a champion who is not them', async () =>
    {
        const { code, people } = await filled();
        const admin = await staffed('admin');

        await breakOver(code);
        await ports.jobs.sweepTournaments();

        const out = people[1];
        const entries = await db.getRepository(TournamentEntry).findBy({ tournamentId: (await row(code)).id });
        const seedOut = entries.find((entry) => entry.userId === out)?.seed as number;
        const inHand = (await games(code)).find((game) => game.dealt && game.how === null && (game.seedA === seedOut || game.seedB === seedOut)) as TournamentGame;

        const view = await ports.admin.removeFromTournament(admin, code, { player: await handleOf(out), reason: 'Left the game on purpose.' });

        expect(view?.tournament.entrants.find((entry) => entry.seed === seedOut)?.removed).toBe(true);

        const decided = (await games(code)).find((game) => game.id === inHand.id) as TournamentGame;

        expect(decided.how).toBe('seed');
        expect(decided.winnerSeed).toBe(decided.seedA === seedOut ? decided.seedB : decided.seedA);

        for (let pass = 0; pass < 4 && (await row(code)).status === 'running'; pass += 1)
        {
            await finishLive(code, 0);
            await ports.jobs.sweepTournaments();
            await breakOver(code);
            await ports.jobs.sweepTournaments();
        }

        const done = await row(code);

        expect(done.status).toBe('finished');
        expect(done.winnerId).not.toBe(out);
        expect(await db.getRepository(StaffAction).countBy({ kind: 'tournament' })).toBe(1);
    });

    it('frees the place of somebody taken out before the start', async () =>
    {
        const [host, guest] = await crowd(2);
        const admin = await staffed('admin');
        const code = ((await open(host)) as { code: string }).code;

        await ports.tournament.join(guest, code);
        await ports.admin.removeFromTournament(admin, code, { player: await handleOf(guest), reason: 'Asked to be taken out.' });

        expect(await db.getRepository(TournamentEntry).countBy({ tournamentId: (await row(code)).id })).toBe(1);
        await expect(ports.admin.removeFromTournament(admin, code, { player: await handleOf(guest), reason: 'Twice over.' })).rejects.toMatchObject({ code: 'staff-tournament-player' });
    });

    it('starts one early with whoever is in, and refuses with fewer than four', async () =>
    {
        const [host, ...guests] = await crowd(4);
        const admin = await staffed('admin');
        const code = ((await open(host, { size: 8 })) as { code: string }).code;

        for (const person of guests.slice(0, 2))
        {
            await ports.tournament.join(person, code);
        }

        await expect(ports.admin.startTournament(admin, code, { reason: 'Nobody else is coming.' })).rejects.toMatchObject({ code: 'staff-tournament-few' });
        await ports.tournament.join(guests[2], code);

        expect((await ports.admin.startTournament(admin, code, { reason: 'Nobody else is coming.' }))?.tournament.status).toBe('running');
        await expect(ports.admin.moveTournament(admin, code, { startsAt: inAnHour(), reason: 'Too late now.' })).rejects.toMatchObject({ code: 'staff-tournament-started' });
    });

    it('hides one from the list without touching what its creator chose, and pins another to the top', async () =>
    {
        const [host, other, reader] = await crowd(3);
        const admin = await staffed('admin');
        const first = ((await open(host, { name: 'First' })) as { code: string }).code;
        const second = ((await open(other, { name: 'Second', startsAt: new Date(Date.now() + 7_200_000).toISOString() })) as { code: string }).code;

        await ports.admin.featureTournament(admin, second, { on: true, reason: 'The weekly cup.' });

        expect((await ports.tournament.list(reader, {})).tournaments.map((one) => one.code)).toEqual([second, first]);

        await ports.admin.hideTournament(admin, first, { on: true, reason: 'A rude name.' });

        expect((await ports.tournament.list(reader, {})).tournaments.map((one) => one.code)).toEqual([second]);
        expect((await row(first)).listed).toBe(true);

        await ports.admin.hideTournament(admin, first, { on: false, reason: 'Renamed.' });

        expect((await ports.tournament.list(reader, {})).tournaments).toHaveLength(2);
    });

    it('keeps all of it from a moderator', async () =>
    {
        const [host] = await crowd(1);
        const moderator = await staffed('moderator');
        const code = ((await open(host)) as { code: string }).code;

        await expect(ports.admin.tournament(moderator, code)).resolves.toBeNull();
        await expect(ports.admin.cancelTournament(moderator, code, { reason: 'Not mine to do.' })).resolves.toBeNull();
        expect((await row(code)).status).toBe('open');
    });
});

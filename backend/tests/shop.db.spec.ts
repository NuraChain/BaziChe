import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { MatchPlayer, OwnedItem, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { buildPorts, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let tables: ReturnType<typeof createTableService>;

let seq = 0;

const rung = { self: [] as [string, string][], social: [] as string[][] };

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: (...ids) =>
    {
        rung.social.push(ids);
    },
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        rung.self.push([userId, what]);
    },
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const door = () => buildPorts(db, {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1], listener);

const makeUser = async () =>
{
    seq += 1;

    return db.getRepository(User).save({ handle: `looker${ seq }`, displayName: `Looker ${ seq }`, hue: 40, kind: 'wallet' });
};

const own = (userId: string, ...items: string[]) =>
    db.getRepository(OwnedItem).insert(items.map((itemId) => ({ userId, itemId, via: 'grant' as const })));

/** A game of Ludo for two at a public table, started by `host`. */
const startLudo = async (ports: ReturnType<typeof door>, host: User, guest: User) =>
{
    const table = await tables.create(host.id, {
        game: 'ludo',
        seats: 2,
        mode: 'live',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: []
    });

    await tables.claimSeat(guest.id, table.id);
    await tables.setReady(host.id, table.id, true);
    await tables.setReady(guest.id, table.id, true);

    return await ports.match.start(host.id, table.id);
};

const LOOK_KEYS = ['deco', 'nameplate', 'theme', 'effect'] as const;

/** The looks a read carries, by key, or null when the read did not find the person at all. */
const looksOf = (read: object | null | undefined) => read === null || read === undefined
    ? null
    : Object.fromEntries(LOOK_KEYS.filter((key) => key in read).map((key) => [key, (read as Record<string, unknown>)[key]]));

/** Every read that draws `subject` for `viewer`: the account, the lists, a profile, the public one and both boards. */
const everyRead = async (ports: ReturnType<typeof door>, viewer: User, subject: User) =>
{
    const theirs = <T extends { handle: string }>(rows: readonly T[]) => rows.find((row) => row.handle === subject.handle);
    const [account, graph, directory, found, named, view, shown, all, today] = await Promise.all([
        ports.identity.me(subject.id),
        ports.social.graph(viewer.id),
        ports.social.directory(viewer.id, 60),
        ports.social.search(viewer.id, subject.handle, 20),
        ports.social.names([subject.handle]),
        ports.social.view(viewer.id, subject.handle),
        ports.social.shown(subject.handle),
        ports.match.leaderboard('ludo', 'all'),
        ports.match.leaderboard('ludo', 'today')
    ]);

    return {
        account: looksOf(account),
        friend: looksOf(theirs(graph.friends)),
        directory: looksOf(theirs(directory)),
        search: looksOf(theirs(found)),
        names: looksOf(theirs(named)),
        view: looksOf(view),
        viewed: looksOf(view?.person),
        shown: looksOf(shown),
        face: looksOf(shown?.person),
        all: looksOf(theirs(all.standings)?.person),
        today: looksOf(theirs(today.standings)?.person)
    };
};

const CLASSIC = { account: {}, friend: {}, directory: {}, search: {}, names: {}, view: {}, viewed: {}, shown: {}, face: {}, all: {}, today: {} };

/** The word a refusal carries, or nothing when the call went through. */
const refusal = async (call: Promise<unknown>) =>
{
    try
    {
        await call;
        return null;
    }
    catch (error)
    {
        return { status: (error as { status?: number }).status, code: (error as { code?: string }).code };
    }
};

describe.skipIf(!active)('looks a person owns and chooses, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        tables = createTableService(db, createSocialService(db));
    }, 60_000);

    afterAll(async () =>
    {
        await db?.destroy();
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        rung.self.length = 0;
        rung.social.length = 0;
    });

    it('lists what the reader owns, newest first, how each came and who gave a gift, and what they chose', async () =>
    {
        const me = await makeUser();
        const friend = await makeUser();
        const ports = door();

        await db.getRepository(OwnedItem).insert({ userId: me.id, itemId: 'dice.shiraz', via: 'grant', acquiredAt: new Date(Date.now() - 60_000) });
        await db.getRepository(OwnedItem).insert({ userId: me.id, itemId: 'back.neon', via: 'gift', giverId: friend.id });

        const chosen = await ports.shop.choose(me.id, 'ludo.dice', 'dice.shiraz');

        expect(chosen.chosen).toEqual([{ slot: 'ludo.dice', item: 'dice.shiraz' }]);
        expect(chosen.owned.map((look) => [look.item, look.via, look.from])).toEqual([['back.neon', 'gift', friend.handle], ['dice.shiraz', 'grant', undefined]]);
        expect(chosen.owned.every((look) => !Number.isNaN(Date.parse(look.at)))).toBe(true);
        expect(await ports.shop.collection(me.id)).toEqual(chosen);
        expect(await ports.shop.collection(friend.id)).toEqual({ owned: [], chosen: [] });
    });

    it('chooses only a look of the slot\'s kind the reader owns, and Classic with none', async () =>
    {
        const me = await makeUser();
        const ports = door();

        await own(me.id, 'dice.shiraz', 'pawns.shiraz');

        expect(await refusal(ports.shop.choose(me.id, 'ludo.dice', 'pawns.shiraz'))).toEqual({ status: 422, code: 'shop-slot' });
        expect(await refusal(ports.shop.choose(me.id, 'ludo.dice', 'bundle.shiraz'))).toEqual({ status: 422, code: 'shop-slot' });
        expect(await refusal(ports.shop.choose(me.id, 'ludo.board' as 'ludo.dice', 'dice.shiraz'))).toEqual({ status: 422, code: 'shop-slot' });
        expect(await refusal(ports.shop.choose(me.id, 'ludo.dice', 'dice.gold'))).toEqual({ status: 409, code: 'shop-not-owned' });

        await ports.shop.choose(me.id, 'ludo.dice', 'dice.shiraz');
        await ports.shop.choose(me.id, 'backgammon.dice', 'dice.shiraz');
        await ports.shop.choose(me.id, 'ludo.dice', 'dice.shiraz');

        expect((await ports.shop.collection(me.id)).chosen).toEqual([
            { slot: 'backgammon.dice', item: 'dice.shiraz' },
            { slot: 'ludo.dice', item: 'dice.shiraz' }
        ]);

        await ports.shop.choose(me.id, 'ludo.dice', null);
        await ports.shop.choose(me.id, 'ludo.pawns', null);

        expect((await ports.shop.collection(me.id)).chosen).toEqual([{ slot: 'backgammon.dice', item: 'dice.shiraz' }]);
    });

    it('takes a look off whatever it was chosen for once it is taken back', async () =>
    {
        const me = await makeUser();
        const ports = door();

        await own(me.id, 'dice.neon');
        await ports.shop.choose(me.id, 'ludo.dice', 'dice.neon');
        await ports.shop.choose(me.id, 'backgammon.dice', 'dice.neon');
        await db.getRepository(OwnedItem).delete({ userId: me.id, itemId: 'dice.neon' });

        expect(await ports.shop.collection(me.id)).toEqual({ owned: [], chosen: [] });
    });

    it('tells the reader\'s own tabs, and everybody who draws them only when the look is on their profile', async () =>
    {
        const me = await makeUser();
        const ports = door();

        await own(me.id, 'dice.gold', 'decoration.gold');
        await ports.shop.choose(me.id, 'ludo.dice', 'dice.gold');

        expect(rung.self).toEqual([[me.id, 'shop']]);
        expect(rung.social).toEqual([]);

        await ports.shop.choose(me.id, 'profile.decoration', 'decoration.gold');

        expect(rung.self).toEqual([[me.id, 'shop'], [me.id, 'shop'], [me.id, 'profile']]);
        expect(rung.social.length).toBe(1);
        expect(rung.social[0]).toContain(me.id);
    });

    it('lets a game keep what each player chose for that game as it starts, and nothing of another game or the profile', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const ports = door();

        await own(host.id, 'dice.shiraz', 'pawns.neon', 'back.gold', 'celebration.glow', 'decoration.glow');

        for (const [slot, item] of [['ludo.dice', 'dice.shiraz'], ['ludo.pawns', 'pawns.neon'], ['hokm.back', 'back.gold'], ['table.celebration', 'celebration.glow'], ['profile.decoration', 'decoration.glow']] as const)
        {
            await ports.shop.choose(host.id, slot, item);
        }

        const started = await startLudo(ports, host, guest);
        const hostSeat = started.players.find((player) => player.who === host.handle);
        const guestSeat = started.players.find((player) => player.who === guest.handle);
        const look = { dice: 'dice.shiraz', pawns: 'pawns.neon', celebration: 'celebration.glow' };

        expect(hostSeat?.look).toEqual(look);
        expect(guestSeat).toBeDefined();
        expect(guestSeat && 'look' in guestSeat).toBe(false);

        const rows = await db.getRepository(MatchPlayer).find({ where: { matchId: started.id }, order: { seat: 'ASC' } });

        expect(rows.map((row) => row.look)).toEqual(rows.map((row) => row.userId === host.id ? look : {}));

        await ports.shop.choose(host.id, 'ludo.dice', null);

        const later = await ports.match.view(guest.id, started.id);

        expect(later?.players.find((player) => player.who === host.handle)?.look).toEqual(look);
    });

    describe('the looks a person chose for their profile', () =>
    {
        const LISTED = { deco: 'decoration.gold', nameplate: 'nameplate.neon' };
        const PAGE = { theme: 'theme.shiraz', effect: 'effect.glow' };

        /**
         * One player who wears all four profile looks and one who wears none, who played a game of
         * Ludo today and stand on the all-time board, and a friend of both who reads them.
         */
        const cast = async (ports: ReturnType<typeof door>) =>
        {
            const wearer = await makeUser();
            const plain = await makeUser();
            const reader = await makeUser();

            await own(wearer.id, 'decoration.gold', 'nameplate.neon', 'theme.shiraz', 'effect.glow');

            for (const [slot, item] of [['profile.decoration', 'decoration.gold'], ['profile.nameplate', 'nameplate.neon'], ['profile.theme', 'theme.shiraz'], ['profile.effect', 'effect.glow']] as const)
            {
                await ports.shop.choose(wearer.id, slot, item);
            }

            await db.query('insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1), ($1, $3), ($3, $1)', [reader.id, wearer.id, plain.id]);

            const game = await startLudo(ports, wearer, plain);

            await db.query(`update matches set finished_at = now(), deadline_at = null, outcome = 'won', winner_seat = 0 where id = $1`, [game.id]);
            await db.query(`update match_players set result = case when seat = 0 then 'won' else 'lost' end, xp = 30 where match_id = $1`, [game.id]);
            await db.query(
                `insert into player_stats (user_id, game, rating, peak_rating, played, won, xp)
                 select id, 'ludo', 1250, 1250, 9, 3, 400 from users where id = any($1::uuid[])`,
                [[wearer.id, plain.id]]
            );

            return { wearer, plain, reader };
        };

        it('carries them wherever the person is drawn, the page\'s own two only with their profile, and no key for Classic', async () =>
        {
            const ports = door();
            const { wearer, plain, reader } = await cast(ports);

            expect(await everyRead(ports, reader, wearer)).toEqual({
                account: { ...LISTED, ...PAGE },
                friend: LISTED,
                directory: LISTED,
                search: LISTED,
                names: LISTED,
                view: PAGE,
                viewed: LISTED,
                shown: PAGE,
                face: { deco: LISTED.deco },
                all: LISTED,
                today: LISTED
            });
            expect(await everyRead(ports, reader, plain)).toEqual(CLASSIC);
        });

        it('takes a look off every read once it is taken back', async () =>
        {
            const ports = door();
            const { wearer, reader } = await cast(ports);

            await db.getRepository(OwnedItem).delete({ userId: wearer.id });

            expect(await everyRead(ports, reader, wearer)).toEqual(CLASSIC);
        });
    });
});

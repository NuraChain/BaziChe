import { expect, it } from 'vitest';
import { postgres, tableDatabase } from './table-database.ts';

it.skipIf(!postgres)('enforces the link audience independently of normal table access and seat reservations', async () =>
{
    const { db, table, person, close } = await tableDatabase();
    try
    {
        const [host, friend, stranger, guest, other] = await Promise.all(
            ['host', 'friend', 'stranger', 'guest', 'other'].map(person)
        );
        const create = {
            game: 'ludo', seats: 4, mode: 'live' as const, privacy: 'invite' as const, target: 0,
            cube: false, blinds: 'low', chat: true, voice: 'off' as const, teams: false, invitees: [guest]
        };
        await db.query('insert into friendships (user_id, friend_id) values ($1,$2),($2,$1)', [host, friend]);
        const friends = await table.create(host, { ...create, linkAudience: 'friends' });
        const token = friends.link_token!;
        expect(token).toBeTruthy();
        expect(await table.byId(friend, friends.id)).toBeNull();
        expect((await table.byId(friend, friends.id, token))?.link_token).toBeNull();
        expect(await table.byId(stranger, friends.id, token)).toBeNull();
        await expect(table.claimSeat(stranger, friends.id, token)).rejects.toThrow('No table');
        expect(await table.byCode(friend, friends.code)).toBeNull();
        await db.query('delete from friendships where user_id = $1 or friend_id = $1', [friend]);
        expect(await table.byId(friend, friends.id, token)).toBeNull();
        await expect(table.claimSeat(friend, friends.id, token)).rejects.toThrow('No table');

        await db.query('insert into friendships (user_id, friend_id) values ($1,$2),($2,$1)', [host, friend]);
        expect(await table.claimSeat(friend, friends.id, token)).toBeGreaterThan(0);

        const open = await table.create(host, { ...create, linkAudience: 'everyone' });
        const shared = open.link_token!;
        expect(await table.byId(stranger, open.id, token)).toBeNull();
        expect(await table.byId(stranger, open.id)).toBeNull();
        expect(await table.byId(stranger, open.id, 'invalid')).toBeNull();
        expect(await table.byCode(stranger, open.code)).toBeNull();
        expect((await table.byId(stranger, open.id, shared))?.id).toBe(open.id);
        expect(await table.claimSeat(stranger, open.id, shared)).toBeGreaterThan(0);
        expect((await table.byId(stranger, open.id))?.mine).not.toBeNull();
        expect((await table.byId(guest, open.id))?.chairs.some(chair => chair.invited === 'guest')).toBe(true);
        const seats = await Promise.all([table.claimSeat(friend, open.id, shared), table.claimSeat(other, open.id, shared)]);
        expect(seats.filter(seat => seat !== null)).toHaveLength(1);
        expect(await table.claimSeat(guest, open.id)).toBeGreaterThan(0);
        await db.query('insert into blocks (user_id, blocked_id) values ($1, $2)', [host, other]);
        expect(await table.byId(other, open.id, shared)).toBeNull();
        await table.remove(host, open.id, 'stranger');
        expect(await table.byId(stranger, open.id, shared)).toBeNull();
        await expect(table.claimSeat(stranger, open.id, shared)).rejects.toThrow('No table');
        await table.close(host, open.id);
        expect(await table.byId(friend, open.id, shared)).toBeNull();
        const legacy = await table.create(host, create);
        expect(legacy.link_token).toBeNull();
        expect(await table.byId(stranger, legacy.id, shared)).toBeNull();

        const [room] = await db.query("insert into conversations (kind, pair_key) values ('direct', $1) returning id", [[host, friend].sort().join(':')]) as { id: string }[];
        await db.query('insert into conversation_members (conversation_id, user_id) values ($1,$2),($1,$3)', [room.id, host, friend]);
        const inRoom = await table.create(host, { ...create, seats: 2, invitees: [], roomId: room.id, linkAudience: 'everyone' });
        expect(inRoom.privacy).toBe('room');
        expect(inRoom.link_token).toBeNull();
        expect(await table.byId(stranger, inRoom.id, shared)).toBeNull();
    }
    finally
    {
        await close();
    }
}, 30_000);

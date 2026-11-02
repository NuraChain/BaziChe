import { describe, expect, it } from 'vitest';

import { GROUP_ACTS, GROUP_RIGHTS, SWITCH_DEFAULTS, mayIn, mayOn, outranks, type GroupAct, type GroupRight, type GroupStanding } from '../src/domains/group/roles.ts';

/**
 * Who may do what in a group, as one pure function the server asks before every act and the page asks
 * before drawing a control. A table here is the rule; the database specs hold the server to it.
 */

const OPEN = { ...SWITCH_DEFAULTS, pin: true, info: true };
const CLOSED = { send: false, media: false, add: false, pin: false, info: false, call: false, joinCall: false, speak: false };

const owner: GroupStanding = { role: 'owner' };
const member: GroupStanding = { role: 'member' };
const moderator: GroupStanding = { role: 'moderator' };
const admin = (...rights: GroupRight[]): GroupStanding => ({ role: 'admin', rights });

describe('who may do what in a group', () =>
{
    it('lets the owner do everything, whatever the switches say', () =>
    {
        for (const act of GROUP_ACTS)
        {
            expect(mayIn(owner, CLOSED, act), act).toBe(true);
        }
    });

    it('lets somebody outside the group do nothing', () =>
    {
        for (const act of GROUP_ACTS)
        {
            expect(mayIn({ role: null }, OPEN, act), act).toBe(false);
        }
    });

    it('keeps the owner\'s own acts to the owner, an admin with every right included', () =>
    {
        for (const act of ['admins', 'permissions', 'transfer'] as GroupAct[])
        {
            expect(mayIn(admin(...GROUP_RIGHTS), OPEN, act), act).toBe(false);
        }
    });

    it('gives an admin each act of a right only with that right', () =>
    {
        const ofRight: [GroupAct, GroupRight][] = [
            ['links', 'invite'], ['approve', 'approve'], ['remove', 'remove'], ['ban', 'ban'], ['moderators', 'members'], ['calls', 'calls']
        ];

        for (const [act, right] of ofRight)
        {
            expect(mayIn(admin(right), CLOSED, act), `${ act } with ${ right }`).toBe(true);
            expect(mayIn(admin(...GROUP_RIGHTS.filter((one) => one !== right)), CLOSED, act), `${ act } without ${ right }`).toBe(false);
        }
    });

    it('lets an admin with the right, or anybody while members may, change the look, add, pin and start a call', () =>
    {
        const ofSwitch: [GroupAct, GroupRight, keyof typeof OPEN][] = [['info', 'info', 'info'], ['add', 'invite', 'add'], ['pin', 'pin', 'pin'], ['call', 'calls', 'call']];

        for (const [act, right, key] of ofSwitch)
        {
            expect(mayIn(admin(right), CLOSED, act), `${ act } by an admin with ${ right }`).toBe(true);
            expect(mayIn(admin(), CLOSED, act), `${ act } by an admin without it`).toBe(false);
            expect(mayIn(member, { ...CLOSED, [key]: true }, act), `${ act } by a member while members may`).toBe(true);
            expect(mayIn(member, CLOSED, act), `${ act } by a member while they may not`).toBe(false);
        }
    });

    it('gives a moderator deleting, muting and the reports, and no right of an admin\'s', () =>
    {
        expect(mayIn(moderator, CLOSED, 'delete')).toBe(true);
        expect(mayIn(moderator, CLOSED, 'mute')).toBe(true);
        expect(mayIn(moderator, CLOSED, 'reports')).toBe(true);

        for (const act of ['remove', 'ban', 'links', 'approve', 'moderators', 'calls', 'admins'] as GroupAct[])
        {
            expect(mayIn(moderator, OPEN, act), act).toBe(false);
        }
    });

    it('lets the staff write, send media, join a call and speak whatever the switches say, and members only while they may', () =>
    {
        for (const act of ['send', 'media', 'joinCall', 'speak'] as GroupAct[])
        {
            expect(mayIn(moderator, CLOSED, act), `${ act } by a moderator`).toBe(true);
            expect(mayIn(admin(), CLOSED, act), `${ act } by an admin`).toBe(true);
            expect(mayIn(member, CLOSED, act), `${ act } by a member while they may not`).toBe(false);
            expect(mayIn(member, OPEN, act), `${ act } by a member while they may`).toBe(true);
        }
    });

    it('keeps anybody muted from writing, sending media and speaking, and lets them read the log and join a call', () =>
    {
        for (const standing of [{ ...member, muted: true }, { ...moderator, muted: true }, { ...admin(...GROUP_RIGHTS), muted: true }])
        {
            expect(mayIn(standing, OPEN, 'send'), `${ standing.role } writing`).toBe(false);
            expect(mayIn(standing, OPEN, 'media'), `${ standing.role } sending media`).toBe(false);
            expect(mayIn(standing, OPEN, 'speak'), `${ standing.role } speaking`).toBe(false);
            expect(mayIn(standing, OPEN, 'joinCall'), `${ standing.role } joining a call`).toBe(true);
        }

        expect(mayIn({ ...moderator, muted: true }, OPEN, 'log')).toBe(true);
    });

    it('lets the staff read the log and nobody else', () =>
    {
        expect(mayIn(moderator, CLOSED, 'log')).toBe(true);
        expect(mayIn(admin(), CLOSED, 'log')).toBe(true);
        expect(mayIn(member, OPEN, 'log')).toBe(false);
    });
});

describe('who may act on whom', () =>
{
    it('ranks the owner above an admin above a moderator above a member, and nobody above their own rank', () =>
    {
        expect(outranks('owner', 'admin')).toBe(true);
        expect(outranks('admin', 'moderator')).toBe(true);
        expect(outranks('moderator', 'member')).toBe(true);

        for (const role of ['owner', 'admin', 'moderator', 'member'] as const)
        {
            expect(outranks(role, role), role).toBe(false);
        }

        expect(outranks('admin', 'owner')).toBe(false);
        expect(outranks('member', null), 'a member over somebody outside').toBe(false);
        expect(outranks('moderator', null), 'the staff over somebody outside').toBe(true);
        expect(outranks(null, 'member'), 'somebody outside over anybody').toBe(false);
    });

    it('needs the act and the rank both', () =>
    {
        expect(mayOn(admin('remove'), CLOSED, 'remove', 'moderator')).toBe(true);
        expect(mayOn(admin('remove'), CLOSED, 'remove', 'admin'), 'an equal').toBe(false);
        expect(mayOn(admin(), CLOSED, 'remove', 'member'), 'without the right').toBe(false);
        expect(mayOn(moderator, CLOSED, 'mute', 'member')).toBe(true);
        expect(mayOn(moderator, CLOSED, 'mute', 'admin')).toBe(false);
    });
});

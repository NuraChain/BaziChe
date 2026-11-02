export const GROUP_ROLES = ['member', 'moderator', 'admin', 'owner'] as const;

export type GroupRole = (typeof GROUP_ROLES)[number];

/** A role's place, each above the one before it. */
export const RANK: Readonly<Record<GroupRole, number>> = { member: 0, moderator: 1, admin: 2, owner: 3 };

/** Somebody who is not in the group stands where a member does: a ban is lifted from a stranger. */
export function outranks(actor: GroupRole | null, other: GroupRole | null)
{
    return actor !== null && RANK[actor] > RANK[other ?? 'member'];
}

export const GROUP_RIGHTS = ['info', 'invite', 'approve', 'remove', 'ban', 'delete', 'pin', 'members', 'calls'] as const;

export type GroupRight = (typeof GROUP_RIGHTS)[number];

/** What the members of a group may do, as the owner sets it, and what a new group starts with. */
export const SWITCHES = ['send', 'media', 'add', 'pin', 'info', 'call', 'joinCall', 'speak'] as const;

export type GroupSwitch = (typeof SWITCHES)[number];

export type GroupSwitches = Readonly<Record<GroupSwitch, boolean>>;

export const SWITCH_DEFAULTS: GroupSwitches = { send: true, media: true, add: true, pin: false, info: false, call: true, joinCall: true, speak: true };

/** The column each switch is kept in. */
export const SWITCH_COLUMNS: Readonly<Record<GroupSwitch, string>> = {
    send: 'members_send',
    media: 'members_media',
    add: 'members_add',
    pin: 'members_pin',
    info: 'members_info',
    call: 'members_call',
    joinCall: 'members_join_call',
    speak: 'members_speak'
};

/**
 * Everything somebody might do in a group, each answered by `mayIn` from their role, their rights,
 * a mute and the switches. The server asks it before every act and the page asks it before drawing
 * the control, so the two cannot disagree about who may.
 */
export const GROUP_ACTS = [
    'info', 'add', 'links', 'approve', 'remove', 'ban', 'delete', 'pin', 'mute', 'moderators', 'admins',
    'permissions', 'transfer', 'send', 'media', 'call', 'joinCall', 'speak', 'calls', 'log', 'reports'
] as const;

export type GroupAct = (typeof GROUP_ACTS)[number];

export interface GroupStanding
{
    /** Null for somebody who is not in the group, who may do nothing in it. */
    role: GroupRole | null;
    rights?: readonly GroupRight[] | null;

    /** A mute in force: they read and react, and send nothing. */
    muted?: boolean;
}

export function mayIn(standing: GroupStanding, switches: GroupSwitches, act: GroupAct)
{
    const { role } = standing;

    if (role === null)
    {
        return false;
    }

    const quiet = standing.muted === true;

    if (role === 'owner')
    {
        return true;
    }

    const staff = role !== 'member';
    const holds = (right: GroupRight) => role === 'admin' && (standing.rights ?? []).includes(right);

    switch (act)
    {
        case 'info': return holds('info') || switches.info;
        case 'add': return holds('invite') || switches.add;
        case 'links': return holds('invite');
        case 'approve': return holds('approve');
        case 'remove': return holds('remove');
        case 'ban': return holds('ban');
        case 'delete': return holds('delete') || role === 'moderator';
        case 'pin': return holds('pin') || switches.pin;
        case 'mute': return holds('members') || role === 'moderator';
        case 'moderators': return holds('members');
        case 'admins': return false;
        case 'permissions': return false;
        case 'transfer': return false;
        case 'send': return !quiet && (staff || switches.send);
        case 'media': return !quiet && (staff || switches.media);
        case 'call': return holds('calls') || switches.call;
        case 'joinCall': return staff || switches.joinCall;
        case 'speak': return !quiet && (staff || switches.speak);
        case 'calls': return holds('calls');
        case 'log': return staff;
        case 'reports': return holds('delete') || role === 'moderator';
    }
}

/** An act on somebody: allowed in the group, and only on somebody ranked lower. */
export function mayOn(standing: GroupStanding, switches: GroupSwitches, act: GroupAct, other: GroupRole | null)
{
    return mayIn(standing, switches, act) && outranks(standing.role, other);
}

export const GROUP_EVENTS = [
    'created', 'joined', 'left', 'removed', 'banned', 'unbanned', 'muted', 'unmuted', 'role', 'rights', 'permissions',
    'info', 'owner', 'invite', 'request', 'deleted', 'pinned', 'unpinned', 'call'
] as const;

export type GroupEventKind = (typeof GROUP_EVENTS)[number];

/** How long a mute lasts, in hours; none is until somebody lifts it. */
export const MUTE_HOURS = [1, 24, 168] as const;

/** How long a link works, in hours; none is until it is revoked. */
export const LINK_HOURS = [1, 24, 168] as const;

/** How many times a link can be used; none is no limit. */
export const LINK_USES = [1, 10, 100] as const;

/** A link's token: sixteen random bytes as base64url. */
export const LINK_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const PINS_MOST = 20;

export const MEMBERS_PAGE = 50;

export const GROUP_LOG_PAGE = 50;

/** The faces a group's card and head draw, the staff first. */
export const FACES = 6;

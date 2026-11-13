export const NOTICES = ['invites', 'requests', 'messages', 'groups', 'turns', 'gifts', 'inviting', 'calls'] as const;

export type Notice = typeof NOTICES[number];

export const NOTICE_OF: Readonly<Record<string, Notice>> = {
    'friend-request': 'requests',
    'friend-accepted': 'requests',
    'group-added': 'groups',
    'group-request': 'groups',
    'group-approved': 'groups',
    'group-owner': 'groups',
    'table-invite': 'invites',
    'table-removed': 'invites',
    'message': 'messages',
    'turn': 'turns',
    'invite-joined': 'inviting',
    'invite-played': 'inviting',
    'invite-reward': 'inviting',
    'gift': 'gifts',
    'donation': 'gifts',
    'reward-ready': 'gifts',
    'reward-streak': 'gifts',
    'channel-invite': 'groups',
    'group-report': 'groups',
    'call': 'calls',
    'call-missed': 'calls',
    'group-call': 'calls',
    'tournament-start': 'turns',
    'tournament-game': 'turns',
    'tournament-cancelled': 'turns',
    'tournament-over': 'turns'
};

export const isNotice = (value: string): value is Notice => (NOTICES as readonly string[]).includes(value);

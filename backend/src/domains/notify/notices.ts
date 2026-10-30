export const NOTICES = ['invites', 'requests', 'messages', 'groups', 'turns', 'gifts', 'inviting'] as const;

export type Notice = typeof NOTICES[number];

export const NOTICE_OF: Readonly<Record<string, Notice>> = {
    'friend-request': 'requests',
    'friend-accepted': 'requests',
    'group-added': 'groups',
    'table-invite': 'invites',
    'table-removed': 'invites',
    'message': 'messages',
    'turn': 'turns',
    'invite-joined': 'inviting',
    'invite-played': 'inviting',
    'invite-reward': 'inviting',
    'gift': 'gifts',
    'donation': 'gifts'
};

export const isNotice = (value: string): value is Notice => (NOTICES as readonly string[]).includes(value);

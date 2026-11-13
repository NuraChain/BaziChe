import type { Notification, NotificationKind } from '../api.ts';
import { GAMES } from '../data/games.ts';
import type { IconName } from '../icons/registry.ts';
import type { MessageKey } from '../locales/en.ts';
import type { LocaleApi } from '../stores/locale.store.ts';
import { nuraOf } from './nura.ts';

export const NOTIFICATION_ICON: Record<NotificationKind, IconName> = {
    'friend-request': 'friend-add',
    'friend-accepted': 'friend-check',
    'group-added': 'people',
    'table-invite': 'seat',
    'table-removed': 'sign-out',
    'message': 'chats',
    'turn': 'dice',
    'invite-joined': 'invite',
    'invite-played': 'dice',
    'invite-reward': 'gift',
    'gift': 'gift',
    'donation': 'coins',
    'reward-ready': 'gift',
    'reward-streak': 'gift',
    'group-request': 'friend-add',
    'group-approved': 'friend-check',
    'group-owner': 'crest-crown',
    'channel-invite': 'megaphone',
    'group-report': 'report',
    'call': 'call',
    'call-missed': 'call-missed',
    'group-call': 'call',
    'tournament-start': 'medal',
    'tournament-game': 'medal',
    'tournament-cancelled': 'medal',
    'tournament-over': 'trophy'
};

const SAYS: Record<NotificationKind, MessageKey> = {
    'friend-request': 'notify.friendRequest',
    'friend-accepted': 'notify.friendAccepted',
    'group-added': 'notify.groupAdded',
    'table-invite': 'notify.tableInvite',
    'table-removed': 'notify.tableRemoved',
    'turn': 'notify.turn',
    'message': 'notify.message',
    'invite-joined': 'notify.inviteJoined',
    'invite-played': 'notify.invitePlayed',
    'invite-reward': 'notify.inviteReward',
    'gift': 'notify.gift',
    'donation': 'notify.donation',
    'reward-ready': 'notify.rewardReady',
    'reward-streak': 'notify.rewardStreak',
    'group-request': 'notify.groupRequest',
    'group-approved': 'notify.groupApproved',
    'group-owner': 'notify.groupOwner',
    'channel-invite': 'notify.channelInvite',
    'group-report': 'notify.groupReport',
    'call': 'notify.call',
    'call-missed': 'notify.callMissed',
    'group-call': 'notify.groupCall',
    'tournament-start': 'notify.tournamentStart',
    'tournament-game': 'notify.tournamentGame',
    'tournament-cancelled': 'notify.tournamentCancelled',
    'tournament-over': 'notify.tournamentOver'
};

export function sayOf(item: Notification, who: string, locale: Pick<LocaleApi, 't' | 'plural' | 'n'>)
{
    const game = GAMES.find((one) => one.id === item.ref.game);

    if (item.kind === 'message')
    {
        return locale.plural('notify.message', item.count, { who });
    }

    if (item.kind === 'group-report')
    {
        return locale.plural('notify.groupReport', item.count, {});
    }

    if (item.kind === 'turn' && game === undefined)
    {
        return locale.t('notify.turnAnywhere');
    }

    return locale.t(SAYS[item.kind], {
        who,
        game: game === undefined ? '' : locale.t(game.nameKey),
        amount: item.ref.amount === undefined ? '' : locale.n(nuraOf(item.ref.amount), { maximumFractionDigits: 4 })
    });
}

export function targetOf(item: Notification): string | null
{
    if (item.kind === 'friend-request')
    {
        return '/app/friends?tab=requests';
    }
    if (item.kind === 'table-removed')
    {
        return '/app/games';
    }
    if (item.kind === 'gift' || item.kind === 'invite-reward')
    {
        return '/app/shop/collection';
    }
    if (item.kind === 'reward-ready' || item.kind === 'reward-streak')
    {
        return '/app/rewards';
    }
    if (item.kind === 'invite-joined' || item.kind === 'invite-played')
    {
        return '/app/invite';
    }
    if (item.kind === 'donation')
    {
        return '/app/me/wallet';
    }
    if (item.ref.tournament !== undefined && item.kind !== 'tournament-game')
    {
        return `/app/tournaments/${ item.ref.tournament }`;
    }
    if (item.ref.tableId !== undefined)
    {
        return `/app/play/${ item.ref.tableId }`;
    }
    if (item.kind === 'group-request' && item.ref.groupId !== undefined)
    {
        return `/app/groups/${ item.ref.groupId }?tab=requests`;
    }
    if (item.kind === 'group-report' && item.ref.groupId !== undefined)
    {
        return `/app/groups/${ item.ref.groupId }?tab=reports`;
    }
    if (item.ref.groupId !== undefined)
    {
        return `/app/groups/${ item.ref.groupId }`;
    }
    if (item.ref.channelId !== undefined)
    {
        return `/app/channels/${ encodeURIComponent(item.ref.channelId) }`;
    }
    if (item.ref.conversationId !== undefined)
    {
        return `/app/chats/${ item.ref.conversationId }`;
    }
    if (item.actor !== undefined)
    {
        return `/app/people/${ item.actor }`;
    }
    return null;
}

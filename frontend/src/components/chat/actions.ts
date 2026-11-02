import type { Message } from '../../data/chat.ts';
import type { IconName } from '../../icons/registry.ts';
import { copyText } from '../../lib/clipboard.ts';
import type { MessageKey } from '../../locales/en.ts';
import type { LocaleApi } from '../../stores/locale.store.ts';
import { albumSaid } from './gist.ts';

/** One thing a menu or a sheet offers to do with a line or a conversation. */
export interface ChatAction
{
    id: string;
    icon: IconName;
    label: string;
    danger?: boolean;
    run: () => void;
}

/** What can be done with a line, beside the reactions; a sheet and a menu draw the same list. */
export interface LineHandlers
{
    onReply?: () => void;

    /** Handed only for a line the reader may still edit: their own words, within two days. */
    onEdit?: () => void;

    /** Handed only where the reader may pin in the room, the one of the two the line's place calls for. */
    onPin?: () => void;
    onUnpin?: () => void;
    onForward?: () => void;
    onDelete?: () => void;

    /** Handed only for somebody else's line the reader may take out of a group's thread. */
    onTake?: () => void;
    onPerson?: () => void;
}

/** The actions on a line in the order every sheet and menu lists them. */
export function messageActions(say: (key: MessageKey) => string, message: Message, me: string, handlers: LineHandlers)
{
    const mine = message.from === me;
    const list: ChatAction[] = [];

    if (handlers.onReply !== undefined)
    {
        list.push({ id: 'reply', icon: 'reply', label: say('chat.reply'), run: handlers.onReply });
    }

    if (mine && handlers.onEdit !== undefined)
    {
        list.push({ id: 'edit', icon: 'edit', label: say('chat.edit'), run: handlers.onEdit });
    }

    if (handlers.onPin !== undefined)
    {
        list.push({ id: 'pin', icon: 'pin', label: say('chat.pin'), run: handlers.onPin });
    }

    if (handlers.onUnpin !== undefined)
    {
        list.push({ id: 'unpin', icon: 'pin-off', label: say('chat.unpin'), run: handlers.onUnpin });
    }

    if (message.kind !== 'voice' && (message.kind !== 'file' || message.text.trim() !== ''))
    {
        list.push({ id: 'copy', icon: 'copy', label: say('chat.copy'), run: () => void copyText(message.text, 'chat.copied', { dedupe: 'chat-copy' }) });
    }

    if (handlers.onForward !== undefined)
    {
        list.push({ id: 'forward', icon: 'forward', label: say('chat.forward'), run: handlers.onForward });
    }

    if (!mine && handlers.onPerson !== undefined)
    {
        list.push({ id: 'person', icon: 'me', label: say('chat.aboutSender'), run: handlers.onPerson });
    }

    const deleting = message.album === undefined ? 'chat.delete' : 'chat.deleteAlbum';

    if (mine && handlers.onDelete !== undefined)
    {
        list.push({ id: 'delete', icon: 'trash', label: say(deleting), danger: true, run: handlers.onDelete });
    }

    if (!mine && handlers.onTake !== undefined)
    {
        list.push({ id: 'take', icon: 'trash', label: say(deleting), danger: true, run: handlers.onTake });
    }

    return list;
}

/**
 * What deleting a line asks first: of the reader's own, or of somebody's whose name is given when the
 * group's staff take it away. An album goes whole, so it says what goes ("Delete these 4 photos?").
 */
export function deleteAsked(message: Message, t: LocaleApi['t'], name?: string)
{
    const what = message.album === undefined ? null : albumSaid(message.album, t);

    if (name !== undefined)
    {
        return what === null
            ? { title: t('chat.takeConfirm', { name }), lead: t('chat.takeLead', { name }), confirm: t('chat.delete') }
            : { title: t('chat.takeAlbumConfirm', { name, what }), lead: t('chat.takeAlbumLead', { name }), confirm: t('chat.deleteAlbum') };
    }

    return what === null
        ? { title: t('chat.deleteConfirm'), lead: t('chat.deleteLead'), confirm: t('chat.delete') }
        : { title: t('chat.deleteAlbumConfirm', { what }), lead: t('chat.deleteAlbumLead'), confirm: t('chat.deleteAlbum') };
}

/** Where a menu was asked for, in the window's own pixels. */
export interface MenuPoint
{
    x: number;
    y: number;
}

/** The reactions a line's menu opens with, and the way to the rest of them. */
export interface MenuReactions
{
    emoji: readonly string[];
    mine: (emoji: string) => boolean;
    pick: (emoji: string) => void;
    more: () => void;
}

/** An icon that points along the reading direction turns with it. */
export const flips = (icon: IconName) => icon === 'reply' || icon === 'forward';

import type { MessageKey } from '../locales/en.ts';
import type { GroupLogRow } from '../stores/group-admin.store.ts';
import type { LocaleApi } from '../stores/locale.store.ts';
import { handleParts } from './staff-words.ts';

const SLOTS = { actor: '{actor}', person: '{person}' };

/** The doors, or asking first alone, each said plainly; any switch of what members may do as one sentence. */
const permissionsKey = (details: GroupLogRow['details']): MessageKey =>
{
    if (details.privacy !== undefined)
    {
        return details.privacy === 'private' ? 'groups.log.private' : 'groups.log.public';
    }
    if (details.approval !== undefined && details.on === undefined && details.off === undefined)
    {
        return details.approval === 'on' ? 'groups.log.asksFirst' : 'groups.log.asksNot';
    }
    return 'groups.log.permissions';
};

/** What the staff did in the group's voice chat, each in its own sentence. */
const CALL_ACTS: Readonly<Record<string, MessageKey>> = {
    end: 'groups.log.callEnded',
    hold: 'groups.log.callHeld',
    speak: 'groups.log.callSpeak',
    'hold-all': 'groups.log.callHeldAll',
    remove: 'groups.log.callRemoved'
};

/** The sentence a row of a group's log is said in, or nothing for a kind no page words yet. */
const keyOf = (row: GroupLogRow): MessageKey | null =>
{
    const { details } = row;

    switch (row.kind)
    {
        case 'created': return 'groups.log.created';
        case 'joined': return details.by === 'add' ? 'groups.log.added' : (details.by === 'link' ? 'groups.log.joinedLink' : 'groups.log.joined');
        case 'left': return 'groups.log.left';
        case 'removed': return 'groups.log.removed';
        case 'banned': return 'groups.log.banned';
        case 'unbanned': return 'groups.log.unbanned';
        case 'muted': return 'groups.log.muted';
        case 'unmuted': return 'groups.log.unmuted';
        case 'role': return details.to === 'admin' ? 'groups.log.toAdmin' : (details.to === 'moderator' ? 'groups.log.toModerator' : 'groups.log.toMember');
        case 'rights': return 'groups.log.rights';
        case 'permissions': return permissionsKey(details);
        case 'info': return details.to === undefined ? 'groups.log.info' : 'groups.log.renamed';
        case 'owner': return row.actor === undefined ? 'groups.log.heir' : 'groups.log.owner';
        case 'invite': return details.to === 'revoked' ? 'groups.log.linkRevoked' : 'groups.log.linkMade';
        case 'request': return details.to === 'approved' ? 'groups.log.approved' : 'groups.log.declined';
        case 'deleted': return 'groups.log.deleted';
        case 'pinned': return 'groups.log.pinned';
        case 'unpinned': return 'groups.log.unpinned';
        case 'report': return details.to === 'actioned' ? 'groups.log.reportActioned' : 'groups.log.reportDismissed';
        case 'call': return details.act !== undefined && Object.hasOwn(CALL_ACTS, details.act) ? CALL_ACTS[details.act] : null;
    }
};

/** Whether a row of the log has a sentence: a kind no page words yet is left out of the list rather than drawn as an empty row. */
export const worded = (row: GroupLogRow) => keyOf(row) !== null;

/**
 * A row of a group's log as parts, each handle a part of its own that the page draws left to right:
 * two handles side by side in a Persian sentence are otherwise one run, and read the wrong way round.
 * A kind no page words yet has no parts, and is drawn as nothing.
 */
export function groupLogParts(row: GroupLogRow, locale: LocaleApi)
{
    const key = keyOf(row);

    if (key === null)
    {
        return [];
    }

    return handleParts(locale.t(key, { ...SLOTS, to: row.details.to ?? '' }), { actor: row.actor ?? '', person: row.person ?? '' });
}

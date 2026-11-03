import type { CallView } from '../../api.ts';
import { runtime } from '../../lib/runtime.ts';
import { callRoomOf } from '../../stores/calls.store.ts';
import { useChat } from '../../stores/chat.store.ts';
import { useGroups } from '../../stores/groups.store.ts';
import type { LocaleApi } from '../../stores/locale.store.ts';
import type { VoiceApi } from '../../stores/voice.store.ts';
import { voiceClock } from '../chat/gist.ts';

/**
 * The name of the group a voice chat is in, as this page knows its room: the room's own title, or its
 * group's name. Nothing for a call that is no voice chat, or for a room this page has not read.
 */
export function groupOfCall(call: CallView | null)
{
    const room = call === null || call.kind !== 'group' ? undefined : useChat().conversation(call.room);

    if (room === undefined)
    {
        return null;
    }

    return room.title ?? (room.groupId === null ? null : useGroups().byId(room.groupId)?.name ?? null);
}

/** What a voice chat says of itself: that another device of the reader's is in it, that this tab is coming in, or how long it has run. */
export function voiceChatSaid(here: boolean, joining: boolean, lasted: number, locale: Pick<LocaleApi, 't' | 'n'>)
{
    if (!here)
    {
        return locale.t('call.voiceChat.elsewhere');
    }

    return joining ? locale.t('call.connecting') : voiceClock(lasted, locale.n);
}

/** How long a call has lasted, in seconds: to its end, or to now while it goes on. */
export function lastedOf(call: CallView | null, now: number, toLocal: (serverAt: number) => number)
{
    if (call === null || call.answeredAt === undefined)
    {
        return 0;
    }

    const until = call.endedAt === undefined ? now : toLocal(Date.parse(call.endedAt));

    return Math.max(0, (until - toLocal(Date.parse(call.answeredAt))) / 1000);
}

/** Whether somebody else is heard in the live call this tab is in. */
export function heardIn(call: CallView | null, here: boolean, voice: Pick<VoiceApi, 'table' | 'joining' | 'people'>)
{
    return call !== null && call.state === 'live' && here && voice.table() === callRoomOf(call.id) && !voice.joining() && voice.people().some((one) => !one.me);
}

/** What a live call says of itself: that another device has it, that it is connecting, or its time. */
export function liveSaid(here: boolean, heard: boolean, lasted: number, locale: Pick<LocaleApi, 't' | 'n'>)
{
    if (!here)
    {
        return locale.t('call.elsewhere');
    }

    return heard ? voiceClock(lasted, locale.n) : locale.t('call.connecting');
}

/** Tells `set` the product clock's time now and every second after, until the answer is called. */
export function ticking(set: (now: number) => void)
{
    let stop: (() => void) | null = null;

    const tick = () =>
    {
        set(runtime().clock.now());
        stop = runtime().clock.after(1000, tick);
    };

    tick();

    return () => stop?.();
}

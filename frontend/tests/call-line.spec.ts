import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import ChatListItem from '../src/components/chat/chat-list-item.component.azeroth';
import { lineSaid } from '../src/components/chat/line-said.ts';
import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import type { Message, MessageLine } from '../src/data/chat.ts';
import '../src/icons/all.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/**
 * The line a call leaves in its room once it ends (MS-D34): one line that names whoever rang and
 * how it ended, which each of the two reads from their own side.
 */

const call = (ending?: string, seconds?: string): MessageLine => ({
    key: 'chat.line.call',
    params: { who: 'alex', ...(ending === undefined ? {} : { ending }), ...(seconds === undefined ? {} : { seconds }) }
});

const said = (line: MessageLine, me: string) => lineSaid(line, me, (handle) => (handle === 'alex' ? 'Alex Morgan' : handle), useLocale());

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(1_700_000_000_000), seed: 5 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

describe('a call that ended, said in its room', () =>
{
    it.each([
        ['en', ['Outgoing call · 5:12', 'Incoming call · 5:12'], ['Call not answered', 'Missed call'], ['Cancelled call', 'Missed call'], ['Busy', 'Missed call'], ['Declined call', 'Declined call']],
        ['fa', ['تماس خروجی · ۵:۱۲', 'تماس ورودی · ۵:۱۲'], ['جواب نداد', 'تماس بی‌جواب'], ['تماس لغو شد', 'تماس بی‌جواب'], ['مشغول بود', 'تماس بی‌جواب'], ['تماس رد شد', 'تماس رد شد']]
    ] as const)('is read from the side of whoever rang and of whoever was rung, in %s', (language, answered, missed, cancelled, busy, declined) =>
    {
        useLocale().setLocale(language);

        for (const [ending, [out, into]] of [['answered', answered], ['missed', missed], ['cancelled', cancelled], ['busy', busy], ['declined', declined]] as const)
        {
            const line = call(ending, ending === 'answered' ? '312' : undefined);

            expect(said(line, 'alex'), `${ ending }, to whoever rang`).toBe(out);
            expect(said(line, 'sara.k'), `${ ending }, to whoever was rung`).toBe(into);
        }
    });

    it('knows whoever rang whatever the case of their handle, and says a call of an hour in minutes', () =>
    {
        expect(said(call('answered', '3725'), 'ALEX')).toBe('Outgoing call · 62:05');
        expect(said(call('answered'), 'alex'), 'no length kept').toBe('Outgoing call · 0:00');
    });

    it('names whoever rang where it cannot say how it ended, and says nothing of a line it does not know', () =>
    {
        expect(said(call(), 'sara.k')).toBe('Alex Morgan called');
        expect(said(call('failed'), 'sara.k')).toBe('Alex Morgan called');
        expect(said(call('hung-up'), 'alex')).toBe('Alex Morgan called');
        expect(said({ key: 'chat.line.ringing', params: {} }, 'alex')).toBe('');
    });

    it('is what the bubble draws for its reader', () =>
    {
        const message: Message = { id: 'm-1', conversationId: 'c-1', from: '', kind: 'system', text: '', line: call('answered', '75'), at: 1_700_000_000_000, ref: null };
        const drawn = (me: string) =>
        {
            const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });

            return renderTest(() => RouterProvider({ router, children: () => MessageBubble({ message, me }) }) as HTMLElement).container.textContent ?? '';
        };

        expect(drawn('alex')).toContain('Outgoing call · 1:15');
        cleanup();
        expect(drawn('sara.k')).toContain('Incoming call · 1:15');
    });
});

describe('a call last in the chat list', () =>
{
    beforeEach(() =>
    {
        useSession().reset();
        useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
        server.reset();
        useSocial().reset();
        useGroups().reset();
        useChat().reset();
    });

    it('says how it ended from the reader\'s side', async () =>
    {
        const chat = useChat();
        const room = server.conversations.find((one) => one.id === 'c-reza')!;

        room.last = { id: 'm-call', conversationId: 'c-reza', kind: 'system', payload: { key: 'chat.line.call', params: { who: 'reza.t', ending: 'missed' } }, at: new Date(runtime().clock.now()).toISOString() };
        await chat.refresh();

        const router = createRouter({ routes: [], history: createMemoryHistory('/app/chats'), scroll: false });
        const container = renderTest(() => RouterProvider({
            router,
            children: () => ChatListItem({ conversation: chat.conversation('c-reza')!, me: 'alex', now: runtime().clock.now() })
        }) as HTMLElement).container;

        expect(container.textContent).toContain('Missed call');
    });
});

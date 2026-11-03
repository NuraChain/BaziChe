import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, createSignal } from 'azerothjs';

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

describe('a call\'s line, pressed to call again', () =>
{
    const line = (who: string, ending: string, seconds?: string): Message => ({
        id: 'm-call',
        conversationId: 'c-1',
        from: '',
        kind: 'system',
        text: '',
        line: { key: 'chat.line.call', params: { who, ending, ...(seconds === undefined ? {} : { seconds }) } },
        at: 1_700_000_000_000,
        ref: null
    });

    /** The line drawn for sara.k, whom alex rang, offered a way to call again when `onCall` is handed. */
    const drawn = (first: Message, onCall?: () => void) =>
    {
        const [message, setMessage] = createSignal(first);
        const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
        const { container } = renderTest(() => RouterProvider({
            router,
            children: () => MessageBubble({
                get message()
                {
                    return message();
                },
                me: 'sara.k',
                onCall
            })
        }) as HTMLElement);

        return { container, read: setMessage, button: () => container.querySelector<HTMLButtonElement>('[data-call-again]') };
    };

    const mark = (button: HTMLButtonElement | null) => button?.querySelector('svg')?.getAttribute('class') ?? '';

    it('calls again at a press, named for what it says and what it does', () =>
    {
        const onCall = vi.fn();
        const { button } = drawn(line('alex', 'answered', '75'), onCall);

        expect(button()?.getAttribute('aria-label')).toBe('Incoming call · 1:15. Call again');
        expect(button()?.textContent).toContain('Incoming call · 1:15');

        button()?.click();

        expect(onCall).toHaveBeenCalledTimes(1);
    });

    it('marks a call that rang for the reader and nobody took, and no other', () =>
    {
        expect(mark(drawn(line('alex', 'missed'), vi.fn()).button())).toContain('text-danger');
        cleanup();
        expect(mark(drawn(line('alex', 'cancelled'), vi.fn()).button()), 'one whoever rang gave up on is missed too').toContain('text-danger');
        cleanup();
        expect(mark(drawn(line('alex', 'declined'), vi.fn()).button()), 'one the reader declined').toContain('text-accent');
        cleanup();
        expect(mark(drawn(line('sara.k', 'missed'), vi.fn()).button()), 'one the reader rang and nobody took').toContain('text-accent');
    });

    it('is words with nothing to press where the thread cannot call, and on a line that is no call', () =>
    {
        const quiet = drawn(line('alex', 'missed'));

        expect(quiet.button()).toBeNull();
        expect(quiet.container.textContent).toContain('Missed call');

        cleanup();

        const joined = drawn({ ...line('alex', 'missed'), line: { key: 'chat.line.group.joined', params: { who: 'alex' } } }, vi.fn());

        expect(joined.button()).toBeNull();
    });

    it('is the same button when the thread is read again', async () =>
    {
        const { button, read } = drawn(line('alex', 'missed'), vi.fn());
        const first = button();

        read(line('alex', 'missed'));
        await Promise.resolve();

        expect(first).not.toBeNull();
        expect(button(), 'drawn again for a line that said the same').toBe(first);
    });

    it('says what it does in Persian', () =>
    {
        useLocale().setLocale('fa');

        expect(drawn(line('alex', 'missed'), vi.fn()).button()?.getAttribute('aria-label')).toBe('تماس بی‌جواب. دوباره زنگ بزن');
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

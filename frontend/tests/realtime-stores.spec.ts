import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEffect, createRoot, createSignal } from 'azerothjs';

import { FRAME_FLOORS, SEE_MOST } from '../../backend/src/realtime/frames.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { TYPING_PING_MS, TYPING_TTL_MS, useChat } from '../src/stores/chat.store.ts';
import { SEE_PAUSE_MS, usePresence } from '../src/stores/presence.store.ts';
import { BACKOFF_MS, FLOOR_MARGIN_MS, NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 8; turn += 1)
    {
        await Promise.resolve();
    }
};

const room = (people: { who: string; state: 'online' | 'away' }[]) =>
{
    socket.deliver({
        v: 1,
        t: 'presence',
        n: 1,
        full: true,
        people: people.map((entry) => ({ ...entry, since: clock.now() }))
    });
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(900_000);
    setRuntime({ clock, seed: 9 });

    server.reset();
    useRealtime().reset();
    socket.reset();
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        isMinor: false
    });
    useSocial().reset();
    useChat().reset();
    usePresence().reset();

    useRealtime().start();
    socket.accept();
    clock.advance(NUDGE_WINDOW_MS);
});

afterEach(() =>
{
    useChat().reset();
    useSocial().reset();
    useRealtime().reset();
});

describe('presence over the socket', () =>
{
    it('knows nothing about anybody until the server says something', () =>
    {
        const presence = usePresence();

        expect(presence.of('sara.k').known).toBe(false);
        expect(presence.dot('sara.k')).toBeNull();
        expect(presence.isOnline('sara.k')).toBe(false);
        expect(presence.online(['sara.k', 'reza.t'])).toEqual([]);
    });

    it('draws a dot only for the people the snapshot actually named', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }, { who: 'reza.t', state: 'away' }]);

        expect(presence.dot('sara.k')).toBe('online');
        expect(presence.dot('reza.t')).toBe('away');
        expect(presence.online(['sara.k', 'reza.t', 'mina'])).toEqual(['sara.k']);

        // Absent from the snapshot is not "offline". It could be a privacy setting, and drawing a
        // grey dot would be this client deciding something the server declined to tell it.
        expect(presence.of('mina').known).toBe(false);
        expect(presence.dot('mina')).toBeNull();
    });

    it('holds only the two states the server sends, and no game it never names', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }]);

        expect(Object.keys(presence.of('sara.k')).sort()).toEqual(['known', 'since', 'state']);
        expect(Object.keys(presence.of('nobody')).sort()).toEqual(['known', 'since', 'state']);
    });

    /**
     * The departure the wire could not express.
     *
     * `announce` builds its entry from the presence record, and going dark is the state where there
     * is no record - so it sent `people: []`, a delta naming nobody, and this merge changed nothing.
     * A tab left open showed people who had left hours earlier. `gone` is what says it.
     */
    it('drops somebody a delta says has gone, and leaves the rest alone', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }, { who: 'reza.t', state: 'online' }]);

        socket.deliver({ v: 1, t: 'presence', n: 2, full: false, people: [], gone: ['sara.k'] });

        // Unknown, not offline: somebody who left and somebody who turned presence off look the
        // same from here, and the dot is drawn for neither.
        expect(presence.of('sara.k').known).toBe(false);
        expect(presence.dot('sara.k')).toBeNull();

        expect(presence.dot('reza.t')).toBe('online');
    });

    it('forgets the room when the socket goes, rather than freezing it', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }]);
        expect(presence.dot('sara.k')).toBe('online');

        socket.drop();
        expect(presence.dot('sara.k')).toBeNull();
        expect(presence.of('sara.k').known).toBe(false);
    });

    it('asks the server to say it all again when the page is pulled', () =>
    {
        usePresence().refresh();
        expect(socket.sent).toEqual([{ t: 'sync' }]);
    });
});

/**
 * The server tells a socket when somebody comes, goes or looks away only if that socket's page shows
 * them, or they are a friend. Telling every socket about everybody was a frame for each of N people
 * to each of N sockets, and at a thousand sockets that was the event loop's whole second. So the page
 * names whom it draws, and it learns that from the reads that draw them.
 */
describe('whom the page shows, told to the server', () =>
{
    const sees = () => socket.sent.filter((frame) => frame.t === 'see');

    const floor = FRAME_FLOORS.see + FLOOR_MARGIN_MS;

    const showing = (...ids: string[]) => createRoot((dispose) =>
    {
        createEffect(() =>
        {
            for (const id of ids)
            {
                usePresence().dot(id);
            }
        });

        return dispose;
    });

    it('names the people drawn once the page has stayed put, in the order they were drawn', async () =>
    {
        const stop = showing('sara.k', 'reza.t');
        await settle();

        clock.advance(SEE_PAUSE_MS - 1);
        expect(sees(), 'told before the page stopped changing').toEqual([]);

        clock.advance(1);
        expect(sees()).toEqual([{ t: 'see', who: ['sara.k', 'reza.t'] }]);

        stop();
    });

    it('names nobody for a read that draws nothing', async () =>
    {
        usePresence().dot('sara.k');
        usePresence().isOnline('reza.t');
        await settle();

        clock.advance(SEE_PAUSE_MS * 4);
        expect(sees()).toEqual([]);
    });

    it('lets them go when what drew them goes, and keeps to the frame\'s floor doing it', async () =>
    {
        const stop = showing('sara.k');
        await settle();
        clock.advance(SEE_PAUSE_MS);

        stop();
        clock.advance(SEE_PAUSE_MS);
        expect(sees(), 'a second frame inside the floor the gateway holds the socket to').toHaveLength(1);

        clock.advance(floor);
        expect(sees()).toEqual([{ t: 'see', who: ['sara.k'] }, { t: 'see', who: [] }]);
    });

    it('says nothing more while the same people are drawn, however often they are drawn again', async () =>
    {
        const [tick, setTick] = createSignal(0);
        const stop = createRoot((dispose) =>
        {
            createEffect(() =>
            {
                tick();
                usePresence().dot('sara.k');
            });

            return dispose;
        });
        await settle();
        clock.advance(SEE_PAUSE_MS);

        setTick(1);
        room([{ who: 'sara.k', state: 'online' }]);
        setTick(2);
        await settle();

        clock.advance(SEE_PAUSE_MS + floor);
        expect(sees()).toEqual([{ t: 'see', who: ['sara.k'] }]);

        stop();
    });

    it('lets go of somebody only once nothing draws them', async () =>
    {
        const first = showing('sara.k');
        const second = showing('sara.k');
        await settle();
        clock.advance(SEE_PAUSE_MS);

        first();
        clock.advance(SEE_PAUSE_MS + floor);
        expect(sees(), 'let go while another read still drew them').toEqual([{ t: 'see', who: ['sara.k'] }]);

        second();
        clock.advance(SEE_PAUSE_MS + floor);
        expect(sees()).toEqual([{ t: 'see', who: ['sara.k'] }, { t: 'see', who: [] }]);
    });

    it('names the newest when the page draws more people than a frame may name', async () =>
    {
        const ids = Array.from({ length: SEE_MOST + 5 }, (_, index) => `p${ index }`);
        const stop = showing(...ids);
        await settle();

        clock.advance(SEE_PAUSE_MS);
        expect(sees()).toEqual([{ t: 'see', who: ids.slice(-SEE_MOST) }]);

        stop();
    });

    it('says it again to every new connection, which knows nothing of the last one', async () =>
    {
        const stop = showing('sara.k');
        await settle();
        clock.advance(SEE_PAUSE_MS);

        socket.drop();
        clock.advance(BACKOFF_MS[0] * 1.11);
        socket.accept();
        clock.advance(floor);

        expect(sees()).toEqual([{ t: 'see', who: ['sara.k'] }, { t: 'see', who: ['sara.k'] }]);

        stop();
    });

    it('forgets whom the page drew when the stores are reset', async () =>
    {
        const before = showing('reza.t');
        await settle();

        usePresence().reset();
        useRealtime().reset();
        socket.reset();
        useRealtime().start();
        socket.accept();
        clock.advance(floor);
        expect(sees(), 'a new connection was told about a page from before the reset').toEqual([]);

        const stop = showing('sara.k');
        await settle();
        clock.advance(SEE_PAUSE_MS);
        expect(sees()).toEqual([{ t: 'see', who: ['sara.k'] }]);

        stop();
        before();
    });

    it('tells a page drawn again after a reset, and what was drawn before it lets go of nothing', async () =>
    {
        const before = showing('sara.k');
        await settle();
        clock.advance(SEE_PAUSE_MS);

        usePresence().reset();
        useRealtime().reset();
        socket.reset();
        useRealtime().start();
        socket.accept();

        const after = showing('sara.k');
        await settle();
        before();
        clock.advance(SEE_PAUSE_MS + floor);

        expect(sees()).toEqual([{ t: 'see', who: ['sara.k'] }]);

        after();
    });
});

describe('the chat doorbell', () =>
{
    it('re-reads the open thread and the list when the open conversation changes', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.openThread('c-reza');
        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-reza', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('chat.list');
        await vi.waitFor(() => expect(server.calls).toContain('chat.messages'));

        stop();
    });

    it('does not re-read a thread the reader has been taken out of', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.openThread('c-reza');
        await chat.refresh();
        server.conversations = server.conversations.filter((row) => row.id !== 'c-reza');
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-reza', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await vi.waitFor(() => expect(server.calls).toContain('chat.list'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(server.calls).not.toContain('chat.messages');

        stop();
    });

    it('does not ask for that thread, nor for who can read it, when everything is rung at once', async () =>
    {
        const chat = useChat();
        const stop = chat.start();
        const heard: (string | undefined)[] = [];
        const deaf = chat.onThread((id) => heard.push(id));

        chat.openThread('c-reza');
        await chat.refresh();
        server.conversations = server.conversations.filter((row) => row.id !== 'c-reza');
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await vi.waitFor(() => expect(server.calls).toContain('chat.list'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(server.calls, 'a conversation the reader is no longer in was asked for').not.toContain('chat.messages');
        expect(heard, 'the room was asked about, though the reader is out of it').toEqual([]);

        deaf();
        stop();
    });

    it('reads the open thread again, and tells whoever listens, when everything is rung and the reader is still in it', async () =>
    {
        const chat = useChat();
        const stop = chat.start();
        const heard: (string | undefined)[] = [];
        const deaf = chat.onThread((id) => heard.push(id));

        chat.openThread('c-reza');
        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);

        await vi.waitFor(() => expect(server.calls).toContain('chat.messages'));
        expect(server.calls).toContain('chat.list');
        expect(heard).toEqual([undefined]);

        deaf();
        stop();
    });

    it('reads the open thread again on such a ring when the list has not reached it', async () =>
    {
        server.listPage = 1;

        const chat = useChat();
        const stop = chat.start();

        await chat.refresh();

        const beyond = server.conversations.map((row) => row.id).find((id) => !chat.conversations().some((one) => one.id === id));

        expect(beyond, 'the fixtures hold more conversations than one page lists').toBeDefined();

        chat.openThread(beyond!);
        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);

        await vi.waitFor(() => expect(server.calls).toContain('chat.messages'));

        stop();
    });

    it('re-reads only the list when some other conversation changes', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.openThread('c-reza');
        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-sara', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('chat.list');
        expect(server.calls).not.toContain('chat.messages');

        stop();
    });

    it('drops a thread a block took away between reading the list and the socket standing up', async () =>
    {
        useRealtime().reset();
        socket.reset();

        const chat = useChat();
        const stop = chat.start();
        useRealtime().start();

        await chat.refresh();
        await vi.waitFor(() => expect(chat.conversations().some((one) => one.id === 'c-reza')).toBe(true));
        server.conversations = server.conversations.filter((row) => row.id !== 'c-reza');

        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);

        await vi.waitFor(() => expect(chat.conversations().some((one) => one.id === 'c-reza')).toBe(false));
        stop();
    });

    it('ignores a doorbell meant for somebody else', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).not.toContain('chat.list');
        stop();
    });
});

describe('typing', () =>
{
    it('shows somebody typing and stops on its own, because nobody sends "I stopped"', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        expect(chat.typing('c-sara')).toEqual(['sara.k']);
        expect(chat.typing('c-reza')).toEqual([]);

        clock.advance(TYPING_TTL_MS - 1);
        expect(chat.typing('c-sara')).toEqual(['sara.k']);

        clock.advance(1);
        expect(chat.typing('c-sara')).toEqual([]);
        expect(clock.pending()).toBe(0);

        stop();
    });

    it('keeps two people in one room apart, and refreshes a deadline rather than stacking it', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        clock.advance(2000);
        socket.deliver({ v: 1, t: 'typing', n: 2, who: 'reza.t', id: 'c-sara' });
        socket.deliver({ v: 1, t: 'typing', n: 3, who: 'sara.k', id: 'c-sara' });

        expect(chat.typing('c-sara').sort()).toEqual(['reza.t', 'sara.k']);

        clock.advance(TYPING_TTL_MS);
        expect(chat.typing('c-sara')).toEqual([]);

        stop();
    });

    it('takes somebody out of the indicator the moment a message of theirs is the newest in the room, and not before', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        await chat.refresh();
        await settle();

        const row = server.conversations.find((one) => one.id === 'c-sara')!;
        const theirs = server.messages.find((one) => one.conversationId === 'c-sara' && one.kind === 'text' && one.from === 'sara.k' && one.id !== row.last?.id)!;

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        socket.deliver({ v: 1, t: 'typing', n: 2, who: 'reza.t', id: 'c-sara' });
        await chat.refresh();
        await settle();

        expect(chat.typing('c-sara').sort(), 'a read that brought nothing new ended somebody\'s typing').toEqual(['reza.t', 'sara.k']);

        row.last = { ...theirs };
        await chat.refresh();
        await settle();

        expect(chat.typing('c-sara'), 'the message has come and they are still typing it').toEqual(['reza.t']);

        socket.deliver({ v: 1, t: 'typing', n: 3, who: 'sara.k', id: 'c-sara' });

        expect(chat.typing('c-sara').sort(), 'typing again after a message is typing again').toEqual(['reza.t', 'sara.k']);

        stop();
    });

    it('keeps somebody typing whose old line is read in after their notice came', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        await chat.refresh();
        await settle();

        expect(chat.lastOf('c-sara')?.from, 'the room\'s newest line is one of hers').toBe('sara.k');
        expect(chat.typing('c-sara'), 'a line she wrote before she began typing ended it').toEqual(['sara.k']);

        stop();
    });

    it('takes somebody out of the indicator for the first line of a room that had none', async () =>
    {
        const row = server.conversations.find((one) => one.id === 'c-sara')!;
        const theirs = server.messages.find((one) => one.conversationId === 'c-sara' && one.kind === 'text' && one.from === 'sara.k')!;

        server.messages = server.messages.filter((one) => one.conversationId !== 'c-sara');
        delete row.last;

        const chat = useChat();
        const stop = chat.start();

        await chat.refresh();
        await settle();

        expect(chat.lastOf('c-sara'), 'the room is read and holds nothing').toBeUndefined();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        server.messages.push(theirs);
        row.last = theirs;
        await chat.refresh();
        await settle();

        expect(chat.typing('c-sara'), 'her first line has come and she is still said to be typing it').toEqual([]);

        stop();
    });

    it('says it is typing at a rate the gateway will not hang up on', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.setDraft('c-sara', 'h');
        chat.setDraft('c-sara', 'he');
        chat.setDraft('c-sara', 'hel');
        expect(socket.sent).toEqual([{ t: 'typing', id: 'c-sara' }]);

        clock.advance(TYPING_PING_MS);
        chat.setDraft('c-sara', 'hell');
        expect(socket.sent.length).toBe(2);

        stop();
    });

    it('says nothing about an empty draft', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.setDraft('c-sara', '   ');
        expect(socket.sent).toEqual([]);

        stop();
    });

    it('drops the typing state it was holding when it is reset', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        chat.reset();

        expect(chat.typing('c-sara')).toEqual([]);
        expect(clock.pending()).toBe(0);

        stop();
    });
});

describe('a long chat list', () =>
{
    it('reads one page, and the rest only when asked', async () =>
    {
        const chat = useChat();
        const everything = server.conversations.length;

        server.listPage = 2;
        await chat.refresh();
        await vi.waitFor(() => expect(chat.conversations().length).toBe(2));

        expect(chat.hasMoreConversations()).toBe(true);

        chat.moreConversations();
        await vi.waitFor(() => expect(chat.conversations().length).toBe(Math.min(4, everything)));
    });
});

describe('a chat store whose reader has signed out', () =>
{
    it('asks the server for nothing once nobody is signed in, the open thread included', async () =>
    {
        const chat = useChat();

        chat.openThread('c-reza');
        await chat.refresh();
        await vi.waitFor(() => expect(server.calls).toContain('chat.messages'));
        await settle();
        server.calls = [];

        useSession().reset();
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(server.calls.filter((call) => call.startsWith('chat.')), 'the chat was read again for nobody, with a session the server had ended').toEqual([]);
    });
});

describe('the social doorbell', () =>
{
    it('re-reads the graph, and only the graph', async () =>
    {
        const social = useSocial();
        const stop = social.start();

        await social.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('social.graph');

        // The suggestion and directory reads are behind want() because they are expensive, and
        // nothing the server rings about moves either of them.
        expect(server.calls).not.toContain('social.suggestions');
        expect(server.calls).not.toContain('social.people');

        stop();
    });

    it('leaves the chat list and the open thread alone when the graph moved without a block', async () =>
    {
        const social = useSocial();
        const chat = useChat();
        const stops = [social.start(), chat.start()];

        chat.openThread('c-reza');
        await social.refresh();
        await chat.refresh();
        await vi.waitFor(() => expect(server.calls).toContain('chat.messages'));
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await vi.waitFor(() => expect(server.calls).toContain('social.graph'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(server.calls).not.toContain('chat.list');
        expect(server.calls).not.toContain('chat.messages');

        stops.forEach((stop) => stop());
    });

    it('stops listening when the shell tears it down', async () =>
    {
        const social = useSocial();
        const stop = social.start();

        await social.refresh();
        stop();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toEqual([]);
    });
});

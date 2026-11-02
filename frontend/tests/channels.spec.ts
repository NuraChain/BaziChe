import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type MountNode } from 'azerothjs';

import type { ChannelPost, ChannelSummary } from '../src/api.ts';
import ChannelList from '../src/components/channels/channel-list.component.azeroth';
import ChannelPostView from '../src/components/channels/channel-post.component.azeroth';
import { postGist } from '../src/components/channels/channel-gist.ts';
import ChannelPage from '../src/pages/app/channel.page.azeroth';
import '../src/icons/all.ts';
import { routes } from '../src/routes.ts';
import { useChannels } from '../src/stores/channels.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/**
 * Channels in the browser: a poll a member answers, its tally and who chose what only where it is
 * not anonymous, a post the owner and the admins may delete, the list, and a channel's page saying
 * on its face that it is not end to end encrypted.
 */

const poll = (over: Partial<NonNullable<ChannelPost['poll']>> = {}): ChannelPost => ({
    id: 'p-1',
    channelId: 'ch-1',
    kind: 'poll',
    from: 'sara.k',
    text: '',
    at: '2026-11-02T10:00:00.000Z',
    poll: {
        question: 'Which game tonight?',
        answers: [{ text: 'Chess', votes: 0 }, { text: 'Hokm', votes: 0 }, { text: 'Poker', votes: 0 }],
        anonymous: true,
        multiple: false,
        voters: 0,
        mine: [],
        closed: false,
        ...over
    }
});

const channel = (over: Partial<ChannelSummary> = {}): ChannelSummary => ({
    id: 'ch-1',
    slug: 'friday-chess',
    name: 'Friday Chess',
    bio: 'Games every Friday.',
    privacy: 'public',
    owner: 'sara.k',
    memberCount: 12,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...over
});

const routed = (child: () => MountNode, at = '/app/chats') =>
{
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });

    return renderTest(() => RouterProvider({ router, children: child }) as HTMLElement).container;
};

const showPost = (post: ChannelPost, options: { member?: boolean; speaks?: boolean } = {}) =>
    routed(() => ChannelPostView({ post, slug: 'friday-chess', member: options.member ?? true, speaks: options.speaks ?? false, me: 'alex' }));

beforeEach(() =>
{
    useLocale().setLocale('en');
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    vi.restoreAllMocks();
});

describe('a poll in a channel', () =>
{
    it('takes one answer at a press, for a member who has not voted, without showing the tally first', () =>
    {
        const vote = vi.spyOn(useChannels(), 'vote').mockResolvedValue(undefined);
        const container = showPost(poll());

        expect(container.querySelector('[data-result]'), 'no tally before voting').toBeNull();

        fire(container.querySelector('[data-answer="1"]')!, 'click');

        expect(vote).toHaveBeenCalledWith('friday-chess', 'p-1', [1]);
    });

    it('takes several answers and sends them together when it allows several', () =>
    {
        const vote = vi.spyOn(useChannels(), 'vote').mockResolvedValue(undefined);
        const container = showPost(poll({ multiple: true }));

        fire(container.querySelector('[data-answer="2"]')!, 'click');
        fire(container.querySelector('[data-answer="0"]')!, 'click');

        expect(vote, 'nothing sent at a press').not.toHaveBeenCalled();

        const send = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Vote')!;

        fire(send, 'click');
        expect(vote).toHaveBeenCalledWith('friday-chess', 'p-1', [0, 2]);
    });

    it('shows the tally once the reader has voted, with what they chose, and names nobody when anonymous', () =>
    {
        const container = showPost(poll({ answers: [{ text: 'Chess', votes: 3 }, { text: 'Hokm', votes: 1 }, { text: 'Poker', votes: 0 }], voters: 4, mine: [0] }));
        const shares = [...container.querySelectorAll('[data-result]')].map((one) => one.textContent);

        expect(shares[0]).toContain('75%');
        expect(shares[1]).toContain('25%');
        expect(container.querySelector('[data-voters]')?.textContent).toBe('4 votes');
        expect(container.textContent).toContain('Anonymous poll');
        expect([...container.querySelectorAll('[data-result]')].every((one) => one.querySelector('span.block') === null), 'nobody named beside an answer').toBe(true);
    });

    it('names who chose what when it is not anonymous', () =>
    {
        const container = showPost(poll({ anonymous: false, answers: [{ text: 'Chess', votes: 1, voters: ['reza'] }, { text: 'Hokm', votes: 0, voters: [] }, { text: 'Poker', votes: 0, voters: [] }], voters: 1, mine: [0] }));

        expect(container.querySelector('[data-result="0"]')?.textContent).toContain('reza');
        expect(container.textContent).toContain('Public poll');
    });

    it('shows its tally to somebody only looking, who cannot vote', () =>
    {
        const container = showPost(poll({ answers: [{ text: 'Chess', votes: 2 }, { text: 'Hokm', votes: 0 }, { text: 'Poker', votes: 0 }], voters: 2 }), { member: false });

        expect(container.querySelectorAll('[data-result]')).toHaveLength(3);
        expect(container.querySelector('[data-answer]')).toBeNull();
    });

    it('takes no vote once it is closed', () =>
    {
        const container = showPost(poll({ closed: true }));

        expect(container.querySelector('[data-answer]')).toBeNull();
        expect(container.textContent).toContain('Closed');
    });
});

describe('a post in a channel', () =>
{
    it('may be deleted by the owner and the admins, and by nobody else', () =>
    {
        const remove = vi.spyOn(useChannels(), 'removePost').mockResolvedValue(undefined);
        const text: ChannelPost = { id: 'p-2', channelId: 'ch-1', kind: 'text', from: 'sara.k', text: 'Hello **all**', at: '2026-11-02T10:00:00.000Z' };

        expect(showPost(text).querySelector('button[aria-label="Delete the post"]')).toBeNull();

        cleanup();
        const container = showPost(text, { speaks: true });

        expect(container.querySelector('strong')?.textContent).toBe('all');
        fire(container.querySelector('button[aria-label="Delete the post"]')!, 'click');
        expect(remove).toHaveBeenCalledWith('friday-chess', 'p-2');
    });

    it('says its size before its file is fetched', () =>
    {
        const container = showPost({
            id: 'p-3',
            channelId: 'ch-1',
            kind: 'file',
            from: 'sara.k',
            text: 'Last night',
            at: '2026-11-02T10:00:00.000Z',
            file: { id: '0f8b5d2c-7a41-4c3e-9b6d-2e1f0a9c8b7d', key: 'k'.repeat(43), iv: 'i'.repeat(16), as: 'video', mime: 'video/mp4', name: 'game.mp4', bytes: 18 * 1024 * 1024, w: 1280, h: 720, ms: 42_000 }
        });

        expect(container.querySelector('[data-size]')?.textContent).toContain('0:42 · 18 MB');
        expect(container.textContent).toContain('Last night');
    });

    it('is summed up by its words, its file or its question', () =>
    {
        const locale = useLocale();

        expect(postGist(poll(), locale)).toBe('Poll: Which game tonight?');
        expect(postGist({ ...poll(), kind: 'text', poll: undefined, text: 'Hi' }, locale)).toBe('Hi');
    });
});

describe('the channels tab', () =>
{
    it('lists the reader’s channels with their unread posts, and New channel opens the form', async () =>
    {
        vi.spyOn(useChannels(), 'mine').mockReturnValue([channel({ role: 'member', unread: 3, last: { ...poll(), channelId: 'ch-1' } })]);
        vi.spyOn(useChannels(), 'reading').mockReturnValue('read');
        vi.spyOn(useChannels(), 'elsewhere').mockReturnValue([channel({ id: 'ch-2', slug: 'poker-night', name: 'Poker Night', memberCount: 1 })]);

        const container = routed(() => ChannelList({}));

        expect(container.querySelector('[data-channel="friday-chess"]')?.textContent).toContain('Poll: Which game tonight?');
        expect(container.querySelector('[data-channel="friday-chess"] [data-unread]')?.textContent).toBe('3');
        expect(container.querySelector('[data-channel="poker-night"]')?.textContent).toContain('1 member');

        fire([...container.querySelectorAll('button')].find((one) => one.textContent?.includes('New channel'))!, 'click');

        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.label)).toEqual(['New channel']));
    });
});

describe('a channel’s page', () =>
{
    const page = (summary: ChannelSummary) =>
    {
        const store = useChannels();

        vi.spyOn(store, 'open').mockImplementation(() => undefined);
        vi.spyOn(store, 'viewing').mockReturnValue(summary);
        vi.spyOn(store, 'viewReading').mockReturnValue('read');
        vi.spyOn(store, 'posts').mockReturnValue([]);
        vi.spyOn(store, 'postsReading').mockReturnValue('read');
        vi.spyOn(store, 'markRead').mockResolvedValue(undefined);

        return routed(() => ChannelPage(), `/app/channels/${ summary.slug }`);
    };

    it('says on its face that it is not end to end encrypted, with its bio and count, and offers Join to somebody looking', () =>
    {
        const container = page(channel());

        expect(container.querySelector('[data-not-sealed]')?.textContent).toContain('not end-to-end encrypted');
        expect(container.querySelector('[data-bio]')?.textContent).toBe('Games every Friday.');
        expect(container.querySelector('[data-members]')?.textContent).toBe('12 members · Public');
        expect([...container.querySelectorAll('button')].some((one) => one.textContent?.trim() === 'Join')).toBe(true);
        expect(container.querySelector('[data-channel-composer]'), 'no composer for a reader').toBeNull();
    });

    it('gives the owner and the admins the composer, with the paperclip and a poll', () =>
    {
        const container = page(channel({ role: 'admin' }));
        const composer = container.querySelector('[data-channel-composer]');

        expect(composer).not.toBeNull();
        expect(composer?.querySelector('button[aria-label="Attach a photo, a video or a file"]')).not.toBeNull();
        expect(composer?.querySelector('button[aria-label="New poll"]')).not.toBeNull();
    });

    it('keeps a member to reading, voting and inviting', () =>
    {
        const container = page(channel({ role: 'member' }));
        const words = [...container.querySelectorAll('button')].map((one) => one.textContent?.trim());

        expect(words).toContain('Invite');
        expect(words).not.toContain('Edit channel');
        expect(container.querySelector('[data-channel-composer]')).toBeNull();
    });
});

describe('a channel’s members', () =>
{
    it('lets the owner name an admin and take a member out, and shows everybody else the list alone', async () =>
    {
        const { default: ChannelMembers } = await import('../src/components/channels/channel-members.component.azeroth');
        const store = useChannels();

        vi.spyOn(store, 'members').mockResolvedValue([{ handle: 'sara.k', role: 'owner' }, { handle: 'reza', role: 'member' }]);
        const setRole = vi.spyOn(store, 'setRole').mockResolvedValue(undefined);

        const owned = routed(() => ChannelMembers({ overlayId: 'm', close: () => undefined, channel: channel({ role: 'owner' }) }));

        await vi.waitFor(() => expect(owned.querySelector('[data-member="reza"]')).not.toBeNull());
        expect(owned.querySelector('[data-member="sara.k"] button'), 'nothing to do to the owner').toBeNull();

        fire([...owned.querySelectorAll<HTMLElement>('[data-member="reza"] button')].find((one) => one.textContent?.trim() === 'Make admin')!, 'click');
        expect(setRole).toHaveBeenCalledWith('friday-chess', 'reza', 'admin');

        cleanup();
        const looked = routed(() => ChannelMembers({ overlayId: 'm', close: () => undefined, channel: channel({ role: 'member' }) }));

        await vi.waitFor(() => expect(looked.querySelector('[data-member="reza"]')).not.toBeNull());
        expect(looked.querySelectorAll('[data-member] button')).toHaveLength(0);
    });

    it('hands the channel on only once the owner says yes, then stops offering what only an owner may do', async () =>
    {
        const { default: ChannelMembers } = await import('../src/components/channels/channel-members.component.azeroth');
        const store = useChannels();
        const read = vi.spyOn(store, 'members').mockResolvedValue([{ handle: 'sara.k', role: 'owner' }, { handle: 'reza', role: 'member' }]);
        const transfer = vi.spyOn(store, 'transfer').mockResolvedValue(undefined);
        const pressed = (root: HTMLElement, words: string) => fire([...root.querySelectorAll<HTMLElement>('button')].find((one) => one.textContent?.trim() === words)!, 'click');

        const owned = routed(() => ChannelMembers({ overlayId: 'm', close: () => undefined, channel: channel({ role: 'owner' }) }));

        await vi.waitFor(() => expect(owned.querySelector('[data-member="reza"]')).not.toBeNull());
        pressed(owned, 'Make owner');
        expect(transfer, 'asked first').not.toHaveBeenCalled();
        expect(owned.querySelector('[data-handing="reza"]')?.textContent).toContain('You stay on as an admin.');

        pressed(owned, 'Cancel');
        expect(owned.querySelector('[data-handing]')).toBeNull();
        expect(transfer).not.toHaveBeenCalled();

        pressed(owned, 'Make owner');
        read.mockResolvedValue([{ handle: 'sara.k', role: 'admin' }, { handle: 'reza', role: 'owner' }]);
        pressed(owned, 'Hand it over');

        await vi.waitFor(() => expect(owned.querySelector('[data-member="reza"]')?.getAttribute('data-role')).toBe('owner'));
        expect(transfer).toHaveBeenCalledWith('friday-chess', 'reza');
        expect(owned.querySelectorAll('[data-member] button'), 'an admin now, who names nobody').toHaveLength(0);
    });
});

import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type ChannelPost, type ChannelSummary } from '../api.ts';
import type { FileDraft } from '../data/chat.ts';
import { sealFile, sniffShown } from '../lib/chat-file.ts';
import { holdFile } from '../lib/file-held.ts';
import { readingOf, type Reading } from '../lib/reading.ts';
import { chatFiles } from '../services/chat-files.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';

export interface ChannelDraft
{
    name: string;
    bio: string;

    /** The address an avatar upload answered with, or '' for none. */
    photo: string;
    privacy: 'public' | 'private';
}

export interface PollDraft
{
    question: string;
    answers: string[];
    anonymous: boolean;
    multiple: boolean;
}

export interface ChannelsApi
{
    /** The channels this account is in, the one with the newest post first. */
    mine: Getter<ChannelSummary[]>;
    reading: Getter<Reading>;
    failure: Getter<unknown>;

    /** Public channels this account is not in. Lazy: read the first time something wants them. */
    elsewhere: Getter<ChannelSummary[]>;
    elsewhereReading: Getter<Reading>;
    want(): void;

    /** Posts not yet read across every channel, for the tab's count. */
    unread: Getter<number>;

    open(slug: string): void;
    close(): void;
    openSlug: Getter<string>;

    /** The open channel, or null while it is read and for a slug that is no channel this reader may see. */
    viewing: Getter<ChannelSummary | null>;
    viewReading: Getter<Reading>;
    viewFailure: Getter<unknown>;

    /** The open channel's posts, oldest first, and whether older ones are there to read. */
    posts: Getter<ChannelPost[]>;
    postsReading: Getter<Reading>;
    older: Getter<boolean>;
    readOlder(): Promise<void>;

    /** How much of a post's file has gone up, 0 to 1, while it goes. */
    uploading: Getter<number | null>;

    create(draft: ChannelDraft): Promise<ChannelSummary>;
    edit(slug: string, draft: ChannelDraft): Promise<ChannelSummary>;
    join(slug: string): Promise<void>;
    leave(slug: string): Promise<void>;
    destroy(slug: string): Promise<void>;
    invite(slug: string, handle: string): Promise<void>;
    remove(slug: string, handle: string): Promise<void>;
    setRole(slug: string, handle: string, role: 'admin' | 'member'): Promise<void>;
    transfer(slug: string, handle: string): Promise<void>;
    members(slug: string): Promise<{ handle: string; role: 'owner' | 'admin' | 'member' }[]>;

    post(slug: string, text: string): Promise<void>;

    /** Seals the file under a key of its own, puts it up with its progress, and posts it with the key and its caption. */
    postFile(slug: string, draft: FileDraft, caption: string): Promise<void>;
    postPoll(slug: string, poll: PollDraft): Promise<void>;
    removePost(slug: string, postId: string): Promise<void>;
    vote(slug: string, postId: string, choices: number[]): Promise<void>;
    closePoll(slug: string, postId: string): Promise<void>;
    markRead(slug: string): Promise<void>;

    refresh(): Promise<void>;
    start(): () => void;
    reset(): void;
}

/**
 * Channels, according to the SERVER, which reads them: a channel is a broadcast, not a sealed room,
 * and nothing here touches a key but a post's file's, which travels in the post. Named by slug
 * everywhere, as a group is.
 */
export const useChannels = createStore((): ChannelsApi =>
{
    const account = useAccount();

    const who = () => account.user()?.id ?? null;

    const [openSlug, setOpenSlug] = createSignal('');
    const [wanted, setWanted] = createSignal(false);
    const [earlier, setEarlier] = createSignal<ChannelPost[]>([]);
    const [cursor, setCursor] = createSignal<string | undefined>(undefined);
    const [uploading, setUploading] = createSignal<number | null>(null);

    const mine = createResource(who, () => client.channels.mine(), { name: 'channels.mine' });

    const elsewhere = createResource(() => (wanted() ? who() : null), () => client.channels.discover(), { name: 'channels.discover' });

    const viewing = createResource(
        () => (openSlug() === '' ? null : { slug: openSlug(), who: who() }),
        async (current) =>
        {
            try
            {
                return await client.channels.view({ params: { slug: current.slug } });
            }
            catch (error)
            {
                // A slug that is no channel this reader may see is an answer, not a failure.
                if (error instanceof ApiError && error.status === 404)
                {
                    return null;
                }
                throw error;
            }
        },
        { name: 'channels.view' }
    );

    /** The newest page of the open channel's posts; older pages read on asking are kept beside it. */
    const page = createResource(
        () => (openSlug() === '' ? null : { slug: openSlug(), who: who() }),
        async (current) =>
        {
            try
            {
                const read = await client.channels.posts({ params: { slug: current.slug }, query: {} });

                if (untrack(earlier).length === 0)
                {
                    setCursor(read.hasMore ? read.cursor : undefined);
                }
                return read;
            }
            catch (error)
            {
                if (error instanceof ApiError && error.status === 404)
                {
                    return { posts: [], hasMore: false };
                }
                throw error;
            }
        },
        { name: 'channels.posts' }
    );

    let inFlight: Promise<void> = Promise.resolve();

    const revalidate = () =>
    {
        inFlight = inFlight.catch(() => undefined).then(async () =>
        {
            await Promise.all([
                mine.refetch(),
                untrack(openSlug) === '' ? Promise.resolve() : viewing.refetch(),
                untrack(openSlug) === '' ? Promise.resolve() : page.refetch(),
                untrack(wanted) ? elsewhere.refetch() : Promise.resolve()
            ]);
        });
        return inFlight;
    };

    const listed = () => mine.data()?.channels ?? [];

    /** The newest page and the older pages read before it, one post once, oldest first. */
    const posts = () =>
    {
        const newest = page.data()?.posts ?? [];
        const seen = new Set(newest.map((post) => post.id));

        return [...earlier().filter((post) => !seen.has(post.id)), ...newest];
    };

    const sendFile = async (slug: string, draft: FileDraft, caption: string) =>
    {
        const id = crypto.randomUUID();
        const sealed = await sealFile(draft.plain, id);

        setUploading(0);

        try
        {
            await chatFiles().upload(id, sealed.body, (fraction) => setUploading(fraction));
        }
        finally
        {
            setUploading(null);
        }

        // The poster sees what they posted at once, as the type its bytes say it is.
        holdFile(id, draft.plain, draft.as === 'file' ? 'application/octet-stream' : sniffShown(draft.plain) ?? 'application/octet-stream');

        await client.channels.post({
            params: { slug },
            input: {
                kind: 'file',
                text: caption.trim(),
                file: {
                    id,
                    key: sealed.key,
                    iv: sealed.iv,
                    as: draft.as,
                    mime: draft.mime,
                    name: draft.name,
                    bytes: draft.plain.byteLength,
                    ...(draft.w === undefined || draft.h === undefined ? {} : { w: draft.w, h: draft.h }),
                    ...(draft.ms === undefined ? {} : { ms: draft.ms }),
                    ...(draft.thumb === undefined ? {} : { thumb: draft.thumb })
                }
            }
        });
    };

    const after = async <T>(work: Promise<T>) =>
    {
        const done = await work;

        await revalidate();
        return done;
    };

    return {
        mine: listed,
        reading: () => readingOf(mine),
        failure: () => mine.error(),

        elsewhere: () => elsewhere.data()?.channels ?? [],
        elsewhereReading: () => readingOf(elsewhere),

        want()
        {
            if (!untrack(wanted))
            {
                setWanted(true);
            }
        },

        unread: () => listed().reduce((sum, channel) => sum + (channel.unread ?? 0), 0),

        open(slug)
        {
            if (untrack(openSlug) !== slug)
            {
                setEarlier([]);
                setCursor(undefined);
            }
            setOpenSlug(slug);
        },

        close()
        {
            setOpenSlug('');
            setEarlier([]);
            setCursor(undefined);
        },

        openSlug,
        viewing: () => viewing.data() ?? null,
        viewReading: () => readingOf(viewing),
        viewFailure: () => viewing.error(),

        posts,
        postsReading: () => readingOf(page),
        older: () => cursor() !== undefined,

        async readOlder()
        {
            const slug = untrack(openSlug);
            const from = untrack(cursor);

            if (slug === '' || from === undefined)
            {
                return;
            }

            const read = await client.channels.posts({ params: { slug }, query: { cursor: from } });

            setEarlier((current) => [...read.posts, ...current]);
            setCursor(read.hasMore ? read.cursor : undefined);
        },

        uploading,

        create: (draft) => after(client.channels.create({ input: draft })),

        edit: (slug, draft) => after(client.channels.edit({ params: { slug }, input: draft })),

        async join(slug)
        {
            await after(client.channels.join({ params: { slug } }));
        },

        async leave(slug)
        {
            await client.channels.leave({ params: { slug } });

            if (untrack(openSlug) === slug)
            {
                await viewing.refetch();
            }
            await revalidate();
        },

        async destroy(slug)
        {
            await client.channels.destroy({ params: { slug } });

            if (untrack(openSlug) === slug)
            {
                setOpenSlug('');
            }
            await revalidate();
        },

        async invite(slug, handle)
        {
            await after(client.channels.invite({ params: { slug }, input: { id: handle } }));
        },

        async remove(slug, handle)
        {
            await after(client.channels.remove({ params: { slug }, input: { id: handle } }));
        },

        async setRole(slug, handle, role)
        {
            await after(client.channels.role({ params: { slug }, input: { id: handle, role } }));
        },

        async transfer(slug, handle)
        {
            await after(client.channels.transfer({ params: { slug }, input: { id: handle } }));
        },

        async members(slug)
        {
            return (await client.channels.members({ params: { slug } })).members;
        },

        async post(slug, text)
        {
            await after(client.channels.post({ params: { slug }, input: { kind: 'text', text: text.trim() } }));
        },

        async postFile(slug, draft, caption)
        {
            await after(sendFile(slug, draft, caption));
        },

        async postPoll(slug, poll)
        {
            await after(client.channels.post({ params: { slug }, input: { kind: 'poll', text: '', poll } }));
        },

        async removePost(slug, postId)
        {
            await client.channels.removePost({ params: { slug, postId } });
            setEarlier((current) => current.filter((post) => post.id !== postId));
            await revalidate();
        },

        async vote(slug, postId, choices)
        {
            const voted = await client.channels.vote({ params: { slug, postId }, input: { choices } });

            setEarlier((current) => current.map((post) => (post.id === postId ? voted : post)));
            await revalidate();
        },

        async closePoll(slug, postId)
        {
            const closed = await client.channels.close({ params: { slug, postId } });

            setEarlier((current) => current.map((post) => (post.id === postId ? closed : post)));
            await revalidate();
        },

        async markRead(slug)
        {
            await client.channels.read({ params: { slug } });
            await mine.refetch();
        },

        refresh: revalidate,

        /** A channel's change rings this account's own doorbell, as `channels`, and everything open is read again. */
        start()
        {
            return useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'channels') && untrack(who) !== null)
                {
                    void revalidate().catch(() => undefined);
                }
            });
        },

        reset()
        {
            setOpenSlug('');
            setWanted(false);
            setEarlier([]);
            setCursor(undefined);
            setUploading(null);
            inFlight = Promise.resolve();
            void mine.refetch();
        }
    };
});

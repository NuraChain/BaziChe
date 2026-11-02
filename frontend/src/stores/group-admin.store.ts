import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { GROUP_RIGHTS, type GroupRight, type GroupRole } from '../../../backend/src/domains/group/roles.ts';
import { client, type GroupMembers } from '../api.ts';
import { createGuesses } from '../lib/guess.ts';
import { readingOf, type Reading } from '../lib/reading.ts';
import { runtime } from '../lib/runtime.ts';
import { useAccount } from './account.store.ts';
import { useGroups } from './groups.store.ts';
import { usePeople } from './people.store.ts';
import { useRealtime } from './realtime.store.ts';

export type GroupMember = GroupMembers['members'][number];

export interface GroupAdminApi
{
    /** The open group's slug, or nothing while no group page is open. */
    slug: Getter<string>;
    open(slug: string): void;
    close(): void;

    /** Its members a page at a time, the staff first, narrowed by what was searched, with every change pressed and not yet answered laid over them. */
    members: Getter<GroupMember[]>;
    count: Getter<number>;
    reading: Getter<Reading>;
    failure: Getter<unknown>;
    hasMore: Getter<boolean>;
    more(): Promise<void>;
    query: Getter<string>;
    search(query: string): void;

    /** What the staff do to a member, each shown at the press and taken back if the server refuses. */
    setRole(handle: string, role: Exclude<GroupRole, 'owner'>, rights?: readonly GroupRight[]): Promise<void>;
    mute(handle: string, hours?: number): Promise<void>;
    unmute(handle: string): Promise<void>;
    remove(handle: string): Promise<void>;
    ban(handle: string): Promise<void>;
    handOn(handle: string): Promise<void>;

    /** Reads the members again: after a change, and at the social doorbell. */
    refresh(): Promise<void>;

    start(): () => void;
    reset(): void;
}

const HOUR_MS = 3_600_000;

/**
 * What a group's page shows of who is in it, read from the server for the group that is open.
 *
 * The members are a page at a time: the first page is a resource keyed by the group and the words
 * searched, and a later page is added below it; anything that changes the list reads the first page
 * again and drops the rest, because a fresh head stitched onto a stale tail shows somebody twice.
 */
export const useGroupAdmin = createStore((): GroupAdminApi =>
{
    const account = useAccount();
    const people = usePeople();
    const groups = useGroups();

    const [slug, setSlug] = createSignal('');
    const [query, setQuery] = createSignal('');
    const [later, setLater] = createSignal<GroupMember[]>([]);
    const [cursor, setCursor] = createSignal<string | undefined>(undefined);

    const guesses = createGuesses<GroupMember[]>();

    const who = () => account.user()?.id ?? null;

    const words = (said: string) => said.trim();

    const first = createResource(
        () => (slug() === '' ? null : { slug: slug(), q: words(query()), who: who() }),
        async (current) =>
        {
            const page = await client.groups.members({ params: { slug: current.slug }, query: current.q === '' ? {} : { q: current.q } });

            setLater([]);
            setCursor(page.cursor);
            people.remember(page.members.map((member) => member.person));
            guesses.landed();
            return page;
        },
        { name: 'groupAdmin.members' }
    );

    const refresh = async () =>
    {
        if (untrack(slug) !== '')
        {
            await Promise.all([first.refetch(), groups.refresh()]);
        }
    };

    /** Reads after a change, and fails when the members could not be read, so a guess stands until they are. */
    const reread = async () =>
    {
        await refresh();
        if (first.error() !== null)
        {
            throw first.error();
        }
    };

    const about = (handle: string, change: (member: GroupMember) => GroupMember | null) =>
        (held: GroupMember[]) => held.flatMap((member) =>
        {
            if (member.person.handle !== handle)
            {
                return [member];
            }
            const changed = change(member);
            return changed === null ? [] : [changed];
        });

    const act = async (guess: (held: GroupMember[]) => GroupMember[], send: (open: string) => Promise<unknown>) =>
    {
        const open = untrack(slug);
        await guesses.during(guess, () => send(open), reread);
    };

    return {
        slug,

        open(next)
        {
            if (untrack(slug) !== next)
            {
                setQuery('');
                guesses.clear();
                setSlug(next);
            }
        },

        close: () => setSlug(''),

        members: () => guesses.over([...(first.data()?.members ?? []), ...later()]),
        count: () => first.data()?.count ?? 0,
        reading: () => readingOf(first),
        failure: () => first.error(),
        hasMore: () => cursor() !== undefined,

        async more()
        {
            const open = untrack(slug);
            const after = untrack(cursor);

            if (open === '' || after === undefined)
            {
                return;
            }

            const said = words(untrack(query));
            const page = await client.groups.members({ params: { slug: open }, query: { cursor: after, ...(said === '' ? {} : { q: said }) } });

            // A page that comes back after the group, the search or the head moved belongs to none of them.
            if (untrack(slug) === open && untrack(cursor) === after && words(untrack(query)) === said)
            {
                setLater((current) => [...current, ...page.members]);
                setCursor(page.cursor);
                people.remember(page.members.map((member) => member.person));
            }
        },

        query,
        search: (next) => setQuery(next),

        setRole: (handle, role, rights) => act(
            about(handle, (member) =>
            {
                const { rights: _, ...rest } = member;
                return role === 'admin' ? { ...rest, role, rights: GROUP_RIGHTS.filter((right) => (rights ?? []).includes(right)) } : { ...rest, role };
            }),
            (open) => client.groups.role({ params: { slug: open }, input: { id: handle, role, ...(role === 'admin' ? { rights: [...(rights ?? [])] } : {}) } })
        ),

        mute: (handle, hours) => act(
            about(handle, (member) => ({ ...member, muted: hours === undefined ? {} : { until: new Date(runtime().clock.now() + hours * HOUR_MS).toISOString() } })),
            (open) => client.groups.mute({ params: { slug: open }, input: { id: handle, ...(hours === undefined ? {} : { hours }) } })
        ),

        unmute: (handle) => act(
            about(handle, (member) =>
            {
                const { muted: _, ...rest } = member;
                return rest;
            }),
            (open) => client.groups.unmute({ params: { slug: open }, input: { id: handle } })
        ),

        remove: (handle) => act(
            about(handle, () => null),
            (open) => client.groups.remove({ params: { slug: open }, input: { id: handle } })
        ),

        ban: (handle) => act(
            about(handle, () => null),
            (open) => client.groups.ban({ params: { slug: open }, input: { id: handle } })
        ),

        handOn: (handle) => act(
            (held) => held.map((member) =>
            {
                if (member.person.handle === handle)
                {
                    const { rights: _, ...rest } = member;
                    return { ...rest, role: 'owner' as const };
                }
                return member.role === 'owner' ? { ...member, role: 'admin' as const, rights: [...GROUP_RIGHTS] } : member;
            }),
            (open) => client.groups.transfer({ params: { slug: open }, input: { id: handle } })
        ),

        refresh,

        start()
        {
            return useRealtime().onNudge((scope) =>
            {
                if (scope === 'social')
                {
                    void refresh().catch(() => undefined);
                }
            });
        },

        reset()
        {
            setSlug('');
            setQuery('');
            setLater([]);
            setCursor(undefined);
            guesses.clear();
        }
    };
});

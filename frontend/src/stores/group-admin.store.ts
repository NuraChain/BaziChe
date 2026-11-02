import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { GROUP_RIGHTS, type GroupRight, type GroupRole } from '../../../backend/src/domains/group/roles.ts';
import { client, type GroupLinks, type GroupLog, type GroupMembers, type GroupReport, type GroupRequests } from '../api.ts';
import { createGuesses } from '../lib/guess.ts';
import { readingOf, type Reading } from '../lib/reading.ts';
import { runtime } from '../lib/runtime.ts';
import { useAccount } from './account.store.ts';
import { useGroups } from './groups.store.ts';
import { usePeople } from './people.store.ts';
import { useRealtime } from './realtime.store.ts';

export type GroupMember = GroupMembers['members'][number];

export type GroupWaiting = GroupRequests['requests'][number];

export type GroupLink = GroupLinks['links'][number];

export type GroupLogRow = GroupLog['rows'][number];

/** Which of a group's reports a panel lists: those still waiting, those closed, or both. */
export type GroupReportList = 'open' | 'closed' | 'all';

export interface GroupKept
{
    person: GroupMember['person'];
    at: string;
}

/** The panels only some of the staff open, read once their tab asks and never before. */
export type GroupPanel = 'requests' | 'links' | 'banned' | 'log' | 'reports';

const PANELS: readonly GroupPanel[] = ['requests', 'links', 'banned', 'log', 'reports'];

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

    /** Asks for a panel's read, once its tab is shown. */
    want(panel: GroupPanel): void;

    /** Who waits to be let in, and an answer to one of them, shown at the press. */
    requests: Getter<GroupWaiting[]>;
    requestsReading: Getter<Reading>;
    requestsFailure: Getter<unknown>;
    answer(handle: string, approve: boolean): Promise<void>;

    /** The group's links, a new one drawn once the server has made it, and one revoked at the press. */
    links: Getter<GroupLink[]>;
    linksReading: Getter<Reading>;
    linksFailure: Getter<unknown>;
    makeLink(input: { hours?: number; uses?: number; approval: boolean }): Promise<GroupLink | undefined>;
    revokeLink(id: string): Promise<void>;

    /** Who is kept out, and one let back at the press. */
    banned: Getter<GroupKept[]>;
    bannedReading: Getter<Reading>;
    bannedFailure: Getter<unknown>;
    unban(handle: string): Promise<void>;

    /** What the staff did here, newest first, a page at a time. */
    log: Getter<GroupLogRow[]>;
    logReading: Getter<Reading>;
    logFailure: Getter<unknown>;
    logHasMore: Getter<boolean>;
    logMore(): Promise<void>;

    /** The reports about lines in its room the reader may work, newest first, of the list chosen, a page at a time. */
    reports: Getter<GroupReport[]>;
    reportsReading: Getter<Reading>;
    reportsFailure: Getter<unknown>;
    reportsHasMore: Getter<boolean>;
    reportsMore(): Promise<void>;
    reportList: Getter<GroupReportList>;
    showReports(list: GroupReportList): void;

    /** Closes one as nothing to do or dealt with, shown at the press and taken back if the server refuses. */
    closeReport(id: string, outcome: 'dismissed' | 'actioned'): Promise<void>;

    /** Takes the line a report is about out of the group's chat, and closes the report as dealt with, at the press. */
    takeReported(report: GroupReport, conversationId: string): Promise<void>;

    /** One member by their handle, read afresh for the sheet that manages them, or none once they are not in the group. */
    memberNamed(handle: string): Promise<GroupMember | null>;

    /** Reads the members and every panel asked for again: after a change, and at the social doorbell. */
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
    const waitingGuesses = createGuesses<GroupWaiting[]>();
    const linkGuesses = createGuesses<GroupLink[]>();
    const keptGuesses = createGuesses<GroupKept[]>();
    const reportGuesses = createGuesses<GroupReport[]>();

    const wants: Record<GroupPanel, ReturnType<typeof createSignal<boolean>>> = {
        requests: createSignal(false),
        links: createSignal(false),
        banned: createSignal(false),
        log: createSignal(false),
        reports: createSignal(false)
    };
    const [olderLog, setOlderLog] = createSignal<GroupLogRow[]>([]);
    const [logCursor, setLogCursor] = createSignal<string | undefined>(undefined);
    const [reportList, setReportList] = createSignal<GroupReportList>('open');
    const [olderReports, setOlderReports] = createSignal<GroupReport[]>([]);
    const [reportCursor, setReportCursor] = createSignal<string | undefined>(undefined);

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

    /** A panel's read, keyed by the group and whether its tab has asked, so nothing is read before. */
    const panel = <T>(name: GroupPanel, read: (open: string) => Promise<T>) => createResource(
        () => (slug() === '' || !wants[name][0]() ? null : { slug: slug(), who: who() }),
        (current) => read(current.slug),
        { name: `groupAdmin.${ name }` }
    );

    const requests = panel('requests', async (open) =>
    {
        const answer = await client.groups.requests({ params: { slug: open } });
        people.remember(answer.requests.map((one) => one.person));
        waitingGuesses.landed();
        return answer;
    });

    const links = panel('links', async (open) =>
    {
        const answer = await client.groups.links({ params: { slug: open } });
        linkGuesses.landed();
        return answer;
    });

    const banned = panel('banned', async (open) =>
    {
        const answer = await client.groups.banned({ params: { slug: open } });
        people.remember(answer.people.map((one) => one.person));
        keptGuesses.landed();
        return answer;
    });

    const firstLog = panel('log', async (open) =>
    {
        const page = await client.groups.log({ params: { slug: open }, query: {} });
        setOlderLog([]);
        setLogCursor(page.cursor);
        return page;
    });

    /** Keyed by the list chosen as well, so a list chosen is read and a page of another is never kept. */
    const firstReports = createResource(
        () => (slug() === '' || !wants.reports[0]() ? null : { slug: slug(), who: who(), list: reportList() }),
        async (current) =>
        {
            const page = await client.groups.reports({ params: { slug: current.slug }, query: current.list === 'open' ? {} : { list: current.list } });

            setOlderReports([]);
            setReportCursor(page.cursor);
            people.remember(page.reports.map((one) => one.person));
            reportGuesses.landed();
            return page;
        },
        { name: 'groupAdmin.reports' }
    );

    const reads = { requests, links, banned, log: firstLog, reports: firstReports };

    const refresh = async () =>
    {
        if (untrack(slug) !== '')
        {
            const asked = PANELS.filter((name) => untrack(wants[name][0]));
            await Promise.all([first.refetch(), groups.refresh(), ...asked.map((name) => reads[name].refetch())]);
        }
    };

    /** Reads after a change, and fails when the read a guess waits for failed, so the guess stands until it lands. */
    const rereadFor = (read: { error: Getter<unknown> }) => async () =>
    {
        await refresh();
        if (read.error() !== null)
        {
            throw read.error();
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

    const without = <T extends { person: { handle: string } }>(handle: string) => (held: T[]) => held.filter((one) => one.person.handle !== handle);

    /** A report closed as the list shown says it: gone from those still waiting, closed where closed ones are listed. */
    const closedIn = (id: string, outcome: 'dismissed' | 'actioned', by: string) => (held: GroupReport[]) =>
        (untrack(reportList) === 'open'
            ? held.filter((one) => one.id !== id)
            : held.map((one) => (one.id === id && one.state === 'open'
                ? { ...one, state: outcome, closedBy: by, closedAt: new Date(runtime().clock.now()).toISOString() }
                : one)));

    const closing = async (guess: (held: GroupReport[]) => GroupReport[], send: (open: string) => Promise<unknown>) =>
    {
        const open = untrack(slug);
        await reportGuesses.during(guess, () => send(open), rereadFor(firstReports));
    };

    return {
        slug,

        open(next)
        {
            if (untrack(slug) !== next)
            {
                setQuery('');
                guesses.clear();
                waitingGuesses.clear();
                linkGuesses.clear();
                keptGuesses.clear();
                reportGuesses.clear();
                setReportList('open');
                for (const name of PANELS)
                {
                    wants[name][1](false);
                }
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

        want(name)
        {
            if (!untrack(wants[name][0]))
            {
                wants[name][1](true);
            }
        },

        requests: () => waitingGuesses.over(requests.data()?.requests ?? []),
        requestsReading: () => readingOf(requests),
        requestsFailure: () => requests.error(),

        async answer(handle, approve)
        {
            const open = untrack(slug);
            await waitingGuesses.during(
                without<GroupWaiting>(handle),
                () => client.groups.answer({ params: { slug: open }, input: { id: handle, approve } }),
                rereadFor(requests)
            );
        },

        links: () => linkGuesses.over(links.data()?.links ?? []),
        linksReading: () => readingOf(links),
        linksFailure: () => links.error(),

        async makeLink(input)
        {
            const open = untrack(slug);
            const made = await client.groups.makeLink({ params: { slug: open }, input: { approval: input.approval, ...(input.hours === undefined ? {} : { hours: input.hours }), ...(input.uses === undefined ? {} : { uses: input.uses }) } });
            await links.refetch();
            return made.links[0];
        },

        async revokeLink(id)
        {
            const open = untrack(slug);
            const at = new Date(runtime().clock.now()).toISOString();
            await linkGuesses.during(
                (held) => held.map((one) => (one.id === id && one.revoked === undefined ? { ...one, revoked: at, live: false } : one)),
                () => client.groups.revokeLink({ params: { slug: open, linkId: id } }),
                rereadFor(links)
            );
        },

        banned: () => keptGuesses.over(banned.data()?.people ?? []),
        bannedReading: () => readingOf(banned),
        bannedFailure: () => banned.error(),

        async unban(handle)
        {
            const open = untrack(slug);
            await keptGuesses.during(
                without<GroupKept>(handle),
                () => client.groups.unban({ params: { slug: open }, input: { id: handle } }),
                rereadFor(banned)
            );
        },

        log: () => [...(firstLog.data()?.rows ?? []), ...olderLog()],
        logReading: () => readingOf(firstLog),
        logFailure: () => firstLog.error(),
        logHasMore: () => logCursor() !== undefined,

        async logMore()
        {
            const open = untrack(slug);
            const after = untrack(logCursor);

            if (open === '' || after === undefined)
            {
                return;
            }

            const page = await client.groups.log({ params: { slug: open }, query: { cursor: after } });

            if (untrack(slug) === open && untrack(logCursor) === after)
            {
                setOlderLog((current) => [...current, ...page.rows]);
                setLogCursor(page.cursor);
            }
        },

        reports: () => reportGuesses.over([...(firstReports.data()?.reports ?? []), ...olderReports()]),
        reportsReading: () => readingOf(firstReports),
        reportsFailure: () => firstReports.error(),
        reportsHasMore: () => reportCursor() !== undefined,

        async reportsMore()
        {
            const open = untrack(slug);
            const after = untrack(reportCursor);
            const list = untrack(reportList);

            if (open === '' || after === undefined)
            {
                return;
            }

            const page = await client.groups.reports({ params: { slug: open }, query: { cursor: after, ...(list === 'open' ? {} : { list }) } });

            if (untrack(slug) === open && untrack(reportCursor) === after && untrack(reportList) === list)
            {
                setOlderReports((current) => [...current, ...page.reports]);
                setReportCursor(page.cursor);
                people.remember(page.reports.map((one) => one.person));
            }
        },

        reportList,
        showReports: (list) => setReportList(list),

        closeReport: (id, outcome) => closing(
            closedIn(id, outcome, account.user()?.handle ?? ''),
            (open) => client.groups.closeReport({ params: { slug: open, id }, input: { outcome } })
        ),

        takeReported: (report, conversationId) => closing(
            (held) =>
            {
                const { line: _, ...gone } = report;
                return closedIn(report.id, 'actioned', account.user()?.handle ?? '')(held.map((one) => (one.id === report.id ? gone : one)));
            },
            async (open) =>
            {
                if (report.line !== undefined)
                {
                    await client.chat.remove({ params: { id: conversationId, messageId: report.line } });
                }
                await client.groups.closeReport({ params: { slug: open, id: report.id }, input: { outcome: 'actioned' } });
            }
        ),

        async memberNamed(handle)
        {
            const wanted = handle.toLowerCase();
            const page = await client.groups.members({ params: { slug: untrack(slug) }, query: { q: handle } });

            return page.members.find((one) => one.person.handle.toLowerCase() === wanted) ?? null;
        },

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
            setOlderLog([]);
            setLogCursor(undefined);
            setReportList('open');
            setOlderReports([]);
            setReportCursor(undefined);
            guesses.clear();
            waitingGuesses.clear();
            linkGuesses.clear();
            keptGuesses.clear();
            reportGuesses.clear();
            for (const name of PANELS)
            {
                wants[name][1](false);
            }
        }
    };
});

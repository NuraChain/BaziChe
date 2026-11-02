import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { ApiError } from '@azerothjs/http/api/shared';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import GroupLinkSheet from '../src/components/social/group-link-sheet.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { whyFailed } from '../src/lib/failure.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import GroupPage from '../src/pages/app/group.page.azeroth';
import { useGroupAdmin } from '../src/stores/group-admin.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

/**
 * The staff's panels on a group's page: a tab for each one the reader's place opens, kept in the
 * address and read only once it is opened, and in each what the staff do there drawn at the press,
 * said once the server has, and taken back with the refusal's words.
 */

const SLUG = 'friday-night-crew';

const NOW = 1_800_000_000_000;

let clock: ReturnType<typeof manualClock>;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const t = (key: Parameters<ReturnType<typeof useLocale>['t']>[0], params?: Record<string, string>) => useLocale().t(key, params);

const crew = () => server.groups.find((one) => one.slug === SLUG)!;

/** The reader, alex, owns the group. */
const owned = () =>
{
    crew().owner = 'alex';
    crew().role = 'owner';
};

let router: ReturnType<typeof createRouter>;

const opened = (search = '') =>
{
    const routes: Route[] = [{ path: '/app/groups/:id', component: (): HTMLElement => GroupPage() as HTMLElement }];
    router = createRouter({ routes, history: createMemoryHistory(`/app/groups/${ SLUG }${ search }`), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

const tabsOf = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => tab.textContent?.trim() ?? '');

const tabOf = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.includes(label)) ?? null;

const panelOf = (container: HTMLElement, label: string) => container.querySelector<HTMLElement>(`section[aria-label="${ label }"]`);

/** The staff's panels drawn now, by the names they are read by. */
const shownPanels = (container: HTMLElement) =>
    [t('groups.tab.requests'), t('groups.tab.links'), t('groups.tab.banned'), t('groups.tab.log')].filter((label) => panelOf(container, label) !== null);

const membersOf = (container: HTMLElement) => container.querySelector<HTMLElement>(`ul[aria-label="${ t('groups.members') }"]`)?.closest('section') ?? null;

const rowsIn = (list: Element | null) => [...(list?.querySelectorAll(':scope > li') ?? [])];

const rowOf = (list: Element | null, words: string) => rowsIn(list).find((row) => row.textContent?.includes(words)) ?? null;

const buttonIn = (within: Element | null, label: string) =>
    [...(within?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((one) => one.textContent?.trim() === label || one.getAttribute('aria-label') === label) ?? null;

const toasted = () => useToasts().items().map((toast) => toast.text);

/** A request held at the server's door, so a test can look in between the press and the answer. */
const held = <K extends 'answer' | 'unban' | 'revokeLink' | 'requests' | 'links' | 'banned' | 'log' | 'permissions' | 'reports' | 'closeReport'>(verb: K) =>
{
    let release: () => void = () => undefined;
    const original = client.groups[verb].bind(client.groups) as (...args: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(client.groups, verb).mockImplementationOnce(((...args: unknown[]) =>
        new Promise((resolve, reject) =>
        {
            release = () => void original(...args).then(resolve, reject);
        })) as never);

    return { spy, release: () => release() };
};

/** Answers the question a destructive press asks, yes or no. */
const answer = async (yes: boolean) =>
{
    await vi.waitFor(() => expect(useOverlay().items().length).toBeGreaterThan(0), { timeout: 4000 });
    const asked = useOverlay().items().at(-1)!;
    expect(asked.props, 'asked as something that cannot be taken back').toMatchObject({ destructive: true });
    useOverlay().close(asked.id, yes);
    await settle();
};

const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(NOW);
    setRuntime({ clock, seed: 7 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useSocial().reset();
    useGroups().reset();
    useGroupAdmin().reset();
    useOverlay().reset();
    useToasts().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useGroups().reset();
    useGroupAdmin().reset();
    useOverlay().reset();
    useRealtime().reset();
    vi.restoreAllMocks();
});

describe('the tabs of a group\'s page', () =>
{
    it('are not drawn for a member, whose page is its members alone', async () =>
    {
        const container = opened();
        await vi.waitFor(() => expect(membersOf(container)).not.toBeNull(), { timeout: 4000 });

        expect(container.querySelector('[role="tablist"]'), 'no tabs for one panel').toBeNull();
        expect(membersOf(container)?.hidden).toBe(false);
        expect(server.calls.filter((call) => ['groups.requests', 'groups.reports', 'groups.links', 'groups.banned', 'groups.log'].includes(call)), 'no panel read').toEqual([]);
    });

    it('are a tab for each panel the owner opens, the requests counting who waits', async () =>
    {
        owned();
        crew().requests = 2;

        const container = opened();
        await vi.waitFor(() => expect(tabsOf(container).length).toBe(7), { timeout: 4000 });

        expect(tabsOf(container).map((label) => label.replace(/\d+$/, '').trim())).toEqual([
            t('groups.tab.members'), t('groups.tab.requests'), t('groups.tab.reports'), t('groups.tab.links'), t('groups.tab.banned'), t('groups.tab.log'), t('groups.tab.permissions')
        ]);
        expect(tabOf(container, t('groups.tab.requests'))?.textContent, 'how many wait').toContain('2');
    });

    it('are only the panels an admin\'s rights open, and a moderator\'s log', async () =>
    {
        crew().role = 'admin';
        crew().rights = ['approve'];

        const container = opened();
        await vi.waitFor(() => expect(tabsOf(container).length).toBe(3), { timeout: 4000 });
        expect(tabsOf(container)).toEqual([t('groups.tab.members'), t('groups.tab.requests'), t('groups.tab.log')]);

        cleanup();
        useGroups().reset();
        useGroupAdmin().reset();
        crew().role = 'moderator';
        delete crew().rights;

        const again = opened();
        await vi.waitFor(() => expect(tabsOf(again).length).toBe(3), { timeout: 4000 });
        expect(tabsOf(again), 'a moderator works what is reported').toEqual([t('groups.tab.members'), t('groups.tab.reports'), t('groups.tab.log')]);
    });

    it('keep the panel in the address, never the members, and read a word they do not know as the members', async () =>
    {
        owned();

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.links'))).not.toBeNull(), { timeout: 4000 });
        expect(membersOf(container)?.hidden, 'the members out of sight').toBe(true);
        expect(shownPanels(container), 'only the panel chosen').toEqual([t('groups.tab.links')]);

        fire(tabOf(container, t('groups.tab.banned'))!, 'click');
        await vi.waitFor(() => expect(router.location().query.tab).toBe('banned'), { timeout: 4000 });
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.banned'))).not.toBeNull(), { timeout: 4000 });
        expect(shownPanels(container), 'one panel at a time').toEqual([t('groups.tab.banned')]);

        fire(tabOf(container, t('groups.tab.members'))!, 'click');
        await vi.waitFor(() => expect(router.location().query.tab, 'the members are never written').toBeUndefined(), { timeout: 4000 });
        expect(membersOf(container)?.hidden).toBe(false);
        expect(shownPanels(container), 'no panel over the members').toEqual([]);

        cleanup();
        useGroups().reset();
        useGroupAdmin().reset();

        const lost = opened('?tab=nonsense');
        await vi.waitFor(() => expect(membersOf(lost)?.hidden).toBe(false), { timeout: 4000 });
    });

    it('keep a panel the reader\'s place no longer opens out of sight, and show the members', async () =>
    {
        owned();

        const container = opened('?tab=requests');
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.requests'))).not.toBeNull(), { timeout: 4000 });

        crew().owner = 'sara.k';
        crew().role = 'member';
        await useGroups().refresh();
        await settle();

        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.requests'))).toBeNull(), { timeout: 4000 });
        expect(membersOf(container)?.hidden).toBe(false);
    });

    it('read a panel only once its tab is opened', async () =>
    {
        owned();

        const container = opened();
        await vi.waitFor(() => expect(tabsOf(container).length).toBe(7), { timeout: 4000 });
        await settle();
        expect(server.calls.filter((call) => ['groups.requests', 'groups.reports', 'groups.links', 'groups.banned', 'groups.log'].includes(call))).toEqual([]);

        fire(tabOf(container, t('groups.tab.requests'))!, 'click');
        await vi.waitFor(() => expect(server.calls).toContain('groups.requests'), { timeout: 4000 });
        expect(server.calls.filter((call) => ['groups.reports', 'groups.links', 'groups.banned', 'groups.log'].includes(call)), 'the others not yet').toEqual([]);

        fire(tabOf(container, t('groups.tab.reports'))!, 'click');
        await vi.waitFor(() => expect(server.calls).toContain('groups.reports'), { timeout: 4000 });
    });

    it('ask nothing of the next group for a panel the last one had open', async () =>
    {
        owned();

        const container = opened('?tab=requests');
        await vi.waitFor(() => expect(server.calls).toContain('groups.requests'), { timeout: 4000 });

        await router.navigate('/app/groups/balcony-backgammon');
        await vi.waitFor(() => expect(container.textContent).toContain('Balcony Backgammon'), { timeout: 4000 });
        await settle();

        expect(server.calls.filter((call) => call === 'groups.requests'), 'read once, for the first group').toHaveLength(1);
    });

    it('keep the members drawn while another panel is open, so nothing typed there is lost', async () =>
    {
        owned();

        const container = opened();
        await vi.waitFor(() => expect(rowsIn(container.querySelector(`ul[aria-label="${ t('groups.members') }"]`)).length).toBeGreaterThan(0), { timeout: 4000 });
        const list = container.querySelector(`ul[aria-label="${ t('groups.members') }"]`);

        fire(tabOf(container, t('groups.tab.log'))!, 'click');
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.log'))).not.toBeNull(), { timeout: 4000 });
        fire(tabOf(container, t('groups.tab.members'))!, 'click');
        await vi.waitFor(() => expect(membersOf(container)?.hidden).toBe(false), { timeout: 4000 });

        expect(container.querySelector(`ul[aria-label="${ t('groups.members') }"]`), 'the same list').toBe(list);
    });
});

describe('who waits to join', () =>
{
    const waiting = () =>
    {
        owned();
        crew().requests = 2;
        server.groupRequests[SLUG] = [
            { handle: 'nima.f', at: ago(30), byLink: true },
            { handle: 'reza.t', at: ago(5), byLink: false }
        ];
    };

    const requestsOf = (container: HTMLElement) => panelOf(container, t('groups.tab.requests'))?.querySelector('ul') ?? null;

    it('are listed, the longest waiting first, each with when they asked and whether a link brought them', async () =>
    {
        waiting();

        const container = opened('?tab=requests');
        await vi.waitFor(() => expect(rowsIn(requestsOf(container)).length).toBe(2), { timeout: 4000 });

        const [first, second] = rowsIn(requestsOf(container));
        expect(first.textContent).toContain('Nima');
        expect(first.textContent, 'by a link').toContain(t('groups.viaLink'));
        expect(second.textContent).not.toContain(t('groups.viaLink'));
        expect(first.querySelector('button[aria-haspopup="dialog"] > svg'), 'no mark of its own beside the buttons').toBeNull();
        expect(first.textContent, 'when they asked').toContain(t('groups.askedWhen', { when: useLocale().relative(NOW - 30 * 60_000, { style: 'short' }) }));
    });

    it('are let in at the press, said once the server has, and the count follows', async () =>
    {
        waiting();

        const container = opened('?tab=requests');
        await vi.waitFor(() => expect(rowsIn(requestsOf(container)).length).toBe(2), { timeout: 4000 });

        const door = held('answer');
        fire(buttonIn(rowOf(requestsOf(container), 'Nima'), t('groups.approve'))!, 'click');
        await settle();

        expect(rowOf(requestsOf(container), 'Nima'), 'gone at the press').toBeNull();
        expect(toasted(), 'nothing said before the server has').not.toContain(t('groups.approvedToast', { name: 'Nima Farahani' }));

        door.release();
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.approvedToast', { name: 'Nima Farahani' })), { timeout: 4000 });
        expect(door.spy).toHaveBeenCalledWith({ params: { slug: SLUG }, input: { id: 'nima.f', approve: true } });
        expect(crew().members, 'in the group').toContain('nima.f');
        await vi.waitFor(() => expect(tabOf(container, t('groups.tab.requests'))?.textContent).toContain('1'), { timeout: 4000 });
        expect(rowOf(requestsOf(container), 'Nima'), 'and stays gone').toBeNull();
    });

    it('are turned away, and a refusal brings the row back in the refusal\'s words', async () =>
    {
        waiting();
        server.refuseGroupAct = { status: 403, code: 'group-right' };

        const container = opened('?tab=requests');
        await vi.waitFor(() => expect(rowsIn(requestsOf(container)).length).toBe(2), { timeout: 4000 });

        const door = held('answer');
        fire(buttonIn(rowOf(requestsOf(container), 'Reza'), t('groups.decline'))!, 'click');
        await settle();
        expect(rowOf(requestsOf(container), 'Reza'), 'gone at the press').toBeNull();

        door.release();
        await vi.waitFor(() => expect(toasted()).toContain(t('group.refused.group-right')), { timeout: 4000 });
        await vi.waitFor(() => expect(rowOf(requestsOf(container), 'Reza'), 'back').not.toBeNull(), { timeout: 4000 });
        expect(door.spy).toHaveBeenCalledWith({ params: { slug: SLUG }, input: { id: 'reza.t', approve: false } });
    });

    it('are said to be nobody only once the server has answered, and a read that failed says so', async () =>
    {
        owned();

        const door = held('requests');
        const container = opened('?tab=requests');
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.requests'))?.querySelector('[data-reading]') ?? null).not.toBeNull(), { timeout: 4000 });
        expect(panelOf(container, t('groups.tab.requests'))?.textContent, 'nothing said yet').not.toContain(t('groups.requestsEmpty'));

        door.release();
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.requests'))?.textContent).toContain(t('groups.requestsEmpty')), { timeout: 4000 });

        cleanup();
        useGroups().reset();
        useGroupAdmin().reset();
        vi.spyOn(client.groups, 'requests').mockRejectedValueOnce(new Error('down'));

        const failed = opened('?tab=requests');
        await vi.waitFor(() => expect(panelOf(failed, t('groups.tab.requests'))?.textContent).toContain(t('state.errorTitle')), { timeout: 4000 });
        expect(panelOf(failed, t('groups.tab.requests'))?.textContent, 'never nobody').not.toContain(t('groups.requestsEmpty'));
    });
});

describe('the invite links', () =>
{
    const linked = () =>
    {
        owned();
        server.groupLinks[SLUG] = [
            { id: 'l-new', link: 'http://localhost:1/g/aaaaaaaaaaaaaaaaaaaaaa', by: 'alex', at: ago(2), ends: new Date(NOW + 86_400_000).toISOString(), uses: 0, approval: true, live: true },
            { id: 'l-full', link: 'http://localhost:1/g/bbbbbbbbbbbbbbbbbbbbbb', by: 'alex', at: ago(60), most: 10, uses: 10, approval: false, live: false },
            { id: 'l-gone', link: 'http://localhost:1/g/cccccccccccccccccccccc', at: ago(120), uses: 3, approval: false, revoked: ago(90), live: false }
        ];
    };

    const linksOf = (container: HTMLElement) => panelOf(container, t('groups.tab.links'))?.querySelector('ul') ?? null;

    it('are listed newest first, each with how often it was used, how long it works, whether it asks and who made it', async () =>
    {
        linked();

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(rowsIn(linksOf(container)).length).toBe(3), { timeout: 4000 });

        const [fresh, full, gone] = rowsIn(linksOf(container));
        expect(fresh.textContent, 'a link nobody used').toContain(t('groups.linkUnused'));
        expect(fresh.textContent).toContain(t('groups.linkAsks'));
        expect(fresh.textContent).toContain(t('groups.linkBy', { who: '@alex' }));
        expect(fresh.querySelector('[dir="ltr"]')?.textContent, 'the whole address, left to right').toBe('http://localhost:1/g/aaaaaaaaaaaaaaaaaaaaaa');
        expect(buttonIn(fresh, t('groups.linkCopy')), 'a live one copies').not.toBeNull();
        expect(buttonIn(fresh, t('groups.linkRevoke')), 'and stops').not.toBeNull();

        expect(fresh.textContent, 'when it ends').toContain(t('groups.linkEnds', { when: useLocale().date(NOW + 86_400_000, { dateStyle: 'medium', timeStyle: 'short' }) }));

        expect(full.textContent, 'its limit').toContain(t('groups.linkUsesOf', { count: '10', most: '10' }));
        expect(full.textContent, 'why it stopped').toContain(t('groups.linkUsedUp'));
        expect(gone.textContent).toContain(t('groups.linkRevoked'));
        for (const dead of [full, gone])
        {
            expect(buttonIn(dead, t('groups.linkCopy')), 'nothing to copy').toBeNull();
            expect(buttonIn(dead, t('groups.linkRevoke')), 'nothing to stop').toBeNull();
            expect(dead.textContent, 'no promise of working on').not.toContain(t('groups.linkForever'));
        }
    });

    it('name who made one with the handle a part of its own, left to right in Persian too', async () =>
    {
        linked();
        useLocale().setLocale('fa');

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(rowsIn(linksOf(container)).length).toBe(3), { timeout: 4000 });

        const maker = rowsIn(linksOf(container))[0].querySelector('[data-maker]');
        expect(maker?.textContent).toBe(t('groups.linkBy', { who: '@alex' }));
        expect(maker?.querySelector('[dir="ltr"]')?.textContent, 'the handle on its own').toBe('@alex');
        expect(rowsIn(linksOf(container))[2].querySelector('[data-maker]'), 'nobody named for a link whose maker is gone').toBeNull();
    });

    it('count a link used once in the words for once, and more in theirs', async () =>
    {
        owned();
        server.groupLinks[SLUG] = [
            { id: 'l-one', link: 'http://localhost:1/g/dddddddddddddddddddddd', at: ago(2), uses: 1, approval: false, live: true },
            { id: 'l-two', link: 'http://localhost:1/g/eeeeeeeeeeeeeeeeeeeeee', at: ago(3), uses: 7, approval: false, live: true }
        ];

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(rowsIn(linksOf(container)).length).toBe(2), { timeout: 4000 });

        expect(rowsIn(linksOf(container))[0].textContent).toContain(useLocale().plural('groups.linkUses', 1));
        expect(rowsIn(linksOf(container))[1].textContent).toContain(useLocale().plural('groups.linkUses', 7));
        expect(useLocale().plural('groups.linkUses', 7)).toContain('7');
    });

    it('copy the whole address', async () =>
    {
        linked();
        const wrote = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: wrote } });

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(rowsIn(linksOf(container)).length).toBe(3), { timeout: 4000 });

        fire(buttonIn(rowsIn(linksOf(container))[0], t('groups.linkCopy'))!, 'click');
        await vi.waitFor(() => expect(wrote).toHaveBeenCalledWith('http://localhost:1/g/aaaaaaaaaaaaaaaaaaaaaa'), { timeout: 4000 });
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.linkCopied')), { timeout: 4000 });
    });

    it('are stopped behind a question, drawn stopped at the press and said once the server has', async () =>
    {
        linked();

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(rowsIn(linksOf(container)).length).toBe(3), { timeout: 4000 });

        const door = held('revokeLink');
        fire(buttonIn(rowsIn(linksOf(container))[0], t('groups.linkRevoke'))!, 'click');
        await answer(true);

        await vi.waitFor(() => expect(rowsIn(linksOf(container))[0].textContent, 'stopped at the press').toContain(t('groups.linkRevoked')), { timeout: 4000 });
        expect(buttonIn(rowsIn(linksOf(container))[0], t('groups.linkCopy'))).toBeNull();

        door.release();
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.linkStopped')), { timeout: 4000 });
        expect(door.spy).toHaveBeenCalledWith({ params: { slug: SLUG, linkId: 'l-new' } });
    });

    it('are not stopped when the question is answered no', async () =>
    {
        linked();

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(rowsIn(linksOf(container)).length).toBe(3), { timeout: 4000 });

        fire(buttonIn(rowsIn(linksOf(container))[0], t('groups.linkRevoke'))!, 'click');
        await answer(false);

        expect(server.calls).not.toContain('groups.revokeLink');
        expect(buttonIn(rowsIn(linksOf(container))[0], t('groups.linkCopy'))).not.toBeNull();
    });

    it('come back live with the refusal\'s words when a revoke is refused', async () =>
    {
        linked();
        server.refuseGroupAct = { status: 403, code: 'group-right' };

        const container = opened('?tab=links');
        await vi.waitFor(() => expect(rowsIn(linksOf(container)).length).toBe(3), { timeout: 4000 });

        fire(buttonIn(rowsIn(linksOf(container))[0], t('groups.linkRevoke'))!, 'click');
        await answer(true);

        await vi.waitFor(() => expect(toasted()).toContain(t('group.refused.group-right')), { timeout: 4000 });
        await vi.waitFor(() => expect(buttonIn(rowsIn(linksOf(container))[0], t('groups.linkCopy')), 'live again').not.toBeNull(), { timeout: 4000 });
    });
});

describe('a new invite link', () =>
{
    const sheet = (close = vi.fn()) => renderTest(() => GroupLinkSheet({ overlayId: 'link', close }) as HTMLElement).container;

    const choice = (container: HTMLElement, label: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((one) => one.textContent?.trim() === label)!;

    const readied = async () =>
    {
        owned();
        const page = opened('?tab=links');
        await vi.waitFor(() => expect(panelOf(page, t('groups.tab.links'))).not.toBeNull(), { timeout: 4000 });
        return page;
    };

    it('works for a day and any number of times unless chosen otherwise, and asks nobody first', async () =>
    {
        await readied();
        const container = sheet();

        expect(choice(container, t('groups.linkHours.24')).getAttribute('aria-pressed')).toBe('true');
        expect(choice(container, t('groups.linkTimes.ever')).getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    });

    it('is made with the choices pressed, and its address is drawn once the server has made it', async () =>
    {
        server.groupLinks[SLUG] = [
            { id: 'l-old', link: 'http://localhost:1/g/oooooooooooooooooooooo', by: 'alex', at: ago(60), uses: 4, approval: false, live: true }
        ];
        const page = await readied();
        const container = sheet();

        fire(choice(container, t('groups.linkHours.168')), 'click');
        fire(choice(container, t('groups.linkTimes.10')), 'click');
        fire(container.querySelector<HTMLElement>('[role="switch"]')!, 'click');
        await settle();
        fire(buttonIn(container, t('groups.linkMake'))!, 'click');

        await vi.waitFor(() => expect(container.textContent).toContain(t('groups.linkMade')), { timeout: 4000 });
        expect(server.calls).toContain('groups.makeLink');
        const made = server.groupLinks[SLUG][0];
        expect(made).toMatchObject({ most: 10, approval: true });
        expect(Date.parse(made.ends!) - NOW, 'a week').toBe(168 * 3_600_000);
        expect(container.querySelector('[dir="ltr"]')?.textContent, 'the address to copy').toBe(made.link);
        expect(buttonIn(container, t('groups.linkCopy'))).not.toBeNull();

        await vi.waitFor(() => expect(rowsIn(panelOf(page, t('groups.tab.links'))?.querySelector('ul') ?? null).length, 'listed on the page').toBe(2), { timeout: 4000 });
    });

    it('for good and with no limit sends neither', async () =>
    {
        await readied();
        const container = sheet();
        const spy = vi.spyOn(client.groups, 'makeLink');

        fire(choice(container, t('groups.linkHours.ever')), 'click');
        await settle();
        fire(buttonIn(container, t('groups.linkMake'))!, 'click');

        await vi.waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 4000 });
        expect(spy).toHaveBeenCalledWith({ params: { slug: SLUG }, input: { approval: false } });
    });

    it('says a refusal above the button in its words and keeps every choice', async () =>
    {
        await readied();
        server.refuseGroupAct = { status: 403, code: 'group-right' };
        const container = sheet();

        fire(choice(container, t('groups.linkHours.1')), 'click');
        await settle();
        fire(buttonIn(container, t('groups.linkMake'))!, 'click');

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe(t('group.refused.group-right')), { timeout: 4000 });
        expect(choice(container, t('groups.linkHours.1')).getAttribute('aria-pressed'), 'kept').toBe('true');
        expect(container.textContent).not.toContain(t('groups.linkMade'));
    });
});

describe('who is banned', () =>
{
    const bannedOf = (container: HTMLElement) => panelOf(container, t('groups.tab.banned'))?.querySelector('ul') ?? null;

    it('are listed, the newest first, and let back at the press with a word once the server has', async () =>
    {
        owned();
        server.groupBans[SLUG] = ['nima.f', 'reza.t'];

        const container = opened('?tab=banned');
        await vi.waitFor(() => expect(rowsIn(bannedOf(container)).length).toBe(2), { timeout: 4000 });
        expect(rowsIn(bannedOf(container))[0].textContent, 'the newest first').toContain('Reza');

        const door = held('unban');
        fire(buttonIn(rowOf(bannedOf(container), 'Reza'), t('groups.unban'))!, 'click');
        await settle();
        expect(rowOf(bannedOf(container), 'Reza'), 'gone at the press').toBeNull();

        door.release();
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.unbannedToast', { name: 'Reza Tehrani' })), { timeout: 4000 });
        expect(server.groupBans[SLUG]).toEqual(['nima.f']);
    });

    it('come back with the refusal\'s words when letting one back is refused', async () =>
    {
        owned();
        server.groupBans[SLUG] = ['nima.f'];
        server.refuseGroupAct = { status: 409, code: 'group-rank' };

        const container = opened('?tab=banned');
        await vi.waitFor(() => expect(rowsIn(bannedOf(container)).length).toBe(1), { timeout: 4000 });

        fire(buttonIn(rowOf(bannedOf(container), 'Nima'), t('groups.unban'))!, 'click');
        await vi.waitFor(() => expect(toasted()).toContain(t('group.refused.group-rank')), { timeout: 4000 });
        await vi.waitFor(() => expect(rowOf(bannedOf(container), 'Nima')).not.toBeNull(), { timeout: 4000 });
    });

    it('are said to be nobody once the server has said so', async () =>
    {
        owned();

        const container = opened('?tab=banned');
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.banned'))?.textContent).toContain(t('groups.bannedEmpty')), { timeout: 4000 });
    });
});

describe('what members may do', () =>
{
    const panel = (container: HTMLElement) => panelOf(container, t('groups.tab.permissions'));

    const toggle = (container: HTMLElement, label: string) =>
        [...(panel(container)?.querySelectorAll<HTMLElement>('[role="switch"]') ?? [])].find((one) => one.textContent?.includes(label)) ?? null;

    const on = (container: HTMLElement, label: string) => toggle(container, label)?.getAttribute('aria-checked');

    it('is a tab of the owner\'s alone: an admin holding every right has none', async () =>
    {
        owned();
        const mine = opened();
        await vi.waitFor(() => expect(tabsOf(mine)).toContain(t('groups.tab.permissions')), { timeout: 4000 });

        cleanup();
        useGroups().reset();
        useGroupAdmin().reset();
        crew().role = 'admin';
        crew().rights = ['info', 'invite', 'approve', 'remove', 'ban', 'delete', 'pin', 'members', 'calls'];
        const theirs = opened('?tab=permissions');
        await vi.waitFor(() => expect(tabsOf(theirs).length).toBeGreaterThan(1), { timeout: 4000 });

        expect(tabsOf(theirs)).not.toContain(t('groups.tab.permissions'));
        expect(panel(theirs), 'the address cannot open it either').toBeNull();
    });

    it('turns a switch at the press, sends the whole set, and says so once kept', async () =>
    {
        owned();
        const container = opened('?tab=permissions');
        await vi.waitFor(() => expect(toggle(container, t('groups.perm.pin'))).not.toBeNull(), { timeout: 4000 });
        expect(on(container, t('groups.perm.pin'))).toBe('false');

        const door = held('permissions');
        fire(toggle(container, t('groups.perm.pin'))!, 'click');
        await settle();

        expect(on(container, t('groups.perm.pin')), 'on at the press').toBe('true');
        expect(crew().switches.pin, 'nothing kept yet').toBe(false);

        door.release();
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.perm.saved')), { timeout: 4000 });
        expect(door.spy).toHaveBeenCalledWith({ params: { slug: SLUG }, input: { switches: { ...crew().switches, pin: true }, approval: false } });
        expect(crew().switches.pin).toBe(true);
        expect(on(container, t('groups.perm.pin')), 'and stays on').toBe('true');
    });

    it('sends presses one after another, each carrying every press before it', async () =>
    {
        owned();
        const container = opened('?tab=permissions');
        await vi.waitFor(() => expect(toggle(container, t('groups.perm.pin'))).not.toBeNull(), { timeout: 4000 });

        const door = held('permissions');
        const sent = vi.spyOn(client.groups, 'permissions');
        fire(toggle(container, t('groups.perm.pin'))!, 'click');
        fire(toggle(container, t('groups.perm.info'))!, 'click');
        await settle();

        expect(on(container, t('groups.perm.pin'))).toBe('true');
        expect(on(container, t('groups.perm.info'))).toBe('true');
        expect(sent, 'the second waits for the first').toHaveBeenCalledTimes(1);

        door.release();
        await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2), { timeout: 4000 });
        expect(sent.mock.calls[1][0].input.switches, 'the last says both').toMatchObject({ pin: true, info: true });
        await vi.waitFor(() => expect(crew().switches).toMatchObject({ pin: true, info: true }), { timeout: 4000 });
    });

    it('turns a refused switch back and says why in the group\'s words', async () =>
    {
        owned();
        server.refuseGroupAct = { status: 403, code: 'group-right' };
        const container = opened('?tab=permissions');
        await vi.waitFor(() => expect(toggle(container, t('groups.perm.send'))).not.toBeNull(), { timeout: 4000 });
        expect(on(container, t('groups.perm.send'))).toBe('true');

        fire(toggle(container, t('groups.perm.send'))!, 'click');

        await vi.waitFor(() => expect(toasted()).toContain(t('group.refused.group-right')), { timeout: 4000 });
        await vi.waitFor(() => expect(on(container, t('groups.perm.send')), 'back as kept').toBe('true'), { timeout: 4000 });
        expect(crew().switches.send).toBe(true);
    });

    it('makes joining ask first at the press', async () =>
    {
        owned();
        const container = opened('?tab=permissions');
        const asking = () => panel(container)?.querySelector('[data-approval] [role="switch"]') ?? null;
        await vi.waitFor(() => expect(asking()).not.toBeNull(), { timeout: 4000 });

        const door = held('permissions');
        fire(asking() as HTMLElement, 'click');
        await settle();

        expect(asking()?.getAttribute('aria-checked'), 'on at the press').toBe('true');
        expect(crew().approval, 'nothing kept yet').toBe(false);

        door.release();
        await vi.waitFor(() => expect(crew().approval).toBe(true), { timeout: 4000 });
        expect(asking()?.getAttribute('aria-checked')).toBe('true');
    });
});

describe('the recent actions', () =>
{
    const logOf = (container: HTMLElement) => panelOf(container, t('groups.tab.log'))?.querySelector('ol') ?? null;

    const logged = () =>
    {
        owned();
        server.groupLogs[SLUG] = [
            { id: 'e-4', at: ago(1), kind: 'banned', actor: 'alex', actorRole: 'owner', person: 'reza.t', details: {} },
            { id: 'e-3', at: ago(2), kind: 'call', actor: 'mina', details: {} },
            { id: 'e-2', at: ago(3), kind: 'joined', actor: 'mina', details: { by: 'link' } },
            { id: 'e-1', at: ago(4), kind: 'info', actor: 'alex', details: { to: 'Night Owls' } }
        ];
    };

    it('say each row as a sentence, newest first, each handle set apart and left to right', async () =>
    {
        logged();

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(rowsIn(logOf(container)).length).toBe(3), { timeout: 4000 });

        const said = rowsIn(logOf(container)).map((row) => row.querySelector('p')?.textContent);
        expect(said).toEqual([
            t('groups.log.banned', { actor: 'alex', person: 'reza.t' }),
            t('groups.log.joinedLink', { actor: 'mina' }),
            t('groups.log.renamed', { actor: 'alex', to: 'Night Owls' })
        ]);
        expect([...rowsIn(logOf(container))[0].querySelectorAll('span[dir="ltr"]')].map((one) => one.textContent), 'each handle its own part').toEqual(['alex', 'reza.t']);
    });

    it('say asking first plainly, and any switch of what members may do as one sentence', async () =>
    {
        owned();
        server.groupLogs[SLUG] = [
            { id: 'p-3', at: ago(1), kind: 'permissions', actor: 'alex', details: { approval: 'on' } },
            { id: 'p-2', at: ago(2), kind: 'permissions', actor: 'alex', details: { approval: 'off' } },
            { id: 'p-1', at: ago(3), kind: 'permissions', actor: 'alex', details: { on: 'pin', off: '', approval: 'on' } }
        ];

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(rowsIn(logOf(container)).length).toBe(3), { timeout: 4000 });

        expect(rowsIn(logOf(container)).map((row) => row.querySelector('p')?.textContent)).toEqual([
            t('groups.log.asksFirst', { actor: 'alex' }),
            t('groups.log.asksNot', { actor: 'alex' }),
            t('groups.log.permissions', { actor: 'alex' })
        ]);
    });

    it('say how a report about somebody was closed, and never who filed it', async () =>
    {
        owned();
        server.groupLogs[SLUG] = [
            { id: 'r-2', at: ago(1), kind: 'report', actor: 'alex', actorRole: 'owner', person: 'reza.t', details: { report: 'gr-2', to: 'actioned' } },
            { id: 'r-1', at: ago(2), kind: 'report', actor: 'alex', actorRole: 'owner', person: 'reza.t', details: { report: 'gr-1', to: 'dismissed' } }
        ];

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(rowsIn(logOf(container)).length).toBe(2), { timeout: 4000 });

        expect(rowsIn(logOf(container)).map((row) => row.querySelector('p')?.textContent)).toEqual([
            t('groups.log.reportActioned', { actor: 'alex', person: 'reza.t' }),
            t('groups.log.reportDismissed', { actor: 'alex', person: 'reza.t' })
        ]);
    });

    it('leave out a kind it has no words for rather than drawing an empty row', async () =>
    {
        logged();

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(rowsIn(logOf(container)).length).toBe(3), { timeout: 4000 });
        expect(rowsIn(logOf(container)).every((row) => (row.querySelector('p')?.textContent ?? '') !== '')).toBe(true);
    });

    it('bring older rows a page at a time', async () =>
    {
        logged();
        server.groupLogPage = 2;

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(rowsIn(logOf(container)).length).toBe(1), { timeout: 4000 });

        fire(buttonIn(panelOf(container, t('groups.tab.log')), t('groups.logMore'))!, 'click');
        await vi.waitFor(() => expect(rowsIn(logOf(container)).length).toBe(3), { timeout: 4000 });
        expect(buttonIn(panelOf(container, t('groups.tab.log')), t('groups.logMore')), 'no more to bring').toBeNull();
    });

    it('read right to left in Persian with every handle still left to right', async () =>
    {
        logged();
        useLocale().setLocale('fa');

        const container = opened('?tab=log');
        await vi.waitFor(() => expect(rowsIn(logOf(container)).length).toBe(3), { timeout: 4000 });

        expect(rowsIn(logOf(container))[0].querySelector('p')?.textContent).toBe(t('groups.log.banned', { actor: 'alex', person: 'reza.t' }));
        expect([...rowsIn(logOf(container))[0].querySelectorAll('span[dir="ltr"]')].map((one) => one.textContent)).toEqual(['alex', 'reza.t']);
    });
});

describe('what people reported in the group’s chat', () =>
{
    const reportsOf = (container: HTMLElement) => panelOf(container, t('groups.tab.reports'))?.querySelector('ul') ?? null;

    /** Two reports waiting: reza.t's line still in the chat, and a voice message of mina's that is gone. */
    const reported = (reports = 2) =>
    {
        owned();
        crew().reports = reports;
        server.groupReports[SLUG] = [
            { id: 'gr-2', handle: 'reza.t', category: 'spam', at: ago(5), state: 'open', said: { text: 'buy cheap coins here' }, line: 'line-reza' },
            { id: 'gr-1', handle: 'mina', category: 'harassment', at: ago(90), state: 'open', said: { voice: 12_000 } }
        ];
    };

    const drawn = async (search = '?tab=reports') =>
    {
        const container = opened(search);
        await vi.waitFor(() => expect(rowsIn(reportsOf(container)).length).toBeGreaterThan(0), { timeout: 4000 });
        return container;
    };

    it('are a tab for whoever may work them, counting what waits, and for nobody else', async () =>
    {
        reported();

        const container = opened();
        await vi.waitFor(() => expect(tabOf(container, t('groups.tab.reports'))).not.toBeNull(), { timeout: 4000 });
        expect(tabOf(container, t('groups.tab.reports'))?.textContent).toContain('2');

        cleanup();
        useGroups().reset();
        crew().role = 'admin';
        crew().rights = ['ban'];
        await useGroups().refresh();

        const bare = opened();
        await vi.waitFor(() => expect(tabOf(bare, t('groups.tab.banned'))).not.toBeNull(), { timeout: 4000 });
        expect(tabOf(bare, t('groups.tab.reports')), 'an admin who may not delete').toBeNull();

        cleanup();
        useGroups().reset();
        crew().role = 'moderator';
        crew().rights = undefined;
        await useGroups().refresh();

        const moderator = opened();
        await vi.waitFor(() => expect(tabOf(moderator, t('groups.tab.reports'))).not.toBeNull(), { timeout: 4000 });
    });

    it('say who each is about, what for, when and what was said, and never who reported it', async () =>
    {
        reported();
        server.groupReports[SLUG].push(
            { id: 'gr-0', handle: 'omid.k', category: 'inappropriate', at: ago(200), state: 'open', said: { file: { name: 'IMG_0042.jpg', as: 'photo' }, text: 'look at this' }, line: 'line-omid' },
            { id: 'gr-00', handle: 'babak', category: 'other', at: ago(300), state: 'open', said: { file: { name: 'notes.pdf', as: 'file' } } },
            { id: 'gr-000', handle: 'leila', category: 'spam', at: ago(400), state: 'open', said: {} }
        );

        const container = await drawn();
        const [spam, voice, photo, file, unread] = rowsIn(reportsOf(container));

        expect(photo.querySelector('[data-said]')?.textContent, 'a photo and its caption').toBe(`${ t('chat.fileGist.photo') } · look at this`);
        expect(buttonIn(photo, t('groups.reports.take')), 'a photo still in the chat').not.toBeNull();
        expect(file.querySelector('[data-said]')?.textContent, 'a file by its name').toBe(t('chat.fileGist.file', { name: 'notes.pdf' }));
        expect(unread.querySelector('[data-said]')?.textContent, 'what could not be read').toBe(t('groups.reports.unreadable'));
        expect(rowsIn(reportsOf(container)).map((row) => row.querySelector('[data-report]')?.getAttribute('data-report'))).toEqual(['gr-2', 'gr-1', 'gr-0', 'gr-00', 'gr-000']);

        expect(spam.textContent).toContain('buy cheap coins here');
        expect(spam.textContent).toContain(t('report.category.spam'));
        expect(spam.textContent, 'still in the chat').not.toContain(t('groups.reports.gone'));
        expect(voice.textContent).toContain(t('chat.voiceGist', { time: '0:12' }));
        expect(voice.textContent).toContain(t('groups.reports.gone'));
        expect(buttonIn(voice, t('groups.reports.take')), 'nothing to take out of the chat').toBeNull();
        expect(buttonIn(spam, t('groups.reports.take'))).not.toBeNull();
    });

    it('close one as nothing to do at the press, and say so once the server has', async () =>
    {
        reported();

        const container = await drawn();
        const door = held('closeReport');

        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.reports.dismiss'))!, 'click');
        await settle();

        expect(rowOf(reportsOf(container), 'buy cheap coins'), 'gone from what waits at the press').toBeNull();
        expect(server.groupReports[SLUG][0].state, 'nothing kept yet').toBe('open');

        door.release();
        await vi.waitFor(() => expect(server.groupReports[SLUG][0].state).toBe('dismissed'), { timeout: 4000 });
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.reports.dismissedToast')), { timeout: 4000 });
        expect(rowOf(reportsOf(container), 'buy cheap coins')).toBeNull();
    });

    it('bring one back with the group’s words when the server will not close it', async () =>
    {
        reported();

        const container = await drawn();
        server.refuseGroupAct = { status: 403, code: 'group-right' };

        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.reports.action'))!, 'click');

        await vi.waitFor(() => expect(toasted()).toContain(t('group.refused.group-right')), { timeout: 4000 });
        await vi.waitFor(() => expect(rowOf(reportsOf(container), 'buy cheap coins'), 'back where it was').not.toBeNull(), { timeout: 4000 });
        expect(server.groupReports[SLUG][0].state).toBe('open');

        server.refuseGroupAct = null;
        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.reports.action'))!, 'click');

        await vi.waitFor(() => expect(server.groupReports[SLUG][0].state, 'dealt with').toBe('actioned'), { timeout: 4000 });
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.reports.actionedToast')), { timeout: 4000 });
    });

    it('keep one closed in the list of every report, closed by the reader at the press, its line marked gone once taken', async () =>
    {
        reported();

        const container = await drawn('?tab=reports&list=all');
        const door = held('closeReport');
        const removed = vi.spyOn(client.chat, 'remove').mockResolvedValue({ ok: true });

        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.reports.take'))!, 'click');
        await answer(true);
        await vi.waitFor(() => expect(removed).toHaveBeenCalled(), { timeout: 4000 });
        await settle();

        const taken = rowOf(reportsOf(container), 'buy cheap coins')!;

        expect(taken.querySelector('[data-report]')?.getAttribute('data-state'), 'dealt with at the press').toBe('actioned');
        expect(taken.textContent, 'its line out of the chat').toContain(t('groups.reports.gone'));
        expect(taken.querySelector('[data-closed]')?.textContent).toContain(t('groups.reports.wasActioned'));
        expect(taken.querySelector('[data-closed] [dir="ltr"]')?.textContent, 'by the reader').toBe('@alex');
        expect(buttonIn(taken, t('groups.reports.take')), 'nothing left to take').toBeNull();
        expect(server.groupReports[SLUG][0].state, 'nothing kept yet').toBe('open');

        door.release();
        await vi.waitFor(() => expect(server.groupReports[SLUG][0].state).toBe('actioned'), { timeout: 4000 });

        fire(buttonIn(rowOf(reportsOf(container), t('chat.voiceGist', { time: '0:12' })), t('groups.reports.dismiss'))!, 'click');
        await settle();

        const dismissed = rowOf(reportsOf(container), t('chat.voiceGist', { time: '0:12' }))!;

        expect(dismissed.querySelector('[data-report]')?.getAttribute('data-state'), 'still listed, closed').toBe('dismissed');
        expect(dismissed.querySelector('[data-closed]')?.textContent).toContain(t('groups.reports.wasDismissed'));
        await vi.waitFor(() => expect(server.groupReports[SLUG][1].state).toBe('dismissed'), { timeout: 4000 });
        expect(rowsIn(reportsOf(container))).toHaveLength(2);
    });

    it('take the line out of the chat, asked first, and close the report as dealt with', async () =>
    {
        reported();

        const container = await drawn();
        const removed = vi.spyOn(client.chat, 'remove').mockResolvedValue({ ok: true });

        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.reports.take'))!, 'click');
        await answer(false);

        expect(removed, 'a no takes nothing').not.toHaveBeenCalled();

        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.reports.take'))!, 'click');
        await answer(true);

        await vi.waitFor(() => expect(server.groupReports[SLUG][0].state).toBe('actioned'), { timeout: 4000 });
        expect(removed).toHaveBeenCalledWith({ params: { id: `conv-${ SLUG }`, messageId: 'line-reza' } });
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.reports.takenToast')), { timeout: 4000 });
    });

    it('list the closed ones apart, by a choice kept in the address, saying how and who closed each', async () =>
    {
        reported();
        server.groupReports[SLUG][1] = { ...server.groupReports[SLUG][1], state: 'dismissed', closedBy: 'sara.k', closedAt: ago(30) };

        const container = await drawn();
        const chip = [...panelOf(container, t('groups.tab.reports'))!.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.includes(t('groups.reports.list.closed')))!;

        fire(chip, 'click');

        await vi.waitFor(() => expect(router.location().search).toContain('list=closed'), { timeout: 4000 });
        await vi.waitFor(() => expect(rowsIn(reportsOf(container)).map((row) => row.querySelector('[data-state]')?.getAttribute('data-state'))).toEqual(['dismissed']), { timeout: 4000 });

        const closed = rowsIn(reportsOf(container))[0];

        expect(closed.querySelector('[data-closed]')?.textContent).toContain(t('groups.reports.wasDismissed'));
        expect(closed.querySelector('[data-closed] [dir="ltr"]')?.textContent).toBe('@sara.k');
        expect(buttonIn(closed, t('groups.reports.dismiss')), 'nothing to press on one closed').toBeNull();
    });

    it('let go of the list chosen once another tab is', async () =>
    {
        reported();
        server.groupReports[SLUG][1] = { ...server.groupReports[SLUG][1], state: 'dismissed', closedBy: 'sara.k', closedAt: ago(30) };

        const container = await drawn('?tab=reports&list=closed');

        await vi.waitFor(() => expect(rowsIn(reportsOf(container))).toHaveLength(1), { timeout: 4000 });

        fire(tabOf(container, t('groups.tab.log'))!, 'click');
        await vi.waitFor(() => expect(router.location().query.tab).toBe('log'), { timeout: 4000 });
        expect(router.location().query.list, 'the reports’ word left with them').toBeUndefined();

        fire(tabOf(container, t('groups.tab.reports'))!, 'click');
        await vi.waitFor(() => expect(rowOf(reportsOf(container), 'buy cheap coins'), 'what waits, again').not.toBeNull(), { timeout: 4000 });
    });

    it('say there is nothing waiting only once the server has said so', async () =>
    {
        owned();
        crew().reports = 0;
        server.groupReports[SLUG] = [];

        const door = held('reports');
        const container = opened('?tab=reports');
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.reports'))).not.toBeNull(), { timeout: 4000 });
        await settle();

        expect(panelOf(container, t('groups.tab.reports'))!.textContent).not.toContain(t('groups.reports.emptyOpen'));

        door.release();
        await vi.waitFor(() => expect(panelOf(container, t('groups.tab.reports'))?.textContent).toContain(t('groups.reports.emptyOpen')), { timeout: 4000 });
    });

    it('bring older ones a page at a time, of the list chosen', async () =>
    {
        reported();
        server.groupReports[SLUG][1] = { ...server.groupReports[SLUG][1], state: 'dismissed', closedBy: 'sara.k', closedAt: ago(30) };
        server.groupReports[SLUG].push(
            { id: 'gr-0', handle: 'omid.k', category: 'other', at: ago(200), state: 'open', said: { text: 'third' } },
            { id: 'gr-00', handle: 'babak', category: 'other', at: ago(300), state: 'open', said: { text: 'fourth' } }
        );
        server.groupReportsPage = 1;

        const container = await drawn();
        const panel = () => panelOf(container, t('groups.tab.reports'))!;
        const ids = () => rowsIn(reportsOf(container)).map((row) => row.querySelector('[data-report]')?.getAttribute('data-report'));
        const more = async (count: number) =>
        {
            for (let at = 0; at < count; at += 1)
            {
                const before = ids().length;

                fire(buttonIn(panel(), t('groups.reports.more'))!, 'click');
                await vi.waitFor(() => expect(ids().length).toBe(before + 1), { timeout: 4000 });
            }
        };

        expect(ids()).toEqual(['gr-2']);

        await more(2);

        expect(ids(), 'what waits, oldest last').toEqual(['gr-2', 'gr-0', 'gr-00']);
        expect(buttonIn(panel(), t('groups.reports.more')), 'no more to bring').toBeNull();

        fire([...panel().querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.includes(t('groups.reports.list.all')))!, 'click');
        await vi.waitFor(() => expect(ids()).toEqual(['gr-2']), { timeout: 4000 });

        await more(3);

        expect(ids(), 'every report, in its own order').toEqual(['gr-2', 'gr-1', 'gr-0', 'gr-00']);
    });

    it('lead to the group’s own sheet about whoever one is about, read afresh, and say when they have left', async () =>
    {
        reported();
        crew().members = [...crew().members.filter((one) => one !== 'reza.t'), 'reza.t'];
        server.groupReports[SLUG].push({ id: 'gr-0', handle: 'sara', category: 'other', at: ago(200), state: 'open', said: { text: 'gone already' } });

        const container = await drawn();
        const reza = usePeople().byHandle('reza.t')!.displayName;
        const ghost = usePeople().byHandle('sara')!.displayName;
        const lost = new ApiError(503, 'unavailable', 'Down.', undefined);
        const read = vi.spyOn(client.groups, 'members').mockRejectedValueOnce(lost);

        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.manage', { name: reza }))!, 'click');

        await vi.waitFor(() => expect(toasted()).toContain(t(whyFailed(lost))), { timeout: 4000 });
        expect(useOverlay().items(), 'no sheet without the member').toEqual([]);
        read.mockRestore();

        fire(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.manage', { name: reza }))!, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });
        expect(useOverlay().items()[0].props, 'the member as the group holds them').toMatchObject({ member: { person: { handle: 'reza.t' }, role: 'member' }, group: { slug: SLUG } });
        expect(server.calls, 'asked of the server').toContain('groups.members');

        useOverlay().closeAll();
        fire(buttonIn(rowOf(reportsOf(container), 'gone already'), t('groups.manage', { name: ghost }))!, 'click');

        await vi.waitFor(() => expect(toasted(), 'sara.k is somebody else').toContain(t('groups.reports.notMember', { name: ghost })), { timeout: 4000 });
        expect(useOverlay().items().filter((one) => one.phase !== 'closing'), 'no sheet for somebody gone').toEqual([]);
    });

    it('offer the group’s sheet only to a reader who may mute, ban or remove somebody', async () =>
    {
        reported();
        crew().role = 'admin';
        crew().rights = ['delete'];

        const container = await drawn();
        const reza = usePeople().byHandle('reza.t')!.displayName;

        expect(rowOf(reportsOf(container), 'buy cheap coins'), 'an admin who may delete works the report').not.toBeNull();
        expect(buttonIn(rowOf(reportsOf(container), 'buy cheap coins'), t('groups.manage', { name: reza })), 'and has nothing to do to the person').toBeNull();

        cleanup();
        useGroups().reset();
        useGroupAdmin().reset();
        crew().rights = ['delete', 'ban'];

        const banning = await drawn();

        expect(buttonIn(rowOf(reportsOf(banning), 'buy cheap coins'), t('groups.manage', { name: reza })), 'an admin who may ban').not.toBeNull();
    });

    it('read right to left in Persian, a handle still left to right', async () =>
    {
        reported();
        server.groupReports[SLUG][0] = { ...server.groupReports[SLUG][0], state: 'actioned', closedBy: 'sara.k', closedAt: ago(1) };
        useLocale().setLocale('fa');

        const container = await drawn('?tab=reports&list=all');

        expect(tabOf(container, t('groups.tab.reports'))).not.toBeNull();
        expect(rowsIn(reportsOf(container))[0].querySelector('[data-closed]')?.textContent).toContain(t('groups.reports.wasActioned'));
        expect(rowsIn(reportsOf(container))[0].querySelector('[data-closed] [dir="ltr"]')?.textContent).toBe('@sara.k');
    });
});

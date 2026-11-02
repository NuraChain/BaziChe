import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import GroupLinkSheet from '../src/components/social/group-link-sheet.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import GroupPage from '../src/pages/app/group.page.azeroth';
import { useGroupAdmin } from '../src/stores/group-admin.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
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
const held = <K extends 'answer' | 'unban' | 'revokeLink' | 'requests' | 'links' | 'banned' | 'log'>(verb: K) =>
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
        expect(server.calls.filter((call) => ['groups.requests', 'groups.links', 'groups.banned', 'groups.log'].includes(call)), 'no panel read').toEqual([]);
    });

    it('are a tab for each panel the owner opens, the requests counting who waits', async () =>
    {
        owned();
        crew().requests = 2;

        const container = opened();
        await vi.waitFor(() => expect(tabsOf(container).length).toBe(5), { timeout: 4000 });

        expect(tabsOf(container).map((label) => label.replace(/\d+$/, '').trim())).toEqual([
            t('groups.tab.members'), t('groups.tab.requests'), t('groups.tab.links'), t('groups.tab.banned'), t('groups.tab.log')
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
        await vi.waitFor(() => expect(tabsOf(again).length).toBe(2), { timeout: 4000 });
        expect(tabsOf(again)).toEqual([t('groups.tab.members'), t('groups.tab.log')]);
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
        await vi.waitFor(() => expect(tabsOf(container).length).toBe(5), { timeout: 4000 });
        await settle();
        expect(server.calls.filter((call) => ['groups.requests', 'groups.links', 'groups.banned', 'groups.log'].includes(call))).toEqual([]);

        fire(tabOf(container, t('groups.tab.requests'))!, 'click');
        await vi.waitFor(() => expect(server.calls).toContain('groups.requests'), { timeout: 4000 });
        expect(server.calls.filter((call) => ['groups.links', 'groups.banned', 'groups.log'].includes(call)), 'the others not yet').toEqual([]);
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

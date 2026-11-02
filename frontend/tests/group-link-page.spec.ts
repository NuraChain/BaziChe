import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route, type Router } from 'azerothjs';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import GroupLinkPage from '../src/pages/app/group-link.page.azeroth';
import { routes as APP_ROUTES } from '../src/routes.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

const TOKEN = 'kkkkkkkkkkkkkkkkkkkkkk';
const SLUG = 'lunch-ludo';

let router: Router;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const t = (key: Parameters<ReturnType<typeof useLocale>['t']>[0], params?: Record<string, string>) => useLocale().t(key, params);

const crew = () => server.groups.find((one) => one.slug === SLUG)!;

/** A link to the group as the server keeps one, live unless said otherwise. */
const linked = (approval = false, live = true) =>
{
    server.groupLinks[SLUG] = [{ id: 'l-1', link: `http://localhost:1/app/g/${ TOKEN }`, at: new Date(0).toISOString(), uses: 0, approval, live }];
};

const opened = (token = TOKEN) =>
{
    const table: Route[] = [
        { path: '/app/g/:token', component: (): HTMLElement => GroupLinkPage() as HTMLElement },
        {
            path: '/app/groups/:id',
            component: (): HTMLElement =>
            {
                const page = document.createElement('div');
                page.dataset.groupPage = '';
                return page;
            }
        }
    ];
    router = createRouter({ routes: table, history: createMemoryHistory(`/app/g/${ token }`), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

/** Holds the next request of a link verb until released, answered as the fake server would. */
const held = <K extends 'face' | 'join' | 'withdraw'>(verb: K) =>
{
    let release: () => void = () => undefined;
    const original = client.groupLinks[verb].bind(client.groupLinks) as (...args: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(client.groupLinks, verb).mockImplementationOnce(((...args: unknown[]) =>
        new Promise((resolve, reject) =>
        {
            release = () => void original(...args).then(resolve, reject);
        })) as never);

    return { spy, release: () => release() };
};

const face = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-link-face]');

const pressed = (container: HTMLElement, words: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[data-link-face] button')].find((one) => one.textContent?.includes(words)) ?? null;

const toasted = () => useToasts().items().map((toast) => toast.text);

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(1_200_000), seed: 7 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useSocial().reset();
    useGroups().reset();
    useToasts().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useGroups().reset();
    vi.restoreAllMocks();
});

describe('the page a group\'s invitation link opens', () =>
{
    it('draws the group as the link shows it, and joins into the group\'s own page once the server has seated the reader', async () =>
    {
        linked();
        const container = opened();
        await vi.waitFor(() => expect(face(container)).not.toBeNull(), { timeout: 4000 });

        expect(face(container)?.querySelector('h1')?.textContent).toBe('Lunch Ludo');
        expect(face(container)?.textContent).toContain(t('groups.linkPageEyebrow'));
        expect(face(container)?.textContent).toContain('Twenty minutes, four colours, back to work.');
        expect(face(container)?.querySelector('.facts')?.textContent).toContain('5');

        const door = held('join');
        fire(pressed(container, t('groups.join'))!, 'click');
        await settle();

        expect(pressed(container, t('groups.join'))?.getAttribute('aria-busy'), 'working while the server seats the reader').toBe('true');
        expect(router.location().pathname).toBe(`/app/g/${ TOKEN }`);

        door.release();
        await vi.waitFor(() => expect(router.location().pathname).toBe(`/app/groups/${ SLUG }`), { timeout: 4000 });

        expect(toasted()).toContain(t('groups.joined', { name: 'Lunch Ludo' }));
        expect(crew().members).toContain('alex');
        expect(useGroups().mine().map((one) => one.slug), 'the reader\'s own groups read again').toContain(SLUG);
    });

    it('asks to join at the press through a link that asks first, and takes it back at the press', async () =>
    {
        linked(true);
        const container = opened();
        await vi.waitFor(() => expect(pressed(container, t('groups.requestJoin'))).not.toBeNull(), { timeout: 4000 });

        const asking = held('join');
        fire(pressed(container, t('groups.requestJoin'))!, 'click');
        await settle();

        expect(face(container)?.querySelector('[data-asked]')?.textContent, 'asked at the press').toContain(t('groups.asked', { name: 'Lunch Ludo' }));
        expect(server.groupRequests[SLUG] ?? [], 'nothing asked yet').toEqual([]);

        asking.release();
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.requestSent')), { timeout: 4000 });
        expect(server.groupRequests[SLUG].map((one) => one.handle)).toEqual(['alex']);
        expect(router.location().pathname, 'a request stays on the link').toBe(`/app/g/${ TOKEN }`);

        const taking = held('withdraw');
        fire(pressed(container, t('groups.withdraw'))!, 'click');
        await settle();

        expect(pressed(container, t('groups.requestJoin')), 'Request to join again at the press').not.toBeNull();

        taking.release();
        await vi.waitFor(() => expect(toasted()).toContain(t('groups.withdrawn', { name: 'Lunch Ludo' })), { timeout: 4000 });
        expect(server.groupRequests[SLUG]).toEqual([]);
    });

    it('takes no second press while one is on its way', async () =>
    {
        linked(true);
        server.groupRequests[SLUG] = [{ handle: 'alex', at: new Date(0).toISOString(), byLink: true }];
        const container = opened();
        await vi.waitFor(() => expect(pressed(container, t('groups.withdraw'))).not.toBeNull(), { timeout: 4000 });

        const taking = held('withdraw');
        const asking = vi.spyOn(client.groupLinks, 'join');
        fire(pressed(container, t('groups.withdraw'))!, 'click');
        await settle();
        fire(pressed(container, t('groups.requestJoin'))!, 'click');
        await settle();

        expect(asking, 'nothing sent while the first is out').not.toHaveBeenCalled();

        taking.release();
        await vi.waitFor(() => expect(server.groupRequests[SLUG]).toEqual([]), { timeout: 4000 });
        expect(asking).not.toHaveBeenCalled();
    });

    it('takes a refused press back, says why in the group\'s words, and reads the link again', async () =>
    {
        linked(true);
        const container = opened();
        await vi.waitFor(() => expect(pressed(container, t('groups.requestJoin'))).not.toBeNull(), { timeout: 4000 });

        server.groupBans[SLUG] = ['alex'];
        fire(pressed(container, t('groups.requestJoin'))!, 'click');
        await vi.waitFor(() => expect(toasted()).toContain(t('group.refused.group-banned')), { timeout: 4000 });

        await vi.waitFor(() => expect(face(container)?.querySelector('[data-banned]') ?? null).not.toBeNull(), { timeout: 4000 });
        expect(face(container)?.querySelector('[data-asked]')).toBeNull();
        expect(pressed(container, t('groups.requestJoin')), 'nothing to press once banned').toBeNull();
    });

    it('says a link that no longer works in one way, whatever ended it, with the way to the reader\'s groups', async () =>
    {
        for (const [token, set] of [[TOKEN, () => linked(false, false)], [TOKEN, () => undefined], ['not-a-token', () => linked()]] as const)
        {
            cleanup();
            useGroups().reset();
            server.groupLinks = {};
            set();
            const container = opened(token);

            await vi.waitFor(() => expect(container.textContent).toContain(t('groups.linkPageDead')), { timeout: 4000 });
            expect(container.textContent).toContain(t('groups.linkPageDeadLead'));
            expect(face(container)).toBeNull();
            expect(container.querySelector('a[href="/app/friends?tab=groups"]')).not.toBeNull();
        }
    });

    it('is being read until the link answers, and says what went wrong with Try again when it cannot be read', async () =>
    {
        linked();
        const reading = held('face');
        const container = opened();
        await settle();

        expect(container.querySelector('[data-reading]')).not.toBeNull();
        expect(container.textContent).not.toContain(t('groups.linkPageDead'));

        reading.release();
        await vi.waitFor(() => expect(face(container)).not.toBeNull(), { timeout: 4000 });

        cleanup();
        useGroups().reset();
        vi.spyOn(client.groupLinks, 'face').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down.', undefined));
        const failing = opened();

        await vi.waitFor(() => expect(failing.querySelector('[role="alert"]')?.textContent).toContain(t('failure.down')), { timeout: 4000 });
        expect(failing.textContent, 'a refused read is not a dead link').not.toContain(t('groups.linkPageDead'));

        const retry = [...failing.querySelectorAll<HTMLElement>('[role="alert"] button')].find((one) => one.textContent?.includes(t('common.retry')))!;
        fire(retry, 'click');
        await vi.waitFor(() => expect(face(failing)).not.toBeNull(), { timeout: 4000 });
    });

    it('tells a member they are in already, with the way to the group', async () =>
    {
        linked();
        crew().members.push('alex');
        crew().role = 'member';
        const container = opened();
        await vi.waitFor(() => expect(face(container)?.querySelector('[data-member]') ?? null).not.toBeNull(), { timeout: 4000 });

        expect(face(container)?.textContent).toContain(t('groups.linkPageMember'));
        expect(face(container)?.querySelector(`a[href="/app/groups/${ SLUG }"]`)?.textContent).toContain(t('groups.linkPageOpen'));
        expect(pressed(container, t('groups.join'))).toBeNull();
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        linked();
        const container = opened();
        await vi.waitFor(() => expect(face(container)).not.toBeNull(), { timeout: 4000 });

        expect(face(container)?.textContent).toContain('به یه گروه دعوت شدی');
        expect(pressed(container, useLocale().t('groups.join'))).not.toBeNull();
    });

    it('is a page of the app of its own, fetched when it is opened', () =>
    {
        const app = APP_ROUTES.find((route) => route.path === '/app')!;
        const link = app.children?.find((route) => route.path === 'g/:token');

        expect(link, 'the address a group link names').toBeDefined();
        expect(link?.component, 'never drawn from the app shell\'s own chunk').toBeUndefined();
        expect(typeof link?.lazy).toBe('function');
    });
});

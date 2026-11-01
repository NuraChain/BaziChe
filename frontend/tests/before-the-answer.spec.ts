import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import type { GroupSummary } from '../src/api.ts';
import SocialPanel from '../src/components/app/social-panel.component.azeroth';
import InviteSheet from '../src/components/games/invite-sheet.component.azeroth';
import LiveStats from '../src/components/games/live-stats.component.azeroth';
import GroupAdd from '../src/components/social/group-add.component.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import DiscoverPage from '../src/pages/app/discover.page.azeroth';
import FriendsPage from '../src/pages/app/friends.page.azeroth';
import GamesPage from '../src/pages/app/games.page.azeroth';
import HomePage from '../src/pages/app/home.page.azeroth';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useConnection } from '../src/stores/connection.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRecord } from '../src/stores/record.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const routes = client.social as unknown as Record<string, () => Promise<unknown>>;

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

const ALEX = { id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false };

/**
 * Signs the reader in again with one of the social reads answered as `answer` says, so the store holds
 * nothing it read before. Hands back what puts the read back as it was.
 */
const anew = async (verb: string, answer: (real: () => Promise<unknown>) => Promise<unknown>) =>
{
    const real = routes[verb];

    routes[verb] = () => answer(real);
    useSession().reset();
    await settle();
    useSession().establish(ALEX);
    await settle();

    return () =>
    {
        routes[verb] = real;
    };
};

const held = () =>
{
    const gate = { open: () => undefined as void };
    const answer = (real: () => Promise<unknown>) => new Promise((resolve, reject) =>
    {
        gate.open = () => void real().then(resolve, reject);
    });

    return { gate, answer };
};

const refused = () => Promise.reject(new ApiError(503, 'unavailable', 'Down.', undefined));

const page = (component: () => HTMLElement, at: string) =>
{
    const table: Route[] = [{ path: at.split('?')[0], component }];
    const router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

const alertOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="alert"]');

const retryOf = (container: HTMLElement) =>
    [...(alertOf(container)?.querySelectorAll('button') ?? [])].find((one) => one.textContent?.includes(useLocale().t('common.retry'))) ?? null;

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(2_000_000), seed: 5 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish(ALEX);
    usePresence().reset();
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    useLobby().reset();
    useToasts().reset();
    useConnection().reset();
    await useSocial().refresh();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useDevice().override(null);
    useConnection().reset();
    useSocial().reset();
    useLobby().reset();
    useRealtime().reset();
    useToasts().reset();
});

describe('the people Discover suggests', () =>
{
    const section = (container: HTMLElement) => [...container.querySelectorAll('section')].find((one) => one.textContent?.includes(useLocale().t('discover.people')))!;

    it('are drawn as being read until the server answers, and never as nobody', async () =>
    {
        const { gate, answer } = held();
        const real = routes.suggestions;

        routes.suggestions = () => answer(real);

        try
        {
            const container = page(DiscoverPage as unknown as () => HTMLElement, '/app/discover');

            await settle();

            expect(section(container).querySelector('[data-reading]'), 'the section is blank while it is read').not.toBeNull();
            expect(container.textContent).not.toContain(useLocale().t('friends.empty.suggestions'));

            gate.open();
            await settle();

            expect(section(container).querySelector('[data-reading]')).toBeNull();
            expect(section(container).querySelectorAll('li').length).toBeGreaterThan(0);
        }
        finally
        {
            routes.suggestions = real;
        }
    });

    it('say what went wrong when they could not be read, and that there is nobody left only when the server says so', async () =>
    {
        const real = routes.suggestions;
        let answer: () => Promise<unknown> = refused;

        routes.suggestions = () => answer();

        try
        {
            const container = page(DiscoverPage as unknown as () => HTMLElement, '/app/discover');

            await settle();

            expect(alertOf(section(container))?.textContent).toContain(useLocale().t('failure.down'));
            expect(container.textContent).not.toContain(useLocale().t('friends.empty.suggestions'));

            answer = () => Promise.resolve({ suggestions: [] });
            fire(retryOf(section(container))!, 'click');
            await settle();

            expect(alertOf(section(container))).toBeNull();
            expect(section(container).textContent, 'a section with nobody in it says nothing at all').toContain(useLocale().t('friends.empty.suggestions'));
        }
        finally
        {
            routes.suggestions = real;
        }
    });
});

describe('the sheet that invites a friend to a table, before the friends are read', () =>
{
    const sheet = async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', defaultTable('ludo'), []);

        lobby.open(id);
        await settle();

        return renderTest(() => InviteSheet({ overlayId: 'invite', close: () => undefined, tableId: id }) as HTMLElement).container;
    };

    it('draws the friends as being read, and says there is nobody to invite only once the server has said so', async () =>
    {
        const { gate, answer } = held();
        const restore = await anew('graph', answer);

        try
        {
            const container = await sheet();

            expect(container.querySelector('[data-reading]')).not.toBeNull();
            expect(container.textContent).not.toContain(useLocale().t('create.friendless'));

            gate.open();
            await settle();

            expect(container.querySelector('[data-reading]')).toBeNull();
            expect(container.querySelectorAll('ul button').length).toBeGreaterThan(0);
        }
        finally
        {
            restore();
        }
    });

    it('says what went wrong where the friends would be, and reads them again at Try again', async () =>
    {
        let answer: (real: () => Promise<unknown>) => Promise<unknown> = refused;
        const restore = await anew('graph', (real) => answer(real));

        try
        {
            const container = await sheet();

            expect(alertOf(container)?.textContent).toContain(useLocale().t('failure.down'));
            expect(container.textContent).not.toContain(useLocale().t('create.friendless'));

            answer = (real) => real();
            fire(retryOf(container)!, 'click');
            await settle();

            expect(alertOf(container)).toBeNull();
            expect(container.querySelectorAll('ul button').length).toBeGreaterThan(0);
        }
        finally
        {
            restore();
        }
    });
});

describe('the sheet that adds a friend to a group, before the friends are read', () =>
{
    const group = () => structuredClone(server.groups.find((one) => one.slug === 'friday-night-crew')!) as unknown as GroupSummary;

    it('draws the friends as being read, then what went wrong, and never that everybody is already in the group', async () =>
    {
        const { gate, answer } = held();
        const restore = await anew('graph', (real) => answer(() => real().then(() => Promise.reject(new ApiError(500, 'internal', 'Internal server error', undefined)))));

        try
        {
            const container = renderTest(() => GroupAdd({ overlayId: 'add', close: () => undefined, group: group() }) as HTMLElement).container;

            await settle();

            expect(container.querySelector('[data-reading]')).not.toBeNull();
            expect(container.textContent).not.toContain(useLocale().t('groups.addNone'));

            gate.open();
            await settle();

            expect(alertOf(container)?.textContent).toContain(useLocale().t('failure.server'));
            expect(container.textContent).not.toContain(useLocale().t('groups.addNone'));
            expect(container.querySelector('[data-reading]')).toBeNull();
        }
        finally
        {
            restore();
        }
    });

    it('says what kept a friend out of the group as what it was', async () =>
    {
        const container = renderTest(() => GroupAdd({ overlayId: 'add', close: () => undefined, group: group() }) as HTMLElement).container;
        const real = (client.groups as unknown as Record<string, unknown>).add;

        (client.groups as unknown as Record<string, unknown>).add = () => Promise.reject(new ApiError(503, 'unavailable', 'Down.', undefined));

        try
        {
            await settle();

            fire(container.querySelector('ul button')!, 'click');
            await settle();

            expect(useToasts().items().map((toast) => toast.text)).toEqual([useLocale().t('failure.down')]);
        }
        finally
        {
            (client.groups as unknown as Record<string, unknown>).add = real;
        }
    });
});

describe('the friends online, on Home and beside the page', () =>
{
    const places = [
        {
            name: 'Home',
            open: () =>
            {
                useDevice().override('phone');

                return page(HomePage as unknown as () => HTMLElement, '/app');
            }
        },
        { name: 'the panel', open: () => page(SocialPanel as unknown as () => HTMLElement, '/app') }
    ];

    const friendsOf = (container: HTMLElement) =>
        [...container.querySelectorAll('section')].find((one) => one.textContent?.includes(useLocale().t('home.friends.title')))!;

    for (const place of places)
    {
        it(`are drawn as being read in ${ place.name } until the friends and the socket have both answered`, async () =>
        {
            const { gate, answer } = held();
            const restore = await anew('graph', answer);

            try
            {
                const container = place.open();

                await settle();

                expect(friendsOf(container).querySelector('[data-reading]'), 'the friends are not said to be on their way').not.toBeNull();
                expect(container.textContent).not.toContain(useLocale().t('shell.friends.empty'));

                gate.open();
                await settle();

                expect(friendsOf(container).querySelector('[data-reading]'), 'nobody is said to be online before the socket has said who is').not.toBeNull();
                expect(container.textContent).not.toContain(useLocale().t('shell.friends.empty'));

                useRealtime().start();
                socket.deliver({ v: 1, t: 'presence', n: 1, full: true, people: [] });
                await settle();

                expect(friendsOf(container).querySelector('[data-reading]')).toBeNull();
                expect(friendsOf(container).textContent).toContain(useLocale().t('shell.friends.empty'));
            }
            finally
            {
                restore();
            }
        });

        it(`say in ${ place.name } what went wrong when the friends could not be read, and why nobody can be named while there is no connection`, async () =>
        {
            let answer: (real: () => Promise<unknown>) => Promise<unknown> = refused;
            const restore = await anew('graph', (real) => answer(real));
            const stop = useConnection().start();

            try
            {
                const container = place.open();

                await settle();

                expect(alertOf(friendsOf(container))?.textContent).toContain(useLocale().t('failure.down'));
                expect(container.textContent).not.toContain(useLocale().t('shell.friends.empty'));

                answer = (real) => real();
                window.dispatchEvent(new Event('offline'));
                fire(retryOf(friendsOf(container))!, 'click');
                await settle();

                expect(alertOf(friendsOf(container))).toBeNull();
                expect(friendsOf(container).textContent).toContain(useLocale().t('shell.friends.unknown'));
                expect(friendsOf(container).querySelector('[data-reading]'), 'still being read beside the sentence that says it cannot be').toBeNull();
                expect(container.textContent).not.toContain(useLocale().t('shell.friends.empty'));
            }
            finally
            {
                window.dispatchEvent(new Event('online'));
                stop();
                restore();
            }
        });
    }
});

describe('the groups, on the Friends page and on Discover, before the server has answered', () =>
{
    const groupRoutes = client.groups as unknown as Record<string, () => Promise<unknown>>;

    /** Signs the reader in again with the groups' reads answered as given, so the store holds nothing it read before. */
    const anewGroups = async (answers: { mine?: (real: () => Promise<unknown>) => Promise<unknown>; discover?: (real: () => Promise<unknown>) => Promise<unknown> }) =>
    {
        const real = { mine: groupRoutes.mine, discover: groupRoutes.discover };

        groupRoutes.mine = () => (answers.mine ?? ((read) => read()))(real.mine);
        groupRoutes.discover = () => (answers.discover ?? ((read) => read()))(real.discover);
        useGroups().reset();
        useSession().reset();
        await settle();
        useSession().establish(ALEX);
        await settle();

        return () =>
        {
            groupRoutes.mine = real.mine;
            groupRoutes.discover = real.discover;
        };
    };

    const sectionOf = (container: HTMLElement, key: 'groups.mine' | 'groups.discover' | 'discover.rooms') =>
        [...container.querySelectorAll('section')].find((one) => one.querySelector('h2, h3')?.textContent?.includes(useLocale().t(key)))!;

    it('draws the reader\'s groups and the ones to join as being read on the Friends page, and their empty words only once answered', async () =>
    {
        const mine = held();
        const discover = held();
        const restore = await anewGroups({ mine: mine.answer, discover: discover.answer });

        try
        {
            const container = page(FriendsPage as unknown as () => HTMLElement, '/app/friends?tab=groups');

            await settle();

            expect(sectionOf(container, 'groups.mine').querySelector('[data-reading]')).not.toBeNull();
            expect(sectionOf(container, 'groups.discover').querySelector('[data-reading]')).not.toBeNull();
            expect(container.textContent).not.toContain(useLocale().t('groups.none'));
            expect(container.textContent).not.toContain(useLocale().t('groups.discoverNone'));

            mine.gate.open();
            discover.gate.open();
            await settle();

            expect(container.querySelector('[data-reading]')).toBeNull();
            expect(sectionOf(container, 'groups.mine').querySelectorAll('li').length).toBeGreaterThan(0);
        }
        finally
        {
            restore();
        }
    });

    it('says what went wrong where each list of groups would be on the Friends page, and reads them again at Try again', async () =>
    {
        let refusing = true;
        const restore = await anewGroups({
            mine: (read) => (refusing ? refused() : read()),
            discover: (read) => (refusing ? Promise.reject(new ApiError(500, 'internal', 'Internal server error', undefined)) : read())
        });

        try
        {
            const container = page(FriendsPage as unknown as () => HTMLElement, '/app/friends?tab=groups');

            await settle();

            expect(alertOf(sectionOf(container, 'groups.mine'))?.textContent).toContain(useLocale().t('failure.down'));
            expect(alertOf(sectionOf(container, 'groups.discover'))?.textContent).toContain(useLocale().t('failure.server'));
            expect(container.textContent).not.toContain(useLocale().t('groups.none'));
            expect(container.textContent).not.toContain(useLocale().t('groups.discoverNone'));

            refusing = false;
            fire(retryOf(sectionOf(container, 'groups.mine'))!, 'click');
            await settle();

            expect(container.querySelector('[role="alert"]')).toBeNull();
            expect(sectionOf(container, 'groups.mine').querySelectorAll('li').length).toBeGreaterThan(0);
        }
        finally
        {
            restore();
        }
    });

    it('draws the groups worth joining as being read on Discover, then what went wrong, and never that there are none', async () =>
    {
        const { gate, answer } = held();
        const restore = await anewGroups({ discover: (read) => answer(() => read().then(() => Promise.reject(new ApiError(503, 'unavailable', 'Down.', undefined)))) });

        try
        {
            const container = page(DiscoverPage as unknown as () => HTMLElement, '/app/discover');

            await settle();

            expect(sectionOf(container, 'discover.rooms').querySelector('[data-reading]')).not.toBeNull();
            expect(container.textContent).not.toContain(useLocale().t('discover.roomsEmpty'));

            gate.open();
            await settle();

            expect(alertOf(sectionOf(container, 'discover.rooms'))?.textContent).toContain(useLocale().t('failure.down'));
            expect(container.textContent).not.toContain(useLocale().t('discover.roomsEmpty'));
            expect(sectionOf(container, 'discover.rooms').querySelector('[data-reading]')).toBeNull();
        }
        finally
        {
            restore();
        }
    });
});

describe('the activity beside the page, before the server has answered', () =>
{
    const lists = client.notifications as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const activityOf = (container: HTMLElement) =>
        [...container.querySelectorAll('section')].find((one) => one.querySelector('h2')?.textContent?.includes(useLocale().t('shell.activity')))!;

    const anewList = async (list: (real: (input: unknown) => Promise<unknown>, input: unknown) => Promise<unknown>) =>
    {
        const real = lists.list;

        lists.list = (input) => list(real, input);
        useSession().reset();
        await settle();
        useSession().establish(ALEX);
        await settle();

        return () =>
        {
            lists.list = real;
        };
    };

    it('is drawn as being read, and says there is nothing new only once the server has said so', async () =>
    {
        let open: () => void = () => undefined;
        const restore = await anewList((real, input) => new Promise((resolve, reject) =>
        {
            open = () => void real(input).then(resolve, reject);
        }));

        try
        {
            const container = page(SocialPanel as unknown as () => HTMLElement, '/app');

            await settle();

            expect(activityOf(container).querySelector('[data-reading]')).not.toBeNull();
            expect(container.textContent).not.toContain(useLocale().t('shell.activity.empty'));

            open();
            await settle();

            expect(activityOf(container).querySelector('[data-reading]')).toBeNull();
            expect(activityOf(container).textContent).toContain(useLocale().t('shell.activity.empty'));
        }
        finally
        {
            restore();
        }
    });

    it('says what went wrong where the activity would be when it could not be read', async () =>
    {
        const restore = await anewList(() => Promise.reject(new ApiError(503, 'unavailable', 'Down.', undefined)));

        try
        {
            const container = page(SocialPanel as unknown as () => HTMLElement, '/app');

            await settle();

            expect(alertOf(activityOf(container))?.textContent).toContain(useLocale().t('failure.down'));
            expect(container.textContent).not.toContain(useLocale().t('shell.activity.empty'));
        }
        finally
        {
            restore();
        }
    });
});

describe('the games the reader finished, on Home, before the server has answered', () =>
{
    const recentOf = (container: HTMLElement) =>
        [...container.querySelectorAll('section')].find((one) => one.querySelector('h2')?.textContent?.includes(useLocale().t('home.recent.title')))!;

    beforeEach(() =>
    {
        useRecord().reset();
        useDevice().override('phone');
    });

    afterEach(() =>
    {
        vi.restoreAllMocks();
        useRecord().reset();
    });

    it('are drawn as being read, and as none only once the server has said so', async () =>
    {
        let open: () => void = () => undefined;

        vi.spyOn(client.matches, 'history').mockImplementationOnce(() => new Promise((resolve) =>
        {
            open = () => resolve({ matches: [] });
        }));

        const container = page(HomePage as unknown as () => HTMLElement, '/app');

        await settle();

        expect(recentOf(container).querySelector('[data-reading]')).not.toBeNull();
        expect(container.textContent).not.toContain(useLocale().t('home.recent.empty'));

        open();
        await settle();

        expect(recentOf(container).querySelector('[data-reading]')).toBeNull();
        expect(recentOf(container).textContent).toContain(useLocale().t('home.recent.empty'));
    });

    it('say what went wrong where they would be, and read them again at Try again', async () =>
    {
        vi.spyOn(client.matches, 'history')
            .mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down.', undefined))
            .mockResolvedValueOnce({ matches: [] });

        const container = page(HomePage as unknown as () => HTMLElement, '/app');

        await settle();

        expect(alertOf(recentOf(container))?.textContent).toContain(useLocale().t('failure.down'));
        expect(container.textContent).not.toContain(useLocale().t('home.recent.empty'));

        fire(retryOf(recentOf(container))!, 'click');
        await settle();

        expect(alertOf(recentOf(container))).toBeNull();
        expect(recentOf(container).textContent).toContain(useLocale().t('home.recent.empty'));
    });
});

describe('how many are playing, before any count has come', () =>
{
    afterEach(() =>
    {
        vi.restoreAllMocks();
        useDevice().override(null);
    });

    const uncounted = () => vi.spyOn(useCatalogue(), 'counted').mockReturnValue(false);

    const hidden = (node: Element | null) => node !== null && node.classList.contains('invisible') && node.getAttribute('aria-hidden') === 'true';

    it('is kept out of sight and out of a screen reader\'s hearing on Home, never said as nobody', async () =>
    {
        useDevice().override('phone');
        uncounted();

        const container = page(HomePage as unknown as () => HTMLElement, '/app');

        await settle();

        expect(hidden(container.querySelector('[data-pulse]')), 'nobody is said to be playing before anybody has been counted').toBe(true);
    });

    it('is shown on Home once a count has come', async () =>
    {
        useDevice().override('phone');

        const container = page(HomePage as unknown as () => HTMLElement, '/app');

        await settle();

        expect(hidden(container.querySelector('[data-pulse]'))).toBe(false);
    });

    it('is kept out of sight on the games page and on a game\'s own page until a count has come', async () =>
    {
        uncounted();

        const games = page(GamesPage as unknown as () => HTMLElement, '/app/games');
        const stats = renderTest(() => LiveStats({ game: 'ludo' }) as unknown as HTMLElement).container;

        await settle();

        expect(hidden(games.querySelector('[data-counts]'))).toBe(true);
        expect(hidden(stats.querySelector('ul'))).toBe(true);
    });
});

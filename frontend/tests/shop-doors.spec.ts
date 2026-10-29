import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type MountNode, type Route } from 'azerothjs';

import { lookOf, SHOP_COLLECTIONS, type ShopCollection, type ShopGame } from '../../backend/src/domains/shop/catalogue.ts';
import type { Account } from '../../backend/src/schemas.ts';
import NavRail from '../src/components/app/nav-rail.component.azeroth';
import { lit, RAIL } from '../src/components/app/nav-items.ts';
import Sidebar from '../src/components/app/sidebar.component.azeroth';
import TopBar from '../src/components/app/top-bar.component.azeroth';
import GameHero from '../src/components/games/game-hero.component.azeroth';
import GameLooks from '../src/components/shop/game-looks.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import { routeMeta } from '../src/lib/route-meta.ts';
import { GAME_LOOKS, looksForGame } from '../src/lib/shop.ts';
import '../src/locales/app-catalogue.ts';
import GamePage from '../src/pages/app/game.page.azeroth';
import MePage from '../src/pages/app/me.page.azeroth';
import { routes } from '../src/routes.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useShell } from '../src/stores/shell.store.ts';
import { useShop } from '../src/stores/shop.store.ts';
import { closedShop, establishAccount, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const SOURCES = import.meta.glob(
    ['../src/pages/app/game.page.azeroth', '../src/components/games/game-hero.component.azeroth', '../src/components/games/lazy-game-looks.component.azeroth', '../src/pages/app/me.page.azeroth', '../src/components/shop/shop-chip.component.azeroth'],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const stub = () => document.createElement('div');

const shown = async (children: () => MountNode, at = '/app') =>
{
    const router = createRouter({ routes: [{ path: at.split('?')[0], component: stub }], history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children }) as HTMLElement);
    await settle();
    return container;
};

let seq = 0;

const signIn = () =>
{
    seq += 1;
    const account: Account = establishAccount('alex', { id: `u-doors-${ seq }`, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' });
    useSession().establish(account);
    return account;
};

const hrefs = (root: ParentNode) => [...root.querySelectorAll('a[href]')].map((one) => one.getAttribute('href'));

beforeEach(() =>
{
    cleanup();
    server.reset();
    socket.reset();
    useRealtime().reset();
    useShop().reset();
    useOverlay().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useShop().reset();
    useOverlay().reset();
    useSession().reset();
});

describe('the shop among the rail’s destinations', () =>
{
    it('puts Shop after Discover and before Settings, whatever the server runs', () =>
    {
        expect(RAIL.map((item) => item.to).slice(-3)).toEqual(['/app/discover', '/app/shop', '/app/me/settings']);
    });

    it.each([['the sidebar', Sidebar], ['the rail', NavRail]] as const)('%s draws Shop for every account, beside a shop that is turned off too', async (_, Nav) =>
    {
        server.shop.state = closedShop();
        signIn();
        const nav = await shown(() => Nav({}));
        const links = hrefs(nav);

        expect(links.indexOf('/app/shop')).toBe(links.indexOf('/app/discover') + 1);
        expect(nav.querySelector('a[href="/app/shop"]')?.getAttribute('aria-label') ?? nav.querySelector('a[href="/app/shop"]')?.textContent?.trim()).toBe('Shop');
    });

    it('lights Shop on the shop and on the collection', () =>
    {
        const app = routes.find((route) => route.path === '/app')!;
        const tabOf = (path: string) => routeMeta({ route: (app.children ?? []).find((child) => child.path === path)! } as never).tab;

        for (const path of ['shop', 'shop/collection'])
        {
            expect(RAIL.find((item) => lit(item, tabOf(path)))?.to, path).toBe('/app/shop');
        }
    });

    it('draws no way back on the shop beside the sidebar that lists it', async () =>
    {
        const page = async () =>
        {
            signIn();
            const table: Route[] = [{ path: '/app', component: stub, children: [{ path: 'shop', component: stub, meta: { tab: 'shop', parent: '/app/games' } }] }];
            const router = createRouter({ routes: table, history: createMemoryHistory('/app/shop'), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => TopBar({}) }) as HTMLElement);
            await settle();
            return container.querySelector('button[aria-label="Back"]');
        };

        useShell().reset();
        useDevice().override('sidebar');

        expect(await page()).toBeNull();
    });
});

describe('what a game’s page offers of the shop', () =>
{
    it('offers the featured collection’s looks for the game, its table’s and then its celebration, and fills a chess row from the other sets', () =>
    {
        expect(looksForGame('ludo', 'glow')).toEqual(['dice.glow', 'pawns.glow', 'yard.glow', 'celebration.glow']);
        expect(looksForGame('hokm', 'neon')).toEqual(['back.neon', 'face.neon', 'felt.neon', 'celebration.neon']);
        expect(looksForGame('poker', 'gold')).toEqual(['back.gold', 'face.gold', 'felt.gold', 'chips.gold']);
        expect(looksForGame('backgammon', 'shiraz')).toEqual(['dice.shiraz', 'checkers.shiraz', 'home.shiraz', 'celebration.shiraz']);
        expect(looksForGame('chess', 'shiraz')).toEqual(['pieces.shiraz', 'celebration.shiraz', 'pieces.glow', 'pieces.neon']);

        for (const game of GAMES.map((one) => one.id as ShopGame))
        {
            for (const collection of SHOP_COLLECTIONS as readonly ShopCollection[])
            {
                const looks = looksForGame(game, collection);

                expect(looks, `${ game } in ${ collection }`).toHaveLength(GAME_LOOKS);
                expect(new Set(looks).size, `${ game } in ${ collection }`).toBe(GAME_LOOKS);
                expect(looks.every((look) => lookOf(look) !== undefined), `${ game } in ${ collection }`).toBe(true);
                expect(looks[0].endsWith(`.${ collection }`), `${ game } in ${ collection }`).toBe(true);
            }
        }
    });

    it('puts Shop beside Quick play and Create in the hero, leading to the shop for that game', async () =>
    {
        const ludo = GAMES.find((one) => one.id === 'ludo')!;

        signIn();
        const container = await shown(() => GameHero({ game: ludo, onQuickPlay: () => undefined }), '/');
        const create = container.querySelector('a[href="/app/games/ludo/create"]');
        const shop = container.querySelector('a[href="/app/shop?for=ludo"]');

        expect(create).not.toBeNull();
        expect(shop?.textContent?.trim()).toBe('Shop');
        expect(shop?.parentElement).toBe(create?.parentElement);
    });

    const gamePage = async (slug = 'ludo') =>
    {
        const router = createRouter({ routes: [{ path: '/app/games/:slug', component: () => GamePage() as HTMLElement }], history: createMemoryHistory(`/app/games/${ slug }`), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() => expect(container.querySelector(`a[href="/app/games/${ slug }/create"]`)).not.toBeNull(), { timeout: 4000 });
        await settle();

        return container;
    };

    it.each([['open', false], ['turned off', true]] as const)('offers the shop three ways while it is %s: the hero, a bag in the phone’s bar and the game’s looks', async (_, off) =>
    {
        if (off)
        {
            server.shop.state = closedShop();
        }

        signIn();
        const container = await gamePage();

        await vi.waitFor(() => expect(container.querySelector('[data-game-looks="ludo"]')).not.toBeNull(), { timeout: 4000 });

        const doors = [...container.querySelectorAll('a[href="/app/shop?for=ludo"]')];
        const bag = doors.find((one) => one.closest('.sm\\:hidden') !== null);

        expect(doors, 'the hero, the phone’s bar and See all').toHaveLength(3);
        expect(bag?.getAttribute('aria-label')).toBe('Shop');
        expect(bag?.closest('.sm\\:hidden')?.querySelector('a[href="/app/games/ludo/create"]'), 'the bag is not beside the bar’s create').not.toBeNull();

        const strip = container.querySelector('[data-game-looks="ludo"]')!;

        expect(strip.querySelector('h2')?.textContent).toBe('Looks for Ludo');
        expect(strip.querySelector('a[href="/app/shop?for=ludo"]')?.textContent?.trim()).toBe('See all');
        expect([...strip.querySelectorAll('[data-look]')].map((one) => one.getAttribute('data-look'))).toEqual(looksForGame('ludo', 'glow'));
    });

    it('opens a look’s sheet over the game’s page, so it is bought without leaving', async () =>
    {
        signIn();
        const container = await gamePage();

        await vi.waitFor(() => expect(container.querySelector('[data-look="pawns.glow"]')).not.toBeNull(), { timeout: 4000 });

        fire(container.querySelector('[data-look="pawns.glow"]')!, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().top()!.props.item).toBe('pawns.glow');
    });

    it('follows the collection the staff feature', async () =>
    {
        server.shop.state = { ...server.shop.state, featured: 'neon' } as typeof server.shop.state;
        signIn();
        const container = await gamePage('chess');

        await vi.waitFor(() => expect(container.querySelector('[data-game-looks="chess"]')).not.toBeNull(), { timeout: 4000 });

        expect([...container.querySelectorAll('[data-look]')].map((one) => one.getAttribute('data-look'))).toEqual(looksForGame('chess', 'neon'));
    });

    it('says nothing where the shop could not be read: the shop’s own page says why', async () =>
    {
        server.shop.refuse = { status: 503, code: 'chain-unreachable' };
        signIn();
        const container = await shown(() => GameLooks({ game: 'ludo' }));

        await vi.waitFor(() => expect(server.calls).toContain('shop.state'), { timeout: 4000 });
        await settle();

        expect(container.querySelector('[data-game-looks]')).toBeNull();
    });

    it('shows the looks of a shop that is turned off, each opening its sheet, which says so', async () =>
    {
        server.shop.state = closedShop();
        signIn();
        const container = await shown(() => GameLooks({ game: 'ludo' }));

        await vi.waitFor(() => expect(container.querySelector('[data-game-looks="ludo"]')).not.toBeNull(), { timeout: 4000 });

        expect([...container.querySelectorAll('[data-look]')].map((one) => one.getAttribute('data-look'))).toEqual(looksForGame('ludo', 'glow'));
    });

    it('says the game’s name in the reader’s words', async () =>
    {
        useLocale().setLocale('fa');
        signIn();
        const container = await gamePage();

        await vi.waitFor(() => expect(container.querySelector('[data-game-looks="ludo"] h2')).not.toBeNull(), { timeout: 4000 });

        expect(container.querySelector('[data-game-looks="ludo"] h2')?.textContent).toBe(`استایل‌های ${ useLocale().t(GAMES.find((one) => one.id === 'ludo')!.nameKey) }`);
    });

    it('keeps the shop out of the page’s own chunk: only the wrapper’s import() reaches it', () =>
    {
        const SHOP = /\/shop\/|shop\.store|shop-catalogue|lib\/shop|look-sheet/;

        for (const [file, text] of Object.entries(SOURCES))
        {
            const statics = [...text.matchAll(/^import (?:[^;]*? from )?'([^']+)';$/gm)].map((match) => match[1]);

            expect(statics.filter((path) => SHOP.test(path) && !path.endsWith('shop-chip.component.azeroth')), file).toEqual([]);
        }

        expect(SOURCES['../src/components/games/lazy-game-looks.component.azeroth']).toContain('import(\'../shop/game-looks.component.azeroth\')');
    });
});

describe('the reader’s own page', () =>
{
    const mePage = async () =>
    {
        const table: Route[] = [{ path: '/app/me', component: MePage as unknown as () => HTMLElement }];
        const router = createRouter({ routes: table, history: createMemoryHistory('/app/me'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: MePage as unknown as () => HTMLElement }) as HTMLElement);

        await settle();

        return container;
    };

    it.each([['open', false], ['turned off', true]] as const)('leads to the reader’s collection beside the vault’s chip while the shop is %s', async (_, off) =>
    {
        if (off)
        {
            server.shop.state = closedShop();
        }

        signIn();
        const page = await mePage();
        const chip = page.querySelector<HTMLAnchorElement>('a[href="/app/shop/collection"]');

        expect(chip?.textContent).toContain('Your collection');
        expect(chip?.textContent).toContain('Looks for your profile and your tables');
    });

    it('leads to the vault\'s page, saying playing for NURA is turned off where the server keeps no vault', async () =>
    {
        server.nura.state = { configured: false };
        signIn();
        const page = await mePage();

        await vi.waitFor(() => expect(page.querySelector('a[href="/app/me/wallet"] [data-off="paid"]')).not.toBeNull(), { timeout: 4000 });

        expect(page.querySelector('a[href="/app/me/wallet"]')?.textContent).toContain('Playing for NURA is turned off right now');
    });

    it('carries nothing of the shop but the chip, which asks nothing', () =>
    {
        const chip = SOURCES['../src/components/shop/shop-chip.component.azeroth'];

        expect([...chip.matchAll(/from '([^']+)'/g)].map((match) => match[1]).filter((path) => /shop/.test(path))).toEqual([]);
    });
});

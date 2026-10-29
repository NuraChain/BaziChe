import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import MarketDoor from '../src/components/market/market-door.component.azeroth';
import MarketPositions from '../src/components/market/market-positions.component.azeroth';
import MarketSheet from '../src/components/market/market-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/market-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import { routes } from '../src/routes.ts';
import { SETTLE_MS, useMarkets } from '../src/stores/markets.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import type { MarketPositionView, MarketView } from '../../backend/src/schemas.ts';
import { server, settleClaim } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const SOURCES = import.meta.glob(
    ['../src/pages/app/play.page.azeroth', '../src/pages/app/wallet.page.azeroth', '../src/components/games/lazy-market-door.component.azeroth', '../src/components/market/lazy-market-positions.component.azeroth'],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const OTHER = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf';
const NURA = 10n ** 18n;

const OPEN = {
    open: true as const,
    may: 'yes' as 'yes' | 'market-wallet' | 'market-minor' | 'market-terms' | 'market-break' | 'market-disclosure',
    presets: [1n, 5n, 10n].map((one) => (one * NURA).toString()),
    least: NURA.toString(),
    most: (500n * NURA).toString(),
    perBettor: (1000n * NURA).toString(),
    perDay: (2000n * NURA).toString(),
    pool: (100_000n * NURA).toString(),
    feeBps: 0,
    window: 90
};

const MARKET: MarketView = {
    id: 'market-1',
    match: 'match-1',
    game: 'chess',
    state: 'open',
    closesAt: '2026-10-28T12:01:30.000Z',
    feeBps: 0,
    minBettors: 2,
    minOutcomes: 2,
    outcomes: [
        { choice: { kind: 'seat', seat: 0, who: 'sara.k' }, pool: (10n * NURA).toString() },
        { choice: { kind: 'seat', seat: 1, who: 'reza.t' }, pool: (30n * NURA).toString() }
    ],
    pool: (40n * NURA).toString(),
    bettors: 3,
    mine: []
};

const position = (id: string, more: Partial<MarketPositionView> = {}): MarketPositionView => ({
    id,
    market: 'market-1',
    match: 'match-1',
    game: 'chess',
    outcome: 1,
    choice: { kind: 'seat', seat: 1, who: 'reza.t' },
    address: OWNER,
    amount: (5n * NURA).toString(),
    state: 'confirmed',
    deadline: '2026-10-28T12:02:00.000Z',
    at: '2026-10-28T11:00:00.000Z',
    ...more
});

let clock: ManualClock;
let stopWallet: (() => void) | null = null;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const walletWith = () =>
{
    const provider: Eip1193Provider = {
        async request({ method })
        {
            if (method === 'eth_accounts' || method === 'eth_requestAccounts')
            {
                return [OWNER];
            }

            if (method === 'eth_chainId')
            {
                return '0x7a69';
            }

            if (method === 'eth_sendTransaction')
            {
                return `0x${ 'ab'.repeat(32) }`;
            }

            return null;
        },
        on()
        {
            return;
        },
        removeListener()
        {
            return;
        }
    };

    useWallet().adopt(provider);
    stopWallet = useWallet().start();
};

const mount = async (draw: () => HTMLElement) =>
{
    server.account = { id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false, address: OWNER };
    useSession().establish(server.account);
    await settle();

    const router = createRouter({ routes, history: createMemoryHistory('/app/play/t-1'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: draw }) as unknown as HTMLElement);

    await settle();
    await settle();

    return container;
};

const door = () => mount(() => MarketDoor({ match: 'match-1' }) as unknown as HTMLElement);

const positions = () => mount(() => MarketPositions({}) as unknown as HTMLElement);

const button = (root: ParentNode, words: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim().replace(/\s+/g, ' ') === words);

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-28T12:00:00.000Z'));
    setRuntime({ clock, seed: 3 });
    server.reset();
    server.markets.state = { ...OPEN };
    server.markets.view = structuredClone(MARKET);
    socket.reset();
    useRealtime().reset();
    useMarkets().reset();
    useToasts().reset();
    usePeople().reset();
    useOverlay().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    stopWallet?.();
    stopWallet = null;
    useMarkets().reset();
    useWallet().reset();
    useSession().reset();
    useOverlay().reset();
    useLocale().setLocale('en');
});

describe('the way to a watched game\'s market', () =>
{
    it('says how long the market takes positions and what is in it, and opens it at a press', async () =>
    {
        const root = await door();
        const press = root.querySelector<HTMLButtonElement>('[data-market-door]');

        expect(press?.getAttribute('data-market-door')).toBe('open');
        expect(press?.textContent).toContain('Back a winner');
        expect(root.querySelector('[data-market-left]')?.textContent).toBe('1:30 left');
        expect(press?.textContent).toContain('40 NURA in the pool');

        press?.click();
        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.label)).toEqual(['Who wins?']), { timeout: 4000 });
    });

    it('stops counting at the close and goes on leading to the market', async () =>
    {
        const root = await door();

        clock.advance(91_000);
        await settle();

        expect(root.querySelector('[data-market-door]')?.getAttribute('data-market-door')).toBe('closed');
        expect(root.querySelector('[data-market-door]')?.textContent).toContain('The market');
        expect(root.querySelector('[data-market-left]')).toBeNull();
    });

    it('counts the same second as the sheet it opens, whenever each was drawn', async () =>
    {
        const root = await door();

        clock.advance(600);
        await settle();

        const { container: sheet } = renderTest(() => MarketSheet({ match: 'match-1', overlayId: 'market-sheet', close: () => undefined }) as unknown as HTMLElement);
        await settle();

        clock.advance(500);
        await settle();

        expect(root.querySelector('[data-market-left]')?.textContent).toBe('1:29 left');
        expect(sheet.querySelector('[data-market-when]')?.textContent).toBe('Taking positions for 1:29');
    });

    it('is drawn for nobody markets are not offered to and for no game without a market, and says where markets are turned off', async () =>
    {
        server.markets.state = { ...OPEN, may: 'market-minor' };
        let root = await door();

        expect(root.querySelector('[data-market-door]')).toBeNull();
        expect(server.calls.filter((call) => call.startsWith('markets.game'))).toEqual([]);

        cleanup();
        useMarkets().reset();
        server.markets.state = { ...OPEN };
        server.markets.view = null;
        root = await door();

        expect(root.querySelector('[data-market-door]')).toBeNull();
        expect(server.calls).toContain('markets.game match-1');

        cleanup();
        useMarkets().reset();
        server.markets.state = { open: false };
        server.markets.view = structuredClone(MARKET);
        server.calls.length = 0;
        root = await door();

        const off = root.querySelector('[data-market-door]');

        expect(off?.getAttribute('data-market-door')).toBe('off');
        expect(off?.textContent).toContain('Backing a winner is turned off right now');
        expect(server.calls.filter((call) => call.startsWith('markets.game')), 'a market was asked for where markets are turned off').toEqual([]);
    });

    it('keeps its node while the market is read again', async () =>
    {
        const root = await door();
        const press = root.querySelector('[data-market-door]');

        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        server.markets.view = { ...structuredClone(MARKET), pool: (41n * NURA).toString() };
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope: 'me', id: 'markets' });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(root.querySelector('[data-market-door]')?.textContent).toContain('41 NURA in the pool');
        expect(root.querySelector('[data-market-door]')).toBe(press);
    });
});

describe('the wallet page\'s markets', () =>
{
    it('lists what the reader backed and what each came to, a page at a time', async () =>
    {
        server.markets.positions = [
            position('won', { result: 'won', payout: (7n * NURA).toString(), claimableAt: '2026-10-28T12:05:00.000Z' }),
            position('lost', { outcome: 0, choice: { kind: 'seat', seat: 0, who: 'sara.k' }, result: 'lost' }),
            position('back', { result: 'refund', payout: (5n * NURA).toString() }),
            position('going', { state: 'sent' })
        ];

        const root = await positions();
        const rows = [...root.querySelectorAll('[data-position]')];

        expect(rows.map((row) => row.querySelector('[data-position-words]')?.textContent)).toEqual(['5 NURA on Reza', '5 NURA on Sara', '5 NURA on Reza', '5 NURA on Reza']);
        expect(rows.map((row) => row.getAttribute('data-result'))).toEqual(['won', 'lost', 'refund', '']);
        expect(rows[0].textContent).toContain('Won 7 NURA');
        expect(rows[0].querySelector('[data-claim-from]')?.textContent).toBe('Yours to claim in 5 minutes');
        expect(rows[1].textContent).toContain('Lost');
        expect(rows[2].textContent).toContain('5 NURA back');
        expect(rows[3].textContent).toContain('On its way');
        expect(rows[0].textContent).toContain('Chess, ');
    });

    it('reads each position in the page\'s direction, not in that of whatever opens it', async () =>
    {
        server.markets.positions = [position('won', { result: 'won', payout: (7n * NURA).toString(), choice: { kind: 'seat', seat: 1, who: '0xf39f…2266' } })];

        const english = await positions();

        expect(english.querySelector('[data-position-words]')?.getAttribute('dir')).toBe('ltr');

        cleanup();
        useMarkets().reset();
        useLocale().setLocale('fa');
        const persian = await positions();
        const words = persian.querySelector('[data-position-words]');

        expect(words?.textContent).toBe('۵ NURA روی 0xf39f…2266');
        expect(words?.getAttribute('dir'), 'a Persian sentence that opens with an amount and NURA is still read right to left').toBe('rtl');
    });

    it('never says a claim opens now while it cannot be made yet', async () =>
    {
        server.markets.positions = [position('won', { result: 'won', payout: (7n * NURA).toString(), claimableAt: '2026-10-28T12:00:00.300Z' })];

        const root = await positions();

        expect(root.querySelector('[data-claim-from]')?.textContent).toBe('Yours to claim in 1 second');
        expect(button(root, 'Claim 7 NURA')).toBeUndefined();
    });

    it('claims what can be claimed now, and the rest once its window has passed', async () =>
    {
        walletWith();
        server.markets.positions = [
            position('won', { result: 'won', payout: (7n * NURA).toString(), claimableAt: '2026-10-28T12:00:04.000Z' }),
            position('back', { result: 'refund', payout: (5n * NURA).toString() })
        ];

        const root = await positions();

        expect(button(root, 'Claim 5 NURA'), 'the stake back at once').toBeDefined();

        clock.advance(5000);
        await settle();

        expect(button(root, 'Claim 12 NURA'), 'and the winner beside it once its window has passed').toBeDefined();

        button(root, 'Claim 12 NURA')?.click();
        await settle();
        await settle();

        expect(server.calls).toContain('markets.claim won,back');

        settleClaim(['won', 'back'], true);
        clock.advance(SETTLE_MS);
        await settle();
        await settle();

        expect(root.querySelector('[data-claim-step="done"]')?.textContent).toBe('Claimed 12 NURA.');
        expect(button(root, 'Claim 12 NURA')).toBeUndefined();
    });

    it('says a claim is done with no amount where the server could not read what it paid', async () =>
    {
        walletWith();
        server.markets.positions = [position('won', { result: 'won', payout: (7n * NURA).toString(), claimableAt: '2026-10-28T11:59:00.000Z' })];

        const root = await positions();

        button(root, 'Claim 7 NURA')?.click();
        await settle();
        await settle();
        settleClaim(['won'], true, false);
        clock.advance(SETTLE_MS);
        await settle();
        await settle();

        expect(root.querySelector('[data-claim-step="done"]')?.textContent, 'never "Claimed 0 NURA."').toBe('Claimed');
    });

    it('offers a claim for each wallet that placed something, to that wallet', async () =>
    {
        server.markets.positions = [
            position('one', { result: 'refund', payout: (5n * NURA).toString() }),
            position('two', { result: 'refund', payout: (3n * NURA).toString(), address: OTHER })
        ];

        const root = await positions();

        expect([...root.querySelectorAll('[data-claim]')].map((one) => one.getAttribute('data-claim'))).toEqual([OWNER, OTHER]);
        expect(button(root, 'Claim 5 NURA to 0x71c7…976f')).toBeDefined();
        expect(button(root, 'Claim 3 NURA to 0x2b5a…d6cf')).toBeDefined();
    });

    it('says when there is nothing yet, and when the list could not be read, with a way to try again', async () =>
    {
        let root = await positions();

        expect(root.textContent).toContain('You have not backed a game yet.');

        cleanup();
        useMarkets().reset();
        server.markets.listRefuse = { status: 503, code: 'unavailable' };
        root = await positions();

        expect(root.textContent).toContain('Your positions could not be read.');
        expect(root.textContent).not.toContain('You have not backed a game yet.');
    });

    it('says markets are turned off where they are, and asks for nothing', async () =>
    {
        server.markets.state = { open: false };
        const root = await positions();

        expect(root.querySelector('[data-markets]')).toBeNull();
        expect(root.querySelector('[data-off="markets"]')?.textContent).toContain('Backing a winner is turned off right now');
        expect(server.calls.filter((call) => call.startsWith('markets.positions'))).toEqual([]);
    });
});

describe('the pages a market is reached from', () =>
{
    it('carry none of the market in their own chunks: only the wrappers\' import() reaches it', () =>
    {
        const MARKET_CODE = /\/market\/|markets\.store|market-catalogue|lib\/market/;

        for (const file of ['../src/pages/app/play.page.azeroth', '../src/pages/app/wallet.page.azeroth'])
        {
            const statics = [...SOURCES[file].matchAll(/^import (?:[^;]*? from )?'([^']+)';$/gm)].map((match) => match[1]);

            expect(statics.filter((path) => MARKET_CODE.test(path) && !/lazy-market-(door|positions)/.test(path)), file).toEqual([]);
        }

        expect(SOURCES['../src/components/games/lazy-market-door.component.azeroth']).toContain('import(\'../market/market-door.component.azeroth\')');
        expect(SOURCES['../src/components/market/lazy-market-positions.component.azeroth']).toContain('import(\'./market-positions.component.azeroth\')');
    });

    it('show the door to somebody watching a public game played live, and on the finished game they still see', () =>
    {
        expect(SOURCES['../src/pages/app/play.page.azeroth']).toContain([
            'derived backable = watching && table !== null && table.privacy === \'public\' && table.mode === \'live\'',
            '        ? table.matchId ?? (spectated?.match.tableId === table.id ? spectated.match.id : null)',
            '        : null;'
        ].join('\n'));
    });
});

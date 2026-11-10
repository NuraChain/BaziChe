import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter } from 'azerothjs';

import { MAX_STAKE_WEI } from '../../backend/src/domains/stake/policy.ts';
import CreateGameForm from '../src/components/games/create-game-form.component.azeroth';
import LobbyPanel from '../src/components/games/lobby-panel.component.azeroth';
import QuickFinder from '../src/components/games/quick-finder.component.azeroth';
import { GAMES, type GameId } from '../src/data/games.ts';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVault } from '../src/stores/vault.store.ts';
import type { TableSummary } from '../src/api.ts';
import type { VaultState } from '../../backend/src/schemas.ts';
import { ApiError, client, nuraState, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const WEI = 10n ** 18n;
const TEN = (10n * WEI).toString();
const HUNDRED = (100n * WEI).toString();
const RUNG = (5_000n * WEI).toString();
const SIGNED = `0x${ 'cd'.repeat(65) }`;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const vaultWith = async (change: Partial<Extract<VaultState, { configured: true }>> | null) =>
{
    server.nura.state = change === null ? { configured: false } : { ...nuraState(), ...change } as VaultState;
    await useVault().refresh();
    await settle();
};

const gameOf = (id: GameId) => GAMES.find((one) => one.id === id)!;

const routed = (component: () => HTMLElement) =>
{
    const router = createRouter({
        routes: [
            { path: '/', component },
            { path: '/app/play/:id', component: () => document.createElement('div') },
            { path: '/app/me/wallet', component: () => document.createElement('div') }
        ],
        history: createMemoryHistory('/'),
        scroll: false
    });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    return { container, router };
};

const group = (container: HTMLElement, legend: string) =>
    [...container.querySelectorAll<HTMLFieldSetElement>('fieldset')].find((one) => one.querySelector('legend')?.textContent?.trim() === legend) ?? null;

const offered = (container: HTMLElement, legend: string) =>
    [...(group(container, legend)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((one) => one.textContent?.trim() ?? '');

const chosen = (container: HTMLElement, legend: string) =>
    [...(group(container, legend)?.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]') ?? [])].map((one) => one.textContent?.trim() ?? '');

const press = async (container: HTMLElement, legend: string, name: string) =>
{
    const button = [...(group(container, legend)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((one) => one.textContent?.trim() === name);

    expect(button, `${ legend }: ${ name }`).toBeDefined();
    fire(button!, 'click');
    await settle();
};

const button = (container: ParentNode, label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label);

const toasts = () => useToasts().items().map((one) => one.text);

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(2_000_000), seed: 5 });
    server.reset();
    useCatalogue().reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useSettings().reset();
    useLobby().reset();
    useToasts().reset();
    useVault().reset();
    await vaultWith({});
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useLobby().reset();
    useToasts().reset();
    useSettings().reset();
    useRealtime().reset();
    useLocale().setLocale('en');
});

describe('a table opened at a stake', () =>
{
    const form = (game: GameId = 'ludo') => routed(() => CreateGameForm({ game: gameOf(game), onCreated: () => undefined }) as unknown as HTMLElement);

    const submit = async (container: HTMLElement) =>
    {
        fire(container.querySelector<HTMLFormElement>('form')!, 'submit');
        await settle();
    };

    /** Chooses an amount of one's own and types it, as a reader would. */
    const stake = async (container: HTMLElement, amount: string, legend = 'Played for', custom = 'Custom') =>
    {
        await press(container, legend, custom);

        const field = container.querySelector<HTMLInputElement>('#create-stake-amount');

        expect(field, 'no amount to type into').not.toBeNull();
        field!.value = amount;
        fire(field!, 'input');
        await settle();
    };

    const PER_DOLLAR = (100n * WEI).toString();

    it('offers a free table, the dollar shortcuts at the staff\'s rate and an amount of one\'s own, with free chosen', async () =>
    {
        await vaultWith({ maxStake: MAX_STAKE_WEI.toString(), usd: PER_DOLLAR });
        const { container } = form();
        await settle();

        expect(offered(container, 'Played for')).toEqual(['Free', '≈ $1 · 100 NURA', '≈ $3 · 300 NURA', '≈ $10 · 1,000 NURA', 'Custom']);
        expect(chosen(container, 'Played for')).toEqual(['Free']);

        await press(container, 'Played for', '≈ $3 · 300 NURA');
        await submit(container);

        expect(server.tables.at(-1)?.stake, 'the amount signed for is NURA, never dollars').toBe((300n * WEI).toString());
    });

    it('offers no shortcuts until the staff say what a dollar is, and none under 100 NURA or past the vault\'s ceiling', async () =>
    {
        const { container } = form();
        await settle();

        expect(offered(container, 'Played for')).toEqual(['Free', 'Custom']);

        cleanup();
        await vaultWith({ usd: (50n * WEI).toString(), maxStake: (200n * WEI).toString() });
        const capped = form();
        await settle();

        expect(offered(capped.container, 'Played for')).toEqual(['Free', '≈ $3 · 150 NURA', 'Custom']);
    });

    it('opens a table at any amount typed from 100 NURA, off every ladder, and refuses one under it, finer than four places or past the vault', async () =>
    {
        const { container } = form();
        await settle();

        await stake(container, '250.5');
        await submit(container);

        expect(server.tables.at(-1)?.stake).toBe((2505n * WEI / 10n).toString());

        const opened = server.tables.length;

        await stake(container, '99.9999');

        expect(container.textContent).toContain('Write an amount from 100 to 1,000 NURA, to four places at most.');

        await submit(container);

        expect(server.tables).toHaveLength(opened);

        await stake(container, '5000');

        expect(container.textContent).toContain('Write an amount from 100 to 1,000 NURA, to four places at most.');

        await stake(container, '100.00001');

        expect(container.textContent).toContain('Write an amount from 100 to 1,000 NURA, to four places at most.');
    });

    it('takes the fee of the game being opened when it has one of its own', async () =>
    {
        await vaultWith({ games: { ludo: 1000, hokm: 300 } });
        const { container } = form();
        await settle();

        await press(container, 'Seats', '2 players');
        await stake(container, '100');

        expect(container.textContent).toContain('The pot is 200 NURA. A 20 NURA fee comes out of it and the winner takes 180 NURA.');
    });

    it('says what the pot comes to and what the winner takes, alone and as a pair, and opens the table at that stake', async () =>
    {
        const { container } = form();
        await settle();

        await press(container, 'Seats', '2 players');
        await stake(container, '100');

        expect(container.textContent).toContain('The pot is 200 NURA. A 10 NURA fee comes out of it and the winner takes 190 NURA.');

        await press(container, 'Seats', '2 v 2');

        expect(container.textContent).toContain('The pot is 400 NURA. A 20 NURA fee comes out of it and each of the winning pair takes 190 NURA.');

        await submit(container);

        expect(server.tables.at(-1)?.stake).toBe(HUNDRED);
    });

    it('opens a free table with no stake at all', async () =>
    {
        const { container } = form();
        await settle();
        await submit(container);

        expect(server.tables.at(-1)).toBeDefined();
        expect(server.tables.at(-1)).not.toHaveProperty('stake');
    });

    it('offers no stake at a turn-based table, and opens one with none whatever was chosen while it was live', async () =>
    {
        const { container } = form();
        await settle();

        await stake(container, '100');
        fire(button(container, 'Turn-based')!, 'click');
        await settle();

        expect(group(container, 'Played for')).toBeNull();

        await submit(container);

        expect(server.tables.at(-1)).not.toHaveProperty('stake');
    });

    it('says when the vault holds less than the stake, and where to put more in', async () =>
    {
        await vaultWith({ balances: { address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', free: (150n * WEI).toString(), locked: '0', wallet: '0' } });
        const { container } = form();
        await settle();

        expect(container.querySelector('a[href="/app/me/wallet"]')).toBeNull();

        await stake(container, '200');

        expect(container.textContent).toContain('You have 150 NURA free in the vault, less than the stake.');
        expect(container.querySelector('a[href="/app/me/wallet"]')?.textContent).toBe('Your NURA');

        await stake(container, '100');

        expect(container.textContent).not.toContain('less than the stake');
        expect(container.querySelector('a[href="/app/me/wallet"]')).toBeNull();
    });

    it('shows a reader who may not play for NURA the stakes they cannot choose, and why', async () =>
    {
        await vaultWith({ may: 'paid-terms' });
        const { container } = form();
        await settle();

        const stakes = [...group(container, 'Played for')!.querySelectorAll<HTMLButtonElement>('button')];

        expect(stakes.slice(1).every((one) => one.disabled)).toBe(true);
        expect(container.textContent).toContain('Accept the terms of playing for NURA first.');
        expect(container.querySelector('a[href="/app/me/wallet"]')).not.toBeNull();

        await submit(container);

        expect(server.tables.at(-1)).not.toHaveProperty('stake');
    });

    it('offers every stake and none of them where the server keeps no vault, and says why', async () =>
    {
        await vaultWith(null);
        const { container } = form();
        await settle();

        const played = group(container, 'Played for');

        expect(chosen(container, 'Played for')).toEqual(['Free']);
        expect(offered(container, 'Played for')).toEqual(['Free', 'Custom']);
        expect([...played!.querySelectorAll<HTMLButtonElement>('button')].filter((one) => !one.disabled).map((one) => one.textContent?.trim()), 'a stake was offered where nothing can be staked').toEqual(['Free']);
        expect(played?.querySelector('[data-off="paid"]')?.textContent).toContain('Playing for NURA is turned off right now');
    });

    it('says what the chips are at a poker table played for NURA', async () =>
    {
        const { container } = form('poker');
        await settle();

        expect(container.textContent).toContain(useLocale().t('games.stakes.playMoneyHint'));

        await stake(container, '100');

        expect(container.textContent).toContain('The chips only keep the score. The table is played for its stake in NURA.');
        expect(container.textContent).not.toContain(useLocale().t('games.stakes.playMoneyHint'));
    });

    it('says the pot in Persian, in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const { container } = form();
        await settle();
        const locale = useLocale();

        await press(container, locale.t('create.seats'), locale.plural('common.players', 2));
        await stake(container, '۱۰۰', locale.t('create.stake'), locale.t('create.stake.custom'));

        expect(container.textContent).toContain('کل پات می‌شه ۲۰۰ NURA. ۱۰ NURA کارمزد ازش کم می‌شه و برنده ۱۹۰ NURA می‌بره.');
    });
});

describe('quick play at a stake', () =>
{
    const finder = (game: GameId = 'ludo') =>
    {
        const closed: unknown[] = [];
        const opened = routed(() => QuickFinder({ overlayId: 'quick-finder', close: (result?: unknown) => closed.push(result), game }) as unknown as HTMLElement);

        return { ...opened, closed };
    };

    const find = (container: HTMLElement) => button(container, useLocale().t('quickMatch.find'))!;

    it('asks the wallet to sign the stake first, then looks only at that stake with the signature', async () =>
    {
        const sign = vi.spyOn(useVault(), 'signSearch').mockResolvedValue({ signature: SIGNED });
        const { container, router } = finder();
        await settle();

        await press(container, 'Played for', '5,000 NURA');

        expect(container.textContent).toContain(useLocale().t('quickMatch.stakeHint'));

        fire(find(container), 'click');
        await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//));

        expect(sign).toHaveBeenCalledWith('ludo', RUNG);
        expect(server.sought.at(-1)).toMatchObject({ game: 'ludo', stake: RUNG, signature: SIGNED });
        expect(server.tables.at(-1)?.stake).toBe(RUNG);
    });

    it('looks for nothing when the wallet would not sign, says why, and can be asked again', async () =>
    {
        vi.spyOn(useVault(), 'signSearch').mockResolvedValue({ said: 'vault.rejected' });
        const { container } = finder();
        await settle();

        await press(container, 'Played for', '5,000 NURA');
        fire(find(container), 'click');
        await settle();

        expect(server.calls).not.toContain('tables.quick');
        expect(toasts()).toContain('You declined it in your wallet, so nothing changed.');
        expect(find(container).getAttribute('aria-busy')).not.toBe('true');
    });

    it('says why the server would not seat a search at a stake, in its own words', async () =>
    {
        vi.spyOn(useVault(), 'signSearch').mockResolvedValue({ signature: SIGNED });
        vi.spyOn(client.tables, 'quick').mockRejectedValue(new ApiError(409, 'paid-funds', 'There is not that much NURA free in the vault.', undefined));
        const { container, router } = finder();
        await settle();

        await press(container, 'Played for', '5,000 NURA');
        fire(find(container), 'click');
        await settle();

        expect(toasts()).toContain('There is not that much NURA free in your vault balance.');
        expect(router.location().pathname).toBe('/');
    });

    it('looks for a free table with no stake and asks the wallet nothing', async () =>
    {
        const sign = vi.spyOn(useVault(), 'signSearch');
        const { container, router } = finder();
        await settle();

        fire(find(container), 'click');
        await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//));

        expect(sign).not.toHaveBeenCalled();
        expect(server.sought.at(-1)).not.toHaveProperty('stake');
        expect(server.sought.at(-1)).not.toHaveProperty('signature');
    });

    it('offers no stake for a turn-based search or to somebody on a break, and none to press where the server keeps no vault', async () =>
    {
        const first = finder();
        await settle();

        expect(group(first.container, 'Played for')).not.toBeNull();

        fire(button(first.container, 'Turn-based')!, 'click');
        await settle();

        expect(group(first.container, 'Played for')).toBeNull();

        cleanup();
        await vaultWith({ may: 'paid-break' });
        const second = finder();
        await settle();

        expect(group(second.container, 'Played for')).toBeNull();

        cleanup();
        await vaultWith(null);
        const third = finder();
        await settle();

        const played = group(third.container, 'Played for');

        expect(played?.querySelector('[data-off="paid"]')?.textContent).toContain('Playing for NURA is turned off right now');
        expect([...played!.querySelectorAll<HTMLButtonElement>('button')].filter((one) => !one.disabled).map((one) => one.textContent?.trim()), 'a stake was offered where nothing can be staked').toEqual(['Free']);
    });
});

describe('saying ready at a table played for NURA', () =>
{
    const paidTable = async (paid = true) =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 2, teams: false, ...(paid ? { stake: TEN } : {}) }, []);
        const held = server.tables.find((one) => one.id === id)!;

        held.chairs[1].who = 'sara.k';
        held.chairs[1].ready = true;

        return { id, held };
    };

    const shown = (table: TableSummary) =>
        renderTest(() => LobbyPanel({ table, onInvite: () => undefined, onCopyLink: () => undefined, onLeave: () => undefined }) as HTMLElement).container;

    const summaryOf = (held: { id: string }) => structuredClone(server.tables.find((one) => one.id === held.id)!) as unknown as TableSummary;

    it('asks the wallet to sign the stake, then says ready with the signature and starts nothing', async () =>
    {
        const sign = vi.spyOn(useVault(), 'signStake').mockResolvedValue({ signature: SIGNED });
        const { id, held } = await paidTable();
        const container = shown({ ...summaryOf(held), mine: 0 });
        server.calls = [];

        fire(button(container, 'I’m ready')!, 'click');
        await vi.waitFor(() => expect(held.chairs[0].ready).toBe(true));

        expect(sign).toHaveBeenCalledWith(id);
        expect(server.nura.signatures).toContain(SIGNED);
        expect(server.calls).not.toContain('tables.start');
    });

    it('says nothing ready when the wallet would not sign, and says why', async () =>
    {
        vi.spyOn(useVault(), 'signStake').mockResolvedValue({ said: 'vault.wrongAccount' });
        const { held } = await paidTable();
        const container = shown({ ...summaryOf(held), mine: 0 });
        server.calls = [];

        fire(button(container, 'I’m ready')!, 'click');
        await settle();

        expect(server.calls).not.toContain('tables.ready');
        expect(held.chairs[0].ready).toBe(false);
        expect(toasts()).toContain('Your wallet is on another account. Switch it to the one you signed in with.');
    });

    it('takes a ready back without asking the wallet anything', async () =>
    {
        const sign = vi.spyOn(useVault(), 'signStake');
        const { held } = await paidTable();
        held.chairs[0].ready = true;
        const container = shown({ ...summaryOf(held), mine: 0 });

        fire(button(container, 'Ready')!, 'click');
        await vi.waitFor(() => expect(held.chairs[0].ready).toBe(false));

        expect(sign).not.toHaveBeenCalled();
        expect(server.nura.signatures.at(-1)).toBeUndefined();
    });

    it('says ready at a free table without the wallet, as it always did', async () =>
    {
        const sign = vi.spyOn(useVault(), 'signStake');
        const { held } = await paidTable(false);
        const container = shown({ ...summaryOf(held), mine: 0 });

        fire(button(container, 'I’m ready')!, 'click');
        await vi.waitFor(() => expect(held.chairs[0].ready).toBe(true));

        expect(sign).not.toHaveBeenCalled();
    });

    it('plays again with the next game\'s signature, and leaves starting it to the lock', async () =>
    {
        const { id, held } = await paidTable();
        server.calls = [];

        await useLobby().again(id, undefined, SIGNED);

        expect(server.nura.signatures).toContain(SIGNED);
        expect(held.chairs[0].ready).toBe(true);
        expect(server.calls).not.toContain('tables.start');
    });
});

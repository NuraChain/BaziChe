import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import { CHECKS_PAGE } from '../../backend/src/domains/reconcile/kinds.ts';
import type { AdminCheck } from '../../backend/src/schemas.ts';
import ReasonSheet from '../src/components/admin/reason-sheet.component.azeroth';
import ChecksPage from '../src/pages/admin/checks.page.azeroth';
import MoneyPage from '../src/pages/admin/money.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'owner' as const };

const NURA = 10n ** 18n;

const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const opened = async (at = '/admin/money/checks') =>
{
    const routes: Route[] = [
        { path: '/admin/money/checks', component: () => ChecksPage({}) as unknown as HTMLElement },
        { path: '/admin/:other', component: () => document.createElement('div') }
    ];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return { router, container };
};

const text = (root: ParentNode | null | undefined) => root?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const rowOf = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-checks] [data-check="${ id }"]`);

const listed = (root: ParentNode) => [...root.querySelectorAll('[data-checks] [data-check]')].map((one) => one.getAttribute('data-check'));

const facts = (root: ParentNode | null, selector: string) => [...root?.querySelectorAll(`${ selector } > span`) ?? []].map(text);

const ltr = (root: ParentNode | null, selector: string) => [...root?.querySelectorAll(`${ selector } [dir="ltr"]`) ?? []].map((one) => one.textContent);

const empties = (root: ParentNode) => [...root.querySelectorAll('[data-empty] p')].map(text);

const chip = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find((one) => one.textContent?.trim().startsWith(label))!;

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const answered = async (reason: string | null) =>
{
    useOverlay().close(asked().id, reason);
    await settle();
};

const toasts = () => useToasts().items().map((one) => one.text);

const check = (id: string, over: Partial<AdminCheck>): AdminCheck => ({
    id,
    family: 'escrow',
    record: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    kind: 'escrow-state',
    db: { state: 'settled' },
    chain: { state: 'refunded' },
    about: { game: 'ludo', amount: (10n * NURA).toString(), who: 'sara.k, reza.t' },
    firstSeen: minutesAgo(30),
    lastSeen: minutesAgo(1),
    ...over
});

const found = () =>
{
    server.checks.rows = [
        check('c-escrow', { firstSeen: minutesAgo(40) }),
        check('c-gift', {
            family: 'donation',
            record: '9b2c1a7e-0f3d-4c4e-8a5b-6d7e8f901234',
            kind: 'donation-gift',
            db: { amount: (5n * NURA).toString(), address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' },
            chain: { amount: (9n * NURA).toString(), address: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' },
            about: { game: 'hokm', amount: (5n * NURA).toString(), who: 'mina', to: 'sara.k' },
            firstSeen: minutesAgo(20)
        }),
        check('c-vault', {
            family: 'contract',
            record: 'vault',
            kind: 'solvency',
            db: {},
            chain: { held: (90n * NURA).toString(), owed: (100n * NURA).toString() },
            about: {},
            firstSeen: minutesAgo(10)
        }),
        check('c-put', {
            family: 'order',
            record: '1c6f8e2a-4b3d-4e5f-9a8b-7c6d5e4f3a2b',
            kind: 'order-state',
            db: { state: 'expired' },
            chain: { state: 'sold' },
            about: { item: 'glow.dice', amount: (12n * NURA).toString(), who: 'reza.t' },
            firstSeen: minutesAgo(50),
            lastSeen: minutesAgo(50),
            resolvedAt: minutesAgo(50),
            resolution: 'put-right'
        })
    ];
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish(ALEX);
    useToasts().dismissAll();
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the checks against NuraChain', () =>
{
    it('lists the open disagreements newest first, each with what it is about, what each side says and when it was first and last seen', async () =>
    {
        found();
        const { container } = await opened();

        expect(text(container.querySelector('h1'))).toBe('Checks against NuraChain');
        expect(container.querySelector('[data-back]')?.getAttribute('href')).toBe('/admin/money');
        expect(listed(container)).toEqual(['c-vault', 'c-gift', 'c-escrow']);
        expect(chip(container, 'Open').getAttribute('aria-pressed')).toBe('true');
        expect(text(chip(container, 'Open'))).toBe('Open3');

        const escrow = rowOf(container, 'c-escrow');

        expect(text(escrow?.querySelector('[data-headline]'))).toBe('The vault holds this paid game in another state.');
        expect(facts(escrow, '[data-about]')).toEqual(['Paid game', 'Ludo', '10 NURA a seat', 'sara.k, reza.t', '#3fa85f64']);
        expect(ltr(escrow, '[data-about]')).toEqual(['sara.k, reza.t', '#3fa85f64']);
        expect(facts(escrow, '[data-side="db"] dd')).toEqual(['Paid out']);
        expect(facts(escrow, '[data-side="chain"] dd')).toEqual(['Given back']);
        expect(facts(escrow, '[data-seen]')).toEqual(['First seen 40 minutes ago', 'Last seen 1 minute ago']);
        expect(escrow?.querySelector('[data-seen] time')?.getAttribute('datetime')).toBe(minutesAgo(40));

        const gift = rowOf(container, 'c-gift');

        expect(text(gift?.querySelector('[data-headline]'))).toBe('The gifts contract holds another gift under this one’s id.');
        expect(facts(gift, '[data-about]')).toEqual(['Gift', 'Hokm', '5 NURA', 'mina to sara.k', '#9b2c1a7e']);
        expect(facts(gift, '[data-side="db"] dd')).toEqual(['5 NURA', 'to 0x7099…79c8']);
        expect(facts(gift, '[data-side="chain"] dd')).toEqual(['9 NURA', 'to 0x3c44…93bc']);
        expect(ltr(gift, '[data-side="chain"]')).toEqual(['0x3c44…93bc']);

        const books = rowOf(container, 'c-vault');

        expect(text(books?.querySelector('[data-headline]'))).toBe('The vault holds less than it owes.');
        expect(facts(books, '[data-about]')).toEqual(['Contract']);
        expect(books?.querySelector('[data-side="db"]'), 'the database says nothing of a contract\'s coin').toBeNull();
        expect(facts(books, '[data-side="chain"] dd')).toEqual(['holds 90 NURA', 'owes 100 NURA']);
        expect([...container.querySelectorAll('[data-checks] button')].map(text)).toEqual(['Close', 'Close', 'Close']);
        expect([...container.querySelectorAll('[data-checks] button')].map((one) => one.getAttribute('aria-label')), 'each names the one it closes').toEqual([
            'Close this disagreement: The vault holds less than it owes.',
            'Close this disagreement: The gifts contract holds another gift under this one’s id. #9b2c1a7e',
            'Close this disagreement: The vault holds this paid game in another state. #3fa85f64'
        ]);
    });

    it('says when it last checked and what it checks, and leads a closed one with how it ended', async () =>
    {
        found();
        server.checks.checkedAt = minutesAgo(2);
        const { container } = await opened('/admin/money/checks?list=closed');

        expect(facts(container, '[data-checked]')).toEqual(['Last checked 2 minutes ago', 'Checks paid games, shop orders, gifts, markets, positions in markets, and the contracts’ books.']);
        expect(listed(container)).toEqual(['c-put']);
        expect(chip(container, 'Closed').getAttribute('aria-pressed')).toBe('true');

        const put = rowOf(container, 'c-put');

        expect(facts(put, '[data-resolved] p.facts')).toEqual(['Put right from NuraChain', '50 minutes ago']);
        expect(text(put?.querySelector('[data-resolved] time'))).toBe('50 minutes ago');
        expect(facts(put, '[data-about]')).toEqual(['Shop order', 'look glow.dice', '12 NURA', 'reza.t', '#1c6f8e2a']);
        expect(facts(put, '[data-side="db"] dd')).toEqual(['Ran out']);
        expect(facts(put, '[data-side="chain"] dd')).toEqual(['Sold']);
        expect(put?.querySelector('button'), 'a closed one cannot be closed again').toBeNull();
    });

    it('keeps the list it shows in the address, open never written', async () =>
    {
        found();
        const { router, container } = await opened();

        chip(container, 'All').click();
        await settle();

        expect(router.location().search).toBe('?list=all');
        expect(listed(container)).toEqual(['c-vault', 'c-gift', 'c-escrow', 'c-put']);

        chip(container, 'Open').click();
        await settle();

        expect(router.location().search).toBe('');
        expect(server.calls.filter((call) => call.startsWith('admin.checks'))).toEqual(['admin.checks {}', 'admin.checks {"list":"all"}', 'admin.checks {}']);
    });

    it('asks why before it closes one, and closes nothing when the reader thinks better of it', async () =>
    {
        found();
        const { container } = await opened();

        rowOf(container, 'c-escrow')!.querySelector<HTMLButtonElement>('button')!.click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'Close this disagreement?',
            lead: 'Closing it says somebody looked into it. It stays closed while both sides say what they say now, and opens again if either changes.',
            confirm: 'Close it'
        });
        expect((asked().props as { destructive?: boolean }).destructive).toBeUndefined();

        await answered(null);

        expect(listed(container)).toEqual(['c-vault', 'c-gift', 'c-escrow']);
        expect(server.calls.filter((call) => call.startsWith('admin.closeCheck'))).toEqual([]);
    });

    it('takes a closed one off the open list at the press, says so once the server has, and logs it', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'closeCheck');

        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.closeCheck(request);
        });

        found();
        const { container } = await opened();
        const kept = rowOf(container, 'c-gift');

        rowOf(container, 'c-escrow')!.querySelector<HTMLButtonElement>('button')!.click();
        await settle();
        await answered('The vault paid it back on purpose');

        expect(sent).toHaveBeenCalledWith({ params: { id: 'c-escrow' }, input: { reason: 'The vault paid it back on purpose' } });
        expect(listed(container)).toEqual(['c-vault', 'c-gift']);
        expect(text(chip(container, 'Open'))).toBe('Open2');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['The disagreement is closed.']);
        expect(listed(container)).toEqual(['c-vault', 'c-gift']);
        expect(rowOf(container, 'c-gift'), 'a row the close did not touch is the row it was').toBe(kept);
        expect(server.staff.log.map((one) => [one.kind, one.staff, one.reason, one.details])).toEqual([['check', 'alex', 'The vault paid it back on purpose', { check: 'c-escrow', family: 'escrow', record: '3fa85f64-5717-4562-b3fc-2c963f66afa6', kind: 'escrow-state' }]]);
    });

    it('shows a closed one as closed at the press on the list of all, with who closed it and why', async () =>
    {
        let answer: () => void = () => undefined;

        vi.spyOn(client.admin, 'closeCheck').mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.closeCheck(request);
        });

        found();
        const { container } = await opened('/admin/money/checks?list=all');

        rowOf(container, 'c-gift')!.querySelector<HTMLButtonElement>('button')!.click();
        await settle();
        await answered('Mina sent it to herself');

        const closedBy = () =>
        {
            const gift = rowOf(container, 'c-gift');

            return {
                how: text(gift?.querySelector('[data-resolved] .font-semibold')),
                who: ltr(gift, '[data-resolved]'),
                why: text(gift?.querySelector('[data-reason]')),
                closable: gift?.querySelector('button') !== null
            };
        };
        const closed = { how: 'Closed by alex', who: ['alex'], why: 'Mina sent it to herself', closable: false };

        expect(closedBy(), 'at the press').toEqual(closed);
        expect(text(chip(container, 'Open'))).toBe('Open2');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(closedBy(), 'once the server has').toEqual(closed);
        expect(toasts()).toEqual(['The disagreement is closed.']);
    });

    it('brings a refused close back in the reader\'s words, and reads the list again', async () =>
    {
        found();
        const { container } = await opened();

        vi.spyOn(client.admin, 'closeCheck').mockRejectedValueOnce(new ApiError(409, 'staff-check-closed', 'That disagreement has already been closed.', undefined));
        rowOf(container, 'c-escrow')!.querySelector<HTMLButtonElement>('button')!.click();
        await settle();
        await answered('Looked at it');

        expect(toasts()).toEqual(['That disagreement has already been closed.']);
        expect(listed(container)).toEqual(['c-vault', 'c-gift', 'c-escrow']);
        expect(server.calls.filter((call) => call === 'admin.checks {}')).toHaveLength(2);
    });

    it('says the two agree when nothing is open, that nothing is listed yet elsewhere, and that a server with no contract checks nothing', async () =>
    {
        const { container } = await opened();

        expect(empties(container)).toEqual(['NuraChain and this server agree.', 'Nothing is waiting for a person.']);
        expect(text(container.querySelector('[data-checked]'))).toContain('Not checked yet since this server started.');
        cleanup();

        const closed = await opened('/admin/money/checks?list=closed');

        expect(empties(closed.container)).toEqual(['Nothing here yet.']);
        cleanup();

        server.checks.watching = [];
        const off = await opened();

        expect(empties(off.container)).toEqual(['This server keeps no contract to check against.', 'Paid tables, the shop, gifts and markets are each checked once their contract is set in the server’s .env.']);
        expect([off.container.querySelector('[aria-pressed]'), off.container.querySelector('[data-checked]')]).toEqual([null, null]);
    });

    it('is reached from the head of Money', async () =>
    {
        const routes: Route[] = [{ path: '/admin/money', component: () => MoneyPage({}) as unknown as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/admin/money'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await settle();

        const way = container.querySelector('[data-open-checks]');

        expect(way?.getAttribute('href')).toBe('/admin/money/checks');
        expect(text(way)).toBe('Checks against NuraChain');
    });

    it('reads older ones a page at a time', async () =>
    {
        server.checks.rows = Array.from({ length: CHECKS_PAGE + 3 }, (_, at) => check(`c${ String(at).padStart(3, '0') }`, { firstSeen: minutesAgo(at + 1) }));
        const { container } = await opened();

        expect(listed(container)).toHaveLength(CHECKS_PAGE);

        [...container.querySelectorAll('button')].find((one) => text(one) === 'Show older')!.click();
        await settle();

        expect(listed(container)).toHaveLength(CHECKS_PAGE + 3);
        expect(new Set(listed(container)).size).toBe(CHECKS_PAGE + 3);
    });

    it('says what the checks could not be read, and reads them at a press', async () =>
    {
        found();
        vi.spyOn(client.admin, 'checks').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down.', undefined));
        const { container } = await opened();

        expect(container.textContent).toContain('The checks could not be read.');

        [...container.querySelectorAll('button')].find((one) => text(one) === 'Try again')!.click();
        await settle();

        expect(listed(container)).toEqual(['c-vault', 'c-gift', 'c-escrow']);
    });

    it('says it in Persian, a handle and an address running left to right', async () =>
    {
        useLocale().setLocale('fa');
        found();
        const { container } = await opened();

        expect(text(container.querySelector('h1'))).toBe('بررسی با نوراچین');
        expect(text(rowOf(container, 'c-escrow')?.querySelector('[data-headline]'))).toBe('صندوق این بازی پولی رو توی یه وضعیت دیگه نگه داشته.');
        expect(facts(rowOf(container, 'c-escrow'), '[data-side="db"] dd')).toEqual(['پرداخت شده']);
        expect(facts(rowOf(container, 'c-escrow'), '[data-side="chain"] dd')).toEqual(['برگشت خورده']);
        expect(facts(rowOf(container, 'c-escrow'), '[data-about]')).toEqual(['بازی پولی', 'منچ', 'هر صندلی ۱۰ NURA', 'sara.k, reza.t', '#3fa85f64']);
        expect(facts(rowOf(container, 'c-vault'), '[data-side="chain"] dd')).toEqual(['۹۰ NURA داره', '۱۰۰ NURA بدهکاره']);
        expect(ltr(rowOf(container, 'c-gift'), '[data-side="db"]')).toEqual(['0x7099…79c8']);
        expect(text(chip(container, 'باز'))).toBe('باز۳');
    });
});

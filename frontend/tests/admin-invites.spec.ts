import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import CampaignSheet from '../src/components/admin/campaign-sheet.component.azeroth';
import ReasonSheet from '../src/components/admin/reason-sheet.component.azeroth';
import InvitesPage from '../src/pages/admin/invites.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { AdminCampaignInput, AdminInviteCampaign, AdminInviteReward } from '../../backend/src/schemas.ts';
import { INVITES_PAGE } from '../../backend/src/domains/admin/roles.ts';
import { ApiError, client, server, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-30T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'owner' as const };

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const mounted = async (at = '/admin/invites') =>
{
    const routes: Route[] = [{ path: '/admin/invites', component: () => InvitesPage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return { router, container };
};

const opened = async (at = '/admin/invites') => (await mounted(at)).container;

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

/** Each row of chips on the page, in order, as each chip's words with its count run together and whether it is pressed. */
const barChips = (root: ParentNode) => [...root.querySelectorAll('[role="group"]')]
    .map((bar) => [...bar.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].map((one) => [one.textContent?.replace(/\s+/g, '') ?? '', one.getAttribute('aria-pressed') ?? '']))
    .filter((bar) => bar.length > 0);

const chip = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((one) => one.textContent?.trim().startsWith(label))!;

const button = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label);

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const answered = async (value: unknown) =>
{
    useOverlay().close(asked().id, value);
    await settle();
};

const toasts = () => useToasts().items().map((one) => one.text);

const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const held = () =>
{
    let release: () => void = () => undefined;

    server.invitesAdmin.hold = new Promise<void>((resolve) => release = resolve);
    return async () =>
    {
        server.invitesAdmin.hold = null;
        release();
        await settle();
    };
};

const funnel = (visits: number, joined: number, played: number, flagged: number, given = 0, review = 0, refused = 0, taken = 0) => ({ visits, joined, played, flagged, given, review, refused, taken });

const daysOf = (counts: number[]) => counts.map((visits, at) => ({
    day: new Date(NOW - (counts.length - 1 - at) * 86_400_000).toISOString().slice(0, 10),
    visits,
    joined: Math.floor(visits / 2),
    played: Math.floor(visits / 3)
}));

const campaignOf = (id: string, change: Partial<AdminInviteCampaign> = {}): AdminInviteCampaign => ({
    id,
    name: `Campaign ${ id }`,
    state: 'draft',
    inviterItem: 'dice.storm',
    milestones: [],
    review: false,
    at: minutesAgo(90),
    by: 'alex',
    running: false,
    gave: false,
    joined: 0,
    played: 0,
    given: 0,
    waiting: 0,
    refused: 0,
    taken: 0,
    ...change
});

const FACES: Record<string, { displayName: string; hue: number }> = {
    'alex': { displayName: 'Alex Morgan', hue: 32 },
    'sara.k': { displayName: 'Sara Kamali', hue: 340 },
    'nima.f': { displayName: 'Nima Farahani', hue: 150 },
    'reza.t': { displayName: 'Reza Tehrani', hue: 18 },
    'mina': { displayName: 'Mina Sadeghi', hue: 280 }
};

const face = (handle: string) => ({ handle, ...FACES[handle] });

const rewardOf = (id: string, change: Partial<AdminInviteReward> = {}): AdminInviteReward => ({
    id,
    kind: 'inviter',
    item: 'dice.storm',
    state: 'review',
    at: minutesAgo(5),
    campaign: { id: 'c1', name: 'Spring friends' },
    person: { ...face('sara.k'), suspended: false },
    friend: face('nima.f'),
    ...change
});

const campaignRows = (root: ParentNode) => [...root.querySelectorAll('[data-campaign]')].map((one) => one.getAttribute('data-campaign'));

const campaignRow = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-campaign="${ id }"]`)!;

const stateOf = (root: ParentNode, id: string) => campaignRow(root, id).querySelector('[data-state]')?.getAttribute('data-state');

const move = (root: ParentNode, id: string, to: string) => campaignRow(root, id).querySelector<HTMLButtonElement>(`[data-move="${ to }"] button`);

const rewardRows = (root: ParentNode) => [...root.querySelectorAll('[data-reward]')].map((one) => one.getAttribute('data-reward'));

const rewardRow = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-reward="${ id }"]`)!;

const decide = (root: ParentNode, id: string, to: string) => rewardRow(root, id).querySelector<HTMLButtonElement>(`[data-decide="${ to }"] button`);

const input = (change: Partial<AdminCampaignInput> = {}): AdminCampaignInput => ({ name: 'Autumn', inviterItem: 'dice.storm', milestones: [], review: false, reason: 'For the autumn cup.', ...change });

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

describe('the section', () =>
{
    it('opens at a glance and shows the campaigns or the rewards from the address, writing only what is not the default', async () =>
    {
        const { router, container } = await mounted();

        expect(said(container, 'h1')).toBe('Invites');
        expect(said(container, '[data-lead]')).toBe('What inviting friends brings in, the campaigns that give looks for it, and the rewards that wait for you.');
        expect(barChips(container)[0]).toEqual([['Ataglance', 'true'], ['Campaigns', 'false'], ['Rewards', 'false']]);
        expect(container.querySelector('[data-invite-overview]')).not.toBeNull();

        chip(container, 'Campaigns').click();
        await settle();

        expect(router.location().search).toBe('?view=campaigns');
        expect(container.querySelector('[data-invite-campaigns]')).not.toBeNull();
        expect(container.querySelector('[data-invite-overview]')).toBeNull();

        await router.navigate('/admin/invites?view=rewards&list=given');
        await settle();

        expect(container.querySelector('[data-invite-rewards]')).not.toBeNull();

        chip(container, 'At a glance').click();
        await settle();

        expect(router.location().search, 'a view leaves the last view\'s words behind').toBe('');

        await router.navigate('/admin/invites?view=somewhere');
        await settle();

        expect(container.querySelector('[data-invite-overview]'), 'a view the page does not know is the overview').not.toBeNull();
    });
});

describe('at a glance', () =>
{
    const counted = () =>
    {
        server.invitesAdmin.overview.today = funnel(4, 0, 0, 0);
        server.invitesAdmin.overview.week = funnel(40, 12, 9, 2, 7, 3, 1, 1);
        server.invitesAdmin.overview.all = funnel(400, 120, 60, 5, 50, 3, 9, 2);
    };

    it('counts the last seven days unless told otherwise: who opened a link, joined, played a game and was flagged, and the rewards by how they stand', async () =>
    {
        counted();
        const container = await opened();

        expect(barChips(container)[1]).toEqual([['Today', 'false'], ['Last7days', 'true'], ['Alltime', 'false']]);
        expect([said(container, '[data-visits]'), said(container, '[data-joined]'), said(container, '[data-played]'), said(container, '[data-flagged]')]).toEqual(['40', '12', '9', '2']);
        expect(said(container, '[data-rate]')).toBe('75% of those who joined');
        expect(container.querySelector('[data-flagged]')?.className).toContain('text-danger');
        expect([...container.querySelectorAll('[data-rewards] dt')].map((one) => one.textContent)).toEqual(['Given', 'Waiting', 'Refused', 'Taken back']);
        expect([said(container, '[data-given]'), said(container, '[data-review]'), said(container, '[data-refused]'), said(container, '[data-taken]')]).toEqual(['7', '3', '1', '1']);
    });

    it('counts today and all time from the address, the default never written, and reads again at Read again', async () =>
    {
        counted();
        const { router, container } = await mounted();

        chip(container, 'Today').click();
        await settle();

        expect(router.location().search).toBe('?window=today');
        expect([said(container, '[data-visits]'), said(container, '[data-joined]'), said(container, '[data-played]')]).toEqual(['4', '0', '0']);
        expect(container.querySelector('[data-rate]'), 'no share of those who joined while nobody joined').toBeNull();
        expect(container.querySelector('[data-flagged]')?.className).not.toContain('text-danger');

        chip(container, 'All time').click();
        await settle();

        expect(router.location().search).toBe('?window=all');
        expect(said(container, '[data-rate]')).toBe('50% of those who joined');

        chip(container, 'Last 7 days').click();
        await settle();

        expect(router.location().search).toBe('');

        server.invitesAdmin.overview.week = funnel(41, 13, 9, 2, 7, 3, 1, 1);
        server.calls = [];
        button(container, 'Read again')!.click();
        await settle();

        expect(server.calls).toEqual(['admin.invites']);
        expect([said(container, '[data-visits]'), said(container, '[data-joined]')]).toEqual(['41', '13']);
    });

    it('draws each of the last fourteen days as a column against the busiest, the newest in the accent, each said to a screen reader', async () =>
    {
        server.invitesAdmin.overview.days = daysOf([3, 0, 6, 1, 2, 4, 0, 0, 5, 1, 2, 3, 12, 6]);
        const container = await opened();
        const visits = container.querySelector('[data-funnel] > li')!;
        const columns = [...visits.querySelectorAll<HTMLElement>('[data-day]')];

        expect(columns).toHaveLength(14);
        expect(columns.map((one) => one.getAttribute('data-count'))).toEqual(['3', '0', '6', '1', '2', '4', '0', '0', '5', '1', '2', '3', '12', '6']);
        expect(columns.at(-1)?.className).toContain('bg-accent');
        expect(columns.slice(0, -1).every((one) => one.className.includes('bg-line-strong'))).toBe(true);
        expect([...container.querySelectorAll('[data-funnel] [data-days]')].map((one) => one.className.includes('mt-auto')), 'each row of columns stands at its tile\'s foot, level with the others whatever is above it').toEqual([true, true, true]);
        expect(columns[12].getAttribute('style')).toContain('height: 100%');
        expect(columns[2].getAttribute('style')).toContain('height: 50%');
        expect(visits.querySelector('[data-days] ol')?.getAttribute('aria-label')).toBe('Each of the last 14 days');
        expect([...visits.querySelectorAll('[data-days] ol li')].slice(0, 2).map((one) => one.textContent)).toEqual(['Opened a link, Oct 17: 3', 'Opened a link, Oct 18: 0']);
        expect([...container.querySelectorAll('[data-funnel] > li')[1].querySelectorAll('[data-day]')].map((one) => one.getAttribute('data-count')).at(-1)).toBe('3');
        expect(container.querySelectorAll('[data-funnel] > li')[3].querySelector('[data-days]'), 'flags are counted, never drawn by day').toBeNull();
    });

    it('says how many rewards wait for the reader, leading to them, and says nothing of it when none does', async () =>
    {
        server.invitesAdmin.rewards = [rewardOf('r1'), rewardOf('r2'), rewardOf('r3', { state: 'given' })];
        let container = await opened();

        expect([said(container, '[data-decide] > span'), said(container, '[data-decide] [data-to-rewards]')]).toEqual(['2 rewards wait for you', 'Decide them']);
        expect(container.querySelector('[data-decide] [data-to-rewards]')?.getAttribute('href')).toBe('/admin/invites?view=rewards');

        cleanup();
        server.invitesAdmin.rewards = [rewardOf('r1')];
        container = await opened();

        expect(said(container, '[data-decide] > span')).toBe('1 reward waits for you');

        cleanup();
        server.invitesAdmin.rewards = [];
        container = await opened();

        expect(container.querySelector('[data-decide]')).toBeNull();
    });

    it('shows the campaign running, what it gives and what came of it, and says so when none runs', async () =>
    {
        let container = await opened();

        expect(said(container, '[data-none-running]')).toBe('No campaign is running, so inviting a friend gives no look.');
        expect(container.querySelector('[data-to-campaigns]')?.getAttribute('href')).toBe('/admin/invites?view=campaigns');

        cleanup();
        server.invitesAdmin.campaigns = [campaignOf('c1', {
            name: 'Spring friends',
            state: 'active',
            running: true,
            inviteeItem: 'pawns.jade',
            milestones: [{ count: 5, item: 'decoration.void' }],
            joined: 4,
            played: 3,
            given: 2,
            waiting: 1
        })];
        container = await opened();

        const running = container.querySelector('[data-running]')!;

        expect(running.textContent).toContain('Spring friends');
        expect(running.textContent).toContain('Running');
        expect(said(running, 'p')).toBe('whoever invited gets Stormforged Monarch dice, the friend gets Jade Dragon Dynasty pawns, and milestone 5: Void Emperor avatar decoration');
        expect(said(running, 'p:last-child')).toBe('4 joined, 3 played, 2 given, 1 waiting');
        expect(container.querySelector('[data-none-running]')).toBeNull();
    });

    it('names the inviters whose friends played most, each leading to their page, read again with the rest', async () =>
    {
        server.invitesAdmin.overview.top = [
            { person: face('sara.k'), joined: 6, played: 5, flagged: 0 },
            { person: face('reza.t'), joined: 3, played: 1, flagged: 2 }
        ];
        const container = await opened();
        const rows = () => [...container.querySelectorAll<HTMLAnchorElement>('[data-top] a')];
        const counts = (row: Element) => [...row.querySelectorAll('[data-counts] > span')].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());

        expect(rows().map((one) => [one.getAttribute('href'), one.getAttribute('aria-label')])).toEqual([
            ['/admin/people/sara.k', 'Sara Kamali: 6 joined, 5 played, 0 flagged'],
            ['/admin/people/reza.t', 'Reza Tehrani: 3 joined, 1 played, 2 flagged']
        ]);
        expect(counts(rows()[0])).toEqual(['6 joined', '5 played', '0 flagged']);
        expect(rows()[0].textContent).toContain('@sara.k');
        expect(rows()[1].querySelector('[data-counts] > span:last-child')?.className).toContain('text-danger');
        expect(rows()[0].querySelector('[data-counts] > span:last-child')?.className).not.toContain('text-danger');

        server.invitesAdmin.overview.top = [{ person: face('sara.k'), joined: 7, played: 6, flagged: 1 }];
        button(container, 'Read again')!.click();
        await settle();

        expect(rows().map(counts)).toEqual([['7 joined', '6 played', '1 flagged']]);
        expect(rows()[0].getAttribute('aria-label')).toBe('Sara Kamali: 7 joined, 6 played, 1 flagged');
        expect(rows()[0].querySelector('[data-counts] > span:last-child')?.className).toContain('text-danger');

        server.invitesAdmin.overview.top = [];
        button(container, 'Read again')!.click();
        await settle();

        expect(said(container, '[data-top-none]')).toBe('Nobody has brought a friend in yet.');
    });

    it('says it could not be read, with a way to try again', async () =>
    {
        vi.spyOn(client.admin, 'invites').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));

        const container = await opened();

        expect(container.textContent).toContain('Inviting friends could not be read.');
        expect(container.querySelector('[data-funnel]')).toBeNull();

        button(container, useLocale().t('common.retry'))!.click();
        await settle();

        expect(container.querySelector('[data-funnel]')).not.toBeNull();
    });
});

describe('the campaigns', () =>
{
    const four = () =>
    {
        server.invitesAdmin.campaigns = [
            campaignOf('c1', { name: 'Spring friends', state: 'active', running: true, inviteeItem: 'pawns.jade', milestones: [{ count: 5, item: 'decoration.void' }], most: 3, review: true, joined: 4, played: 3, given: 2, waiting: 1, gave: true }),
            campaignOf('c2', { state: 'paused', startsAt: '2026-10-01T08:00:00.000Z', endsAt: '2026-12-01T08:00:00.000Z' }),
            campaignOf('c3', { by: 'reza.t' }),
            campaignOf('c4', { state: 'ended' })
        ];
    };

    it('lists them newest first, each with how it stands, what it gives, its limit, its window, what came of it and who wrote it', async () =>
    {
        four();
        const container = await opened('/admin/invites?view=campaigns');

        expect(campaignRows(container)).toEqual(['c1', 'c2', 'c3', 'c4']);
        expect(['c1', 'c2', 'c3', 'c4'].map((id) => [stateOf(container, id), said(campaignRow(container, id), '[data-state]')])).toEqual([
            ['running', 'Running'],
            ['paused', 'Paused'],
            ['draft', 'Draft'],
            ['ended', 'Ended']
        ]);

        const spring = campaignRow(container, 'c1');

        expect(said(spring, 'h3')).toBe('Spring friends');
        expect([...spring.querySelectorAll('[data-gives] li')].map((one) => one.textContent)).toEqual([
            'whoever invited gets Stormforged Monarch dice',
            'the friend gets Jade Dragon Dynasty pawns',
            'milestone 5: Void Emperor avatar decoration'
        ]);
        expect([...spring.querySelectorAll('[data-facts] > span')].map((one) => one.textContent)).toEqual(['At most 3 for one person', 'Every reward waits for the staff', 'For as long as it is running']);
        expect(said(spring, '[data-came]')).toBe('4 joined, 3 played, 2 given, 1 waiting');
        expect(spring.textContent).toContain('Written by alex');
        expect([...campaignRow(container, 'c2').querySelectorAll('[data-facts] > span')].map((one) => one.textContent)).toEqual([
            'No limit for one person',
            `${ useLocale().date(Date.parse('2026-10-01T08:00:00.000Z'), { dateStyle: 'medium', timeStyle: 'short' }) } to ${ useLocale().date(Date.parse('2026-12-01T08:00:00.000Z'), { dateStyle: 'medium', timeStyle: 'short' }) }`
        ]);
        expect(campaignRow(container, 'c3').textContent).toContain('Written by reza.t');
        expect(['c1', 'c2', 'c3'].map((id) => [...campaignRow(container, id).querySelectorAll('[data-move]')].map((one) => [one.getAttribute('data-move'), one.textContent?.trim()]))).toEqual([
            [['paused', 'Pause'], ['ended', 'End']],
            [['active', 'Start again'], ['ended', 'End']],
            [['active', 'Start'], ['ended', 'End']]
        ]);
        expect(campaignRow(container, 'c4').querySelector('[data-moves]'), 'an ended campaign is final').toBeNull();
    });

    it('says a campaign started before its window opens is started and not running', async () =>
    {
        server.invitesAdmin.campaigns = [campaignOf('c1', { state: 'active', running: false, startsAt: '2026-11-01T08:00:00.000Z' })];
        const container = await opened('/admin/invites?view=campaigns');

        expect([stateOf(container, 'c1'), said(campaignRow(container, 'c1'), '[data-state]')]).toEqual(['idle', 'Started, not running']);
        expect([...campaignRow(container, 'c1').querySelectorAll('[data-facts] > span')].at(-1)?.textContent).toBe(`From ${ useLocale().date(Date.parse('2026-11-01T08:00:00.000Z'), { dateStyle: 'medium', timeStyle: 'short' }) }`);
    });

    it('writes a new campaign as a draft at the press, says so once the server has, and logs it', async () =>
    {
        four();
        const container = await opened('/admin/invites?view=campaigns');
        const kept = campaignRow(container, 'c2');

        button(container, 'New campaign')!.click();
        await settle();

        expect(asked().component).toBe(CampaignSheet);
        expect(asked().props).toMatchObject({ campaign: null });

        const release = held();

        await answered({ input: input() });

        expect(campaignRows(container)[0]).toMatch(/^draft-/);
        expect(said(container.querySelector('[data-campaign]')!, 'h3')).toBe('Autumn');
        expect(container.querySelector('[data-campaign] [data-state]')?.getAttribute('data-state')).toBe('draft');
        expect(toasts()).toEqual([]);

        await release();

        expect(toasts()).toEqual(['“Autumn” is written as a draft.']);
        expect(campaignRows(container)).toEqual(['campaign-1', 'c1', 'c2', 'c3', 'c4']);
        expect(campaignRow(container, 'c2'), 'a row the write did not touch is the row it was').toBe(kept);
        expect(server.staff.log.map((one) => [one.kind, one.reason, one.details])).toEqual([['invite-campaign', 'For the autumn cup.', { campaign: 'campaign-1', name: 'Autumn', to: 'draft' }]]);
    });

    it('takes a refused campaign back in the reader\'s words, and opens the next sheet on what was written', async () =>
    {
        const container = await opened('/admin/invites?view=campaigns');
        const refused = input({ inviterItem: 'dice.nowhere' });

        button(container, 'New campaign')!.click();
        await settle();
        await answered({ input: refused });

        expect(toasts()).toEqual(['That is not a look the shop sells.']);
        expect(campaignRows(container)).toEqual([]);
        expect(said(container, '[data-invite-campaigns]')).toContain('No campaign has been written yet.');

        button(container, 'New campaign')!.click();
        await settle();

        expect(asked().props).toMatchObject({ campaign: null, initial: refused });

        await answered(null);
        button(container, 'New campaign')!.click();
        await settle();

        expect(asked().props, 'what was written waits until it goes through').toMatchObject({ initial: refused });

        await answered({ input: input() });

        expect(toasts().at(-1)).toBe('“Autumn” is written as a draft.');

        button(container, 'New campaign')!.click();
        await settle();

        expect(asked().props).not.toHaveProperty('initial');
    });

    it('changes a campaign at the press, and keeps a refused change for the next sheet', async () =>
    {
        four();
        const container = await opened('/admin/invites?view=campaigns');

        button(campaignRow(container, 'c3'), 'Change')!.click();
        await settle();

        expect(asked().component).toBe(CampaignSheet);
        expect(asked().props).toMatchObject({ campaign: { id: 'c3', name: 'Campaign c3' } });

        const release = held();

        await answered({ input: input({ name: 'Campaign three' }) });

        expect(said(campaignRow(container, 'c3'), 'h3')).toBe('Campaign three');

        await release();

        expect(toasts()).toEqual(['“Campaign three” is changed.']);
        expect(server.staff.log.map((one) => one.details)).toEqual([{ campaign: 'c3', name: 'Campaign three', to: 'changed', fields: 'name' }]);

        useToasts().dismissAll();
        const giving = input({ name: 'Spring friends', inviterItem: 'dice.jade', review: true });

        button(campaignRow(container, 'c1'), 'Change')!.click();
        await settle();
        await answered({ input: giving });

        expect(toasts()).toEqual(['This campaign has given rewards, so what it gives stays as it is.']);
        expect(said(campaignRow(container, 'c1'), '[data-gives] li')).toBe('whoever invited gets Stormforged Monarch dice');

        button(campaignRow(container, 'c1'), 'Change')!.click();
        await settle();

        expect(asked().props).toMatchObject({ campaign: { id: 'c1' }, initial: giving });
    });

    it('starts a draft after asking why, as a question that loses nothing, shown at the press', async () =>
    {
        server.invitesAdmin.campaigns = [campaignOf('c3')];
        const container = await opened('/admin/invites?view=campaigns');

        move(container, 'c3', 'active')!.click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'Start “Campaign c3”?',
            lead: 'Every friend who joins through a link from now on belongs to it, and their invites give what it gives.',
            confirm: 'Start it',
            destructive: false
        });

        const release = held();

        await answered('Spring starts.');

        expect(stateOf(container, 'c3')).toBe('running');
        expect(toasts()).toEqual([]);

        await release();

        expect(toasts()).toEqual(['“Campaign c3” is running.']);
        expect(stateOf(container, 'c3')).toBe('running');
        expect(server.staff.log.map((one) => [one.kind, one.reason, one.details])).toEqual([['invite-campaign', 'Spring starts.', { campaign: 'c3', name: 'Campaign c3', to: 'active' }]]);
    });

    it('pauses and ends a campaign as questions that lose something, and does nothing when the sheet is put away', async () =>
    {
        four();
        const container = await opened('/admin/invites?view=campaigns');

        move(container, 'c1', 'paused')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Pause “Spring friends”?',
            lead: 'Invites that count while it is paused give nothing. Friends who join meanwhile still belong to it.',
            confirm: 'Pause it',
            destructive: true
        });

        await answered(null);

        expect(stateOf(container, 'c1')).toBe('running');
        expect(server.calls.some((call) => call.startsWith('admin.moveCampaign'))).toBe(false);

        move(container, 'c1', 'paused')!.click();
        await settle();
        await answered('A break for the holidays.');

        expect(stateOf(container, 'c1')).toBe('paused');
        expect(toasts()).toEqual(['“Spring friends” is paused.']);

        move(container, 'c2', 'ended')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'End “Campaign c2”?',
            lead: 'It gives nothing more and cannot start again. What it gave stays given.',
            confirm: 'End it',
            destructive: true
        });

        await answered('It ran its course.');

        expect(stateOf(container, 'c2')).toBe('ended');
        expect(campaignRow(container, 'c2').querySelector('[data-moves]')).toBeNull();
        expect(toasts().at(-1)).toBe('“Campaign c2” has ended.');
    });

    it('takes a refused start back and says why in the reader\'s words', async () =>
    {
        four();
        const container = await opened('/admin/invites?view=campaigns');

        move(container, 'c3', 'active')!.click();
        await settle();
        await answered('Two at once?');

        expect(toasts()).toEqual(['Another campaign is running. Pause or end it first.']);
        expect(stateOf(container, 'c3')).toBe('draft');
        expect(server.staff.log).toEqual([]);
    });

    it('shows older campaigns a page at a time, each once', async () =>
    {
        server.invitesAdmin.campaigns = Array.from({ length: INVITES_PAGE + 2 }, (_, at) => campaignOf(`c${ String(at).padStart(2, '0') }`));
        const container = await opened('/admin/invites?view=campaigns');

        expect(campaignRows(container)).toHaveLength(INVITES_PAGE);

        button(container, 'Show older')!.click();
        await settle();

        expect(campaignRows(container)).toHaveLength(INVITES_PAGE + 2);
        expect(new Set(campaignRows(container)).size).toBe(INVITES_PAGE + 2);
        expect(button(container, 'Show older')).toBeUndefined();
    });

    it('says when none has been written, and when the campaigns could not be read', async () =>
    {
        let container = await opened('/admin/invites?view=campaigns');

        expect(container.textContent).toContain('No campaign has been written yet.');
        expect(container.textContent).toContain('Until one is written and started, inviting a friend gives no look.');

        cleanup();
        vi.spyOn(client.admin, 'campaigns').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));
        container = await opened('/admin/invites?view=campaigns');

        expect(container.textContent).toContain('The campaigns could not be read.');
        expect(button(container, 'New campaign')).toBeUndefined();
    });
});

describe('the rewards', () =>
{
    const five = () =>
    {
        server.invitesAdmin.rewards = [
            rewardOf('r1', { flags: ['quick', 'ring'] }),
            rewardOf('r2', { kind: 'invitee', item: 'pawns.jade', person: { ...face('nima.f'), suspended: false }, friend: face('sara.k') }),
            rewardOf('r3', { kind: 'milestone', milestone: 5, item: 'decoration.void', friend: undefined }),
            rewardOf('r4', { state: 'given', delivered: true, decidedBy: 'reza.t', decidedAt: minutesAgo(2), reason: 'Looks fair.' }),
            rewardOf('r5', { state: 'refused', decidedBy: 'reza.t', decidedAt: minutesAgo(1), reason: 'A farm.' })
        ];
    };

    it('lists what waits unless told otherwise, counting it on its chip, each with whom it is for, what for, the look, its campaign and its flags', async () =>
    {
        five();
        const container = await opened('/admin/invites?view=rewards');

        expect(barChips(container)[1]).toEqual([['Waiting3', 'true'], ['Given', 'false'], ['Refused', 'false'], ['Takenback', 'false'], ['All', 'false']]);
        expect(rewardRows(container)).toEqual(['r1', 'r2', 'r3']);

        const first = rewardRow(container, 'r1');

        expect(first.textContent).toContain('Sara Kamali');
        expect(first.textContent).toContain('@sara.k');
        expect(said(first, '[data-what]')).toBe('For inviting nima.f');
        expect(said(first, '[data-look]')).toBe('Stormforged Monarch dice');
        expect(first.querySelector('img')?.getAttribute('src')).toBe('/looks/dice.storm.svg');
        expect(first.textContent).toContain('In “Spring friends”');
        expect(said(first, '[data-state]')).toBe('Waiting');
        expect([...first.querySelectorAll('[data-flag]')].map((one) => [one.getAttribute('data-flag'), one.textContent])).toEqual([
            ['quick', 'First game within 10 minutes of joining'],
            ['ring', 'Played with another friend of the same inviter']
        ]);
        expect([...first.querySelectorAll('[data-flag]')].every((one) => one.querySelector('span[aria-hidden="true"]') !== null), 'a flag is said as a state is, its dot in danger and its words plain').toBe(true);
        expect([...first.querySelectorAll('[data-decide]')].map((one) => one.getAttribute('data-decide'))).toEqual(['given', 'refused']);
        expect(said(rewardRow(container, 'r2'), '[data-what]')).toBe('For joining through sara.k’s link');
        expect(said(rewardRow(container, 'r3'), '[data-what]')).toBe('For milestone 5');
        expect(rewardRow(container, 'r2').querySelector('[data-flags]')).toBeNull();
    });

    it('shows the other lists from the address, the default never written, each saying who decided and why', async () =>
    {
        five();
        const { router, container } = await mounted('/admin/invites?view=rewards');

        chip(container, 'Given').click();
        await settle();

        expect(router.location().search).toBe('?view=rewards&list=given');
        expect(rewardRows(container)).toEqual(['r4']);
        expect(said(rewardRow(container, 'r4'), '[data-decided]')).toBe('Decided by reza.t. “Looks fair.”');
        expect([...rewardRow(container, 'r4').querySelectorAll('[data-decide]')].map((one) => one.getAttribute('data-decide'))).toEqual(['taken']);

        chip(container, 'All').click();
        await settle();

        expect(rewardRows(container)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
        expect(rewardRow(container, 'r5').querySelector('[data-decide]'), 'a refused reward is decided').toBeNull();

        chip(container, 'Taken back').click();
        await settle();

        expect(rewardRows(container)).toEqual([]);
        expect(container.textContent).toContain('No reward here.');

        chip(container, 'Waiting').click();
        await settle();

        expect(router.location().search).toBe('?view=rewards');
        expect(rewardRows(container)).toEqual(['r1', 'r2', 'r3']);
    });

    it('gives a reward at the press after asking why, says so once the server has, and counts one fewer waiting', async () =>
    {
        five();
        const container = await opened('/admin/invites?view=rewards');

        decide(container, 'r1', 'given')!.click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'Give sara.k Stormforged Monarch dice?',
            lead: 'It is theirs at once, and they are told.',
            confirm: 'Give it',
            destructive: false
        });

        const release = held();

        await answered('A real friend, checked.');

        expect(rewardRows(container)).toEqual(['r2', 'r3']);
        expect(barChips(container)[1][0]).toEqual(['Waiting2', 'true']);
        expect(toasts()).toEqual([]);

        await release();

        expect(toasts()).toEqual(['sara.k has Stormforged Monarch dice now.']);
        expect(rewardRows(container)).toEqual(['r2', 'r3']);
        expect(server.invitesAdmin.rewards.find((one) => one.id === 'r1')).toMatchObject({ state: 'given', decidedBy: 'alex', reason: 'A real friend, checked.' });
        expect(server.staff.log.map((one) => [one.kind, one.person, one.details])).toEqual([['invite-reward', 'sara.k', { reward: 'r1', item: 'dice.storm', to: 'given', campaign: 'c1' }]]);
    });

    it('refuses and takes back as questions that lose something, the row drawn as decided where its list still holds it', async () =>
    {
        five();
        const container = await opened('/admin/invites?view=rewards&list=all');

        decide(container, 'r2', 'refused')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Refuse nima.f Jade Dragon Dynasty pawns?',
            lead: 'They are given nothing and not told.',
            confirm: 'Refuse it',
            destructive: true
        });

        await answered('A farm of wallets.');

        expect(said(rewardRow(container, 'r2'), '[data-state]')).toBe('Refused');
        expect(said(rewardRow(container, 'r2'), '[data-decided]')).toBe('Decided by alex. “A farm of wallets.”');
        expect(toasts()).toEqual(['Jade Dragon Dynasty pawns is refused to nima.f.']);

        decide(container, 'r4', 'taken')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Take Stormforged Monarch dice back from sara.k?',
            lead: 'It leaves their collection and comes off wherever they wear it. They are not told.',
            confirm: 'Take it back',
            destructive: true
        });

        await answered('Given by mistake.');

        expect(said(rewardRow(container, 'r4'), '[data-state]')).toBe('Taken back');
        expect(rewardRow(container, 'r4').querySelector('[data-decide]')).toBeNull();
        expect(toasts().at(-1)).toBe('Stormforged Monarch dice is taken back from sara.k.');
    });

    it('puts a refused decision back in the reader\'s words, and opens the next sheet for it on the reason written', async () =>
    {
        five();
        const container = await opened('/admin/invites?view=rewards&list=all');
        const r1 = server.invitesAdmin.rewards.find((one) => one.id === 'r1')!;

        r1.state = 'given';
        r1.delivered = true;
        decide(container, 'r1', 'refused')!.click();
        await settle();
        await answered('Looks like a farm.');

        expect(toasts()).toEqual(['That reward is no longer where that decision can be made.']);
        expect(said(rewardRow(container, 'r1'), '[data-state]'), 'the list is read again').toBe('Given');
        expect(server.staff.log).toEqual([]);

        decide(container, 'r1', 'taken')!.click();
        await settle();

        expect(asked().props).toMatchObject({ initial: 'Looks like a farm.' });
    });

    it('offers no decision on the reader\'s own reward or on somebody at or above their role, says why, and gives nothing to a suspended account', async () =>
    {
        useSession().establish({ ...ALEX, staff: 'admin' });
        server.staff.owners = ['omid.j'];
        server.staff.members = [staffMember('alex', 'admin'), staffMember('reza.t', 'admin'), staffMember('mina', 'moderator')];
        server.invitesAdmin.rewards = [
            rewardOf('r1', { person: { ...face('alex'), staff: 'admin', suspended: false } }),
            rewardOf('r2', { person: { ...face('reza.t'), staff: 'admin', suspended: false } }),
            rewardOf('r3', { person: { ...face('mina'), staff: 'moderator', suspended: false } }),
            rewardOf('r4', { person: { ...face('sara.k'), suspended: true } })
        ];
        const container = await opened('/admin/invites?view=rewards');
        const offered = (id: string) => [...rewardRow(container, id).querySelectorAll('[data-decide]')].map((one) => one.getAttribute('data-decide'));

        expect(offered('r1')).toEqual([]);
        expect(said(rewardRow(container, 'r1'), '[data-barred]')).toBe('This reward is yours, so somebody else decides it.');
        expect(offered('r2')).toEqual([]);
        expect(said(rewardRow(container, 'r2'), '[data-barred]')).toBe('Only somebody above their role decides this.');
        expect(rewardRow(container, 'r2').textContent).toContain('Admin');
        expect(offered('r3')).toEqual(['given', 'refused']);
        expect(rewardRow(container, 'r3').textContent).toContain('Moderator');
        expect(offered('r4')).toEqual(['refused']);
        expect(rewardRow(container, 'r4').textContent).toContain('Suspended');
    });

    it('says when a reward gave nothing because the look was theirs already', async () =>
    {
        server.invitesAdmin.rewards = [rewardOf('r1', { state: 'given', delivered: false, decidedBy: 'alex' }), rewardOf('r2', { state: 'given', delivered: true, decidedBy: 'alex' })];
        const container = await opened('/admin/invites?view=rewards&list=given');

        expect(said(rewardRow(container, 'r1'), '[data-nothing]')).toBe('Theirs already, so nothing was given');
        expect(rewardRow(container, 'r2').querySelector('[data-nothing]')).toBeNull();
    });

    it('shows older rewards a page at a time, each once, and says when none waits or the rewards could not be read', async () =>
    {
        server.invitesAdmin.rewards = Array.from({ length: INVITES_PAGE + 1 }, (_, at) => rewardOf(`r${ String(at).padStart(2, '0') }`));
        let container = await opened('/admin/invites?view=rewards');

        expect(rewardRows(container)).toHaveLength(INVITES_PAGE);
        expect(barChips(container)[1][0]).toEqual([`Waiting${ INVITES_PAGE + 1 }`, 'true']);

        button(container, 'Show older')!.click();
        await settle();

        expect(new Set(rewardRows(container)).size).toBe(INVITES_PAGE + 1);

        cleanup();
        server.invitesAdmin.rewards = [];
        container = await opened('/admin/invites?view=rewards');

        expect(container.textContent).toContain('No reward is waiting for you.');

        cleanup();
        vi.spyOn(client.admin, 'rewards').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));
        container = await opened('/admin/invites?view=rewards');

        expect(container.textContent).toContain('The rewards could not be read.');
    });
});

describe('in Persian', () =>
{
    it('says the section, its counts, its campaigns and its rewards in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.invitesAdmin.overview.week = funnel(40, 12, 9, 2);
        server.invitesAdmin.campaigns = [campaignOf('c1', { name: 'Spring friends', state: 'active', running: true })];
        server.invitesAdmin.rewards = [rewardOf('r1')];

        const { router, container } = await mounted();

        expect(said(container, 'h1')).toBe('دعوت‌ها');
        expect(barChips(container)[0].map((one) => one[0])).toEqual(['یهنگاهکلی', 'کمپین‌ها', 'جایزه‌ها']);
        expect(said(container, '#invites-funnel')).toBe('از لینک تا بازی');
        expect(said(container, '[data-visits]')).toBe('۴۰');
        expect(said(container, '[data-rate]')).toBe('۷۵٪ از کسایی که عضو شدن');
        expect([said(container, '[data-decide] > span'), said(container, '[data-decide] [data-to-rewards]')]).toEqual(['۱ جایزه منتظر تصمیم توئه', 'تصمیم بگیر']);

        await router.navigate('/admin/invites?view=campaigns');
        await settle();

        expect(said(campaignRow(container, 'c1'), '[data-state]')).toBe('در جریان');
        expect([...campaignRow(container, 'c1').querySelectorAll('[data-move]')].map((one) => one.textContent?.trim())).toEqual(['نگه دار', 'تموم کن']);

        await router.navigate('/admin/invites?view=rewards');
        await settle();

        expect(said(rewardRow(container, 'r1'), '[data-what]')).toBe('برای دعوت nima.f');
        expect(said(rewardRow(container, 'r1'), '[data-state]')).toBe('منتظر');
        expect([...rewardRow(container, 'r1').querySelectorAll('[data-decide]')].map((one) => one.textContent?.trim())).toEqual(['بده', 'رد کن']);
    });
});

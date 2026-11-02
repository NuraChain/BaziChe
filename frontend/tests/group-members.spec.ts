import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import { GROUP_RIGHTS } from '../../backend/src/domains/group/roles.ts';
import GroupMemberSheet from '../src/components/social/group-member-sheet.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import GroupPage from '../src/pages/app/group.page.azeroth';
import { SEARCH_PAUSE_MS } from '../src/services/search.service.ts';
import { useGroupAdmin, type GroupMember } from '../src/stores/group-admin.store.ts';
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
 * A group's members as its page draws them: read from the server a page at a time, the staff first,
 * each one's place as a badge, and what the reader may do about each of them in a sheet whose every
 * change is drawn at the press and taken back with the refusal's words.
 */

const SLUG = 'friday-night-crew';

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

const opened = () =>
{
    const routes: Route[] = [{ path: '/app/groups/:id', component: (): HTMLElement => GroupPage() as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(`/app/groups/${ SLUG }`), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

const listOf = (container: HTMLElement) => container.querySelector(`ul[aria-label="${ t('groups.members') }"]`);

const rowOf = (container: HTMLElement, name: string) =>
    [...(listOf(container)?.querySelectorAll('li') ?? [])].find((row) => row.textContent?.includes(name)) ?? null;

const names = (container: HTMLElement) =>
    [...(listOf(container)?.querySelectorAll('li') ?? [])].map((row) => row.querySelector('button[aria-haspopup="dialog"] [dir="auto"]')?.textContent ?? '');

const manageOf = (row: Element | null, name: string) => row?.querySelector<HTMLButtonElement>(`button[aria-label="${ t('groups.manage', { name }) }"]`) ?? null;

const memberOf = (handle: string) => useGroupAdmin().members().find((one) => one.person.handle === handle)!;

/** A member's sheet, drawn as the overlay would draw it. */
const sheetFor = (handle: string, close = vi.fn()) =>
{
    const group = useGroups().viewing()!;
    return renderTest(() => GroupMemberSheet({ overlayId: 'member', close, member: memberOf(handle), group }) as HTMLElement).container;
};

const buttonIn = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label) ?? null;

/** Answers the question a destructive press asks, yes or no. */
const answer = async (yes: boolean) =>
{
    await vi.waitFor(() => expect(useOverlay().items().length).toBeGreaterThan(0), { timeout: 4000 });
    const asked = useOverlay().items().at(-1)!;
    expect(asked.props, 'asked as something that cannot be taken back').toMatchObject({ destructive: true });
    useOverlay().close(asked.id, yes);
    await settle();
};

/** A request held at the server's door, so a test can look in between the press and the answer. */
const held = <K extends 'role' | 'mute' | 'unmute' | 'remove' | 'ban' | 'transfer'>(verb: K) =>
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

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(1_200_000);
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

describe('a group\'s members', () =>
{
    it('are the server\'s, the owner first and the staff after, each one\'s place a badge', async () =>
    {
        server.groupPlaces[SLUG] = { mina: { role: 'admin', rights: ['pin'] }, 'sara.k': { role: 'moderator' } };

        const container = opened();

        await vi.waitFor(() => expect(names(container)).toHaveLength(6), { timeout: 4000 });

        expect(server.calls).toContain('groups.members');
        expect(names(container).slice(0, 3)).toEqual(['Babak Rostami', 'Mina Sadeghi', 'Sara Kamali']);
        expect(rowOf(container, 'Babak Rostami')?.textContent).toContain(t('groups.role.owner'));
        expect(rowOf(container, 'Mina Sadeghi')?.textContent).toContain(t('groups.role.admin'));
        expect(rowOf(container, 'Sara Kamali')?.textContent).toContain(t('groups.role.moderator'));
        expect(rowOf(container, 'Mahsa')?.textContent, 'a member wears no badge').not.toContain(t('groups.role.member'));
    });

    it('offers a member\'s sheet only to somebody who may act on them, and never about the reader', async () =>
    {
        const container = opened();

        await vi.waitFor(() => expect(names(container)).toHaveLength(6), { timeout: 4000 });
        expect(listOf(container)?.querySelector(`button[aria-label^="${ t('groups.manage', { name: '' }).trim() }"]`), 'a member manages nobody').toBeNull();

        cleanup();
        useGroups().reset();
        useGroupAdmin().reset();
        owned();

        const mine = opened();

        await vi.waitFor(() => expect(manageOf(rowOf(mine, 'Sara Kamali'), 'Sara Kamali')).not.toBeNull(), { timeout: 4000 });
        expect(manageOf(rowOf(mine, 'Alex Morgan'), 'Alex Morgan'), 'the reader').toBeNull();
        expect(manageOf(rowOf(mine, 'Babak Rostami'), 'Babak Rostami'), 'the old owner, a member now').not.toBeNull();
    });

    it('opens the sheet about a member from their row', async () =>
    {
        owned();
        const container = opened();

        await vi.waitFor(() => expect(manageOf(rowOf(container, 'Sara Kamali'), 'Sara Kamali')).not.toBeNull(), { timeout: 4000 });

        fire(manageOf(rowOf(container, 'Sara Kamali'), 'Sara Kamali')!, 'click');

        expect(useOverlay().items()).toHaveLength(1);
        expect(useOverlay().items()[0].props).toMatchObject({ member: { person: { handle: 'sara.k' }, role: 'member' } });
    });

    it('reads more of them a page at a time, and asks the server for a search once the typing pauses', async () =>
    {
        server.groupMembersPage = 4;
        crew().members.push('kian16', 'reza.t', 'nima.f');

        const container = opened();

        await vi.waitFor(() => expect(names(container)).toHaveLength(4), { timeout: 4000 });

        fire(buttonIn(container, t('groups.moreMembers'))!, 'click');
        await vi.waitFor(() => expect(names(container)).toHaveLength(8), { timeout: 4000 });
        fire(buttonIn(container, t('groups.moreMembers'))!, 'click');
        await vi.waitFor(() => expect(names(container)).toHaveLength(9), { timeout: 4000 });
        expect(buttonIn(container, t('groups.moreMembers')), 'nothing left to read').toBeNull();

        const field = container.querySelector<HTMLInputElement>('input[type="search"]')!;
        const asked = server.calls.filter((one) => one === 'groups.members').length;

        field.value = 'sar';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
        expect(server.calls.filter((one) => one === 'groups.members'), 'not while the typing goes on').toHaveLength(asked);

        clock.advance(SEARCH_PAUSE_MS);
        await vi.waitFor(() => expect(names(container)).toEqual(['Sara Kamali']), { timeout: 4000 });
    });
});

describe('a group\'s members that could not be read', () =>
{
    it('say so with a way to try again, and are drawn once they are read', async () =>
    {
        const failing = vi.spyOn(client.groups, 'members').mockRejectedValue(new Error('down'));
        const container = opened();

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });
        expect(names(container)).toEqual([]);

        failing.mockRestore();
        fire(buttonIn(container, t('common.retry'))!, 'click');
        await vi.waitFor(() => expect(names(container)).toHaveLength(6), { timeout: 4000 });
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });
});

describe('the sheet about a member', () =>
{
    const ready = async () =>
    {
        owned();
        const container = opened();
        await vi.waitFor(() => expect(names(container)).toHaveLength(6), { timeout: 4000 });
        return container;
    };

    it('makes somebody a moderator at the press, says so once the server has, and keeps it', async () =>
    {
        const page = await ready();
        const close = vi.fn();
        const sheet = sheetFor('sara.k', close);
        const door = held('role');

        fire(buttonIn(sheet, t('groups.makeModerator'))!, 'click');
        await settle();

        expect(close).toHaveBeenCalledWith(true);
        expect(rowOf(page, 'Sara Kamali')?.textContent, 'at the press').toContain(t('groups.role.moderator'));
        expect(useToasts().items(), 'said only once the server has').toHaveLength(0);

        door.release();
        await vi.waitFor(() => expect(useToasts().items().map((one) => one.text)).toContain(t('groups.madeModerator', { name: 'Sara Kamali' })), { timeout: 4000 });
        expect(door.spy).toHaveBeenCalledWith({ params: { slug: SLUG }, input: { id: 'sara.k', role: 'moderator' } });
        expect(rowOf(page, 'Sara Kamali')?.textContent).toContain(t('groups.role.moderator'));
    });

    it('takes a change back the moment the server refuses it, in the refusal\'s own words', async () =>
    {
        const page = await ready();
        server.refuseGroupAct = { status: 409, code: 'group-rank' };

        fire(buttonIn(sheetFor('sara.k'), t('groups.makeModerator'))!, 'click');

        await vi.waitFor(() => expect(useToasts().items().map((one) => one.text)).toContain(t('group.refused.group-rank')), { timeout: 4000 });
        expect(rowOf(page, 'Sara Kamali')?.textContent).not.toContain(t('groups.role.moderator'));
    });

    it('chooses an admin\'s rights a switch each, sends them in the list\'s order, and saves a change of them together', async () =>
    {
        const page = await ready();
        const sheet = sheetFor('sara.k');
        const switchOf = (right: string) => [...sheet.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((one) => one.textContent?.includes(t(`groups.right.${ right }` as never)))!;

        fire(switchOf('ban'), 'click');
        fire(switchOf('info'), 'click');
        fire(buttonIn(sheet, t('groups.makeAdmin'))!, 'click');

        await vi.waitFor(() => expect(server.calls).toContain('groups.role'), { timeout: 4000 });
        expect(server.groupPlaces[SLUG]?.['sara.k']).toEqual({ role: 'admin', rights: ['info', 'ban'] });
        await vi.waitFor(() => expect(rowOf(page, 'Sara Kamali')?.textContent).toContain(t('groups.role.admin')), { timeout: 4000 });

        const again = sheetFor('sara.k');
        const save = buttonIn(again, t('groups.saveRights'))!;
        expect(save.disabled, 'nothing changed yet').toBe(true);
        fire([...again.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((one) => one.textContent?.includes(t('groups.right.pin')))!, 'click');
        expect(save.disabled).toBe(false);
        fire(save, 'click');

        await vi.waitFor(() => expect(server.groupPlaces[SLUG]?.['sara.k']?.rights).toEqual(['info', 'ban', 'pin']), { timeout: 4000 });
        expect(GROUP_RIGHTS.indexOf('ban')).toBeLessThan(GROUP_RIGHTS.indexOf('pin'));
    });

    it('mutes for a time or until lifted, drawn at the press, and lifts it', async () =>
    {
        const page = await ready();

        fire(buttonIn(sheetFor('mina'), t('groups.mute.24'))!, 'click');
        expect(rowOf(page, 'Mina Sadeghi')?.textContent, 'at the press').toContain(t('groups.mutedBadge'));
        await vi.waitFor(() => expect(server.groupPlaces[SLUG]?.mina?.muted?.until).toBeDefined(), { timeout: 4000 });
        await useGroupAdmin().refresh();
        expect(rowOf(page, 'Mina Sadeghi')?.textContent, 'as the server now says').toContain(t('groups.mutedBadge'));

        fire(buttonIn(sheetFor('mina'), t('groups.unmute'))!, 'click');
        expect(rowOf(page, 'Mina Sadeghi')?.textContent).not.toContain(t('groups.mutedBadge'));
        await vi.waitFor(() => expect(server.groupPlaces[SLUG]?.mina?.muted).toBeUndefined(), { timeout: 4000 });

        fire(buttonIn(sheetFor('mahsa'), t('groups.mute.ever'))!, 'click');
        await vi.waitFor(() => expect(server.groupPlaces[SLUG]?.mahsa?.muted).toEqual({}), { timeout: 4000 });
        expect(rowOf(page, 'Mahsa Nouri')?.textContent).toContain(t('groups.mutedBadge'));
    });

    it('removes and bans only once asked, and the member leaves the list at the press', async () =>
    {
        const page = await ready();

        fire(buttonIn(sheetFor('mahsa'), t('groups.remove'))!, 'click');
        await answer(false);
        expect(server.calls).not.toContain('groups.remove');
        expect(rowOf(page, 'Mahsa'), 'a no changes nothing').not.toBeNull();

        const removing = held('remove');
        fire(buttonIn(sheetFor('mahsa'), t('groups.remove'))!, 'click');
        await answer(true);
        expect(removing.spy, 'asked of the server').toHaveBeenCalled();
        expect(rowOf(page, 'Mahsa'), 'gone at the press').toBeNull();
        removing.release();
        await vi.waitFor(() => expect(crew().members).not.toContain('mahsa'), { timeout: 4000 });

        fire(buttonIn(sheetFor('leila.a'), t('groups.ban'))!, 'click');
        await answer(true);
        expect(rowOf(page, 'Leila')).toBeNull();
        await vi.waitFor(() => expect(server.groupBans[SLUG]).toEqual(['leila.a']), { timeout: 4000 });
    });

    it('hands the group on only once asked, and the old owner stands as an admin with every right', async () =>
    {
        const page = await ready();

        const handing = held('transfer');
        fire(buttonIn(sheetFor('sara.k'), t('groups.makeOwner'))!, 'click');
        await answer(true);

        expect(handing.spy, 'asked of the server').toHaveBeenCalled();
        expect(rowOf(page, 'Sara Kamali')?.textContent, 'at the press').toContain(t('groups.role.owner'));
        expect(rowOf(page, 'Alex Morgan')?.textContent, 'the old owner at the press').toContain(t('groups.role.admin'));
        handing.release();
        await vi.waitFor(() => expect(crew().owner).toBe('sara.k'), { timeout: 4000 });
        expect(server.groupPlaces[SLUG]?.alex).toEqual({ role: 'admin', rights: [...GROUP_RIGHTS] });
    });

    it('offers a moderator only to stop being one, and an admin only to stop being one or have rights changed', async () =>
    {
        server.groupPlaces[SLUG] = { 'sara.k': { role: 'moderator' }, mina: { role: 'admin', rights: ['pin'] } };
        const page = await ready();
        expect(names(page).slice(0, 3)).toEqual(['Alex Morgan', 'Mina Sadeghi', 'Sara Kamali']);

        const ofModerator = [...sheetFor('sara.k').querySelectorAll('button')].map((one) => one.textContent?.trim());
        expect(ofModerator).toContain(t('groups.unmakeModerator'));
        expect(ofModerator).not.toContain(t('groups.makeModerator'));
        expect(ofModerator).toContain(t('groups.makeAdmin'));

        const ofAdmin = [...sheetFor('mina').querySelectorAll('button')].map((one) => one.textContent?.trim());
        expect(ofAdmin).toContain(t('groups.unmakeAdmin'));
        expect(ofAdmin).toContain(t('groups.saveRights'));
        expect(ofAdmin).not.toContain(t('groups.makeAdmin'));
        expect(ofAdmin).not.toContain(t('groups.makeModerator'));
    });

    it('offers nothing a moderator may not do, and nothing about anybody at or above them', async () =>
    {
        server.groupPlaces[SLUG] = { alex: { role: 'moderator' }, mina: { role: 'admin', rights: [] } };
        crew().role = 'moderator';

        const container = opened();
        await vi.waitFor(() => expect(names(container)).toHaveLength(6), { timeout: 4000 });

        expect(manageOf(rowOf(container, 'Mina Sadeghi'), 'Mina Sadeghi'), 'an admin').toBeNull();
        expect(manageOf(rowOf(container, 'Babak Rostami'), 'Babak Rostami'), 'the owner').toBeNull();
        expect(manageOf(rowOf(container, 'Sara Kamali'), 'Sara Kamali'), 'a member they may mute').not.toBeNull();

        const sheet = sheetFor('sara.k');
        const offered = [...sheet.querySelectorAll('button')].map((one) => one.textContent?.trim()).filter(Boolean);

        expect(offered).toContain(t('groups.mute.ever'));
        expect(offered).not.toContain(t('groups.makeModerator'));
        expect(offered).not.toContain(t('groups.remove'));
        expect(offered).not.toContain(t('groups.ban'));
        expect(offered).not.toContain(t('groups.makeOwner'));
    });

    it('speaks the reader\'s language', async () =>
    {
        useLocale().setLocale('fa');
        const page = await ready();

        expect(rowOf(page, 'Babak Rostami')).not.toBeNull();
        const sheet = sheetFor('sara.k');
        expect(sheet.textContent).toContain('ناظر');
        expect(sheet.textContent).toContain(t('groups.manage', { name: 'Sara Kamali' }));
    });
});

describe('the members store', () =>
{
    it('keeps a change it was told went through until the members can be read again', async () =>
    {
        owned();
        const admin = useGroupAdmin();
        useGroups().open(SLUG);
        admin.open(SLUG);
        await vi.waitFor(() => expect(admin.members()).toHaveLength(6), { timeout: 4000 });

        const failing = vi.spyOn(client.groups, 'members').mockRejectedValue(new Error('down'));
        await admin.setRole('sara.k', 'moderator').catch(() => undefined);

        expect(memberOf('sara.k').role, 'the server said yes, and nothing has said otherwise').toBe('moderator');

        // Somebody else turned it back meanwhile: once the members are read, what the server says stands.
        failing.mockRestore();
        delete server.groupPlaces[SLUG]?.['sara.k'];
        await admin.refresh();
        expect(memberOf('sara.k').role).toBe('member');
    });

    it('opens another group with nothing searched and nothing guessed from the last one', async () =>
    {
        const admin = useGroupAdmin();
        admin.open(SLUG);
        admin.search('sar');
        admin.open('balcony-backgammon');

        expect(admin.query()).toBe('');
        await vi.waitFor(() => expect(server.calls).toContain('groups.members'), { timeout: 4000 });
    });

    it('lets go of a page that came back for a search the reader has since changed', async () =>
    {
        server.groupMembersPage = 2;
        const admin = useGroupAdmin();
        admin.open(SLUG);
        await vi.waitFor(() => expect(admin.hasMore()).toBe(true), { timeout: 4000 });

        let release: () => void = () => undefined;
        const original = client.groups.members.bind(client.groups);
        vi.spyOn(client.groups, 'members').mockImplementationOnce(((...args: Parameters<typeof original>) =>
            new Promise((resolve) =>
            {
                release = () => void original(...args).then(resolve);
            })) as never);

        const more = admin.more();
        admin.search('mina');
        await vi.waitFor(() => expect(admin.members().map((one: GroupMember) => one.person.handle)).toEqual(['mina']), { timeout: 4000 });
        release();
        await more;

        expect(admin.members().map((one) => one.person.handle)).toEqual(['mina']);
    });
});

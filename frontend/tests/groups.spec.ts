import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import ChatFace from '../src/components/chat/chat-face.component.azeroth';
import GroupCard from '../src/components/social/group-card.component.azeroth';
import GroupForm from '../src/components/social/group-form.component.azeroth';
import { CRESTS, crestOf } from '../src/data/crests.ts';
import { manualClock } from '../src/lib/clock.ts';
import { shrinkPicture } from '../src/lib/picture.ts';
import { isLineKey, LINE_KEYS } from '../src/lib/lines.ts';
import GroupPage from '../src/pages/app/group.page.azeroth';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { SEARCH_PAUSE_MS } from '../src/services/search.service.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useShell } from '../src/stores/shell.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import { PEOPLE_FIXTURES } from './fixtures.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/lib/picture.ts', () => ({
    shrinkPicture: vi.fn(async () => ({ data: 'AAAA', preview: 'data:image/webp;base64,AAAA' }))
}));

const UPLOADED = `${ window.location.origin }/avatars/${ 'ab'.repeat(32) }.webp`;

/** Hands the form's hidden chooser a file, as a person choosing one would. */
const choosePhoto = (container: HTMLElement) =>
{
    const chooser = container.querySelector<HTMLInputElement>('#group-photo')!;
    Object.defineProperty(chooser, 'files', { configurable: true, value: [new File(['x'], 'crew.png', { type: 'image/png' })] });
    fire(chooser, 'change');
};

let clock: ReturnType<typeof manualClock>;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
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
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        isMinor: false
    });
    useSocial().reset();
    useGroups().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useGroups().reset();
    useRealtime().reset();
    vi.restoreAllMocks();
});

describe('the group page', () =>
{
    const opened = (slug: string) =>
    {
        const routes: Route[] = [{ path: '/app/groups/:id', component: (): HTMLElement => GroupPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory(`/app/groups/${ slug }`), scroll: false });

        return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
    };

    it('says there is no such group for a slug nobody claimed, and does not offer to try again', async () =>
    {
        const container = opened('nobody-claimed-this');

        await vi.waitFor(() => expect(server.calls).toContain('groups.view'), { timeout: 4000 });
        await settle();

        expect(container.textContent).toContain(useLocale().t('groups.notFound'));
        expect(container.textContent).not.toContain(useLocale().t('state.errorTitle'));
        expect(useShell().title()).toBe(useLocale().t('groups.notFound'));
    });

    it('is titled as loading while the server is still being asked, never as a group that is not there', async () =>
    {
        const asked = vi.spyOn(client.groups, 'view').mockImplementationOnce(() => new Promise(() => undefined));

        try
        {
            const container = opened('friday-night-crew');

            await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(1), { timeout: 4000 });
            await settle();

            expect(useShell().title(), 'the bar says "No such group." over the placeholder').toBe(useLocale().t('common.loading'));
            expect(container.textContent).not.toContain(useLocale().t('groups.notFound'));
        }
        finally
        {
            asked.mockRestore();
        }
    });

    it('is titled as a group that could not be read when the read failed, not as one that is not there', async () =>
    {
        const asked = vi.spyOn(client.groups, 'view').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down.', undefined));

        try
        {
            const container = opened('friday-night-crew');

            await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

            expect(useShell().title()).toBe(useLocale().t('state.errorTitle'));
            expect(container.textContent).not.toContain(useLocale().t('groups.notFound'));
        }
        finally
        {
            asked.mockRestore();
        }
    });

    it('asks who the members are, so somebody the browser has not met is drawn among them', async () =>
    {
        usePeople().reset();
        server.groups.find((one) => one.slug === 'friday-night-crew')!.members.push('peyman');

        const container = opened('friday-night-crew');
        const listed = () => container.querySelector(`ul[aria-label="${ useLocale().t('groups.members') }"]`)?.textContent ?? '';

        await vi.waitFor(() => expect(usePeople().byHandle('peyman'), 'nobody asked who a member was').not.toBeNull(), { timeout: 4000 });
        await vi.waitFor(() => expect(listed()).toContain(useLocale().text(usePeople().byHandle('peyman')!.displayName)), { timeout: 4000 });
        expect(listed()).toContain(useLocale().text(usePeople().byHandle('mina')!.displayName));
    });

    it('offers to clear a search of the members that found nobody, and puts the keyboard back in the field', async () =>
    {
        server.groups.find((one) => one.slug === 'friday-night-crew')!.members.push('kian16', 'reza.t', 'nima.f', 'arash');

        const container = opened('friday-night-crew');
        const field = () => container.querySelector<HTMLInputElement>('input[type="search"]');
        const members = () => container.querySelectorAll(`ul[aria-label="${ useLocale().t('groups.members') }"] li`);

        await vi.waitFor(() => expect(field()).not.toBeNull(), { timeout: 4000 });

        const typed = field()!;

        typed.value = 'zzzz';
        typed.dispatchEvent(new Event('input', { bubbles: true }));
        clock.advance(SEARCH_PAUSE_MS);

        await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('search.empty', { query: 'zzzz' })), { timeout: 4000 });
        expect(members()).toHaveLength(0);

        const back = container.querySelector<HTMLButtonElement>('[data-way-back] button');

        expect(back?.textContent?.trim()).toBe(useLocale().t('search.clearQuery'));

        back!.click();
        await settle();

        expect(typed.value).toBe('');
        expect(document.activeElement).toBe(typed);
        await vi.waitFor(() => expect(members().length).toBeGreaterThan(8), { timeout: 4000 });
        expect(container.querySelector('[data-way-back]')).toBeNull();
    });

    it('opens what can be done with a member at a press on them, and draws no More beside the row', async () =>
    {
        const container = opened('friday-night-crew');
        const members = () => container.querySelector(`ul[aria-label="${ useLocale().t('groups.members') }"]`);

        await vi.waitFor(() => expect(members()?.querySelectorAll('li').length).toBeGreaterThan(2), { timeout: 4000 });
        await settle();
        useOverlay().reset();

        for (const row of members()!.querySelectorAll('li'))
        {
            const drawn = PEOPLE_FIXTURES.filter((one) => row.textContent?.includes(one.displayName));
            const person = row.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');

            expect(drawn, 'a member\'s row draws one person').toHaveLength(1);
            expect(person?.textContent, 'a member is not a press').toContain(drawn[0].displayName);
            expect([...row.querySelectorAll('button')].filter((one) => /^More/.test(one.getAttribute('aria-label') ?? '')), `${ drawn[0].displayName }'s row still has a More beside them`).toEqual([]);

            fire(person!, 'click');

            await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

            expect(useOverlay().items()[0].props).toMatchObject({ personId: drawn[0].handle });
            useOverlay().reset();
        }

        expect(members()!.querySelector('a[href^="/app/people/"]'), 'a member is still a link to their page').toBeNull();
    });

    it('does not say it could not load a group it is still loading', () =>
    {
        const container = opened('nobody-claimed-this');

        expect(container.textContent).not.toContain(useLocale().t('state.errorTitle'));
    });

    it('keeps what it has drawn when the group is read again, and still shows what changed', async () =>
    {
        const container = opened('friday-night-crew');

        await vi.waitFor(() => expect(container.querySelector('#group-name')).not.toBeNull(), { timeout: 4000 });
        await settle();

        const heading = container.querySelector('#group-name');
        const members = container.querySelector(`ul[aria-label="${ useLocale().t('groups.members') }"]`);
        const held = server.groups.find((one) => one.slug === 'friday-night-crew')!;
        const views = server.calls.filter((one) => one === 'groups.view').length;

        expect(members).not.toBeNull();

        held.name = 'Saturday Morning Crew';
        await useGroups().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'groups.view').length).toBeGreaterThan(views);
        expect(container.querySelector('#group-name')).toBe(heading);
        expect(container.querySelector(`ul[aria-label="${ useLocale().t('groups.members') }"]`)).toBe(members);
        expect(heading?.textContent).toBe('Saturday Morning Crew');
    });
});

describe('the crest set', () =>
{
    it('is closed, and a crest it has never heard of still draws something', () =>
    {
        expect(CRESTS.length).toBeGreaterThan(0);
        for (const crest of CRESTS)
        {
            expect(crestOf(crest)).toBe(crest);
        }

        // A row written by a newer server must not leave a blank square where a group's face is.
        expect(crestOf('crest-from-the-future')).toBe(CRESTS[0]);
        expect(crestOf('')).toBe(CRESTS[0]);
    });
});

describe('the group lines', () =>
{
    /**
     * The count is the point. A key without a producer is filler copy, and pinning the number is
     * what stops one being added "for later" - `lines.spec.ts` reads `services.ts` to prove each of
     * these is really written by something.
     *
     * `closed` and `opened` arrived with private groups, for the reason the expiry lines exist: a
     * rule about who can walk in is not something to change behind the room's back. `photo` came with
     * the group's picture, said as a renaming is, and `pinned` with pinned lines: who pinned one is
     * said in the room, and an unpin is not.
     */
    it('declares exactly the ten the group domain writes', () =>
    {
        for (const key of ['created', 'joined', 'left', 'removed', 'renamed', 'owner', 'closed', 'opened', 'photo', 'pinned'])
        {
            expect(isLineKey(`chat.line.group.${ key }`)).toBe(true);
        }
        expect(isLineKey('chat.line.group.exploded')).toBe(false);
        expect(LINE_KEYS.filter((key) => key.startsWith('chat.line.group.')).length).toBe(10);
    });
});

describe('the groups store', () =>
{
    /**
     * A private group is not a group you have not joined yet - it is one you are never told about.
     *
     * `newcomers-table` is the fixture's private one and alex is not in it, so these two are the
     * whole rule from the browser's side: it is absent from the list of groups to join, and asking
     * for it by slug answers exactly as a slug nobody ever claimed.
     */
    it('leaves a private group out of the groups anybody could join', async () =>
    {
        const groups = useGroups();
        groups.want();
        await groups.refresh();

        expect(groups.elsewhere().some((group) => group.id === 'newcomers-table')).toBe(false);
        expect(groups.elsewhere().length).toBeGreaterThan(0);
    });

    it('answers for a private group exactly as for a slug nobody claimed', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        groups.open('newcomers-table');
        await settle();

        expect(groups.viewing()).toBeNull();
        expect(groups.viewFailed()).toBeNull();
    });

    it('lists the groups this account is in, and nothing else', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const mine = groups.mine().map((group) => group.id);
        expect(mine).toContain('friday-night-crew');
        expect(mine).not.toContain('lunch-ludo');
        expect(server.calls).toContain('groups.mine');
    });

    it('does not fetch the discover list until a page asks for it', async () =>
    {
        const groups = useGroups();
        await groups.refresh();
        expect(server.calls).not.toContain('groups.discover');

        groups.want();
        await groups.refresh();

        expect(server.calls).toContain('groups.discover');
        expect(groups.elsewhere().map((group) => group.id)).toContain('lunch-ludo');
    });

    it('makes a group, and the maker owns it', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const made = await groups.create({ name: 'Sunday Hokm', blurb: 'Every week.', crest: 'crest-crown', hue: 40, game: 'hokm', privacy: 'public' });

        expect(made.slug).toBe('sunday-hokm');
        expect(made.role).toBe('owner');
        expect(made.owner).toBe('alex');
        expect(groups.mine().map((group) => group.id)).toContain('sunday-hokm');
    });

    it('keeps the slug when the name changes, because a url is a promise', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const made = await groups.create({ name: 'Sunday Hokm', blurb: '', crest: 'crest-crown', hue: 40, game: '', privacy: 'public' });
        const saved = await groups.edit(made.id, { name: 'Monday Hokm', blurb: 'Moved.', crest: 'crest-moon', game: 'hokm', privacy: 'public' });

        expect(saved.slug).toBe(made.slug);
        expect(saved.name).toBe('Monday Hokm');
        expect(saved.game).toBe('hokm');
    });

    it('joins and leaves, and gives up the thread on the way out', async () =>
    {
        const groups = useGroups();
        groups.want();
        await groups.refresh();

        await groups.join('lunch-ludo');
        expect(groups.mine().map((group) => group.id)).toContain('lunch-ludo');
        expect(groups.byId('lunch-ludo')?.conversationId).toBeDefined();

        await groups.leave('lunch-ludo');
        expect(groups.mine().map((group) => group.id)).not.toContain('lunch-ludo');
        expect(groups.byId('lunch-ludo')?.conversationId).toBeUndefined();
    });

    it('adds, removes and hands over, naming everybody by handle', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const made = await groups.create({ name: 'Small Room', blurb: '', crest: 'crest-cup', hue: 90, game: '', privacy: 'public' });

        await groups.add(made.id, 'sara.k');
        expect(groups.byId(made.id)?.members).toContain('sara.k');

        await groups.transfer(made.id, 'sara.k');
        expect(groups.byId(made.id)?.owner).toBe('sara.k');
        expect(groups.byId(made.id)?.role, 'the old owner stays on, as an admin').toBe('admin');

        await groups.remove(made.id, 'sara.k');
        expect(groups.byId(made.id)?.members).not.toContain('sara.k');
    });

    it('asks for a group by slug, and never by whatever id is on the next route', async () =>
    {
        const groups = useGroups();
        groups.open('friday-night-crew');
        await settle();
        server.calls = [];

        // The page used to track the route parameter, so leaving it re-ran the open with the NEXT
        // route's id - a conversation uuid - and put a 404 in the console on every navigation.
        groups.close();
        await settle();

        expect(server.calls).not.toContain('groups.view');
        expect(groups.viewing()).toBeNull();
    });

    it('calls a slug nobody claimed an answer, not a failure', async () =>
    {
        const groups = useGroups();
        groups.open('no-such-group');
        await settle();

        expect(groups.viewing()).toBeNull();
        expect(groups.viewFailed() ?? null).toBeNull();
    });

    it('forgets the open group when it is closed', async () =>
    {
        const groups = useGroups();
        groups.open('friday-night-crew');
        await settle();

        expect(groups.viewing()?.id).toBe('friday-night-crew');

        groups.close();
        await settle();
        expect(groups.openId()).toBe('');
    });

    it('re-reads itself when the social doorbell rings', async () =>
    {
        const groups = useGroups();
        const stop = groups.start();

        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await groups.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('groups.mine');
        stop();
    });

    it('ignores a doorbell meant for the chat list', async () =>
    {
        const groups = useGroups();
        const stop = groups.start();

        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await groups.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-1', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).not.toContain('groups.mine');
        stop();
    });
});

describe('the group form', () =>
{
    const open = (): { close: ReturnType<typeof vi.fn>; container: HTMLElement } =>
    {
        const close = vi.fn();
        const { container } = renderTest(() =>
            GroupForm({ overlayId: 'test', close }) as HTMLElement);
        return { close, container };
    };

    it('refuses a name that is not a name, and says which field', async () =>
    {
        const { close, container } = open();

        const form = container.querySelector('form')!;
        fire(form, 'submit');
        await settle();

        expect(close).not.toHaveBeenCalled();
        expect(server.calls).not.toContain('groups.create');
        expect(container.textContent).toContain('Give the group a name');

        const name = container.querySelector<HTMLInputElement>('#group-name')!;

        expect(name.getAttribute('aria-invalid')).toBe('true');
        expect(name.getAttribute('aria-describedby')).toBe('group-name-error');
        expect(document.activeElement, 'the keyboard was left on the button').toBe(name);
    });

    it('says a refusal of the whole form above the buttons, in what went wrong, and keeps what was typed', async () =>
    {
        vi.spyOn(client.groups, 'create').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Service unavailable', undefined));
        const { close, container } = open();

        const input = container.querySelector<HTMLInputElement>('#group-name')!;
        input.value = 'Tuesday Table';
        fire(input, 'input');
        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(container.querySelector('[data-failed]')?.textContent).toBe('The server is not answering right now. Try again in a moment.');
        expect(container.querySelector('[data-failed]')?.getAttribute('role')).toBe('alert');
        expect(close).not.toHaveBeenCalled();
        expect(input.value).toBe('Tuesday Table');

        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(container.querySelector('[data-failed]'), 'the old failure stayed through the next try').toBeNull();
        expect(close).toHaveBeenCalled();
    });

    it('says a name or a description the server refused under that box, until it is changed', async () =>
    {
        vi.spyOn(client.groups, 'create').mockRejectedValueOnce(new ApiError(422, 'validation-failed', 'Validation failed', {
            fields: { blurb: 'Too long' },
            issues: [{ path: 'blurb', code: 'max', message: 'Too long' }]
        }));
        const { container } = open();

        const name = container.querySelector<HTMLInputElement>('#group-name')!;
        const blurb = container.querySelector<HTMLInputElement>('#group-blurb')!;
        name.value = 'Tuesday Table';
        fire(name, 'input');
        blurb.value = 'Hokm on Tuesdays';
        fire(blurb, 'input');
        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(container.querySelector('#group-blurb-error')?.textContent).toBe('This is more than this field takes.');
        expect(blurb.getAttribute('aria-invalid')).toBe('true');
        expect(blurb.getAttribute('aria-describedby')).toBe('group-blurb-error');
        expect(document.activeElement).toBe(blurb);
        expect(container.querySelector('[data-failed]')).toBeNull();

        blurb.value = 'Hokm';
        fire(blurb, 'input');
        await settle();

        expect(container.querySelector('#group-blurb-error')).toBeNull();
    });

    it('sends exactly what was typed, and hands the group back', async () =>
    {
        const { close, container } = open();

        const input = container.querySelector<HTMLInputElement>('#group-name')!;
        input.value = 'Tuesday Table';
        fire(input, 'input');

        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(server.calls).toContain('groups.create');
        const made = server.groups.find((group) => group.name === 'Tuesday Table');
        expect(made).toBeDefined();
        expect(made!.slug).toBe('tuesday-table');
        expect(close).toHaveBeenCalled();
    });

    it('names its button for what it makes, as the table form does, in either language', () =>
    {
        const submit = (container: HTMLElement) => container.querySelector('form button[type="submit"]')?.textContent?.trim();

        expect(submit(open().container)).toBe('Create group');

        cleanup();
        useLocale().setLocale('fa');

        expect(submit(open().container)).toBe('ساخت گروه');
    });

    it('offers every crest and no others', () =>
    {
        const { container } = open();
        const buttons = [...container.querySelectorAll('button[aria-pressed]')]
            .filter((button) => button.getAttribute('aria-label')?.startsWith('Crest') === true);

        expect(buttons.length).toBe(CRESTS.length);
    });
});

describe('a group\'s photo, in the form that makes or edits one', () =>
{
    const opened = (group?: (typeof server.groups)[number]) =>
    {
        const close = vi.fn();
        const { container } = renderTest(() => GroupForm({ overlayId: 'test', close, ...(group === undefined ? {} : { group: structuredClone(group) }) }) as HTMLElement);
        return { close, container };
    };

    const named = (container: HTMLElement, name: string) =>
    {
        const input = container.querySelector<HTMLInputElement>('#group-name')!;
        input.value = name;
        fire(input, 'input');
    };

    /** The reader, alex, owns the first group. */
    const owned = () =>
    {
        const crew = server.groups[0];
        crew.owner = 'alex';
        crew.role = 'owner';
        return crew;
    };

    it('is shown the moment it is chosen, sent up only when the form is, and the group made with its address', async () =>
    {
        const { close, container } = opened();
        named(container, 'Tuesday Table');

        choosePhoto(container);
        await settle();

        expect(container.querySelector('[data-photo] img')?.getAttribute('src'), 'shown before anything is sent').toBe('data:image/webp;base64,AAAA');
        expect(server.calls, 'nothing sent at the choice').not.toContain('auth.avatar');

        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(server.uploaded).toBe('AAAA');
        expect(server.calls.indexOf('auth.avatar'), 'the photo first').toBeLessThan(server.calls.indexOf('groups.create'));
        expect(server.groups.find((group) => group.name === 'Tuesday Table')?.photo).toBe(UPLOADED);
        await vi.waitFor(() => expect(close).toHaveBeenCalled(), { timeout: 4000 });
    });

    it('is not sent again by a second try after the group was refused', async () =>
    {
        vi.spyOn(client.groups, 'create').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Service unavailable', undefined));
        const { close, container } = opened();
        named(container, 'Tuesday Table');
        choosePhoto(container);
        await settle();

        fire(container.querySelector('form')!, 'submit');
        await settle();
        expect(close).not.toHaveBeenCalled();
        expect(container.querySelector('[data-photo] img')?.getAttribute('src'), 'still shown').toBe(UPLOADED);

        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(server.calls.filter((call) => call === 'auth.avatar'), 'sent up once').toHaveLength(1);
        expect(server.groups.find((group) => group.name === 'Tuesday Table')?.photo).toBe(UPLOADED);
    });

    it('is left alone by an edit that does not touch it, and taken off when asked', async () =>
    {
        const crew = owned();
        crew.photo = `${ window.location.origin }/avatars/${ 'cd'.repeat(32) }.webp`;
        const edits = vi.spyOn(client.groups, 'edit');

        const kept = opened(crew);
        expect(kept.container.querySelector('[data-photo] img')?.getAttribute('src')).toBe(crew.photo);
        fire(kept.container.querySelector('form')!, 'submit');
        await settle();

        expect(edits.mock.calls[0]?.[0].input, 'no photo said').not.toHaveProperty('photo');
        expect(server.calls).not.toContain('auth.avatar');

        cleanup();
        const removing = opened(crew);
        fire([...removing.container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === useLocale().t('groups.photoRemove'))!, 'click');
        await settle();
        expect(removing.container.querySelector('[data-photo]'), 'the crest again at the press').toBeNull();

        fire(removing.container.querySelector('form')!, 'submit');
        await settle();

        expect(edits.mock.calls[1]?.[0].input.photo, 'taken off').toBe('');
        expect(server.groups[0].photo).toBeUndefined();
    });

    it('that cannot be read is said under its field, and nothing is sent for it', async () =>
    {
        vi.mocked(shrinkPicture).mockRejectedValueOnce(new Error('not a picture'));
        const { container } = opened();
        named(container, 'Tuesday Table');

        choosePhoto(container);
        await settle();

        expect(container.querySelector('#group-photo-error')?.textContent).toBe(useLocale().t('profile.pictureFailed'));
        expect(container.querySelector('[data-photo]')).toBeNull();

        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(server.calls).not.toContain('auth.avatar');
        expect(server.groups.find((group) => group.name === 'Tuesday Table')?.photo).toBeUndefined();
    });

    it('is drawn beside the doors only for whoever may open and close them', async () =>
    {
        const doors = (container: HTMLElement) => [...container.querySelectorAll('legend')].some((one) => one.textContent === useLocale().t('groups.privacy'));

        expect(doors(opened().container), 'whoever makes a group owns it').toBe(true);
        cleanup();

        const crew = owned();
        expect(doors(opened(crew).container), 'the owner').toBe(true);
        cleanup();

        crew.owner = 'babak.r';
        crew.role = 'admin';
        crew.rights = ['info'];
        const edits = vi.spyOn(client.groups, 'edit');
        const admin = opened(crew);
        expect(doors(admin.container), 'an admin changes how it looks, not who comes in').toBe(false);

        fire(admin.container.querySelector('form')!, 'submit');
        await settle();
        expect(edits.mock.calls[0]?.[0].input.privacy, 'the doors kept as they are').toBe(crew.privacy);
    });
});

describe('who may change a group, from its page', () =>
{
    const SLUG = 'friday-night-crew';

    const crew = () => server.groups.find((one) => one.slug === SLUG)!;

    const opened = async () =>
    {
        const routes: Route[] = [{ path: '/app/groups/:id', component: (): HTMLElement => GroupPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory(`/app/groups/${ SLUG }`), scroll: false });
        const container = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;

        await vi.waitFor(() => expect(container.querySelector('h1#group-name')).not.toBeNull(), { timeout: 4000 });
        await settle();
        return container;
    };

    const offered = (container: HTMLElement) =>
        [...container.querySelectorAll('button[aria-label]')].map((one) => one.getAttribute('aria-label'));

    it('offers a member neither Edit nor Add while the owner keeps both to the staff', async () =>
    {
        crew().switches = { ...crew().switches, info: false, add: false };

        const container = await opened();

        expect(offered(container)).not.toContain(useLocale().t('groups.edit'));
        expect(offered(container)).not.toContain(useLocale().t('groups.add'));
    });

    it('offers a member both once the owner lets members change how it looks and add people', async () =>
    {
        crew().switches = { ...crew().switches, info: true, add: true };

        const container = await opened();

        expect(offered(container)).toContain(useLocale().t('groups.edit'));
        expect(offered(container)).toContain(useLocale().t('groups.add'));
    });

    it('draws its photo in its head, and its crest when it has none', async () =>
    {
        crew().photo = UPLOADED;
        const pictured = await opened();
        expect(pictured.querySelector('section[aria-labelledby="group-name"] [data-photo] img')?.getAttribute('src')).toBe(UPLOADED);

        cleanup();
        useGroups().reset();
        delete crew().photo;
        const plain = await opened();
        expect(plain.querySelector('section[aria-labelledby="group-name"] [data-photo]')).toBeNull();
    });

    it('is drawn by its photo beside its thread in the chat list', async () =>
    {
        crew().photo = UPLOADED;
        await useGroups().refresh();

        const room = { id: 'conv-friday-night-crew', expireAfter: null, kind: 'group' as const, participants: crew().members, groupId: SLUG, tableId: null, game: null, title: null, pinned: false, lastReadAt: 0, quiet: false };
        const face = renderTest(() => ChatFace({ conversation: room, me: 'alex' }) as HTMLElement).container;
        await settle();

        expect(face.querySelector('[data-photo] img')?.getAttribute('src')).toBe(UPLOADED);
    });

    it('offers an admin Edit by the info right and Add by the invite right, whatever members may do', async () =>
    {
        crew().switches = { ...crew().switches, info: false, add: false };
        crew().role = 'admin';
        crew().rights = ['info'];

        const container = await opened();

        expect(offered(container)).toContain(useLocale().t('groups.edit'));
        expect(offered(container), 'no invite right').not.toContain(useLocale().t('groups.add'));
    });
});

describe('a group\'s card', () =>
{
    const drawn = (changes: Partial<(typeof server.groups)[number]> = {}) =>
    {
        const group = { ...server.groups[0], ...changes };
        const routes: Route[] = [{ path: '/app/friends', component: (): HTMLElement => GroupCard({ group }) as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/app/friends'), scroll: false });

        return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
    };

    const online = (who: string) =>
    {
        useRealtime().start();
        socket.accept();
        socket.deliver({ v: 1, t: 'presence', n: 2, full: true, people: [{ who, state: 'online', since: clock.now() }] });
    };

    it.each(['en', 'fa'] as const)('sets its facts apart with a drawn dot, never a character a Persian reader takes for a zero, in %s', (language) =>
    {
        useLocale().setLocale(language);
        online(server.groups[0].members[0]);

        const container = drawn({ game: 'hokm' });
        const facts = container.querySelector('[data-facts]')!;

        expect(facts.textContent).not.toContain('·');
        expect(facts.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
        expect(facts.textContent).toContain(useLocale().t('games.hokm.name'));
    });

    it('draws no dot before a fact that is not there', () =>
    {
        const container = drawn({ game: undefined });
        const facts = container.querySelector('[data-facts]')!;

        expect(facts.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
        expect(facts.textContent).not.toContain('·');
    });

    it('draws the group\'s photo when it has one, and its crest otherwise', async () =>
    {
        const plain = drawn();
        await settle();
        expect(plain.querySelector('[data-photo]')).toBeNull();
        expect(plain.querySelector('[aria-hidden="true"] svg'), 'the crest').not.toBeNull();

        cleanup();
        const pictured = drawn({ photo: UPLOADED });
        await settle();
        expect(pictured.querySelector('[data-photo] img')?.getAttribute('src')).toBe(UPLOADED);
    });
});

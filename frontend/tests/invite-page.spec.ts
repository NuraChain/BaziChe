import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route } from 'azerothjs';

import ConfirmSheet from '../src/components/app/confirm-sheet.component.azeroth';
import InvitePage from '../src/pages/app/invite.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { qrOf } from '../src/lib/qr.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useInvites } from '../src/stores/invites.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { Account, InviteBoard, InvitedPeople } from '../../backend/src/schemas.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const SOURCES = import.meta.glob(
    ['../src/pages/app/invite.page.azeroth', '../src/components/social/lazy-invite-campaign.component.azeroth', '../src/components/social/top-inviters.component.azeroth'],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

let clock: ManualClock;
let seq = 0;

const LINK = 'http://localhost:3100/join/ABCD2345';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const page = async (at = '/app/invite', minor = false) =>
{
    seq += 1;
    const account: Account = { id: `u-invite-${ seq }`, handle: `host${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: minor, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };
    server.account = account;
    useSession().establish(account);

    const table: Route[] = [{ path: '/app/invite', component: () => InvitePage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });
    const rendered = renderTest(() => RouterProvider({ router, children: () => InvitePage({}) as unknown as HTMLElement }) as HTMLElement);

    await settle();
    await settle();

    return { ...rendered, router, me: account.handle };
};

/** Somebody who joined through the reader's link, the `at`th minute after ten. */
const friend = (at: number, played = false): InvitedPeople['people'][number] => ({
    person: { handle: `friend${ at }`, displayName: `Friend ${ at }`, hue: (at * 37) % 360 },
    joinedAt: new Date(Date.parse('2026-10-30T10:00:00.000Z') + at * 60_000).toISOString(),
    played
});

/** Somebody among the top inviters, in their place, with the friends of theirs who played. */
const placed = (place: number, handle: string, friends: number): InviteBoard['rows'][number] => ({
    place,
    person: { handle, displayName: `Name of ${ handle }`, hue: (place * 41) % 360 },
    friends
});

const tab = (root: ParentNode, words: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((one) => one.textContent?.trim() === words) ?? null;

const panel = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-panel="${ id }"]`)!;

const inviters = (root: ParentNode) => [...root.querySelectorAll('[data-inviter]')].map((one) => one.getAttribute('data-inviter'));

const boardReads = () => server.calls.filter((call) => call === 'invites.board').length;

const said = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();

const rows = (root: ParentNode) => [...root.querySelectorAll('[data-invited]')].map((one) => one.getAttribute('data-invited'));

const buttonNamed = (root: ParentNode, words: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === words) ?? null;

const linkNamed = (root: ParentNode, words: string) =>
    [...root.querySelectorAll<HTMLAnchorElement>('a')].find((one) => one.textContent?.trim() === words) ?? null;

const count = (root: ParentNode, what: string) => root.querySelector(`[data-came="${ what }"] dd`)?.textContent?.trim();

const toasts = () => useToasts().items().map((one) => one.text);

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing') ?? null;

const answered = async (answer: unknown) =>
{
    useOverlay().close(asked()!.id, answer);
    await settle();
};

const stubShare = (share: (data: ShareData) => Promise<void>) =>
{
    const before = { share: Object.getOwnPropertyDescriptor(navigator, 'share'), canShare: Object.getOwnPropertyDescriptor(navigator, 'canShare') };

    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });

    return () =>
    {
        for (const [name, held] of Object.entries(before))
        {
            if (held === undefined)
            {
                Reflect.deleteProperty(navigator, name);
            }
            else
            {
                Object.defineProperty(navigator, name, held);
            }
        }
    };
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(Date.parse('2026-10-30T12:00:00.000Z'));
    setRuntime({ clock, seed: 7 });
    server.reset();
    socket.reset();
    useRealtime().reset();
    useInvites().reset();
    useOverlay().reset();
    useToasts().reset();
    usePeople().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useInvites().reset();
    useOverlay().reset();
    useSession().reset();
    vi.restoreAllMocks();
});

describe('the reader\'s invite link', () =>
{
    it('shows the link, a code to scan that is that link, what came of it and the code it carries', async () =>
    {
        server.myInvites.summary = { ...server.myInvites.summary, visits: 3, joined: 2, played: 1 };
        const { container } = await page();

        expect(container.querySelector('[data-invite-url]')?.textContent).toBe(LINK);
        expect(container.querySelector('[data-invite-url]')?.getAttribute('dir')).toBe('ltr');
        expect(container.querySelector('[data-invite-code]')?.textContent).toBe('ABCD2345');

        const qr = container.querySelector('[data-invite-qr]')!;
        const drawn = qrOf(LINK);

        expect(qr.querySelector('path')?.getAttribute('d'), 'the drawing is the code for the link and nothing else').toBe(drawn.path);
        expect(qr.getAttribute('viewBox')).toBe(`-4 -4 ${ drawn.size + 8 } ${ drawn.size + 8 }`);
        expect(qr.getAttribute('aria-label')).toBe('QR code of your invite link');
        expect([count(container, 'visits'), count(container, 'joined'), count(container, 'played')]).toEqual(['3', '2', '1']);
        expect(container.textContent).toContain('Made 2 hours ago');
        expect(server.calls.filter((call) => call.startsWith('invites.'))).toEqual(['invites.summary', 'invites.people']);
    });

    it('copies the link, and says so once it is copied', async () =>
    {
        const wrote = vi.fn(async () => undefined);
        const before = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: wrote } });

        try
        {
            const { container } = await page();

            fire(buttonNamed(container, 'Copy')!, 'click');
            await settle();

            expect(wrote).toHaveBeenCalledWith(LINK);
            expect(toasts()).toContain('Link copied');
        }
        finally
        {
            if (before === undefined)
            {
                Reflect.deleteProperty(navigator, 'clipboard');
            }
            else
            {
                Object.defineProperty(navigator, 'clipboard', before);
            }
        }
    });

    it('sends it with WhatsApp, Telegram and email, each with the words and the link written', async () =>
    {
        const { container } = await page();
        const text = 'Come and play Ludo, Hokm, backgammon, poker and chess with me on Baziche.';

        const whatsapp = linkNamed(container, 'WhatsApp')!;
        const telegram = linkNamed(container, 'Telegram')!;
        const email = linkNamed(container, 'Email')!;

        expect(whatsapp.getAttribute('href')).toBe(`https://wa.me/?text=${ encodeURIComponent(`${ text } ${ LINK }`) }`);
        expect(telegram.getAttribute('href')).toBe(`https://t.me/share/url?url=${ encodeURIComponent(LINK) }&text=${ encodeURIComponent(text) }`);
        expect(email.getAttribute('href')).toBe(`mailto:?subject=${ encodeURIComponent('Play with me on Baziche') }&body=${ encodeURIComponent(`${ text }\n\n${ LINK }`) }`);
        expect([whatsapp.target, whatsapp.rel, telegram.target, telegram.rel]).toEqual(['_blank', 'noopener noreferrer', '_blank', 'noopener noreferrer']);
        expect(email.hasAttribute('target'), 'the mail app opens in place').toBe(false);
        expect(buttonNamed(container, 'Share'), 'no system sheet where the browser has none').toBeNull();
    });

    it('hands the link to the system\'s own sheet where there is one, saying nothing when the reader closes it', async () =>
    {
        const shared: ShareData[] = [];
        let refuse: string | null = null;
        const put = stubShare(async (data) =>
        {
            shared.push(data);

            if (refuse !== null)
            {
                throw new DOMException('no', refuse);
            }
        });

        try
        {
            const { container } = await page();
            const share = buttonNamed(container, 'Share')!;

            fire(share, 'click');
            await settle();

            expect(shared).toEqual([{ title: 'Play with me on Baziche', text: 'Come and play Ludo, Hokm, backgammon, poker and chess with me on Baziche.', url: LINK }]);

            refuse = 'AbortError';
            fire(share, 'click');
            await settle();
            expect(toasts(), 'a sheet the reader closed is no failure').toEqual([]);

            refuse = 'NotAllowedError';
            fire(share, 'click');
            await settle();
            expect(toasts()).toEqual(['Your browser would not share it. Copy the link instead.']);
        }
        finally
        {
            put();
        }
    });

    it('says the link could not be read, never that there is none, and reads it again when asked', async () =>
    {
        server.myInvites.refuse = 'summary';
        const { container } = await page();

        expect(container.textContent).toContain('Your invite link could not be read.');
        expect(container.querySelector('[data-invite-url]')).toBeNull();

        server.myInvites.refuse = null;
        fire(buttonNamed(container, 'Try again')!, 'click');
        await settle();

        expect(container.querySelector('[data-invite-url]')?.textContent).toBe(LINK);
    });

    it('reads in the reader\'s language and digits, the link and the code left to right', async () =>
    {
        useLocale().setLocale('fa');
        server.myInvites.summary = { ...server.myInvites.summary, visits: 12 };
        const { container } = await page();

        expect(container.textContent).toContain('لینک دعوتت');
        expect(count(container, 'visits')).toBe('۱۲');
        expect(container.querySelector('[data-invite-code]')?.getAttribute('dir')).toBe('ltr');
        expect(linkNamed(container, 'واتس‌اپ')?.getAttribute('href')).toContain(encodeURIComponent('بیا با هم توی بازیچه'));
    });
});

describe('the friends it brought in', () =>
{
    it('lists them newest first, twenty at a time, each with when they joined and how far they got', async () =>
    {
        server.myInvites.people = Array.from({ length: 25 }, (_, at) => friend(24 - at, at % 2 === 0));
        const { container } = await page();

        expect(rows(container)).toHaveLength(20);
        expect(rows(container)[0]).toBe('friend24');

        const first = container.querySelector('[data-invited="friend24"]')!;

        expect(first.textContent).toContain('Friend 24');
        expect(first.querySelector('.facts [dir="ltr"]')?.textContent).toBe('@friend24');
        expect(first.querySelector('.facts > [dir="ltr"]'), 'a handle in a line of facts keeps its dot on the line\'s own side').toBeNull();
        expect(first.textContent).toContain('Joined 2 hr. ago');
        expect([first.getAttribute('data-step'), first.lastElementChild?.textContent?.trim()]).toEqual(['played', 'Played']);

        const second = container.querySelector('[data-invited="friend23"]')!;

        expect([second.getAttribute('data-step'), second.lastElementChild?.textContent?.trim()]).toEqual(['joined', 'Joined']);

        const kept = first;

        fire(buttonNamed(container, 'Show more')!, 'click');
        await settle();

        expect(rows(container)).toHaveLength(25);
        expect(rows(container).at(-1)).toBe('friend0');
        expect(container.querySelector('[data-invited="friend24"]'), 'a row already drawn is the node it was').toBe(kept);
        expect(buttonNamed(container, 'Show more')).toBeNull();
        expect(server.calls.filter((call) => call.startsWith('invites.people'))).toEqual(['invites.people', 'invites.people 20']);
    });

    it('keeps the rows and the way to more when a later page is refused, and reads that page when asked again', async () =>
    {
        server.myInvites.people = Array.from({ length: 25 }, (_, at) => friend(24 - at));
        const { container } = await page();

        server.myInvites.refuse = 'people';
        fire(buttonNamed(container, 'Show more')!, 'click');
        await settle();

        expect(rows(container)).toHaveLength(20);
        expect(container.textContent).not.toContain('Your friends could not be read just now.');

        server.myInvites.refuse = null;
        fire(buttonNamed(container, 'Show more')!, 'click');
        await settle();

        expect(rows(container)).toHaveLength(25);
        expect(server.calls.filter((call) => call.startsWith('invites.people'))).toEqual(['invites.people', 'invites.people 20', 'invites.people 20']);
    });

    it('lets go of what it read once the page is gone, so nothing of it is drawn before the next read', async () =>
    {
        server.myInvites.people = [friend(1)];
        const { unmount } = await page();

        expect(useInvites().summary()?.code).toBe('ABCD2345');
        unmount();

        expect([useInvites().summary(), useInvites().people()]).toEqual([null, []]);
    });

    it('says a friend who joined a moment ago joined now, on a device a few seconds behind the server', async () =>
    {
        server.myInvites.people = [{ ...friend(1), joinedAt: '2026-10-30T12:00:05.000Z' }];
        server.myInvites.summary = { ...server.myInvites.summary, since: '2026-10-30T12:00:03.000Z' };
        const { container } = await page();

        expect(container.querySelector('[data-invited="friend1"]')?.textContent).toContain('Joined now');
        expect(container.textContent).toContain('Made now');
    });

    it('asks who they are once a page lands, so the sheet about one names them', async () =>
    {
        server.myInvites.people = [{ person: { handle: 'mina', displayName: 'Mina Sadeghi', hue: 280 }, joinedAt: '2026-10-30T10:00:00.000Z', played: true }];
        await page();

        expect(server.calls).toContain('social.names');
        expect(usePeople().byHandle('mina')?.displayName).toBe('Mina Sadeghi');
    });

    it('opens the sheet about a friend at a press of them', async () =>
    {
        server.myInvites.people = [friend(1)];
        const { container } = await page();

        fire(container.querySelector('[data-invited="friend1"] button')!, 'click');
        await vi.waitFor(() => expect(asked()?.props.personId).toBe('friend1'));
    });

    it('says nobody joined yet only once the server has said so', async () =>
    {
        server.myInvites.hold = new Promise(() => undefined);
        const held = await page();

        expect(held.container.querySelector('[data-invite-nobody]'), 'nothing said before the server answers').toBeNull();
        held.unmount();
        cleanup();
        useInvites().reset();

        server.myInvites.hold = null;
        const { container } = await page();

        expect(container.querySelector('[data-invite-nobody]')?.textContent).toContain('Nobody has joined through your link yet.');
    });

    it('says the list could not be read, never that nobody joined, and tries again', async () =>
    {
        server.myInvites.refuse = 'people';
        server.myInvites.people = [friend(1)];
        const { container } = await page();

        expect(container.querySelector('[data-invite-nobody]')).toBeNull();
        expect(container.textContent).toContain('Your friends could not be read just now.');

        server.myInvites.refuse = null;
        fire(buttonNamed(container, 'Try again')!, 'click');
        await settle();

        expect(rows(container)).toEqual(['friend1']);
    });
});

describe('a new code', () =>
{
    it('is asked about first as something that cannot be undone, and changes nothing until the reader says yes', async () =>
    {
        const { container } = await page();

        fire(buttonNamed(container, 'Make a new code')!, 'click');
        await settle();

        expect(asked()?.component).toBe(ConfirmSheet);
        expect(asked()?.props).toMatchObject({ title: 'Make a new invite code?', destructive: true, confirm: 'Make a new code' });

        await answered(false);

        expect(server.calls).not.toContain('invites.renew');
        expect(container.querySelector('[data-invite-code]')?.textContent).toBe('ABCD2345');
    });

    it('takes the new code\'s link, says it is ready, and says when the next may be made', async () =>
    {
        const { container } = await page();

        fire(buttonNamed(container, 'Make a new code')!, 'click');
        await settle();
        await answered(true);

        expect(server.calls).toContain('invites.renew');
        expect(container.querySelector('[data-invite-code]')?.textContent).toBe('WXYZ6789');
        expect(container.querySelector('[data-invite-url]')?.textContent).toBe('http://localhost:3100/join/WXYZ6789');
        expect(container.querySelector('[data-invite-qr] path')?.getAttribute('d')).toBe(qrOf('http://localhost:3100/join/WXYZ6789').path);
        expect(toasts()).toContain('Your new code is ready. Share the new link.');
        expect(container.querySelector('[data-invite-next]')?.textContent).toContain('You can make another one tomorrow.');
        expect(buttonNamed(container, 'Make a new code')?.disabled).toBe(true);
    });

    it('offers itself again once the day is over', async () =>
    {
        server.myInvites.summary = { ...server.myInvites.summary, next: '2026-10-30T12:30:00.000Z' };
        const { container } = await page();

        expect(buttonNamed(container, 'Make a new code')?.disabled).toBe(true);
        expect(container.querySelector('[data-invite-next]')?.textContent).toContain('in 30 minutes');

        clock.advance(31 * 60_000);
        await settle();

        expect(buttonNamed(container, 'Make a new code')?.disabled).toBe(false);
        expect(container.querySelector('[data-invite-next]')).toBeNull();
    });

    it('refused as too soon, says so and shows when the next may be made', async () =>
    {
        server.myInvites.soon = '2026-10-31T09:00:00.000Z';
        const { container } = await page();

        fire(buttonNamed(container, 'Make a new code')!, 'click');
        await settle();
        await answered(true);
        await settle();

        expect(toasts()).toContain('You made a new code less than a day ago.');
        expect(container.querySelector('[data-invite-code]')?.textContent).toBe('ABCD2345');
        expect(container.querySelector('[data-invite-next]')?.textContent).toContain('in 21 hours');
    });

    it('is one request however often it is pressed while it is out, and a failure says what it was', async () =>
    {
        let let_go = (): void => undefined;
        server.myInvites.hold = new Promise((resolve) => (let_go = () => resolve()));
        const invites = useInvites();
        const first = invites.renew();
        const second = invites.renew();

        expect(second).toBe(first);
        let_go();
        await settle();
        expect(await first).toBeNull();
        expect(server.calls.filter((call) => call === 'invites.renew')).toHaveLength(1);

        server.myInvites.hold = null;
        server.myInvites.refuse = 'renew';
        expect(await invites.renew()).toBe('failure.down');
    });

    it('says a failure on the page in the words of what went wrong', async () =>
    {
        server.myInvites.refuse = 'renew';
        const { container } = await page();

        fire(buttonNamed(container, 'Make a new code')!, 'click');
        await settle();
        await answered(true);
        await settle();

        expect(toasts()).toContain('The server is not answering right now. Try again in a moment.');
        expect(container.querySelector('[data-invite-code]')?.textContent).toBe('ABCD2345');
    });
});

describe('the top inviters', () =>
{
    it('are a tab of their own, kept in the address, read each time it is opened and never before', async () =>
    {
        const { container, router } = await page();

        expect(panel(container, 'link').hidden).toBe(false);
        expect(panel(container, 'top').hidden).toBe(true);
        expect(tab(container, 'Your link')?.getAttribute('aria-selected')).toBe('true');
        expect(boardReads()).toBe(0);

        fire(tab(container, 'Top inviters')!, 'click');
        await settle();

        expect(router.location().query.tab).toBe('top');
        expect(panel(container, 'link').hidden).toBe(true);
        expect(panel(container, 'top').hidden).toBe(false);
        expect(boardReads()).toBe(1);

        fire(tab(container, 'Your link')!, 'click');
        await settle();

        expect(router.location().query.tab).toBeUndefined();
        expect(panel(container, 'link').hidden).toBe(false);
        expect(container.querySelector('[data-invite-url]')?.textContent).toBe(LINK);

        fire(tab(container, 'Top inviters')!, 'click');
        await settle();

        expect(boardReads()).toBe(2);
    });

    it('opens on them when the address says so, and on the link for a word it does not know', async () =>
    {
        const first = await page('/app/invite?tab=top');

        expect(panel(first.container, 'top').hidden).toBe(false);
        expect(boardReads()).toBe(1);

        cleanup();
        server.reset();
        const second = await page('/app/invite?tab=nowhere');

        expect(panel(second.container, 'link').hidden).toBe(false);
        expect(panel(second.container, 'top').hidden).toBe(true);
        expect(boardReads()).toBe(0);
    });

    it('places each inviter by the friends who played, marks the reader\'s own row, and opens the sheet about whoever is pressed', async () =>
    {
        const { container, me } = await page();
        server.myInvites.board = { listed: true, campaign: { name: 'Spring' }, rows: [placed(1, 'sara', 5), placed(2, me, 3), placed(3, 'omid', 1)], me: { place: 2, friends: 3 } };

        fire(tab(container, 'Top inviters')!, 'click');
        await settle();

        expect(container.querySelector('[data-top-scope]')?.textContent).toBe('Friends who played during “Spring”');
        expect(inviters(container)).toEqual(['sara', me, 'omid']);
        expect([...container.querySelectorAll('[data-place]')].map((one) => said(one))).toEqual(['1', '2', '3']);
        expect([...container.querySelectorAll('[data-friends]')].map((one) => said(one))).toEqual(['5 friends', '3 friends', '1 friend']);
        expect(container.querySelector(`[data-inviter="${ me }"] [data-you]`)?.classList.contains('hidden')).toBe(false);
        expect(container.querySelector('[data-inviter="sara"] [data-you]')?.classList.contains('hidden')).toBe(true);
        expect(container.querySelector('[data-top-past]')).toBeNull();
        expect(container.querySelector('[data-top-absent]')).toBeNull();

        fire(container.querySelector('[data-inviter="sara"] button')!, 'click');
        await vi.waitFor(() => expect(asked()?.props.personId).toBe('sara'));
    });

    it('asks who the people on it are once it lands, so the sheet about one names them', async () =>
    {
        const { container } = await page();
        server.myInvites.board = { listed: true, rows: [{ place: 1, person: { handle: 'sara.k', displayName: 'Sara Kamali', hue: 340 }, friends: 4 }] };
        const before = server.calls.filter((call) => call === 'social.names').length;

        fire(tab(container, 'Top inviters')!, 'click');
        await settle();

        expect(server.calls.filter((call) => call === 'social.names').length).toBe(before + 1);
        expect(usePeople().byHandle('sara.k')?.displayName).toBe('Sara Kamali');
    });

    it('says where the reader stands past the twenty, and that they are not on it yet when they are nowhere', async () =>
    {
        server.myInvites.board = { listed: true, rows: Array.from({ length: 20 }, (_, at) => placed(at + 1, `top${ at + 1 }`, 30 - at)), me: { place: 23, friends: 2 } };
        const { container } = await page('/app/invite?tab=top');

        expect(container.querySelector('[data-top-scope]')?.textContent).toBe('Friends who played, all time');
        expect(inviters(container)).toHaveLength(20);
        expect([...container.querySelectorAll('[data-top-past] > span')].map((one) => said(one))).toEqual(['Your place: 23', '2 friends']);
        expect(container.querySelector('[data-top-absent]')).toBeNull();

        server.myInvites.board = { listed: true, rows: [placed(1, 'sara', 5)] };
        fire(tab(container, 'Your link')!, 'click');
        await settle();
        fire(tab(container, 'Top inviters')!, 'click');
        await settle();

        expect(container.querySelector('[data-top-past]')).toBeNull();
        expect(container.querySelector('[data-top-absent]')?.textContent).toBe('You are not on it yet. A friend who joins through your link and plays a game puts you there.');
    });

    it('says the reader chose not to be shown, with the way to the switch in Settings, and nothing about a place', async () =>
    {
        server.myInvites.listed = false;
        server.myInvites.board = { listed: true, rows: [placed(1, 'sara', 5)] };
        const { container } = await page('/app/invite?tab=top');

        const settings = linkNamed(container, 'Change it in Settings')?.getAttribute('href') ?? '';

        expect(container.querySelector('[data-top-hidden]')?.textContent).toContain('You chose not to be shown here.');
        expect(settings).toBe('/app/me/settings#settings-safety');
        expect(routes.find((one) => one.path === '/app')?.children?.some((one) => `/app/${ one.path }` === settings.split('#')[0])).toBe(true);
        expect(container.querySelector('[data-top-absent]')).toBeNull();
        expect(container.querySelector('[data-top-minor]')).toBeNull();
    });

    it('tells somebody under 18 that they are never shown, and offers them nothing to change', async () =>
    {
        server.myInvites.board = { listed: true, rows: [placed(1, 'sara', 5)] };
        const { container } = await page('/app/invite?tab=top', true);

        expect(container.querySelector('[data-top-minor]')?.textContent).toBe('Players under 18 are not shown here.');
        expect(container.querySelector('[data-top-absent]')).toBeNull();
        expect(container.querySelector('[data-top-hidden]')).toBeNull();
    });

    it('says nobody is on it only once the server has said so', async () =>
    {
        const { container } = await page();
        let let_go = (): void => undefined;
        server.myInvites.hold = new Promise((resolve) => (let_go = () => resolve()));

        fire(tab(container, 'Top inviters')!, 'click');
        await settle();

        expect(container.querySelector('[data-top-empty]')).toBeNull();
        expect(panel(container, 'top').textContent).not.toContain('could not be read');

        server.myInvites.hold = null;
        let_go();
        await settle();

        expect(container.querySelector('[data-top-empty]')?.textContent).toBe('Nobody is on it yet.');
    });

    it('says the board could not be read, never that nobody is on it, and reads it again at Try again', async () =>
    {
        server.myInvites.refuse = 'board';
        const { container } = await page('/app/invite?tab=top');

        expect(panel(container, 'top').textContent).toContain('The top inviters could not be read.');
        expect(container.querySelector('[data-top-empty]')).toBeNull();

        server.myInvites.refuse = null;
        server.myInvites.board = { listed: true, rows: [placed(1, 'sara', 5)] };
        fire(buttonNamed(panel(container, 'top'), 'Try again')!, 'click');
        await settle();

        expect(inviters(container)).toEqual(['sara']);
    });

    it('keeps every row when the board is read again', async () =>
    {
        server.myInvites.board = { listed: true, rows: [placed(1, 'sara', 5), placed(2, 'omid', 1)] };
        const { container } = await page('/app/invite?tab=top');
        const before = [...container.querySelectorAll('[data-inviter]')];

        fire(tab(container, 'Your link')!, 'click');
        await settle();
        fire(tab(container, 'Top inviters')!, 'click');
        await settle();

        expect(boardReads()).toBe(2);
        expect(before).toHaveLength(2);
        expect(before.every((row) => container.contains(row))).toBe(true);
    });

    it('draws nothing of a read that lands once the page has gone', async () =>
    {
        await page();
        let let_go = (): void => undefined;
        server.myInvites.hold = new Promise((resolve) => (let_go = () => resolve()));
        server.myInvites.board = { listed: true, rows: [placed(1, 'sara', 5)] };
        const invites = useInvites();

        invites.readBoard();
        cleanup();
        server.myInvites.hold = null;
        let_go();
        await settle();

        expect(invites.board()).toBeNull();
    });

    it('reads in Persian, in the reader\'s digits', async () =>
    {
        useLocale().setLocale('fa');
        server.myInvites.board = { listed: true, campaign: { name: 'Spring' }, rows: [placed(1, 'sara', 12)] };
        const { container } = await page('/app/invite?tab=top');

        expect(tab(container, 'بهترین دعوت‌کننده‌ها')?.getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('[data-top-scope]')?.textContent).toBe('دوست‌هایی که توی «Spring» بازی کردن');
        expect(said(container.querySelector('[data-place]'))).toBe('۱');
        expect(said(container.querySelector('[data-friends]'))).toBe('۱۲ دوست');
    });
});

describe('what the campaign running now gives', () =>
{
    const RUNNING = {
        name: 'Spring',
        inviter: 'dice.inferno',
        invitee: 'decoration.jade',
        milestones: [{ count: 5, item: 'pawns.storm' }],
        most: 3,
        review: true,
        endsAt: '2026-11-15T12:00:00.000Z'
    };

    const block = async (root: ParentNode) =>
    {
        await vi.waitFor(() => expect(root.querySelector('[data-invite-campaign]')).not.toBeNull(), { timeout: 4000 });

        return root.querySelector<HTMLElement>('[data-invite-campaign]')!;
    };

    const gives = (root: ParentNode) => [...root.querySelectorAll('[data-gives]')].map((one) => one.getAttribute('data-gives'));

    it('shows each look it gives in its drawing, what it is given for, the most anybody is given and when it ends', async () =>
    {
        server.myInvites.summary = { ...server.myInvites.summary, campaign: RUNNING };
        const { container } = await page();
        const running = await block(container);
        const look = (id: string) => running.querySelector(`[data-gives="${ id }"]`)!;

        expect(running.querySelector('h2')?.textContent).toBe('“Spring” is on');
        expect(gives(running)).toEqual(['inviter', 'invitee', 'milestone-5']);
        expect(look('inviter').querySelector('img')?.getAttribute('src')).toBe('/looks/dice.inferno.svg');
        expect(look('inviter').textContent).toContain('Infernal Sovereign dice');
        expect(look('inviter').textContent).toContain('Yours for each friend who plays');
        expect(look('invitee').textContent).toContain('Jade Dragon Dynasty avatar decoration');
        expect(look('invitee').textContent).toContain('Your friend’s once they play a game');
        expect(look('milestone-5').textContent).toContain('Yours once 5 friends have played');
        expect(running.querySelector('[data-campaign-most]')?.textContent).toBe('Up to 3 looks each');
        expect(running.querySelector('[data-campaign-until]')?.textContent).toMatch(/^Until .*November.*2026/);
        expect(running.querySelector('[data-campaign-review]')?.textContent).toBe('Our team checks every reward before it is given.');
    });

    it('opens the shop\'s own sheet about a look at a press of it', async () =>
    {
        server.myInvites.summary = { ...server.myInvites.summary, campaign: RUNNING };
        const { container } = await page();
        const running = await block(container);

        fire(running.querySelector('[data-gives="inviter"]')!, 'click');

        await vi.waitFor(() => expect(asked()?.props.item).toBe('dice.inferno'), { timeout: 4000 });
    });

    it('leaves out what it does not give and a look this copy of the app does not sell, and says no most or end it does not have', async () =>
    {
        server.myInvites.summary = { ...server.myInvites.summary, campaign: { name: 'Plain', invitee: 'decoration.jade', milestones: [{ count: 3, item: 'dice.nowhere' }], review: false } };
        const { container } = await page();
        const running = await block(container);

        expect(gives(running)).toEqual(['invitee']);
        expect(running.querySelector('[data-campaign-most]')).toBeNull();
        expect(running.querySelector('[data-campaign-until]')).toBeNull();
        expect(running.querySelector('.facts')).toBeNull();
        expect(running.querySelector('[data-campaign-review]')).toBeNull();
    });

    it('is not drawn while no campaign runs', async () =>
    {
        const { container } = await page();
        await settle();

        expect(container.querySelector('[data-invite-hero]')).not.toBeNull();
        expect(container.querySelector('[data-invite-campaign]')).toBeNull();
    });

    it('says it in Persian, in the reader\'s digits', async () =>
    {
        useLocale().setLocale('fa');
        server.myInvites.summary = { ...server.myInvites.summary, campaign: RUNNING };
        const { container } = await page();
        const running = await block(container);

        expect(running.querySelector('h2')?.textContent).toBe('«Spring» در جریانه');
        expect(running.querySelector('[data-gives="milestone-5"]')?.textContent).toContain('وقتی ۵ تا از دوست‌هات بازی کنن، مال تو');
        expect(running.querySelector('[data-campaign-most]')?.textContent).toBe('هر نفر تا ۳ استایل');
        expect(running.querySelector('[data-gives="inviter"]')?.textContent).toContain('سلطان دوزخ');
    });

    it('keeps the shop out of the page\'s own chunk: only the wrapper\'s import() reaches it', () =>
    {
        const SHOP = /\/shop\/|shop\.store|shop-catalogue|lib\/shop|look-sheet|\/invite-campaign\.component/;

        for (const [file, text] of Object.entries(SOURCES))
        {
            const statics = [...text.matchAll(/^import (?!type )(?:[^;]*? from )?'([^']+)';$/gm)].map((match) => match[1]);

            expect(statics.filter((path) => SHOP.test(path)), file).toEqual([]);
        }

        expect(SOURCES['../src/components/social/lazy-invite-campaign.component.azeroth']).toContain('import(\'./invite-campaign.component.azeroth\')');
    });
});

describe('where the page is', () =>
{
    it('is a lazy page of the app, under Friends', () =>
    {
        const app = routes.find((one) => one.path === '/app')!;
        const invite = app.children?.find((one) => one.path === 'invite');

        expect(invite?.lazy).toBeTypeOf('function');
        expect(invite?.meta).toMatchObject({ title: 'invite.page.title', tab: 'friends', parent: '/app/friends' });
    });
});

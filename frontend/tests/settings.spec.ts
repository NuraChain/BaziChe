import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import SettingsPage from '../src/pages/app/settings.page.azeroth';
import ProfileSheet from '../src/components/app/profile-sheet.component.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useDonations } from '../src/stores/donations.store.ts';
import { useInviteListed } from '../src/stores/invite-listed.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { defaultSettings, useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, establishAccount, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async () =>
{
    for (let i = 0; i < 8; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const show = async (component: () => HTMLElement, at: string) =>
{
    const table: Route[] = [{ path: at, component }];
    const router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: component }) as Rendered);
    await settle();
    return container;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(5000);
    setRuntime({ clock, seed: 2 });
    useLocale().setLocale('en');
    server.reset();
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
});

/**
 * Editing the profile, which is two requests and has to say which of them failed.
 *
 * The display name and the bio are simply STORED; the @handle is CLAIMED against a unique index and
 * can come back 409. Sending them as one request would produce a half-success with nothing on the
 * screen able to say which half - so the handle goes first, and a refusal leaves the rest unwritten
 * with the value still in the box.
 */
describe('the profile sheet', () =>
{
    const fill = (container: HTMLElement, id: string, value: string) =>
    {
        const field = container.querySelector(`#${ id }`) as HTMLInputElement | HTMLTextAreaElement;
        const proto = Object.getPrototypeOf(field) as object;
        (Object.getOwnPropertyDescriptor(proto, 'value')?.set as (this: unknown, v: string) => void).call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    };

    /** The overlay hands every sheet a `close`; rendered on its own it has to be given one. */
    let closedWith: boolean | null = null;

    const sheet = async (): Promise<HTMLElement> =>
    {
        closedWith = null;
        const close = (value?: unknown) =>
        {
            closedWith = value === true;
        };

        return await show(
            (() => ProfileSheet({ overlayId: 'profile-test', close })) as unknown as () => HTMLElement,
            '/app/me'
        );
    };

    const press = (container: HTMLElement, label: string) =>
    {
        const button = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith(label));
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    it('writes the name and the bio, and adopts what the server answers with', async () =>
    {
        useSession().establish(establishAccount());

        const container = await sheet();

        fill(container, 'profile-name', '  Alexandra  ');
        fill(container, 'profile-bio', '  Plays hokm badly.  ');
        await settle();

        press(container, 'Save');
        await settle();

        expect(server.calls).toContain('auth.profile');

        // Trimmed by the server, and the store took the ANSWER rather than what was typed.
        expect(useAccount().user()?.displayName).toBe('Alexandra');
        expect(useAccount().user()?.bio).toBe('Plays hokm badly.');
        expect(closedWith).toBe(true);
    });

    it('says a handle is taken, and writes nothing else when it is', async () =>
    {
        useSession().establish(establishAccount());
        server.takenHandles = ['taken'];

        const container = await sheet();
        const before = useAccount().user()?.displayName;

        fill(container, 'profile-name', 'Someone Else');
        fill(container, 'profile-handle', 'taken');
        await settle();

        press(container, 'Save');
        await settle();

        expect(container.textContent).toContain('taken');
        expect(server.calls).toContain('auth.handle');

        // The name was NOT written: the handle is claimed first precisely so a refusal leaves the
        // account whole rather than half-changed.
        expect(server.calls).not.toContain('auth.profile');
        expect(useAccount().user()?.displayName).toBe(before);

        // And the sheet stays OPEN, with the refusal beside the box that caused it.
        expect(closedWith).toBeNull();
    });
});

describe('the notification switches', () =>
{
    it('read the account\'s own mutes and write through the server, so every device agrees', async () =>
    {
        server.mutes = [{ kind: 'notice', id: 'turns' }];
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const switchFor = (label: string) =>
            [...container.querySelectorAll<HTMLElement>('[role="switch"]')].find((one) => one.querySelector('span span')?.textContent === label)!;

        expect(switchFor('Games: your turn, and a game starting').getAttribute('aria-checked')).toBe('false');
        expect(switchFor('Messages').getAttribute('aria-checked')).toBe('true');

        switchFor('Messages').click();
        await settle();

        expect(server.calls).toContain('social.mute');
        expect(server.mutes).toContainEqual({ kind: 'notice', id: 'messages' });
        expect(switchFor('Messages').getAttribute('aria-checked')).toBe('false');
        expect(switchFor('Messages').querySelector('[aria-hidden]')?.className).toContain('bg-line');
    });

    it('silence gifts and NURA sent to the reader with a switch of their own, and leave friend requests as they were', async () =>
    {
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const switchFor = (label: string) =>
            [...container.querySelectorAll<HTMLElement>('[role="switch"]')].find((one) => one.querySelector('span span')?.textContent === label)!;

        switchFor('Gifts and NURA sent to you').click();
        await settle();

        expect(server.mutes).toContainEqual({ kind: 'notice', id: 'gifts' });
        expect(server.mutes).not.toContainEqual({ kind: 'notice', id: 'requests' });
        expect(switchFor('Gifts and NURA sent to you').getAttribute('aria-checked')).toBe('false');
        expect(switchFor('Friend requests').getAttribute('aria-checked')).toBe('true');
    });

    it.each([
        ['the request never got there', new TypeError('Failed to fetch'), 'The server could not be reached. Check your connection, then try again.'],
        ['the server refused it', new ApiError(409, 'conflict', 'x', undefined), 'That setting did not save. It is still set the way it was.']
    ] as const)('stay as they were and say why when %s', async (_, failure, sentence) =>
    {
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const messages = () =>
            [...container.querySelectorAll<HTMLElement>('[role="switch"]')].find((one) => one.querySelector('span span')?.textContent === 'Messages')!;
        const refused = vi.spyOn(client.social, 'mute').mockRejectedValueOnce(failure);

        useToasts().reset();

        try
        {
            messages().click();
            await settle();

            await vi.waitFor(() => expect(useToasts().items().map((one) => one.text)).toEqual([sentence]), { timeout: 4000 });
            expect(messages().getAttribute('aria-checked')).toBe('true');
            expect(server.mutes).not.toContainEqual({ kind: 'notice', id: 'messages' });
        }
        finally
        {
            refused.mockRestore();
        }
    });

    it('keep chess\'s horse and elephant on this device, under the sound at the table in a section of their own, in both languages', async () =>
    {
        useSettings().reset();
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const switches = (section = 'sound') => [...container.querySelectorAll<HTMLElement>(`#settings-${ section } [role="switch"]`)];
        const labelOf = (one: HTMLElement) => one.querySelector('span span')?.textContent ?? '';
        const at = (label: string) => switches().findIndex((one) => labelOf(one) === label);
        const animals = () => switches()[at('Horse and elephant in chess')];

        expect(switches().map(labelOf)).toEqual(['Sound at the table', 'Horse and elephant in chess', 'Background sound']);
        expect(switches('notifications').map(labelOf).filter((one) => /sound|horse/i.test(one)), 'a sound switch is still among the notifications').toEqual([]);
        expect(animals().getAttribute('aria-checked')).toBe('true');
        expect(animals().textContent).toContain('the elephant of Persian chess');

        animals().click();
        await settle();

        expect(useSettings().settings().animalSounds).toBe(false);
        expect(animals().getAttribute('aria-checked')).toBe('false');
        expect(server.calls).not.toContain('social.mute');

        useLocale().setLocale('fa');
        await settle();

        expect(switches().map(labelOf)).toEqual(['صدا سر میز', 'صدای اسب و فیل توی شطرنج', 'صدای پس‌زمینه']);
    });

    it('play a background behind a table, on by default, with its volume drawn only while it is on, in both languages', async () =>
    {
        useSettings().reset();
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const section = () => container.querySelector('#settings-sound')!;
        const background = () => [...section().querySelectorAll<HTMLElement>('[role="switch"]')].find((one) => one.textContent?.includes(useLocale().t('settings.sound.background')))!;
        const volume = () => section().querySelector<HTMLElement>(`[role="slider"][aria-label="${ useLocale().t('settings.sound.volume') }"]`);

        expect(background().getAttribute('aria-checked')).toBe('true');
        expect(background().textContent).toContain('Something calm behind a table');
        expect(volume()?.getAttribute('aria-valuenow')).toBe('0.4');
        expect(volume()?.getAttribute('aria-valuetext')).toBe('40%');

        volume()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await settle();

        expect(useSettings().settings().backgroundVolume).toBeCloseTo(0.45, 6);

        background().click();
        await settle();

        expect(useSettings().settings().background).toBe(false);
        expect(volume(), 'a volume nobody can hear is drawn').toBeNull();

        useLocale().setLocale('fa');
        background().click();
        await settle();

        expect(volume()?.getAttribute('aria-label')).toBe('بلندی صدای پس‌زمینه');
    });

    it('choose what plays behind a table, music by default, drawn only while the background is on, in both languages', async () =>
    {
        useSettings().reset();
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const section = () => container.querySelector('#settings-sound')!;
        const choice = () => section().querySelector<HTMLElement>(`[role="group"][aria-label="${ useLocale().t('settings.sound.kind') }"]`);
        const options = () => [...choice()!.querySelectorAll<HTMLButtonElement>('button')];
        const pressed = () => options().filter((one) => one.getAttribute('aria-pressed') === 'true').map((one) => one.textContent?.trim());
        const background = () => [...section().querySelectorAll<HTMLElement>('[role="switch"]')].find((one) => one.textContent?.includes(useLocale().t('settings.sound.background')))!;

        expect(useSettings().settings().backgroundKind).toBe('music');
        expect(options().map((one) => one.textContent?.trim())).toEqual(['Music', 'Rain', 'Birds']);
        expect(pressed()).toEqual(['Music']);
        expect(section().textContent).toContain('Each game has a calm piece of its own.');

        const kept = choice();

        options()[2].click();
        await settle();

        expect(useSettings().settings().backgroundKind).toBe('birds');
        expect(pressed()).toEqual(['Birds']);
        expect(choice(), 'the choice was drawn again when it was made').toBe(kept);
        expect(section().textContent).toContain('Birds singing beside a stream in a wood.');
        expect(section().textContent).not.toContain('Each game has a calm piece of its own.');

        options()[1].click();
        await settle();

        expect(useSettings().settings().backgroundKind).toBe('rain');
        expect(section().textContent).toContain('Gentle rain falling on a terrace.');

        background().click();
        await settle();

        expect(choice(), 'a choice of what nobody hears is drawn').toBeNull();

        useLocale().setLocale('fa');
        background().click();
        await settle();

        expect(options().map((one) => one.textContent?.trim())).toEqual(['موسیقی', 'بارون', 'پرنده‌ها']);
        expect(pressed()).toEqual(['بارون']);
        expect(choice()?.getAttribute('aria-label')).toBe('چی پخش بشه');
        expect(section().textContent).toContain('صدای بارون آرومی که روی ایوون می‌باره.');
    });

    it('start the background off on a device that asked to save data', () =>
    {
        Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });

        expect(defaultSettings().background).toBe(false);

        Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });

        expect(defaultSettings().background).toBe(true);
    });
});

describe('the safety lists', () =>
{
    it('keep the lines that say nobody is blocked, muted or reported when they are read again', async () =>
    {
        useSession().establish(establishAccount());

        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const lineOf = (text: string) => [...container.querySelectorAll('p')].find((one) => one.textContent?.trim() === text) ?? null;
        const lines = () => [
            lineOf(useLocale().t('settings.safety.blockedEmpty')),
            lineOf(useLocale().t('settings.safety.mutedEmpty')),
            lineOf(useLocale().t('report.empty'))
        ];

        await vi.waitFor(() => expect(lines().every((one) => one !== null)).toBe(true), { timeout: 4000 });

        const drawn = lines();
        const reads = server.calls.filter((one) => one === 'social.graph').length;

        await useSocial().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'social.graph').length, 'the lists were not read again').toBeGreaterThan(reads);
        expect(lines()[0], 'the line about blocks was drawn again').toBe(drawn[0]);
        expect(lines()[1], 'the line about mutes was drawn again').toBe(drawn[1]);
        expect(lines()[2], 'the line about reports was drawn again').toBe(drawn[2]);
    });

    it('say nobody is blocked, muted or reported only once the server has, and what went wrong when it could not say', async () =>
    {
        const routes = client.social as unknown as Record<string, () => Promise<unknown>>;
        const real = { graph: routes.graph, reports: routes.reports };
        const gates: (() => void)[] = [];

        routes.graph = () => new Promise((resolve, reject) => gates.push(() => void real.graph().then(resolve, reject)));
        routes.reports = () => Promise.reject(new ApiError(503, 'unavailable', 'Down.', undefined));

        try
        {
            useSession().reset();
            await settle();
            useSession().establish(establishAccount());

            const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
            const safety = () => container.querySelector('#settings-safety')!;
            const said = (key: 'settings.safety.blockedEmpty' | 'settings.safety.mutedEmpty' | 'report.empty') => safety().textContent?.includes(useLocale().t(key));

            await vi.waitFor(() => expect(safety().querySelectorAll('[role="alert"]')).toHaveLength(1), { timeout: 4000 });

            expect(safety().querySelectorAll('[data-reading]'), 'the blocked and the muted are not said to be on their way').toHaveLength(2);
            expect([said('settings.safety.blockedEmpty'), said('settings.safety.mutedEmpty'), said('report.empty')]).toEqual([false, false, false]);
            expect(safety().querySelector('[role="alert"]')?.textContent).toContain(useLocale().t('failure.down'));

            gates.forEach((open) => open());
            await vi.waitFor(() => expect(said('settings.safety.blockedEmpty')).toBe(true), { timeout: 4000 });

            expect(said('settings.safety.mutedEmpty')).toBe(true);
            expect(safety().querySelectorAll('[data-reading]')).toHaveLength(0);
            expect(said('report.empty'), 'reports that could not be read are said to be none').toBe(false);
        }
        finally
        {
            routes.graph = real.graph;
            routes.reports = real.reports;
        }
    });
});

describe('a privacy switch the server does not keep', () =>
{
    const strangers = (container: HTMLElement) =>
        [...container.querySelectorAll<HTMLElement>('#settings-safety [role="switch"]')]
            .find((one) => one.querySelector('span span')?.textContent === useLocale().t('settings.safety.strangers'));

    it.each([
        ['the request never got there', new TypeError('Failed to fetch'), 'The server could not be reached. Check your connection, then try again.'],
        ['the server failed', new ApiError(500, 'internal', 'x', undefined), 'Something went wrong on the server. Try again in a moment.'],
        ['the server refused it', new ApiError(409, 'conflict', 'x', undefined), 'That setting did not save. It is still set the way it was.']
    ] as const)('turns back and says why when %s', async (_, failure, sentence) =>
    {
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');

        await vi.waitFor(() => expect(strangers(container)).toBeDefined(), { timeout: 4000 });

        const before = strangers(container)!.getAttribute('aria-checked');
        const refused = vi.spyOn(client.social, 'setPrivacy').mockRejectedValueOnce(failure);

        useToasts().reset();

        try
        {
            strangers(container)!.click();
            await settle();

            await vi.waitFor(() => expect(useToasts().items().map((one) => one.text)).toEqual([sentence]), { timeout: 4000 });
            expect(strangers(container)!.getAttribute('aria-checked')).toBe(before);
        }
        finally
        {
            refused.mockRestore();
        }
    });
});

describe('the page of settings', () =>
{
    it('is one column of sections, each as wide as the column, with no grid of columns in any of them', async () =>
    {
        useSession().establish(establishAccount());

        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const sections = [...container.querySelectorAll('section[id^="settings-"]')];
        const column = sections[0]?.parentElement ?? null;
        const classes = (column?.getAttribute('class') ?? '').split(' ');

        expect(sections.map((one) => one.id)).toEqual(['settings-account', 'settings-appearance', 'settings-safety', 'settings-notifications', 'settings-sound', 'settings-voice', 'settings-helpers']);
        expect(sections.every((one) => one.parentElement === column), 'a section stands beside another inside a wrapper of its own').toBe(true);
        expect(classes).toEqual(expect.arrayContaining(['flex', 'flex-col']));
        expect(classes.filter((one) => /grid/.test(one)), 'the sections are laid out as a grid').toEqual([]);
        expect(
            [...(column?.querySelectorAll('[class*="grid-cols-"]') ?? [])].map((one) => one.getAttribute('class')),
            'something inside a section is laid out in columns'
        ).toEqual([]);
    });

    it('lays the voice section out as the microphone, what is heard and the table, each in a panel of its own', async () =>
    {
        useSession().establish(establishAccount());

        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const voice = container.querySelector('#settings-voice')!;
        const { t } = useLocale();
        const switches = [...voice.querySelectorAll('[role="switch"]')].map((one) => one.textContent ?? '');

        expect([...voice.querySelectorAll('h3')].map((one) => one.textContent?.trim())).toEqual([
            t('voice.section.input'),
            t('voice.section.mode'),
            t('voice.section.processing'),
            t('voice.section.output'),
            t('voice.section.table')
        ]);
        expect(voice.querySelector('[role="meter"]'), 'the microphone has no meter').not.toBeNull();
        expect(voice.querySelector(`[role="slider"][aria-label="${ t('voice.inputVolume') }"]`)).not.toBeNull();
        expect(voice.querySelector(`[role="slider"][aria-label="${ t('voice.volume') }"]`)).not.toBeNull();
        expect(voice.querySelector(`[role="group"][aria-label="${ t('voice.noise') }"]`)).not.toBeNull();
        expect(voice.querySelector(`[role="group"][aria-label="${ t('voice.quality') }"]`)).not.toBeNull();

        for (const key of ['voice.echo', 'voice.agc', 'voice.startMuted', 'voice.autoJoin', 'voice.tables', 'voice.team'] as const)
        {
            expect(switches.some((one) => one.includes(t(key))), `no switch for ${ key }`).toBe(true);
        }

        expect(voice.textContent).toContain(t('voice.privacy'));
    });
});

describe('NURA from people watching', () =>
{
    let seq = 0;

    const OPEN = {
        open: true as const,
        accepting: true,
        may: 'yes' as const,
        presets: ['5000000000000000000'],
        least: '1000000000000000000',
        most: '1000000000000000000000'
    };

    const signedIn = () =>
    {
        seq += 1;
        useSession().establish(establishAccount('alex', { id: `u-donate-${ seq }` }));
    };

    const donationsSwitch = (container: HTMLElement, label: string) =>
        [...container.querySelectorAll<HTMLElement>('#settings-safety [role="switch"]')].find((one) => one.querySelector('span span')?.textContent === label);

    beforeEach(() =>
    {
        useDonations().reset();
    });

    it('is a switch of the privacy section while donations are open, on until the reader turns it off, and writes through the server', async () =>
    {
        server.donate.state = { ...OPEN };
        signedIn();

        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const toggle = donationsSwitch(container, 'Let people watching send you NURA');

        expect(toggle?.getAttribute('aria-checked')).toBe('true');

        toggle!.click();
        await settle();

        expect(server.calls).toContain('donations.accept false');
        expect(donationsSwitch(container, 'Let people watching send you NURA')?.getAttribute('aria-checked')).toBe('false');
    });

    it('is not drawn while donations are turned off here, which the section says in its place', async () =>
    {
        server.donate.state = { open: false };
        signedIn();

        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');

        expect(container.querySelector('#settings-safety')).not.toBeNull();
        expect(donationsSwitch(container, 'Let people watching send you NURA')).toBeUndefined();
        expect(container.querySelector('#settings-safety [data-off="donations"]')?.textContent).toContain('Sending NURA is turned off right now');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.donate.state = { ...OPEN, accepting: false };
        signedIn();

        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');

        expect(donationsSwitch(container, 'تماشاچیا بتونن واسم NURA بفرستن')?.getAttribute('aria-checked')).toBe('false');
    });
});

describe('whether the reader is shown among the top inviters', () =>
{
    let seq = 0;

    const signedIn = () =>
    {
        seq += 1;
        useSession().establish(establishAccount('alex', { id: `u-board-${ seq }`, handle: `board${ seq }` }));
    };

    const boardSwitch = (container: HTMLElement, label = 'Show me among the top inviters') =>
        [...container.querySelectorAll<HTMLElement>('#settings-safety [role="switch"]')].find((one) => one.querySelector('span span')?.textContent === label);

    const settingsPage = () => show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');

    it('is a switch of the privacy section, on until the reader turns it off, turned at the press and written through the server', async () =>
    {
        signedIn();
        const container = await settingsPage();
        const toggle = () => boardSwitch(container);

        expect(toggle()?.getAttribute('aria-checked')).toBe('true');
        expect(toggle()?.textContent).toContain('Off keeps your name off the top inviters.');

        let let_go = (): void => undefined;
        server.myInvites.hold = new Promise((resolve) => (let_go = () => resolve()));
        toggle()!.click();
        await settle();

        expect(toggle()?.getAttribute('aria-checked')).toBe('false');
        expect(server.calls).toContain('invites.list false');

        server.myInvites.hold = null;
        let_go();
        await settle();

        expect(server.myInvites.listed).toBe(false);
        expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    });

    it('turns back when the server refuses, and says so', async () =>
    {
        signedIn();
        const container = await settingsPage();

        server.myInvites.refuse = 'list';
        boardSwitch(container)!.click();
        await settle();

        expect(boardSwitch(container)?.getAttribute('aria-checked')).toBe('true');
        expect(server.myInvites.listed).toBe(true);
        expect(useToasts().items().map((one) => one.text)).toContain('The server is not answering right now. Try again in a moment.');
        expect(useInviteListed().listed()).toBe(true);
    });

    it('is drawn off and locked for somebody under 18, with the sentence why', async () =>
    {
        server.minor = true;
        signedIn();
        const container = await settingsPage();
        const toggle = boardSwitch(container);

        expect(toggle?.getAttribute('aria-checked')).toBe('false');
        expect(toggle?.hasAttribute('disabled')).toBe(true);
        expect(toggle?.textContent).toContain('Players under 18 are never shown among the top inviters.');
    });

    it('is not drawn until the server has said where the reader stands', async () =>
    {
        server.myInvites.refuse = 'listed';
        signedIn();
        const container = await settingsPage();

        expect(container.querySelector('#settings-safety')).not.toBeNull();
        expect(boardSwitch(container)).toBeUndefined();
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.myInvites.listed = false;
        signedIn();
        const container = await settingsPage();

        expect(boardSwitch(container, 'اسمم بین بهترین دعوت‌کننده‌ها بیاد')?.getAttribute('aria-checked')).toBe('false');
    });

    it('is where the page opens when the address names its section, as the board\'s way to it does, and nowhere is scrolled to without one', async () =>
    {
        const scrolled: string[] = [];
        const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element)
        {
            scrolled.push(this.id);
        });

        for (const at of ['/app/me/settings', '/app/me/settings#nowhere'])
        {
            cleanup();
            signedIn();
            const plain = await show(SettingsPage as unknown as () => HTMLElement, at);

            clock.advance(1);
            await settle();

            expect(scrolled.filter((id) => id.startsWith('settings-')), at).toEqual([]);
            expect(plain.querySelector('[data-section="settings-account"]')?.getAttribute('aria-current'), at).toBe('true');
        }

        cleanup();
        signedIn();
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings#settings-safety');

        expect(scrolled.filter((id) => id.startsWith('settings-'))).toEqual([]);

        clock.advance(1);
        await settle();

        expect(scrolled).toContain('settings-safety');
        expect(container.querySelector('[data-section="settings-safety"]')?.getAttribute('aria-current')).toBe('true');
        spy.mockRestore();
    });
});

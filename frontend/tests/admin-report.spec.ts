import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import ReportPage from '../src/pages/admin/report.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { encodeVoice } from '../src/lib/body.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { setVoiceAudio, type VoiceAudio } from '../src/lib/voice-audio.ts';
import { encodeWave, sealAudio } from '../src/lib/voice-note.ts';
import { setVoiceFiles, VoiceFileError, voiceFiles } from '../src/services/voice-files.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useReports } from '../src/stores/reports.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, reportFiled, server, staffLogged, staffMember } from './fake-api.ts';
import { blockFlags, durationAt, webm } from './webm.ts';
import { halfwayOut } from './leaving.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };

const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const as = (staff: StaffRole) =>
{
    useSession().establish({ ...ALEX, staff });
};

const opened = async (id: string) =>
{
    const routes: Route[] = [
        { path: '/admin/reports', component: () => document.createElement('div') },
        { path: '/admin/reports/:id', component: () => ReportPage({}) as unknown as HTMLElement }
    ];
    const router = createRouter({ routes, history: createMemoryHistory(`/admin/reports/${ id }`), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const all = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());

const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

const typeInto = (field: HTMLTextAreaElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const toasts = () => useToasts().items().map((one) => one.text);

const why = (root: ParentNode) => root.querySelector<HTMLTextAreaElement>('#admin-report-why')!;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useToasts().dismissAll();
    useReports().reset();
    as('owner');
});

afterEach(() =>
{
    cleanup();
    useSession().reset();
    useLocale().setLocale('en');
    setVoiceFiles(null);
    setVoiceAudio(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** An audio element that knows what it was handed once its address arrives, and plays when asked. */
class FakeAudio implements VoiceAudio
{
    static made: FakeAudio[] = [];

    src = '';
    currentTime = 0;
    duration = 4;
    playbackRate = 1;
    paused = true;
    error: { code: number } | null = null;
    private readonly heard = new Map<string, Set<() => void>>();

    constructor()
    {
        FakeAudio.made.push(this);
    }

    play()
    {
        this.paused = false;
        this.emit('playing');
        return Promise.resolve();
    }

    pause()
    {
        if (!this.paused)
        {
            this.paused = true;
            this.emit('pause');
        }
    }

    load()
    {
        return undefined;
    }

    removeAttribute(name: string)
    {
        if (name === 'src')
        {
            this.src = '';
        }
    }

    canPlayType()
    {
        return 'probably';
    }

    addEventListener(type: string, listener: () => void)
    {
        this.heard.set(type, (this.heard.get(type) ?? new Set()).add(listener));

        if (type === 'loadedmetadata' && this.src !== '')
        {
            queueMicrotask(listener);
        }
    }

    removeEventListener(type: string, listener: () => void)
    {
        this.heard.get(type)?.delete(listener);
    }

    private emit(type: string)
    {
        for (const listener of [...this.heard.get(type) ?? []])
        {
            listener();
        }
    }
}

const RECORDING = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array.from({ length: 600 }, (_, at) => (at * 7) % 251)]);

/** A voice message sealed as a browser seals one, and the document a report would disclose for it. */
const disclosedVoice = async (extra: { fwd?: true } = {}, recording = RECORDING) =>
{
    const id = crypto.randomUUID();
    const sealed = await sealAudio(recording, id);
    const message = encodeVoice({
        voice: { id, key: sealed.key, iv: sealed.iv, mime: 'audio/webm;codecs=opus', ms: 4000, wave: encodeWave([0, 30, 63, 12]), bytes: recording.length },
        ...extra
    });

    return { body: sealed.body, message };
};

/** The staff's file store: what it was asked for, and what it answers. */
const keeping = (answer: (reportId: string) => Promise<Uint8Array>) =>
{
    const asked: string[] = [];
    const opened: Uint8Array[] = [];

    FakeAudio.made = [];
    setVoiceAudio(() => new FakeAudio());
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) =>
    {
        void (blob as Blob).arrayBuffer().then((bytes) => opened.push(new Uint8Array(bytes)));
        return `blob:report-voice-${ opened.length }`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    setVoiceFiles({
        upload: () => Promise.resolve(),
        download: () => Promise.reject(new VoiceFileError('voice-missing')),
        reported: (reportId) =>
        {
            asked.push(reportId);
            return answer(reportId);
        }
    });

    return { asked, opened };
};

const playOf = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-report-voice] button')!;

describe('one report', () =>
{
    it('keeps the report it was built for while the page is being left', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });

        const container = await halfwayOut(
            [{ path: '/admin/reports/:id', component: () => ReportPage({}) as unknown as HTMLElement }],
            `/admin/reports/${ id }`,
            (root) => said(root, '[data-said]') === 'sara.k reported reza.t'
        );

        expect(said(container, '[data-said]')).toBe('sara.k reported reza.t');
    });

    it('reads what it is for, who reported whom, its status and when, both people, the message, their games together and what the staff did', async () =>
    {
        const id = reportFiled({
            at: hoursAgo(3),
            by: 'sara.k',
            about: 'reza.t',
            status: 'reviewed',
            message: '{"text":"Quit or I keep stalling"}',
            together: [
                { id: 'm2', game: 'hokm', at: hoursAgo(1), live: true },
                { id: 'm1', game: 'ludo', at: hoursAgo(4), live: false, by: 'lost', about: 'won' }
            ]
        });

        staffLogged({ at: hoursAgo(2), staff: 'mina', staffRole: 'moderator', kind: 'report', person: 'reza.t', reason: 'Nothing rude in the chat.', details: { report: id, outcome: 'reviewed', reporter: 'sara.k' } });
        const container = await opened(id);

        expect(said(container, 'h1')).toBe('Harassment or abuse');
        expect(said(container, '[data-said]')).toBe('sara.k reported reza.t');
        expect([...container.querySelectorAll('[data-said] [dir="ltr"]')].map((one) => one.textContent)).toEqual(['sara.k', 'reza.t']);
        expect(said(container, 'header [data-status]')).toBe('Reviewed');
        expect(said(container, 'header [data-when]')).toBe('Filed 3 hours ago');
        expect(container.querySelector('[data-side="about"]')?.getAttribute('href')).toBe('/admin/people/reza.t');
        expect(all(container, '[data-side="about"] .flex-col > span')).toEqual(['About', 'Reza Tehrani', '@reza.t']);
        expect(container.querySelector('[data-side="by"]')?.getAttribute('href')).toBe('/admin/people/sara.k');
        expect(all(container, '[data-side="by"] .flex-col > span')).toEqual(['Filed by', 'Sara Kamali', '@sara.k']);
        expect(said(container, '[data-message]')).toBe('Quit or I keep stalling');
        expect(container.querySelector<HTMLElement>('[data-forwarded]')?.hidden).toBe(true);
        expect(all(container, '[data-together] [data-game] [data-name]')).toEqual(['Hokm', 'Ludo']);
        expect(container.querySelector<HTMLElement>('[data-game="m2"] [data-live]')?.hidden).toBe(false);
        expect(container.querySelector<HTMLElement>('[data-game="m1"] [data-live]')?.hidden).toBe(true);
        expect(all(container, '[data-game="m1"] [data-seat]')).toEqual(['sara.k: Lost', 'reza.t: Won']);
        expect([...container.querySelectorAll<HTMLElement>('[data-game="m2"] [data-seat]')].map((one) => one.hidden)).toEqual([true, true]);
        expect(all(container, '[data-history] [data-line]')).toEqual(['mina reviewed sara.k’s report about reza.t: nothing to do.']);
        expect(container.querySelector('[data-history] [data-open-report]')).toBeNull();
        expect(button(container, 'Reviewed, nothing to do')).toBeUndefined();
        expect(button(container, 'Acted on it')).toBeDefined();
    });

    it('opens on a summary card and keeps the close beside the report once there is room, held in view, and after it on a phone', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });
        const container = await opened(id);
        const layout = container.querySelector<HTMLElement>('[data-layout]')!;
        const [main, aside] = [...layout.children] as HTMLElement[];

        expect(container.querySelector('header[data-summary] h1')?.textContent).toBe('Harassment or abuse');
        expect(container.querySelector('header[data-summary] [data-status]')).not.toBeNull();
        expect(layout.classList.contains('@4xl:grid-cols-[minmax(0,1fr)_20rem]')).toBe(true);
        expect(layout.closest('.\\@container')).not.toBeNull();
        expect(layout.children).toHaveLength(2);
        expect(main?.querySelector('[data-side="about"]')).not.toBeNull();
        expect(main?.querySelector('[data-history], [data-history="none"]')).not.toBeNull();
        expect(aside?.tagName).toBe('ASIDE');
        expect(aside?.getAttribute('aria-label')).toBe('Close the report');
        expect(aside?.classList.contains('@4xl:sticky')).toBe(true);
        expect(aside?.querySelector('[data-outcomes]')).not.toBeNull();
    });

    it('says a message that was forwarded, one that could not be read, and a report that came with none', async () =>
    {
        const forwarded = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t', message: '{"text":"Pass it on","fwd":true}' });
        const broken = reportFiled({ at: hoursAgo(2), by: 'sara.k', about: 'reza.t', message: 'not a message' });
        const bare = reportFiled({ at: hoursAgo(1), by: 'sara.k', about: 'reza.t' });

        const first = await opened(forwarded);

        expect(said(first, '[data-message]')).toBe('Pass it on');
        expect(first.querySelector<HTMLElement>('[data-forwarded]')?.hidden).toBe(false);
        expect(said(first, '[data-forwarded]')).toBe('Forwarded');
        cleanup();

        const second = await opened(broken);

        expect(second.querySelector('[data-message]:not([data-message="none"])')).toBeNull();
        expect(said(second, '[data-message="none"]')).toBe('The message that came with it could not be read.');
        cleanup();

        const third = await opened(bare);

        expect(said(third, '[data-message="none"]')).toBe('No message came with this report.');
        expect(said(third, '[data-together="none"]')).toBe('They have not played together lately.');
        expect(said(third, '[data-history="none"]')).toBe('Nothing yet.');
    });

    it('shows an edited line in the words it had when it was reported, and says it was edited', async () =>
    {
        const edited = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t', message: '{"edit":"Changed to this","on":"m-1"}' });
        const plain = reportFiled({ at: hoursAgo(2), by: 'sara.k', about: 'reza.t', message: '{"text":"Never changed"}' });

        const first = await opened(edited);

        expect(said(first, '[data-message]')).toBe('Changed to this');
        expect(first.querySelector<HTMLElement>('[data-edited]')?.hidden).toBe(false);
        expect(said(first, '[data-edited]')).toBe('Edited: the words it had when it was reported');
        cleanup();

        const second = await opened(plain);

        expect(second.querySelector<HTMLElement>('[data-edited]')?.hidden, 'a line nobody changed').toBe(true);
    });

    it('plays a reported voice message from the file its report keeps, opened under the key it disclosed', async () =>
    {
        const { body, message } = await disclosedVoice({ fwd: true });
        const id = reportFiled({ at: hoursAgo(1), by: 'sara.k', about: 'reza.t', message });
        const store = keeping(() => Promise.resolve(body));
        const page = await opened(id);

        expect(said(page, '[data-message="voice"] p'), 'what it is').toBe('The one voice message the reporter chose to show, kept with the report. The server checked it against what passed through when it was sent, so this is what was said.');
        expect(said(page, '[data-clock]'), 'its length before anything is fetched').toBe('0:04');
        expect(playOf(page).getAttribute('aria-label')).toBe('Play the voice message, 0:04');
        expect(page.querySelector('[data-report-voice]')?.getAttribute('dir'), 'left to right in every language').toBe('ltr');
        expect(page.querySelector('[data-report-voice] [role="slider"]'), 'the way through it').not.toBeNull();
        expect(page.querySelector<HTMLElement>('[data-forwarded]')?.hidden, 'and that it was forwarded').toBe(false);
        expect(store.asked, 'nothing fetched before a press').toEqual([]);

        playOf(page).click();
        await settle();

        expect(store.asked, 'the report’s own file').toEqual([id]);
        expect(store.opened, 'opened as the recording it was').toEqual([RECORDING]);
        expect(FakeAudio.made.at(-1)?.paused, 'and played').toBe(false);
        expect(playOf(page).getAttribute('aria-label')).toBe('Pause the voice message');

        playOf(page).click();
        await settle();

        expect(FakeAudio.made.at(-1)?.paused, 'paused at the next press').toBe(true);

        playOf(page).click();
        await settle();

        expect(FakeAudio.made.at(-1)?.paused, 'and played again').toBe(false);
        expect(store.asked, 'from what it holds already').toEqual([id]);
    });

    it('plays a recording Firefox made as one every browser can move through', async () =>
    {
        const made = webm();
        const { body, message } = await disclosedVoice({}, made);
        const id = reportFiled({ at: hoursAgo(1), by: 'sara.k', about: 'reza.t', message });
        const store = keeping(() => Promise.resolve(body));
        const page = await opened(id);

        playOf(page).click();
        await settle();
        await vi.waitFor(() => expect(store.opened).toHaveLength(1));

        expect(blockFlags(store.opened[0]), 'every block a keyframe, which Chromium seeks by').toEqual([0x80, 0x80, 0x80, 0x80, 0x80]);
        expect([durationAt(store.opened[0]), store.opened[0].length], 'no Duration of 0, and nothing moved').toEqual([-1, made.length]);
    });

    it('says what kept a reported voice message from playing, and fetches it again at Try again', async () =>
    {
        const { body, message } = await disclosedVoice();
        const gone = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t', message });
        const changed = reportFiled({ at: hoursAgo(2), by: 'sara.k', about: 'reza.t', message });
        const dropped = reportFiled({ at: hoursAgo(1), by: 'sara.k', about: 'reza.t', message });
        let reachable = false;
        const store = keeping((reportId) =>
        {
            if (reportId === gone)
            {
                return Promise.reject(new VoiceFileError('voice-missing'));
            }

            if (reportId === changed)
            {
                return Promise.resolve(new Uint8Array(body.length).fill(7));
            }

            return reachable ? Promise.resolve(body) : Promise.reject(new VoiceFileError('network'));
        });

        const first = await opened(gone);

        playOf(first).click();
        await settle();
        expect(said(first, '[data-fault] span'), 'a file the report does not keep').toBe('This voice message is no longer here.');
        cleanup();

        const second = await opened(changed);

        playOf(second).click();
        await settle();
        expect(second.querySelector('[data-fault]')?.getAttribute('role'), 'an alarm').toBe('alert');
        expect(said(second, '[data-fault] span')).toBe('This voice message was changed after it was sent, so it is not played.');
        expect(playOf(second).disabled, 'and nothing more to press').toBe(true);
        cleanup();

        const third = await opened(dropped);

        playOf(third).click();
        await settle();
        expect(said(third, '[data-fault] span'), 'a file that could not be fetched').toBe('This voice message could not be loaded.');

        reachable = true;
        button(third, 'Try again')!.click();
        await settle();

        expect(third.querySelector('[data-fault]'), 'gone once it plays').toBeNull();
        expect(FakeAudio.made.at(-1)?.paused).toBe(false);
        expect(store.asked).toEqual([gone, changed, dropped, dropped]);
    });

    it('asks the staff’s own route for a report’s file, and reads a page that is not there as a file that is not there', async () =>
    {
        const asked: string[] = [];

        vi.stubGlobal('fetch', (url: string) =>
        {
            asked.push(url);

            return Promise.resolve(url.includes('missing')
                ? new Response(JSON.stringify({ error: { code: 'not-found', message: 'Nothing there.' } }), { status: 404 })
                : (url.includes('broken') ? new Response('', { status: 500 }) : new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
        });

        const failureOf = (attempt: Promise<unknown>) => attempt.then(() => null, (error: unknown) => (error instanceof VoiceFileError ? error.failure : 'thrown'));

        expect([...await voiceFiles().reported('r 1')]).toEqual([1, 2, 3]);
        expect(await failureOf(voiceFiles().reported('missing')), 'a file the report does not keep').toBe('voice-missing');
        expect(await failureOf(voiceFiles().reported('broken')), 'anything else').toBe('server');
        expect(asked).toEqual(['/api/admin/reports/r%201/voice', '/api/admin/reports/missing/voice', '/api/admin/reports/broken/voice']);
    });

    it('says a reported voice message in Persian, its clock in the reader’s digits', async () =>
    {
        useLocale().setLocale('fa');

        const { body, message } = await disclosedVoice();
        const id = reportFiled({ at: hoursAgo(1), by: 'sara.k', about: 'reza.t', message });

        keeping(() => Promise.resolve(body));

        const page = await opened(id);

        expect(said(page, '[data-message="voice"] p')).toBe('همون یه پیام صوتی که گزارش‌دهنده خواست نشون بده و همراه گزارش نگه داشته شده. سرور با چیزی که موقع فرستادنش ازش رد شده چکش کرده، پس همین گفته شده.');
        expect(said(page, '[data-clock]')).toBe('۰:۰۴');
        expect(playOf(page).getAttribute('aria-label')).toBe('پخش پیام صوتی، ۰:۰۴');
        expect(page.querySelector('[data-report-voice]')?.getAttribute('dir')).toBe('ltr');
    });

    it('closes a report at the press: the status, the row and the count of waiting reports, said once the server has', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'review');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.review(request);
        });

        useReports().told(3);
        const container = await opened(id);

        expect(said(container, 'header [data-status]')).toBe('Waiting');

        typeInto(why(container), '  Read the chat, nothing rude.  ');
        button(container, 'Reviewed, nothing to do')!.click();
        await settle();

        expect(sent).toHaveBeenCalledWith({ params: { id }, input: { outcome: 'reviewed', reason: 'Read the chat, nothing rude.' } });
        expect(said(container, 'header [data-status]')).toBe('Reviewed');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex reviewed sara.k’s report about reza.t: nothing to do.']);
        expect(button(container, 'Reviewed, nothing to do')).toBeUndefined();
        expect(useReports().waiting()).toBe(2);
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['The report is marked reviewed.']);
        expect(why(container).value).toBe('');
        expect(useReports().waiting()).toBe(0);
        expect(all(container, '[data-history] [data-reason]')).toEqual(['Read the chat, nothing rude.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.person } ${ row.details.outcome } ${ row.details.reporter }`)).toEqual(['report reza.t reviewed sara.k']);

        typeInto(why(container), 'Suspended them for a week.');
        button(container, 'Acted on it')!.click();
        await settle();

        expect(said(container, 'header [data-status]')).toBe('Acted on');
        expect(button(container, 'Reviewed, nothing to do')).toBeDefined();
        expect(button(container, 'Acted on it')).toBeUndefined();
        expect(useReports().waiting()).toBe(0);
    });

    it('takes a refused close back and says why in the reader\'s words, keeping what was typed', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });

        vi.spyOn(client.admin, 'review').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        useReports().told(1);
        const container = await opened(id);

        typeInto(why(container), 'Read the chat, nothing rude.');
        button(container, 'Acted on it')!.click();
        await settle();

        expect(said(container, 'header [data-status]')).toBe('Waiting');
        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(toasts()).toEqual(['That is above what your role may do.']);
        expect(why(container).value).toBe('Read the chat, nothing rude.');
        expect(useReports().waiting()).toBe(1);
    });

    it('asks for a reason before it closes anything', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });
        const container = await opened(id);

        typeInto(why(container), ' a ');
        button(container, 'Acted on it')!.click();
        await settle();

        expect(server.calls.filter((call) => call.startsWith('admin.review'))).toEqual([]);
        expect(said(container, '#admin-report-why-error')).toBe('Say why, in three characters or more.');
        expect(said(container, 'header [data-status]')).toBe('Waiting');
    });

    it('offers no close on a report about the reader or about somebody at or above them, and says why', async () =>
    {
        server.staff.owners = ['sara.k'];
        server.staff.members.push(staffMember('alex', 'moderator'), staffMember('mina', 'admin'));
        as('moderator');

        const cases: [string, string | null][] = [
            [reportFiled({ at: hoursAgo(4), by: 'reza.t', about: 'alex' }), 'This report is about you, so somebody else on the staff closes it.'],
            [reportFiled({ at: hoursAgo(3), by: 'reza.t', about: 'mina' }), 'They are an admin, and only somebody above them may close it.'],
            [reportFiled({ at: hoursAgo(2), by: 'reza.t', about: 'sara.k' }), 'It is about the owner, and nobody on the staff is above them.'],
            [reportFiled({ at: hoursAgo(1), by: 'mina', about: 'reza.t' }), null]
        ];

        for (const [id, sentence] of cases)
        {
            const container = await opened(id);

            expect(said(container, '[data-why-not]'), id).toBe(sentence);
            expect(container.querySelector('[data-outcomes]') !== null, id).toBe(sentence === null);
            cleanup();
        }
    });

    it('answers a report that is not there as missing, and one that could not be read with a way to try again', async () =>
    {
        const gone = await opened('report-404');

        expect(gone.textContent).toContain('No such report.');
        expect(gone.textContent).toContain('It may have gone with the account it was about.');
        cleanup();

        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });

        vi.spyOn(client.admin, 'report').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));
        const failed = await opened(id);

        expect(failed.textContent).toContain('This report could not be read.');
        expect(failed.textContent).not.toContain('No such report.');

        button(failed, 'Try again')!.click();
        await settle();

        expect(said(failed, 'h1')).toBe('Harassment or abuse');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const id = reportFiled({
            at: hoursAgo(3),
            by: 'sara.k',
            about: 'reza.t',
            category: 'cheating',
            message: '{"text":"Quit or I keep stalling"}',
            together: [{ id: 'm1', game: 'ludo', at: hoursAgo(4), live: false, by: 'lost', about: 'won' }]
        });
        const container = await opened(id);

        expect(said(container, 'h1')).toBe('تقلب');
        expect(said(container, '[data-said]')).toBe('sara.k از reza.t گزارش داد');
        expect(said(container, 'header [data-status]')).toBe('منتظر بررسی');
        expect(all(container, '[data-side="about"] .flex-col > span')).toEqual(['درباره‌ی', 'Reza Tehrani', '@reza.t']);
        expect(all(container, '[data-side="by"] .flex-col > span')).toEqual(['گزارش‌دهنده', 'Sara Kamali', '@sara.k']);
        expect(all(container, '[data-game="m1"] [data-seat]')).toEqual(['sara.k: باخت', 'reza.t: برد']);
        expect(button(container, 'بررسی شد، کاری لازم نیست')).toBeDefined();
        expect(button(container, 'رسیدگی کردم')).toBeDefined();
        expect(said(container, '#report-close')).toBe('بستن گزارش');
    });
});

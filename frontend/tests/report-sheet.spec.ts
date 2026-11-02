import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import ReportSheet from '../src/components/social/report-sheet.component.azeroth';
import { encodeVoice } from '../src/lib/body.ts';
import '../src/locales/app-catalogue.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const DISCLOSE = { conversationId: 'c-reza', messageId: 'm-1', frankingKey: 'a-key' };

const shown = (text?: string) => renderTest(() => ReportSheet({
    overlayId: 'report',
    close: vi.fn(),
    personId: 'reza',
    ...(text === undefined ? {} : { disclose: { ...DISCLOSE, text } })
}) as HTMLElement).container;

const showing = (root: ParentNode) => root.querySelector('[data-showing]')?.textContent?.trim() ?? null;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('the sheet that files a report', () =>
{
    it('says the words of the line it will show, never the document they were sealed in', () =>
    {
        expect(showing(shown('{"text":"You **played** badly"}'))).toBe('You played badly');
        cleanup();

        expect(showing(shown('{"text":"The ending ||was a twist||"}')), 'a spoiler kept as one').toBe('The ending (spoiler)');
        cleanup();

        expect(showing(shown('{"edit":"Changed to this","on":"m-1"}')), 'an edit, in the words it gave the line').toBe('Changed to this');
    });

    it('says a voice message as one, with its length', () =>
    {
        const document = encodeVoice({
            voice: { id: '0b5b0d47-5a3c-4f8e-9a51-6f0b3c2d1e7a', key: 'A'.repeat(43), iv: 'B'.repeat(16), mime: 'audio/webm;codecs=opus', ms: 4200, wave: 'AAA', bytes: 900 }
        });

        expect(showing(shown(document))).toBe('Voice message (0:04)');
    });

    it('shows no line when it was opened about the person alone', () =>
    {
        expect(shown().querySelector('[data-showing]')).toBeNull();
    });
});

describe('a line of a group’s room, reported', () =>
{
    const SLUG = 'friday-night-crew';

    beforeEach(async () =>
    {
        server.reset();
        useSession().reset();
        useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
        useGroups().reset();
        useChat().reset();
        server.conversations.find((row) => row.id === 'c-friday')!.groupId = SLUG;
        await useGroups().refresh();
        await useChat().refresh();
    });

    afterEach(() =>
    {
        useChat().reset();
        useGroups().reset();
        useSession().reset();
    });

    const sheet = (conversationId: string) => renderTest(() => ReportSheet({
        overlayId: 'report',
        close: vi.fn(),
        personId: 'mina',
        disclose: { conversationId, messageId: 'm-1', frankingKey: 'a-key', text: '{"text":"nine sharp"}' }
    }) as HTMLElement).container;

    const toGroup = (root: ParentNode) => root.querySelector<HTMLElement>('[data-to-group]');

    const send = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === useLocale().t('report.submit'))!;

    it('asks to tell the group’s admins too, on until it is turned off, and says what they will see', async () =>
    {
        const root = sheet('c-friday');

        await vi.waitFor(() => expect(toGroup(root)).not.toBeNull());
        expect(toGroup(root)?.textContent).toContain(useLocale().t('report.toGroup', { group: useGroups().byId(SLUG)?.name ?? '' }));
        expect(toGroup(root)?.textContent).toContain(useLocale().t('report.toGroupHint'));
        expect(toGroup(root)?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');

        fire(send(root), 'click');

        await vi.waitFor(() => expect(server.reportsToGroup).toHaveLength(1));
    });

    it('sends it to Nura’s team alone once the switch is turned off', async () =>
    {
        const root = sheet('c-friday');

        await vi.waitFor(() => expect(toGroup(root)).not.toBeNull());
        fire(toGroup(root)!.querySelector<HTMLElement>('[role="switch"]')!, 'click');
        fire(send(root), 'click');

        await vi.waitFor(() => expect(server.calls).toContain('social.report'));
        expect(server.reportsToGroup).toEqual([]);
    });

    it('does not ask beside a line of a direct chat, nor about the person alone', async () =>
    {
        const direct = sheet('c-reza');

        await Promise.resolve();
        expect(toGroup(direct)).toBeNull();
        cleanup();

        const alone = renderTest(() => ReportSheet({ overlayId: 'report', close: vi.fn(), personId: 'mina' }) as HTMLElement).container;

        expect(toGroup(alone)).toBeNull();
    });
});
